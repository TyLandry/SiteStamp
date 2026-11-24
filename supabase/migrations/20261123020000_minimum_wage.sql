-- Alberta minimum wage for employees (Employment Standards Regulation s.9).
--
--  * profiles.student_rate_until: for an employee under 18 who is enrolled in
--    school, the day the $13.00 student minimum stops applying (their 18th
--    birthday, or sooner if they leave school). NULL = not a student. Their
--    date of birth is deliberately not stored.
--  * An employee's wage can't be saved below $15.00/h, or $13.00/h while the
--    student rate applies. Checked whenever the wage, type or student date is
--    set, for every writer (app, invite route, SQL editor). Existing rows are
--    left as they are until edited; pay runs top them up and warn.
--  * pay_run_inputs.school_break: the employer marks a pay period as a school
--    break for a student, which lets every hour be paid at the student rate
--    (s.9(1)(a.1)(i)); otherwise hours past 28 in a work week get $15.00.
-- Safe to run more than once.

begin;

alter table public.profiles
  add column if not exists student_rate_until date;

alter table public.pay_run_inputs
  add column if not exists school_break boolean not null default false;

-- The two rates, in one place (the app has the same numbers in src/utils/minimumWage.ts)
create or replace function public.ss_minimum_wage(student boolean)
returns numeric
language sql
immutable
as $$
  select case when student then 13.00 else 15.00 end
$$;

create or replace function public.ss_check_minimum_wage()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Edmonton')::date;
  student boolean;
begin
  if new.role is distinct from 'employee'
     or new.employee_type is distinct from 'employee'
     or new.hourly_wage is null then
    return new;
  end if;
  -- Only when something that decides the minimum is being set
  if tg_op = 'UPDATE'
     and new.hourly_wage is not distinct from old.hourly_wage
     and new.employee_type is not distinct from old.employee_type
     and new.student_rate_until is not distinct from old.student_rate_until then
    return new;
  end if;
  student := new.student_rate_until is not null and new.student_rate_until > today;
  if new.hourly_wage < public.ss_minimum_wage(student) then
    raise exception 'The wage is below Alberta''s minimum: $15.00/h, or $13.00/h for a student under 18 (Employment Standards Regulation s.9).'
      using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists profiles_minimum_wage on public.profiles;
create trigger profiles_minimum_wage
  before insert or update on public.profiles
  for each row execute function public.ss_check_minimum_wage();

commit;

notify pgrst, 'reload schema';
