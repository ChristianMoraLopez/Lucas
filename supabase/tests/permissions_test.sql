-- ============================================================================
-- Lucas · tests/permissions_test.sql
-- Pruebas pgTAP de permisos (RLS + RPC).
--
-- ⚠️ CÓMO SE CORREN: con `supabase test db`, que levanta Postgres en Docker.
-- En la máquina de desarrollo actual NO hay Docker, así que este archivo NO
-- se ha podido ejecutar: está escrito y revisado a mano contra las
-- migraciones (00000000000001/10/20) y contra seed.sql.
--
-- Supuestos:
--   - `supabase test db` aplica migraciones y luego seed.sql (ids fijos).
--   - La imagen local de Supabase incluye pgTAP y el esquema `tests` con las
--     helpers tests.create_supabase_user(identifier, email) y
--     tests.authenticate_as(identifier). authenticate_as fija
--     request.jwt.claims y hace SET ROLE authenticated.
--
-- Ids deterministas del seed usados aquí:
--   usuarios:  10000000-...-01 Valeria (owner Casa y Paseo)
--              10000000-...-02 Juan Camilo (member Casa, admin Paseo)
--              10000000-...-03 Mafe (admin Paseo)
--              10000000-...-04 Andrés (member Paseo)
--   cuentas:   20000000-...-01 Casa · 20000000-...-02 Paseo Santa Marta
--   gastos:    60000000-...-01 Éxito (Casa) · 60000000-...-11 Hotel (Paseo)
--   invitación activa del paseo: código PASEO-7K2Q (uses = 0 en el seed)
-- ============================================================================

begin;

select plan(30);

-- ============================================================================
-- Preparación como superusuario (antes de autenticar)
-- ============================================================================

select tests.create_supabase_user('invitado-prueba', 'invitado-prueba@example.com');
select tests.create_supabase_user('fundador-prueba', 'fundador-prueba@example.com');

-- Invitación vencida del paseo para probar join_with_code
insert into public.invitations (id, account_id, code, role, expires_at, created_by)
values (
  'a0000000-0000-4000-8000-0000000000e1',
  '20000000-0000-4000-8000-000000000002',
  'PASEO-VENC',
  'member',
  now() - interval '1 day',
  '10000000-0000-4000-8000-000000000001'
);

-- ============================================================================
-- Andrés (member del Paseo, ajeno a Casa): RLS de expenses
-- ============================================================================

select tests.authenticate_as('andres@example.com');

select isnt_empty(
  $$ select 1 from public.expenses
     where account_id = '20000000-0000-4000-8000-000000000002' $$,
  'member puede ver los gastos de su cuenta'
);

select is_empty(
  $$ select 1 from public.expenses
     where account_id = '20000000-0000-4000-8000-000000000001' $$,
  'member no ve los gastos de otra cuenta'
);

select lives_ok($$
  insert into public.expenses (id, account_id, merchant, expense_date, total_cop, created_by)
  values ('60000000-0000-4000-8000-000000000099',
          '20000000-0000-4000-8000-000000000002',
          'Gasto de prueba', date '2026-09-29', 10000, (select auth.uid()))
$$, 'member puede reportar un gasto en su cuenta');

select is_empty(
  $$ update public.expenses set merchant = 'Cambio indebido'
     where id = '60000000-0000-4000-8000-000000000011' returning 1 $$,
  'member no puede editar un gasto'
);

select is_empty(
  $$ delete from public.expenses
     where id = '60000000-0000-4000-8000-000000000011' returning 1 $$,
  'member no puede borrar un gasto'
);

-- ============================================================================
-- Valeria (owner): sí puede editar
-- ============================================================================

select tests.authenticate_as('valeria@example.com');

select isnt_empty(
  $$ update public.expenses set merchant = 'Éxito Calle 80'
     where id = '60000000-0000-4000-8000-000000000001' returning 1 $$,
  'owner puede editar un gasto de su cuenta'
);

-- ============================================================================
-- Juan Camilo (admin del Paseo): borrar, roles e invitaciones
-- ============================================================================

select tests.authenticate_as('juancamilo@example.com');

select isnt_empty(
  $$ delete from public.expenses
     where id = '60000000-0000-4000-8000-000000000099' returning 1 $$,
  'admin puede borrar un gasto de su cuenta'
);

select throws_ok(
  $$ select public.set_member_role('20000000-0000-4000-8000-000000000002',
                                   '10000000-0000-4000-8000-000000000001',
                                   'member') $$,
  'P0001',
  'No se puede cambiar el rol del dueño de la cuenta',
  'nadie puede cambiar el rol del owner'
);

select matches(
  public.create_invitation('20000000-0000-4000-8000-000000000002'),
  '^[A-Z]{4}-[A-Z2-9]{4}$',
  'admin puede crear invitación con formato XXXX-XXXX'
);

select throws_ok(
  $$ select public.remove_member('20000000-0000-4000-8000-000000000002',
                                 '10000000-0000-4000-8000-000000000003') $$,
  'P0001',
  'Un administrador no puede expulsar a otro administrador',
  'un admin no puede expulsar a otro admin'
);

-- ============================================================================
-- Andrés (member): permisos de administrador negados
-- ============================================================================

