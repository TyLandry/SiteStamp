# Setting up payroll extras and job sites

What to do in Supabase and the hosting environment for custom deductions,
vacation pay, holiday pay, company details, the T4 summary, job sites and
numeric clock locations. Rules and sources: [payroll-rules.md](payroll-rules.md).

## 1. Run the migration (before deploying the code)

The app code reads the new columns, so apply the migration first.

1. Supabase dashboard → SQL editor → paste
   `supabase/migrations/20261122000000_payroll_extras_and_job_sites.sql` → Run.
   (Or `supabase db push` if the project is linked to the Supabase CLI.)
2. It runs in one transaction and is safe to run again. It only adds tables,
   columns, functions, triggers and policies; nothing is dropped.
3. Then run `supabase/migrations/20261123000000_grant_new_tables.sql` the same
   way. This project doesn't grant new tables to signed-in users
   automatically; without it the new screens fail with "permission denied".
4. Then run `supabase/migrations/20261123010000_security_hardening.sql`. It
   enforces at the database level that:
   - nobody changes their own company or role from the app, and crew can only
     change their extra tax;
   - clock times come from the server, there's one open shift at a time, and
     closed shifts can't be edited;
   - only employers decide time off, and only pending requests can be withdrawn;
   - pay stubs stay within one company, and only active staff see job sites;
   - the API roles lose TRUNCATE, TRIGGER and REFERENCES.
5. Then run `supabase/migrations/20261123020000_minimum_wage.sql`: Alberta's
   minimum wage ($15.00, or $13.00 for students under 18), the
   `profiles.student_rate_until` column and the per-run school-break flag.
   The Crew & wages page and pay runs read these columns, so run it before
   using this version of the app.
6. Supabase → Authentication → Sign In / Providers: turn off **Allow new users
   to sign up**. SiteStamp is invite-only; invites use the admin API and keep
   working.

What it changes:

| Object | Change |
| --- | --- |
| `employer_profiles` (new) | Legal name, address, phone, email, CRA payroll account, default construction/other category, average-daily-wage period. Employer-only RLS. |
| `employee_pay_settings` (new) | Employment start date, category override, vacation and holiday pay timing. Employer-only RLS. Kept out of `profiles` because employees can update their own profile row. |
| `employee_deductions` (new) | Custom deductions. Employer-only RLS, no delete (deactivate instead). Check constraint fixes the tax/T4 treatment per kind. |
| `pay_run_inputs` (new) | Per-run payouts and holiday decisions. Employer-only RLS; locked once the run is finalized. |
| `pay_stubs` | New nullable columns: `calc_version`, `general_holiday_pay`, `holiday_pay_earned`, `holiday_pay_paid`, `vacation_pay_earned`, `vacation_pay_paid`. Old stubs keep NULL ("not tracked"), never $0. |
| `pay_stubs`, `pay_runs` | Triggers: finalized runs and their stubs can't be updated, deleted or added to. |
| `job_sites` | Created if missing; adds `address`, `latitude`, `longitude`, `radius_m` (default 200), `active`, timestamps, with range checks. Org members read; employers insert/update. |
| `time_entries` | Adds `job_site_id`, `clock_in_lat/lng/accuracy_m`, `clock_out_lat/lng/accuracy_m`. Copies old `"lat, lng"` text into the numbers where it parses; the old text columns are kept. Trigger: an active site is required when the company has one, it must be the same company's, and crew can't change the site or clock-in location afterwards. |
| Functions | `ss_current_org_id()`, `ss_is_employer()` (SECURITY DEFINER, read the caller's profile) plus trigger functions, all prefixed `ss_`. |

## 2. Check it worked

Run in the SQL editor:

```sql
-- New tables have RLS on
select relname, relrowsecurity from pg_class
where relname in ('employer_profiles','employee_pay_settings','employee_deductions','pay_run_inputs','job_sites');

-- Every policy on the new and changed tables
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where tablename in ('employer_profiles','employee_pay_settings','employee_deductions','pay_run_inputs','job_sites','time_entries','pay_stubs','pay_runs','profiles')
order by tablename, policyname;

-- How many old locations were converted, and how many couldn't be
select count(*) filter (where clock_in_location is not null) as had_text,
       count(*) filter (where clock_in_lat is not null) as now_numeric
from time_entries;
```

Things to look for in the policy list:

- **`job_sites` already existed?** If it did, any older policies still apply
  alongside the new ones (Postgres ORs permissive policies). Remove any that
  let employees write, or that aren't scoped to `org_id`.
- **`profiles` update policy.** Still open from the earlier review: if
  employees can update their own row, they can change `hourly_wage`. The new
  payroll settings are deliberately in employer-only tables, but the wage
  isn't. Fix that policy (or add a trigger) separately.
- `pay_stubs` / `pay_runs` / `time_entries` policies are unchanged by this
  migration and should already limit employees to their own rows.

## 3. Environment variables

None are required; all have safe defaults. Never put the service-role key in a
`NEXT_PUBLIC_` variable.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_MAP_TILE_URL` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Map tiles. OSM's tile server is best-effort with no SLA, may block heavy users, and forbids prefetching/offline use. For production traffic, use a commercial or self-hosted tile provider and set this. |
| `NEXT_PUBLIC_MAP_ATTRIBUTION` | `© OpenStreetMap contributors` (linked) | Must match the tile provider's attribution requirement. |
| `GEOCODER_URL` | `https://nominatim.openstreetmap.org` | Address ↔ pin lookups in the site editor (server-side). Any Nominatim-compatible URL, or `off` to disable lookups (employers then place pins by clicking the map). |
| `GEOCODER_CONTACT_EMAIL` | — | Added to the User-Agent sent to the geocoder, as Nominatim asks. Recommended. |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` in development; **required in production** | Where invite emails send people. Without it in production, invites are refused rather than pointing at localhost. Also identifies the app to the geocoder. |
| `SUPABASE_SERVICE_ROLE_KEY` | — | **Server only, required for invites.** Never prefix it with `NEXT_PUBLIC_`. |

The geocoder route limits itself to 1 request per second and caches results
for a day **per server process**. If the app runs on several instances, the
combined rate can exceed Nominatim's limit; use a provider with suitable
limits or self-host.

## 4. First-time setup in the app (employer)

1. **Settings → Company details**: legal name, address, phone/email, CRA
   payroll account (123456789RP0001). Shown on new and recalculated stubs; the
   account number only appears in the T4 summary.
2. **Payroll → Employee pay setup**: choose whether your crew are construction
   employees (company default), then per person: start date, overrides,
   vacation/holiday pay timing, deductions (with the employee's signed
   authorization on file).
3. **Job sites**: add sites with a pin and allowed distance. As soon as one
   site is active, crew must pick a site to clock in.
4. Recalculate any draft pay runs so they pick up the new settings.

## 5. Behaviour to expect after deploying

- Recalculate every draft made before the migration before finalizing it, so
  it gets vacation pay, holiday pay, deductions and the employer details. The
  draft screen marks those drafts out of date and disables Finalize until you
  recalculate.
- Finalized stubs from before keep their numbers. They show the company name
  from `orgs` (no address) and no vacation/holiday lines, because those weren't
  tracked then. Vacation and holiday balances start from the first stub made
  after this change.
- Old clock entries whose location text wasn't a coordinate pair show
  "Location unavailable".
