-- Security hardening from the 2026-11-23 review.
--
-- Closes, at the database level (so it holds even if someone skips the app):
--  * an employer changing their own org_id to take over another company
--  * employees renaming themselves or changing anything but their extra tax
--  * employees adding or editing shifts with chosen times, or editing closed shifts
--  * employees approving their own time off or deleting decided requests
--  * rows inserted into another company's shifts or time-off queue
--  * pay stubs pointing at a person or pay run from another company
--  * terminated staff listing job sites
--  * TRUNCATE / TRIGGER / REFERENCES privileges held by the API roles
--
-- Every check skips rows written without a signed-in user (auth.uid() is null):
-- the service role (invite route) and the SQL editor keep full control.
-- Additive and safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create or replace function public.ss_guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  -- Nobody moves themselves or anyone else between companies or roles from the app
  if new.id is distinct from old.id
     or new.org_id is distinct from old.org_id
     or new.role is distinct from old.role then
    raise exception 'Role and company can only be changed by an administrator.' using errcode = '42501';
  end if;

  -- Crew members can change only their own extra tax per pay
  if not public.ss_is_employer()
     and (to_jsonb(new) - 'extra_tax_per_pay') is distinct from (to_jsonb(old) - 'extra_tax_per_pay') then
    raise exception 'You can only change your extra tax.' using errcode = '42501';
  end if;

  return new;
end
$$;

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.ss_guard_profile_update();

-- ---------------------------------------------------------------------------
-- Shifts: server clock, own company, no edits once closed
-- (replaces the function from 20261122000000; its trigger keeps pointing here)
-- ---------------------------------------------------------------------------

create or replace function public.ss_check_time_entry_site()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_employer boolean;
  -- What a crew member may change when clocking out. clock_out_location is
  -- the old text column, kept so the previous app version can still clock out.
  clock_out_fields text[] := array['clock_out', 'clock_out_lat', 'clock_out_lng', 'clock_out_accuracy_m', 'clock_out_location'];
begin
  if auth.uid() is null then
    return new;
  end if;
  is_employer := public.ss_is_employer();

  if tg_op = 'INSERT' then
    if new.org_id is distinct from public.ss_current_org_id() then
      raise exception 'Shifts can only be added to your own company.' using errcode = '42501';
    end if;
    if not is_employer then
      -- One open shift at a time: two open shifts closed together would pay twice
      if exists (select 1 from public.time_entries t where t.profile_id = new.profile_id and t.clock_out is null) then
        raise exception 'You''re already clocked in.' using errcode = '23514';
      end if;
      -- The server's clock, not the phone's
      new.clock_in := now();
      if new.clock_out is not null or new.clock_out_lat is not null
         or new.clock_out_lng is not null or new.clock_out_accuracy_m is not null then
        raise exception 'A shift starts when you clock in; clock out separately.' using errcode = '42501';
      end if;
    end if;
  else
    if new.org_id is distinct from old.org_id or new.profile_id is distinct from old.profile_id then
      raise exception 'A shift can''t be moved to another person or company.' using errcode = '42501';
    end if;
    if not is_employer then
      if old.clock_out is not null then
        raise exception 'This shift is closed and can''t be changed.' using errcode = '42501';
      end if;
      if new.clock_out is null then
        raise exception 'The only change allowed is clocking out.' using errcode = '42501';
      end if;
      if (to_jsonb(new) - clock_out_fields) is distinct from (to_jsonb(old) - clock_out_fields) then
        raise exception 'The clock-in time, job site and clock-in location can''t be changed.' using errcode = '42501';
      end if;
      new.clock_out := now();
      return new;
    end if;
  end if;

  -- Job site rules (insert by anyone, update by an employer)
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

-- ---------------------------------------------------------------------------
-- Time off: requests start pending in your own company; only employers decide
-- ---------------------------------------------------------------------------

create or replace function public.ss_guard_time_off()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_employer boolean;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  is_employer := public.ss_is_employer();

  if tg_op = 'INSERT' then
    if new.org_id is distinct from public.ss_current_org_id() then
      raise exception 'Requests can only be made in your own company.' using errcode = '42501';
    end if;
    new.status := 'pending';
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if not is_employer then
      raise exception 'Only your employer can change a time-off request.' using errcode = '42501';
    end if;
    -- Employers decide; the request itself stays as the employee made it
    if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
      raise exception 'Only the decision on a request can be changed.' using errcode = '42501';
    end if;
    if new.status not in ('pending', 'approved', 'denied') then
      raise exception 'A request can only be pending, approved or denied.' using errcode = '23514';
    end if;
    return new;
  end if;

  -- DELETE: decided requests are a record; only a pending one can be withdrawn
  if not is_employer and old.status is distinct from 'pending' then
    raise exception 'Only a pending request can be withdrawn.' using errcode = '42501';
  end if;
  return old;
end
$$;

drop trigger if exists time_off_requests_guard on public.time_off_requests;
create trigger time_off_requests_guard
  before insert or update or delete on public.time_off_requests
  for each row execute function public.ss_guard_time_off();

-- ---------------------------------------------------------------------------
-- Pay stubs: the person and the pay run must be in the stub's company
-- ---------------------------------------------------------------------------

create or replace function public.ss_check_stub_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if not exists (select 1 from public.profiles p where p.id = new.profile_id and p.org_id = new.org_id)
     or not exists (select 1 from public.pay_runs r where r.id = new.pay_run_id and r.org_id = new.org_id) then
    raise exception 'That pay stub''s person or pay run is not in this company.' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists pay_stubs_check_org on public.pay_stubs;
create trigger pay_stubs_check_org
  before insert or update on public.pay_stubs
  for each row execute function public.ss_check_stub_org();

-- ---------------------------------------------------------------------------
-- Job sites: only active staff (and employers) can list them
-- ---------------------------------------------------------------------------

create or replace function public.ss_is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and status = 'active'
  )
$$;

revoke all on function public.ss_is_active_member() from public;
grant execute on function public.ss_is_active_member() to authenticated;

drop policy if exists "job_sites: org members read" on public.job_sites;
create policy "job_sites: org members read"
  on public.job_sites for select to authenticated
  using (org_id = public.ss_current_org_id() and (public.ss_is_employer() or public.ss_is_active_member()));

-- ---------------------------------------------------------------------------
-- Privileges the API never needs. TRUNCATE in particular ignores row level
-- security. Also stop future tables from getting them by default.
-- ---------------------------------------------------------------------------

revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;

commit;

notify pgrst, 'reload schema';