select tests.authenticate_as('andres@example.com');

select throws_ok(
  $$ select public.create_invitation('20000000-0000-4000-8000-000000000002') $$,
  'P0001',
  'No tienes permisos de administrador en esta cuenta',
  'member no puede crear invitaciones'
);

select throws_ok(
  $$ select public.set_member_role('20000000-0000-4000-8000-000000000002',
                                   '10000000-0000-4000-8000-000000000004',
                                   'admin') $$,
  'P0001',
  'No puedes cambiar tu propio rol',
  'nadie puede promoverse a sí mismo'
);

select throws_ok(
  $$ select public.set_member_role('20000000-0000-4000-8000-000000000002',
                                   '10000000-0000-4000-8000-000000000003',
                                   'member') $$,
  'P0001',
  'No tienes permisos de administrador en esta cuenta',
  'member no puede cambiar el rol de otros'
);

-- ============================================================================
-- Valeria (owner): no puede expulsarse a sí misma ni unirse dos veces
-- ============================================================================

select tests.authenticate_as('valeria@example.com');

select throws_ok(
  $$ select public.remove_member('20000000-0000-4000-8000-000000000002',
                                 '10000000-0000-4000-8000-000000000001') $$,
  'P0001',
  'No se puede expulsar al dueño de la cuenta',
  'no se puede expulsar al owner'
);

select throws_ok(
  $$ select public.join_with_code('PASEO-7K2Q') $$,
  'P0001',
  'Ya eres miembro de esta cuenta',
  'un miembro no puede unirse dos veces con el código'
);

-- ============================================================================
-- Invitado nuevo: join_with_code inválido / vencido / válido
-- ============================================================================

select tests.authenticate_as('invitado-prueba@example.com');

select throws_ok(
  $$ select public.join_with_code('CODIGO-MALO') $$,
  'P0001',
  'Código de invitación no válido',
  'join_with_code con código inválido falla'
);

select throws_ok(
  $$ select public.join_with_code('PASEO-VENC') $$,
  'P0001',
  'La invitación está vencida',
  'join_with_code con código vencido falla'
);

select is(
  public.join_with_code(' paseo-7k2q ', null, 'Invitado de Prueba')::text,
  '20000000-0000-4000-8000-000000000002'::text,
  'join_with_code con código válido (minúsculas y espacios) devuelve la cuenta'
);

select isnt_empty(
  $$ select 1 from public.account_members
     where account_id = '20000000-0000-4000-8000-000000000002'
       and user_id = (select auth.uid()) $$,
  'la membresía del invitado quedó creada'
);

-- ============================================================================
-- Valeria (owner ve invitations): uses se incrementó en 1
-- ============================================================================

select tests.authenticate_as('valeria@example.com');

select is(
  (select uses from public.invitations where code = 'PASEO-7K2Q'),
  1,
  'join_with_code incrementa uses en 1'
);

-- ============================================================================
-- Fundador: INSERT directo prohibido, create_account completo
-- ============================================================================

select tests.authenticate_as('fundador-prueba@example.com');

select throws_ok($$
  insert into public.accounts (name, type, owner_id)
  values ('Cuenta ilegal', 'hogar', (select auth.uid()))
$$,
  '42501',
  null,
  'INSERT directo en accounts está prohibido por RLS'
);

select lives_ok($$
  select public.create_account('Viaje Medellín', 'evento',
                               date '2026-11-01', date '2026-11-05')
$$, 'create_account crea la cuenta sin error');

select is(
  (select am.role::text
   from public.account_members am
   join public.accounts a on a.id = am.account_id
   where a.name = 'Viaje Medellín'
     and am.user_id = (select auth.uid())),
  'owner',
  'create_account deja la membresía owner'
);

select isnt_empty($$
  select 1
  from public.people p
  join public.accounts a on a.id = p.account_id
  where a.name = 'Viaje Medellín'
    and p.claimed_by = (select auth.uid())
$$, 'create_account crea la persona del dueño ya reclamada');

select is(
  (select count(*)::int
   from public.categories c
   join public.accounts a on a.id = c.account_id
   where a.name = 'Viaje Medellín'),
  7,
  'create_account crea las 7 categorías por defecto'
);

-- ============================================================================
-- Andrés: tablas de infraestructura sin acceso para authenticated
-- ============================================================================

select tests.authenticate_as('andres@example.com');

select is_empty(
  $$ select 1 from public.whatsapp_connections $$,
  'whatsapp_connections: sin SELECT para authenticated'
);

select throws_ok($$
  insert into public.whatsapp_connections (label) values ('hack')
$$,
  '42501',
  null,
  'whatsapp_connections: sin INSERT para authenticated'
);

select is_empty(
  $$ select 1 from public.jobs $$,
  'jobs: sin SELECT para authenticated'
);

select throws_ok($$
  insert into public.jobs (type) values ('hack')
$$,
  '42501',
  null,
  'jobs: sin INSERT para authenticated'
);

select isnt_empty(
  $$ select 1 from public.whatsapp_groups $$,
  'member sí ve el grupo de WhatsApp enlazado a su cuenta'
);

select * from finish();

rollback;
