# Before merging `feature/payroll-and-job-sites` into `main`

For whoever reviews or merges this branch. Read this first, then the two docs
it points to. Status is as of **2026-11-23**.

## What's on this branch

**Payroll (employer side, under Payroll)**
- Custom deductions per employee: union dues, health/dental premiums, other
  benefit premiums, tool loans (optional total, stops when repaid), other.
  Each kind has a fixed tax and T4 treatment. Deactivate, don't delete.
- Vacation pay: Alberta rules for construction employees (6%) and other
  employees (4%, 6% from the 5th anniversary), paid on every cheque or saved
  up and paid out from a pay run. Balances come from finalized stubs only.
- General holiday pay: construction employees get 3.6% of wages. Other
  employees get the 9 Alberta holidays: eligibility, normal-work-day test,
  average daily wage and 1.5× premium, each overridable per person per run.
- Minimum wage: $15.00/h, or $13.00/h for students under 18 (first 28 school-week
  hours, all hours in a school break). Enforced on save and topped up in pay
  runs.
- CRA bonus method for vacation pay paid continuously or without leave.
- Employer details (legal name, address, contact, CRA payroll account) in
  Settings, saved onto each stub when it's calculated.
- Year-end T4 summary page and CSV for the accountant (finalized runs only).
- Pay run review panel; drafts out of date with current data can't be
  finalized until recalculated.

**Job sites and clock locations**
- Job sites with name, address, map pin and allowed distance (Job sites page).
- Clock-in/out stores numeric latitude, longitude and GPS accuracy; crew pick
  a site when the company has active ones.
- Employer map of the week's clock events with inside / maybe outside /
  outside flags (accounts for GPS accuracy).
- Address ↔ pin lookups through a server route with OpenStreetMap / Nominatim
  usage limits; map tiles from OpenStreetMap (configurable).

**Security and platform**
- Next.js 16.3.5 → 16.4.6 (critical remote-code-execution advisories in the
  old version). `npm audit`: 0 vulnerabilities.
- `src/middleware.ts` renamed to `src/proxy.ts` (Next 16 convention).
- Security headers on every response; `X-Powered-By` removed.
- Database hardening (see below) and a stricter invite route.

## Database: shared Supabase project

The app and every branch use the same Supabase project, so **these changes
are already live for `main` too**. Migrations, in order:

| Migration | Status | What it does |
| --- | --- | --- |
| `20261122000000_payroll_extras_and_job_sites.sql` | Applied | New tables, stub columns, job sites, numeric clock columns, finalized-payroll locks |
| `20261123000000_grant_new_tables.sql` | Applied | Lets signed-in users reach the new tables (RLS still limits rows) |
| `20261123010000_security_hardening.sql` | Applied | The access fixes below |
| `20261123020000_minimum_wage.sql` | **Not applied yet** | Minimum wage guard, `profiles.student_rate_until`, `pay_run_inputs.school_break` |

The current `main` code was reviewed against all four and keeps working, with
the behaviour changes below (not yet exercised in a browser on `main`).

### Behaviour that changed for everyone (including `main`)
- Crew clock-in and clock-out times come from the server, not the phone. One
  open shift per person; a closed shift can't be edited by crew.
- Time-off requests always start as pending in the requester's own company.
  Only employers approve or deny; crew can only withdraw a pending request.
- Nobody can change their own `org_id` or `role` from the app. Crew can only
  change their own extra tax per pay (name and everything else are employer-only).
- Finalized pay runs and stubs can't be edited, deleted or added to.
- Once a company has an active job site, clocking in requires picking one.
  **Don't create job sites until this branch is deployed**: the old clock-in
  screen on `main` doesn't send a site and would be refused.
- After the minimum wage migration: an employee's wage can't be saved below
  $15.00/h (or $13.00/h with a student end date).

## Checklist before merging

1. **Run `20261123020000_minimum_wage.sql`** in the Supabase SQL editor.
   Crew & wages and pay runs on this branch fail until it's in.
