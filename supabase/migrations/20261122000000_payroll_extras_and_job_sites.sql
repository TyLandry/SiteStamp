-- SiteStamp: custom deductions, vacation pay, general holiday pay, employer
-- details, T4 preparation, job sites and numeric clock locations.
--
-- Written to be safe on the existing database, whose schema is not in this
-- repository: every statement is additive (IF NOT EXISTS / CREATE OR REPLACE),
-- nothing is dropped, and existing rows are only touched to copy old
-- "lat, lng" location text into the new numeric columns.
--
-- Assumes only what the app code already relies on:
--   profiles(id = auth.users.id, org_id, role 'employer' | 'employee')
--   orgs(id), pay_runs(id, org_id, status 'draft' | 'finalized')
--   pay_stubs(id, pay_run_id, org_id, profile_id, ...), time_entries(...)
--
-- Run it once in the Supabase SQL editor (or with `supabase db push`).
-- See docs/payroll-and-job-sites.md for the checks to run afterwards.

begin;

-- ---------------------------------------------------------------------------
-- Helpers for row level security. SECURITY DEFINER so policies can read the
-- caller's profile without depending on the profiles table's own policies.
-- ---------------------------------------------------------------------------

create or replace function public.ss_current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.profiles where id = auth.uid()
$$;

create or replace function public.ss_is_employer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'employer'
  )
$$;

revoke all on function public.ss_current_org_id() from public;
revoke all on function public.ss_is_employer() from public;
grant execute on function public.ss_current_org_id() to authenticated;
grant execute on function public.ss_is_employer() to authenticated;

create or replace function public.ss_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Employer details and company-wide payroll rules (one row per org)
-- ---------------------------------------------------------------------------

