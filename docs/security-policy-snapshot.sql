-- Read-only snapshot of who can do what in the database, for security reviews.
-- Run in the Supabase SQL editor; it changes nothing. Copy the single JSON
-- result. Contains no secrets or personal data (only rules and definitions).

select jsonb_pretty(jsonb_build_object(
  -- Row level security on/off for every table in public
  'rls', (
    select jsonb_agg(jsonb_build_object('table', c.relname, 'rls', c.relrowsecurity, 'forced', c.relforcerowsecurity) order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  ),
  -- Every policy and its conditions
  'policies', (
    select jsonb_agg(jsonb_build_object(
      'table', tablename, 'name', policyname, 'cmd', cmd, 'roles', roles,
      'permissive', permissive, 'using', qual, 'check', with_check
    ) order by tablename, policyname)
    from pg_policies where schemaname = 'public'
  ),
  -- Table privileges held by the API roles
  'grants', (
    select jsonb_agg(jsonb_build_object('table', table_name, 'role', grantee, 'privileges', privs) order by table_name, grantee)
    from (
      select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')
      group by table_name, grantee
    ) g
  ),
  -- Column-level privileges (if any were used to protect columns)
  'column_grants', (
    select jsonb_agg(jsonb_build_object('table', table_name, 'column', column_name, 'role', grantee, 'privilege', privilege_type))
    from information_schema.column_privileges
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
      and (table_name, grantee) not in (
        select table_name, grantee from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'authenticated')
      )
  ),
  -- Functions in public: SECURITY DEFINER ones run with owner rights, so their code matters
  'functions', (
    select jsonb_agg(jsonb_build_object(
      'name', p.proname,
      'security_definer', p.prosecdef,
      'config', p.proconfig,
      'callable_by_anon', has_function_privilege('anon', p.oid, 'execute'),
      'callable_by_authenticated', has_function_privilege('authenticated', p.oid, 'execute'),
      'definition', case when p.prosecdef then pg_get_functiondef(p.oid) end
    ) order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  ),
  -- Triggers in public
  'triggers', (
    select jsonb_agg(jsonb_build_object('table', event_object_table, 'trigger', trigger_name, 'event', event_manipulation, 'timing', action_timing, 'action', action_statement) order by event_object_table, trigger_name)
    from information_schema.triggers where trigger_schema = 'public'
  ),
  -- Triggers on auth.users (e.g. a "create profile on sign-up" function) and their code
  'auth_user_triggers', (
    select jsonb_agg(jsonb_build_object('trigger', t.tgname, 'function', p.proname, 'definition', pg_get_functiondef(p.oid)))
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
  ),
  -- Profile columns (to judge what a self-update could change)
  'profiles_columns', (
    select jsonb_agg(jsonb_build_object('column', column_name, 'type', data_type, 'nullable', is_nullable, 'default', column_default) order by ordinal_position)
    from information_schema.columns where table_schema = 'public' and table_name = 'profiles'
  ),
  -- Storage buckets and whether they're public
  'storage_buckets', (select jsonb_agg(jsonb_build_object('id', id, 'public', public)) from storage.buckets)
)) as security_snapshot;
