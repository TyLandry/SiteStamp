-- Table privileges for the tables added in 20261122000000.
--
-- This project doesn't grant new tables to the API roles automatically, so
-- without these signed-in users get "permission denied for table ...".
-- Privileges only open the door; the row level security policies from the
-- previous migration still decide which rows each user can see or change.
-- `anon` (signed-out visitors) gets nothing. Safe to run more than once.

begin;

grant select, insert, update on public.employer_profiles to authenticated;
grant select, insert, update on public.employee_pay_settings to authenticated;
grant select, insert, update on public.employee_deductions to authenticated;
grant select, insert, update, delete on public.pay_run_inputs to authenticated;
grant select, insert, update on public.job_sites to authenticated;

revoke all on public.employer_profiles from anon;
revoke all on public.employee_pay_settings from anon;
revoke all on public.employee_deductions from anon;
revoke all on public.pay_run_inputs from anon;
revoke all on public.job_sites from anon;

commit;

-- Ask the API to reload its schema cache right away
notify pgrst, 'reload schema';