create table if not exists public.employer_profiles (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  legal_name text,
  address_line1 text,
  address_line2 text,
  city text,
  province text,
  postal_code text,
  phone text,
  email text,
  -- CRA payroll program account, e.g. 123456789RP0001 (T4 box 54)
  cra_payroll_account text,
  -- Alberta Employment Standards: are most employees "construction employees"
  -- under Employment Standards Regulation s.44? NULL = not chosen yet.
  default_es_category text,
  -- Code s.24.1: which 4-week period the average daily wage uses
  holiday_average_period text not null default 'preceding_4_weeks',
  updated_at timestamptz not null default now(),
  constraint employer_profiles_es_category_chk
    check (default_es_category is null or default_es_category in ('construction', 'general')),
  constraint employer_profiles_adw_period_chk
    check (holiday_average_period in ('preceding_4_weeks', 'preceding_pay_period')),
  constraint employer_profiles_payroll_account_chk
    check (cra_payroll_account is null or cra_payroll_account ~ '^[0-9]{9}RP[0-9]{4}$'),
  constraint employer_profiles_province_chk
    check (province is null or province in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')),
  constraint employer_profiles_postal_chk
    check (postal_code is null or postal_code ~ '^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$'),
  constraint employer_profiles_lengths_chk
    check (
      coalesce(char_length(legal_name), 0) <= 120
      and coalesce(char_length(address_line1), 0) <= 120
      and coalesce(char_length(address_line2), 0) <= 120
      and coalesce(char_length(city), 0) <= 80
      and coalesce(char_length(phone), 0) <= 30
      and coalesce(char_length(email), 0) <= 254
    )
);

drop trigger if exists employer_profiles_touch on public.employer_profiles;
create trigger employer_profiles_touch
  before update on public.employer_profiles
  for each row execute function public.ss_touch_updated_at();

alter table public.employer_profiles enable row level security;

drop policy if exists "employer_profiles: employer reads own org" on public.employer_profiles;
create policy "employer_profiles: employer reads own org"
  on public.employer_profiles for select to authenticated
  using (org_id = public.ss_current_org_id() and public.ss_is_employer());

drop policy if exists "employer_profiles: employer inserts own org" on public.employer_profiles;
create policy "employer_profiles: employer inserts own org"
  on public.employer_profiles for insert to authenticated
  with check (org_id = public.ss_current_org_id() and public.ss_is_employer());

drop policy if exists "employer_profiles: employer updates own org" on public.employer_profiles;
create policy "employer_profiles: employer updates own org"
  on public.employer_profiles for update to authenticated
  using (org_id = public.ss_current_org_id() and public.ss_is_employer())
  with check (org_id = public.ss_current_org_id() and public.ss_is_employer());

-- ---------------------------------------------------------------------------
-- Per-employee payroll settings. Kept out of `profiles` on purpose: employees
-- can update their own profile row (extra tax), and these must be
-- employer-only.
-- ---------------------------------------------------------------------------

create table if not exists public.employee_pay_settings (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  -- Start of continuous employment (Code s.36: breaks under 90 days don't reset it)
  employment_start_date date,
  -- NULL = use employer_profiles.default_es_category
  es_category text,
  vacation_pay_timing text not null default 'each_pay',
  -- Construction 3.6% general holiday pay only (Regulation s.46-47)
  holiday_pay_timing text not null default 'each_pay',
  updated_at timestamptz not null default now(),
  constraint employee_pay_settings_es_category_chk
    check (es_category is null or es_category in ('construction', 'general')),
  constraint employee_pay_settings_vac_timing_chk
    check (vacation_pay_timing in ('each_pay', 'accrue')),
  constraint employee_pay_settings_hol_timing_chk
    check (holiday_pay_timing in ('each_pay', 'accrue'))
);

-- The org must be the employee's org; stops a row pointing across companies
create or replace function public.ss_check_profile_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p where p.id = new.profile_id and p.org_id = new.org_id
  ) then
    raise exception 'That person is not in this company.' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists employee_pay_settings_org on public.employee_pay_settings;
create trigger employee_pay_settings_org
  before insert or update on public.employee_pay_settings
  for each row execute function public.ss_check_profile_org();

drop trigger if exists employee_pay_settings_touch on public.employee_pay_settings;
create trigger employee_pay_settings_touch
  before update on public.employee_pay_settings
  for each row execute function public.ss_touch_updated_at();

alter table public.employee_pay_settings enable row level security;

drop policy if exists "employee_pay_settings: employer reads" on public.employee_pay_settings;
create policy "employee_pay_settings: employer reads"
  on public.employee_pay_settings for select to authenticated
  using (org_id = public.ss_current_org_id() and public.ss_is_employer());

drop policy if exists "employee_pay_settings: employer inserts" on public.employee_pay_settings;
create policy "employee_pay_settings: employer inserts"
  on public.employee_pay_settings for insert to authenticated
  with check (org_id = public.ss_current_org_id() and public.ss_is_employer());

drop policy if exists "employee_pay_settings: employer updates" on public.employee_pay_settings;
create policy "employee_pay_settings: employer updates"
  on public.employee_pay_settings for update to authenticated
  using (org_id = public.ss_current_org_id() and public.ss_is_employer())
  with check (org_id = public.ss_current_org_id() and public.ss_is_employer());

-- ---------------------------------------------------------------------------
-- Custom deductions (union dues, benefit premiums, tool loans, other).
-- Never deleted, only deactivated, so finalized stubs keep their history.
-- ---------------------------------------------------------------------------

create table if not exists public.employee_deductions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  name text not null,
  amount_per_pay numeric(10, 2) not null,
  -- Tool loans: total lent. NULL = no balance tracking (deduct until deactivated)
  loan_total numeric(12, 2),
  -- 'union_dues_u1': reduces income for tax withholding (CRA T4127 factor U1)
  -- 'after_tax':     taken from net pay; no effect on tax, CPP or EI
  tax_treatment text not null,
  -- '44' union dues, '85' private health services plan premiums, NULL = not on the T4
  t4_box text,
  -- Code s.12(2)(b)/(c): collective agreement or the employee's written authorization
  authorization_on_file boolean not null default false,
  starts_on date,
  ends_on date,
  active boolean not null default true,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_deductions_kind_chk
    check (kind in ('union_dues', 'health_dental_premium', 'other_benefit_premium', 'tool_loan', 'other')),
  constraint employee_deductions_name_chk
    check (char_length(btrim(name)) between 1 and 60),
  constraint employee_deductions_amount_chk
    check (amount_per_pay > 0 and amount_per_pay <= 100000),
  constraint employee_deductions_loan_chk
    check (loan_total is null or (kind = 'tool_loan' and loan_total > 0)),
  constraint employee_deductions_dates_chk
    check (starts_on is null or ends_on is null or ends_on >= starts_on),
  -- The only valid treatment / T4 combinations
  constraint employee_deductions_treatment_chk
    check (
      (kind = 'union_dues' and tax_treatment = 'union_dues_u1' and (t4_box is null or t4_box = '44'))
      or (kind = 'health_dental_premium' and tax_treatment = 'after_tax' and (t4_box is null or t4_box = '85'))
      or (kind in ('other_benefit_premium', 'tool_loan', 'other') and tax_treatment = 'after_tax' and t4_box is null)
    )
);