2. **Raise any employee wage under $15.00/h.** One existing employee is on
   $8.00/h; pay runs top it up and warn until it's fixed.
3. **Turn off public sign-up**: Supabase → Authentication → Sign In / Providers
   → "Allow new users to sign up" off. The app is invite-only; invites use the
   admin API and keep working.
4. **Security re-test with an employee account.** The attack checks from the
   audit (self-promotion, moving company, backdated or edited shifts, double
   shifts, self-approved time off, cross-company inserts) have been written
   but not yet run against the live database as an employee.
5. **Browser QA of writes** (only reads have been checked end to end):
   clock in/out on a phone (location allowed and blocked), add and edit a job
   site, set company details, set up an employee's pay and a deduction, run a
   draft pay run through to finalize, open the employee's stub, check the T4
   page.
6. **Check payroll numbers** for two or three stubs against CRA's PDOC
   (regular pay; vacation pay on every cheque; union dues).
7. **Environment for production**: `NEXT_PUBLIC_SITE_URL` (required for
   invites), `SUPABASE_SERVICE_ROLE_KEY` (server only, never `NEXT_PUBLIC_`),
   and ideally `NEXT_PUBLIC_MAP_TILE_URL` and `GEOCODER_CONTACT_EMAIL`. See
   `docs/payroll-and-job-sites.md`.
8. **Delete the two test accounts** used for the review
   (`review.admin@example.com`, `review.employee@example.com`) and their
   profile rows.
9. **Merge soon after.** Until then, any deployment of `main` runs Next.js
   16.3.5 with the remote-code-execution advisories.
10. `next.config.ts` lists two private LAN addresses in `allowedDevOrigins`
    (dev only, lets a phone on the same network use hot reload). Keep, change
    or remove to suit your machine.

## What to read
- `docs/payroll-rules.md`: every payroll rule with its source (Alberta
  Employment Standards Code and Regulation, CRA T4127, RC4120, tax-treatment
  pages) and access date, plus assumptions and limits.
- `docs/payroll-and-job-sites.md`: migrations, policy checks, environment
  variables, first-time setup, what to expect after deploying.
- `docs/security-policy-snapshot.sql`: read-only query that dumps every RLS
  policy, grant and security-definer function, for future reviews.
- Code to review first: `src/utils/payRun.ts` (the pay run engine),
  `src/utils/payroll.ts` (bonus method), `src/utils/leave.ts`,
  `src/utils/minimumWage.ts`, `src/utils/t4.ts`, and the four migrations.

## Known limits and improvements to consider
- **No wage history**: the average daily wage uses the current wage.
- **Schedules and absences aren't tracked**, so holiday entitlement under
  Code s.26(2) and holidays during vacation (s.31) rely on the employer's
  review in each pay run. Paying regular pay plus a substitute day off
  (s.29(1)(b)) isn't supported.
- **3-hour minimum** for shifts under 3 hours (Regulation s.11) isn't applied.
- **Monthly-salaried employees** and salesperson/domestic minimums aren't
  supported (hourly only).
- **Pay runs are calculated in the employer's browser** and written with RLS.
  Moving calculation and writes to server routes would make them harder to
  tamper with and easier to audit.
- **Employers can't edit or close an employee's shift** (no update policy for
  employers on `time_entries`); a forgotten clock-out must be closed by the
  employee.
- **Geocoder rate limit and cache are per server process**; with several
  instances use a provider whose limits fit, or self-host.
- **OpenStreetMap's tile server** has no SLA; use a commercial or self-hosted
  provider for production traffic.
- **Precise GPS is kept indefinitely**; add a retention period and a written
  notice to staff (Alberta PIPA).
- **Content Security Policy** covers framing, base URI, forms and plugins only;
  a script policy needs per-request nonces.
- **No automated tests** for the payroll formulas yet; the engine is pure
  functions and would be straightforward to cover.
- Duplicate RLS policies and finalized-payroll triggers (older ones plus the
  new ones) are harmless but could be consolidated.
- Times are grouped into days by the browser's time zone, as before.