create index if not exists employee_deductions_profile_idx
  on public.employee_deductions (profile_id);
create index if not exists employee_deductions_org_idx
  on public.employee_deductions (org_id);

drop trigger if exists employee_deductions_org on public.employee_deductions;
create trigger employee_deductions_org
  before insert or update on public.employee_deductions
  for each row execute function public.ss_check_profile_org();

drop trigger if exists employee_deductions_touch on public.employee_deductions;
create trigger employee_deductions_touch
  before update on public.employee_deductions
  for each row execute function public.ss_touch_updated_at();

alter table public.employee_deductions enable row level security;

drop policy if exists "employee_deductions: employer reads" on public.employee_deductions;
create policy "employee_deductions: employer reads"
  on public.employee_deductions for select to authenticated
  using (org_id = public.ss_current_org_id() and public.ss_is_employer());

drop policy if exists "employee_deductions: employer inserts" on public.employee_deductions;
create policy "employee_deductions: employer inserts"
  on public.employee_deductions for insert to authenticated
  with check (org_id = public.ss_current_org_id() and public.ss_is_employer());

drop policy if exists "employee_deductions: employer updates" on public.employee_deductions;
create policy "employee_deductions: employer updates"
  on public.employee_deductions for update to authenticated
  using (org_id = public.ss_current_org_id() and public.ss_is_employer())
  with check (org_id = public.ss_current_org_id() and public.ss_is_employer());

-- ---------------------------------------------------------------------------
-- Employer inputs for one pay run: vacation / holiday pay payouts and
-- general holiday decisions the app can't make from clock data alone.
-- ---------------------------------------------------------------------------

create table if not exists public.pay_run_inputs (
  pay_run_id uuid not null references public.pay_runs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  vacation_payout numeric(12, 2) not null default 0,
  -- CRA: vacation pay taken with leave uses the regular method; otherwise bonus method
  vacation_payout_on_leave boolean not null default true,
  holiday_payout numeric(12, 2) not null default 0,
  -- { "YYYY-MM-DD": { "eligible": bool|null, "normal_work_day": bool|null, "not_entitled": bool } }
  holiday_overrides jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (pay_run_id, profile_id),
  constraint pay_run_inputs_amounts_chk
    check (vacation_payout >= 0 and holiday_payout >= 0),
  constraint pay_run_inputs_overrides_chk
    check (jsonb_typeof(holiday_overrides) = 'object')
);

create or replace function public.ss_check_pay_run_input()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  run_org uuid;
  run_status text;
begin
  if tg_op = 'DELETE' then
    select org_id, status into run_org, run_status from public.pay_runs where id = old.pay_run_id;
    if run_status = 'finalized' then
      raise exception 'This pay run is finalized and can''t be changed.' using errcode = '23514';
    end if;
    return old;
  end if;

  select org_id, status into run_org, run_status from public.pay_runs where id = new.pay_run_id;
  if run_org is null or run_org <> new.org_id then
    raise exception 'That pay run is not in this company.' using errcode = '23514';
  end if;
  if run_status = 'finalized' then
    raise exception 'This pay run is finalized and can''t be changed.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.profiles p where p.id = new.profile_id and p.org_id = new.org_id) then
    raise exception 'That person is not in this company.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists pay_run_inputs_check on public.pay_run_inputs;
create trigger pay_run_inputs_check
  before insert or update or delete on public.pay_run_inputs
  for each row execute function public.ss_check_pay_run_input();

alter table public.pay_run_inputs enable row level security;

drop policy if exists "pay_run_inputs: employer reads" on public.pay_run_inputs;
create policy "pay_run_inputs: employer reads"
  on public.pay_run_inputs for select to authenticated
  using (org_id = public.ss_current_org_id() and public.ss_is_employer());

drop policy if exists "pay_run_inputs: employer inserts" on public.pay_run_inputs;
create policy "pay_run_inputs: employer inserts"
  on public.pay_run_inputs for insert to authenticated
  with check (org_id = public.ss_current_org_id() and public.ss_is_employer());

drop policy if exists "pay_run_inputs: employer updates" on public.pay_run_inputs;
create policy "pay_run_inputs: employer updates"
  on public.pay_run_inputs for update to authenticated
  using (org_id = public.ss_current_org_id() and public.ss_is_employer())
  with check (org_id = public.ss_current_org_id() and public.ss_is_employer());

drop policy if exists "pay_run_inputs: employer deletes" on public.pay_run_inputs;
create policy "pay_run_inputs: employer deletes"
  on public.pay_run_inputs for delete to authenticated
  using (org_id = public.ss_current_org_id() and public.ss_is_employer());

-- ---------------------------------------------------------------------------
-- Pay stub columns. All nullable with no default: NULL means "this stub was
-- made before SiteStamp tracked it", so old stubs are never shown as $0.
-- ---------------------------------------------------------------------------

alter table public.pay_stubs
  add column if not exists calc_version integer,
  add column if not exists general_holiday_pay numeric(12, 2),
  add column if not exists holiday_pay_earned numeric(12, 2),
  add column if not exists holiday_pay_paid numeric(12, 2),
  add column if not exists vacation_pay_earned numeric(12, 2),
  add column if not exists vacation_pay_paid numeric(12, 2);

-- Finalized payroll is a record: block edits, deletes and late additions.
create or replace function public.ss_protect_finalized_stub()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  target := case when tg_op = 'INSERT' then new.pay_run_id else old.pay_run_id end;
  if exists (select 1 from public.pay_runs where id = target and status = 'finalized') then
    raise exception 'Pay stubs in a finalized pay run can''t be changed.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.pay_run_id is distinct from old.pay_run_id
     and exists (select 1 from public.pay_runs where id = new.pay_run_id and status = 'finalized') then
    raise exception 'Pay stubs in a finalized pay run can''t be changed.' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

drop trigger if exists pay_stubs_protect_finalized on public.pay_stubs;
create trigger pay_stubs_protect_finalized
  before insert or update or delete on public.pay_stubs
  for each row execute function public.ss_protect_finalized_stub();

create or replace function public.ss_protect_finalized_run()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'finalized' then
    raise exception 'A finalized pay run can''t be changed or deleted.' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

drop trigger if exists pay_runs_protect_finalized on public.pay_runs;
create trigger pay_runs_protect_finalized
  before update or delete on public.pay_runs
  for each row execute function public.ss_protect_finalized_run();

-- ---------------------------------------------------------------------------
-- Job sites
-- ---------------------------------------------------------------------------

create table if not exists public.job_sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null
);

alter table public.job_sites
  add column if not exists address text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  -- Allowed distance from the pin before a clock event is flagged
  add column if not exists radius_m integer not null default 200,
  add column if not exists active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'job_sites_name_chk') then
    alter table public.job_sites add constraint job_sites_name_chk
      check (char_length(btrim(name)) between 1 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'job_sites_coords_chk') then
    alter table public.job_sites add constraint job_sites_coords_chk
      check (
        (latitude is null and longitude is null)
        or (latitude between -90 and 90 and longitude between -180 and 180)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'job_sites_radius_chk') then
    alter table public.job_sites add constraint job_sites_radius_chk
      check (radius_m between 25 and 5000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'job_sites_address_chk') then
    alter table public.job_sites add constraint job_sites_address_chk
      check (address is null or char_length(address) <= 300);
  end if;
end
$$;

create index if not exists job_sites_org_idx on public.job_sites (org_id);

drop trigger if exists job_sites_touch on public.job_sites;
create trigger job_sites_touch
  before update on public.job_sites
  for each row execute function public.ss_touch_updated_at();

alter table public.job_sites enable row level security;

-- Crew members see their company's sites (to pick one at clock-in)
drop policy if exists "job_sites: org members read" on public.job_sites;
create policy "job_sites: org members read"
  on public.job_sites for select to authenticated
  using (org_id = public.ss_current_org_id());

drop policy if exists "job_sites: employer inserts" on public.job_sites;
create policy "job_sites: employer inserts"
  on public.job_sites for insert to authenticated
  with check (org_id = public.ss_current_org_id() and public.ss_is_employer());

drop policy if exists "job_sites: employer updates" on public.job_sites;
create policy "job_sites: employer updates"
  on public.job_sites for update to authenticated
  using (org_id = public.ss_current_org_id() and public.ss_is_employer())
  with check (org_id = public.ss_current_org_id() and public.ss_is_employer());

-- ---------------------------------------------------------------------------
-- Numeric clock locations and the selected job site
-- ---------------------------------------------------------------------------

alter table public.time_entries
  add column if not exists job_site_id uuid references public.job_sites(id) on delete set null,
  add column if not exists clock_in_lat double precision,
  add column if not exists clock_in_lng double precision,
  add column if not exists clock_in_accuracy_m double precision,
  add column if not exists clock_out_lat double precision,
  add column if not exists clock_out_lng double precision,
  add column if not exists clock_out_accuracy_m double precision;

create index if not exists time_entries_job_site_idx on public.time_entries (job_site_id);

-- Copy old "lat, lng" text into the numeric columns. Text that isn't exactly a
-- valid coordinate pair is left alone (shown as "location unavailable").
-- The old text columns are kept so nothing is lost.
update public.time_entries t
set clock_in_lat = m.lat, clock_in_lng = m.lng
from (
  select id,
         (regexp_match(clock_in_location, '^\s*(-?[0-9]{1,2}(?:\.[0-9]+)?)\s*,\s*(-?[0-9]{1,3}(?:\.[0-9]+)?)\s*$'))[1]::double precision as lat,
         (regexp_match(clock_in_location, '^\s*(-?[0-9]{1,2}(?:\.[0-9]+)?)\s*,\s*(-?[0-9]{1,3}(?:\.[0-9]+)?)\s*$'))[2]::double precision as lng
  from public.time_entries
  where clock_in_lat is null and clock_in_location is not null
) m
where t.id = m.id
  and m.lat between -90 and 90
  and m.lng between -180 and 180;

update public.time_entries t
set clock_out_lat = m.lat, clock_out_lng = m.lng
from (
  select id,
         (regexp_match(clock_out_location, '^\s*(-?[0-9]{1,2}(?:\.[0-9]+)?)\s*,\s*(-?[0-9]{1,3}(?:\.[0-9]+)?)\s*$'))[1]::double precision as lat,
         (regexp_match(clock_out_location, '^\s*(-?[0-9]{1,2}(?:\.[0-9]+)?)\s*,\s*(-?[0-9]{1,3}(?:\.[0-9]+)?)\s*$'))[2]::double precision as lng
  from public.time_entries
  where clock_out_lat is null and clock_out_location is not null
) m
where t.id = m.id
  and m.lat between -90 and 90
  and m.lng between -180 and 180;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'time_entries_in_coords_chk') then
    alter table public.time_entries add constraint time_entries_in_coords_chk
      check (
        (clock_in_lat is null and clock_in_lng is null and clock_in_accuracy_m is null)
        or (clock_in_lat between -90 and 90 and clock_in_lng between -180 and 180
            and (clock_in_accuracy_m is null or clock_in_accuracy_m >= 0))
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'time_entries_out_coords_chk') then
    alter table public.time_entries add constraint time_entries_out_coords_chk
      check (
        (clock_out_lat is null and clock_out_lng is null and clock_out_accuracy_m is null)
        or (clock_out_lat between -90 and 90 and clock_out_lng between -180 and 180
            and (clock_out_accuracy_m is null or clock_out_accuracy_m >= 0))
      );
  end if;
end
$$;

-- Clock-in rules that must hold even if someone skips the UI:
--  * the site must be an active site of the same company
--  * if the company has active sites, a site is required
--  * crew members can't change the site or the clock-in location afterwards,
--    and can only record a clock-out location while clocking out
-- Rows written by the service role or the SQL editor (no auth.uid()) are not checked.
create or replace function public.ss_check_time_entry_site()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_employer boolean;
begin
  if auth.uid() is null then
    return new;
  end if;
  is_employer := public.ss_is_employer();

  if tg_op = 'UPDATE' and not is_employer then
    if new.job_site_id is distinct from old.job_site_id
       or new.clock_in_lat is distinct from old.clock_in_lat
       or new.clock_in_lng is distinct from old.clock_in_lng
       or new.clock_in_accuracy_m is distinct from old.clock_in_accuracy_m then
      raise exception 'The job site and clock-in location can''t be changed.' using errcode = '42501';
    end if;
    if old.clock_out is not null and (
         new.clock_out_lat is distinct from old.clock_out_lat
         or new.clock_out_lng is distinct from old.clock_out_lng
         or new.clock_out_accuracy_m is distinct from old.clock_out_accuracy_m) then
      raise exception 'The clock-out location can''t be changed.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.job_site_id is not null then
    if not exists (
      select 1 from public.job_sites s
      where s.id = new.job_site_id and s.org_id = new.org_id
        and (s.active or (tg_op = 'UPDATE' and new.job_site_id = old.job_site_id))
    ) then
      raise exception 'Pick one of your company''s active job sites.' using errcode = '23514';
    end if;
  elsif tg_op = 'INSERT' and exists (
    select 1 from public.job_sites s where s.org_id = new.org_id and s.active
  ) then
    raise exception 'Pick the job site you''re working at.' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists time_entries_check_site on public.time_entries;
create trigger time_entries_check_site
  before insert or update on public.time_entries
  for each row execute function public.ss_check_time_entry_site();

commit;
