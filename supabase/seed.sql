-- ============================================================================
-- Lucas · seed.sql
-- Datos de ejemplo alineados con las pantallas de referencia del kit de
-- diseño (lucas-design-kit/referencia/pantallas/_datos-y-marcos.jsx):
--
--   · «Paseo Santa Marta» (evento, 24 – 28 sep 2026): 8 personas, $4.816.000,
--     $602.000 por cabeza, 3 gastos por revisar, código PASEO-7K2Q.
--   · «Casa» (hogar de Valeria y Andrés): mes en curso, $2.395.200 de un
--     presupuesto de $2.600.000, 1 gasto por revisar.
--
-- Comercios inventados. Solo para desarrollo local (supabase db reset):
-- NO lo corras en el proyecto remoto, crea usuarios de prueba.
--
-- Ids deterministas para las pruebas. Prefijos por tabla:
--   10000000 usuarios        20000000 cuentas       30000000 people
--   40000000 categories      50000000 budgets       60000000 expenses
--   70000000 expense_items   90000000 merchant_mem  a0000000 invitations
--   c0000000 connections     d0000000 groups        e0000000 messages
-- ============================================================================

begin;

-- Día n del mes en curso, sin pasarse de hoy (Casa siempre muestra «este mes»)
create function pg_temp.dia(n int) returns date
language sql as $$
  select least(date_trunc('month', current_date)::date + (n - 1), current_date)
$$;

-- ============================================================================
-- Usuarios (contraseña local: lucas1234). El trigger on_auth_user_created
-- crea los perfiles con el full_name. En la web se entra con enlace mágico:
-- en local los correos llegan a Mailpit (http://localhost:54324).
-- ============================================================================

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('lucas1234', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  jsonb_build_object('full_name', u.nombre),
  now(), now(), '', '', '', ''
from (values
  ('10000000-0000-4000-8000-000000000001'::uuid, 'valeria@example.com',    'Valeria Ríos'),
  ('10000000-0000-4000-8000-000000000002'::uuid, 'juancamilo@example.com', 'Juan Camilo Torres'),
  ('10000000-0000-4000-8000-000000000003'::uuid, 'mafe@example.com',       'Mafe Cárdenas'),
  ('10000000-0000-4000-8000-000000000004'::uuid, 'andres@example.com',     'Andrés Peña'),
  ('10000000-0000-4000-8000-000000000005'::uuid, 'laura@example.com',      'Laura Gómez'),
  ('10000000-0000-4000-8000-000000000006'::uuid, 'santi@example.com',      'Santi Herrera')
) as u (id, email, nombre);

insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.id::text like '10000000-%';

update public.profiles
set privacy_accepted_at = now(), privacy_version = '2026-09'
where id::text like '10000000-%';

-- ============================================================================
-- Cuentas
-- ============================================================================

insert into public.accounts (id, name, type, owner_id, starts_on, ends_on, created_at)
values
  ('20000000-0000-4000-8000-000000000001', 'Casa', 'hogar',
   '10000000-0000-4000-8000-000000000001', null, null, timestamptz '2026-03-02 20:10:00-05'),
  ('20000000-0000-4000-8000-000000000002', 'Paseo Santa Marta', 'evento',
   '10000000-0000-4000-8000-000000000001', date '2026-09-24', date '2026-09-28', timestamptz '2026-09-18 21:30:00-05');

-- ============================================================================
-- Personas (tonos como setTones del kit: cada quien conserva su color)
-- ============================================================================

insert into public.people (id, account_id, display_name, tone, claimed_by, consent_at)
values
  -- Casa
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Valeria',     'morado',   '10000000-0000-4000-8000-000000000001', now()),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Andrés',      'coral',    '10000000-0000-4000-8000-000000000004', now()),
  -- Paseo Santa Marta: 6 con cuenta…
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'Valeria',     'morado',   '10000000-0000-4000-8000-000000000001', now()),
  ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002', 'Juan Camilo', 'naranja',  '10000000-0000-4000-8000-000000000002', now()),
  ('30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000002', 'Mafe',        'azul',     '10000000-0000-4000-8000-000000000003', now()),
  ('30000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000002', 'Andrés',      'coral',    '10000000-0000-4000-8000-000000000004', now()),
  ('30000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000002', 'Laura',       'verde',    '10000000-0000-4000-8000-000000000005', now()),
  ('30000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000002', 'Santi',       'amarillo', '10000000-0000-4000-8000-000000000006', now()),
  -- …y 2 solo en WhatsApp, esperando que alguien las reclame
  ('30000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-000000000002', 'Caro',        'turquesa', null, null),
  ('30000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-000000000002', 'Felipe',      'rosa',     null, null);

-- ============================================================================
-- Membresías
-- ============================================================================

insert into public.account_members (account_id, user_id, role, person_id, joined_at)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner',  '30000000-0000-4000-8000-000000000001', timestamptz '2026-03-02 20:10:00-05'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', 'admin',  '30000000-0000-4000-8000-000000000002', timestamptz '2026-03-02 20:25:00-05'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'owner',  '30000000-0000-4000-8000-000000000003', timestamptz '2026-09-18 21:30:00-05'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000005', 'admin',  '30000000-0000-4000-8000-000000000007', timestamptz '2026-09-24 08:05:00-05'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', 'member', '30000000-0000-4000-8000-000000000005', timestamptz '2026-09-19 12:40:00-05'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'member', '30000000-0000-4000-8000-000000000004', timestamptz '2026-09-19 18:02:00-05'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004', 'member', '30000000-0000-4000-8000-000000000006', timestamptz '2026-09-20 09:15:00-05'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000006', 'member', '30000000-0000-4000-8000-000000000008', timestamptz '2026-09-21 22:48:00-05');

-- Números de WhatsApp (E.164 sin «+») de quienes escriben al grupo
insert into public.person_whatsapp_ids (person_id, wa_id)
values
  ('30000000-0000-4000-8000-000000000001', '573001112233'), -- Valeria (Casa)
  ('30000000-0000-4000-8000-000000000002', '573017778899'), -- Andrés (Casa)
  ('30000000-0000-4000-8000-000000000003', '573001112233'), -- Valeria
  ('30000000-0000-4000-8000-000000000004', '573014445566'), -- Juan Camilo
  ('30000000-0000-4000-8000-000000000005', '573016667788'), -- Mafe
  ('30000000-0000-4000-8000-000000000006', '573017778899'), -- Andrés
  ('30000000-0000-4000-8000-000000000007', '573105550142'), -- Laura
  ('30000000-0000-4000-8000-000000000008', '573128880365'), -- Santi
  ('30000000-0000-4000-8000-000000000009', '573002224471'), -- Caro
  ('30000000-0000-4000-8000-00000000000a', '573157770918'); -- Felipe

-- ============================================================================
-- Categorías por defecto (mismas que crea el RPC create_account)
-- ============================================================================

insert into public.categories (id, account_id, name, letter, tone, is_default)
select
  ('40000000-0000-4000-8000-0000000000' || c.prefijo || cat.n)::uuid,
  c.cuenta, cat.name, cat.letter, cat.tone, true
from (values
  ('0', '20000000-0000-4000-8000-000000000001'::uuid),
  ('1', '20000000-0000-4000-8000-000000000002'::uuid)
) as c (prefijo, cuenta)
cross join (values
  ('1', 'Café',        'C', 'naranja'),
  ('2', 'Licor',       'L', 'morado'),
  ('3', 'Mercado',     'M', 'verde'),
  ('4', 'Transporte',  'T', 'azul'),
  ('5', 'Hospedaje',   'H', 'turquesa'),
  ('6', 'Restaurante', 'R', 'coral'),
  ('7', 'Servicios',   'S', 'amarillo'),
  ('8', 'Otros',       'O', 'rosa')
) as cat (n, name, letter, tone);

-- ============================================================================
-- Presupuestos de Casa para el mes en curso ($2.600.000 en total)
-- ============================================================================

insert into public.budgets (id, account_id, category_id, period, amount_cop)
values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', date_trunc('month', current_date)::date, 1300000), -- Mercado
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007', date_trunc('month', current_date)::date,  450000), -- Servicios
  ('50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000006', date_trunc('month', current_date)::date,  350000), -- Restaurante
  ('50000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000004', date_trunc('month', current_date)::date,  300000), -- Transporte
  ('50000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', date_trunc('month', current_date)::date,  120000), -- Licor
  ('50000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', date_trunc('month', current_date)::date,   80000), -- Café
  ('50000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000001', null,                                   date_trunc('month', current_date)::date, 2600000); -- Total

-- ============================================================================
-- WhatsApp: el número contador y los dos grupos enlazados
-- ============================================================================

insert into public.whatsapp_connections (id, label, status, phone_number, created_by)
values ('c0000000-0000-4000-8000-000000000001', 'Número contador (SIM prepago)', 'connected', '573150000000',
        '10000000-0000-4000-8000-000000000001');

insert into public.whatsapp_groups (id, connection_id, wa_group_jid, name)
values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', '120363040123456789@g.us', 'Paseo Santa Marta 2026'),
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', '120363040987654321@g.us', 'Casa V&A');

insert into public.account_group_links (group_id, account_id, linked_by)
values
  ('d0000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001');

-- Mensajes que parecían gastos (solo esos se guardan)
insert into public.messages (id, group_id, wa_message_id, sender_wa_id, kind, text_body, media_path, received_at, processed_at)
values
  -- Paseo
  ('e0000000-0000-4000-8000-000000000012', 'd0000000-0000-4000-8000-000000000001', '3EB0A1F2C4D6E8A01012', '573105550142', 'pdf',   null, 'evidencias/20000000-0000-4000-8000-000000000002/cabanas-taganga.pdf',      timestamptz '2026-09-25 09:12:00-05', timestamptz '2026-09-25 09:12:40-05'),
  ('e0000000-0000-4000-8000-000000000014', 'd0000000-0000-4000-8000-000000000001', '3EB0A1F2C4D6E8A01014', '573001112233', 'photo', null, 'evidencias/20000000-0000-4000-8000-000000000002/la-canoa.webp',            timestamptz '2026-09-25 22:41:00-05', timestamptz '2026-09-25 22:41:35-05'),
  ('e0000000-0000-4000-8000-000000000015', 'd0000000-0000-4000-8000-000000000001', '3EB0A1F2C4D6E8A01015', '573016667788', 'photo', null, 'evidencias/20000000-0000-4000-8000-000000000002/arepas-dona-chela.webp',   timestamptz '2026-09-27 08:30:00-05', timestamptz '2026-09-27 08:30:52-05'),
  ('e0000000-0000-4000-8000-000000000016', 'd0000000-0000-4000-8000-000000000001', '3EB0A1F2C4D6E8A01016', '573002224471', 'photo', null, 'evidencias/20000000-0000-4000-8000-000000000002/pescaderia-el-muelle.webp', timestamptz '2026-09-26 14:05:00-05', timestamptz '2026-09-26 14:05:31-05'),
  ('e0000000-0000-4000-8000-000000000017', 'd0000000-0000-4000-8000-000000000001', '3EB0A1F2C4D6E8A01017', '573157770918', 'photo', null, 'evidencias/20000000-0000-4000-8000-000000000002/asadero-el-rodadero.webp',  timestamptz '2026-09-28 21:18:00-05', timestamptz '2026-09-28 21:18:44-05'),
  ('e0000000-0000-4000-8000-000000000018', 'd0000000-0000-4000-8000-000000000001', '3EB0A1F2C4D6E8A01018', '573128880365', 'text',  'Empanadas y jugos en La Bahía 111.500', null,                                            timestamptz '2026-09-24 19:50:00-05', timestamptz '2026-09-24 19:50:08-05'),
  ('e0000000-0000-4000-8000-000000000019', 'd0000000-0000-4000-8000-000000000001', '3EB0A1F2C4D6E8A01019', '573014445566', 'photo', null, 'evidencias/20000000-0000-4000-8000-000000000002/gasolina-la-ye.webp',       timestamptz '2026-09-24 06:20:00-05', timestamptz '2026-09-24 06:20:37-05'),
  ('e0000000-0000-4000-8000-00000000001b', 'd0000000-0000-4000-8000-000000000001', '3EB0A1F2C4D6E8A0101B', '573016667788', 'text',  'La lancha a Playa Cristal la pagó Santi: 210.500', null,                                 timestamptz '2026-09-26 10:02:00-05', timestamptz '2026-09-26 10:02:06-05'),
  ('e0000000-0000-4000-8000-00000000001c', 'd0000000-0000-4000-8000-000000000001', '3EB0A1F2C4D6E8A0101C', '573002224471', 'text',  'taxis al aeropuerto 100 lucas', null,                                                    timestamptz '2026-09-28 16:44:00-05', timestamptz '2026-09-28 16:44:05-05'),
  ('e0000000-0000-4000-8000-00000000001d', 'd0000000-0000-4000-8000-000000000001', '3EB0A1F2C4D6E8A0101D', '573017778899', 'photo', null, 'evidencias/20000000-0000-4000-8000-000000000002/estanco-el-paisa.webp',     timestamptz '2026-09-25 17:36:00-05', timestamptz '2026-09-25 17:36:49-05'),
  ('e0000000-0000-4000-8000-00000000001e', 'd0000000-0000-4000-8000-000000000001', '3EB0A1F2C4D6E8A0101E', '573157770918', 'photo', null, 'evidencias/20000000-0000-4000-8000-000000000002/licorera-la-22.webp',       timestamptz '2026-09-27 20:11:00-05', timestamptz '2026-09-27 20:11:38-05'),
  ('e0000000-0000-4000-8000-00000000001f', 'd0000000-0000-4000-8000-000000000001', '3EB0A1F2C4D6E8A0101F', '573105550142', 'photo', null, 'evidencias/20000000-0000-4000-8000-000000000002/la-economia.webp',          timestamptz '2026-09-24 15:03:00-05', timestamptz '2026-09-24 15:03:41-05'),
  ('e0000000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000001', '3EB0A1F2C4D6E8A01020', '573002224471', 'photo', null, 'evidencias/20000000-0000-4000-8000-000000000002/tienda-dona-rosa.webp',     timestamptz '2026-09-26 18:25:00-05', timestamptz '2026-09-26 18:25:33-05'),
  -- Casa
  ('e0000000-0000-4000-8000-000000000101', 'd0000000-0000-4000-8000-000000000002', '3EB0B3D4F6A8C0E2B101', '573017778899', 'photo', null, 'evidencias/20000000-0000-4000-8000-000000000001/la-espiga.webp', now() - interval '2 hours', now() - interval '2 hours'),
  ('e0000000-0000-4000-8000-000000000102', 'd0000000-0000-4000-8000-000000000002', '3EB0B3D4F6A8C0E2B102', '573017778899', 'pdf',   null, 'evidencias/20000000-0000-4000-8000-000000000001/acueducto.pdf',  pg_temp.dia(27) + time '12:10', pg_temp.dia(27) + time '12:11');

-- ============================================================================
-- Gastos del Paseo Santa Marta · total $4.816.000
-- Pagó: Valeria 1.014.500 · Laura 870.000 · Mafe 753.500 · Caro 502.000 ·
--       Juan Camilo 469.500 · Felipe 450.500 · Andrés 434.000 · Santi 322.000
-- Categorías: Hospedaje 1.920.000 · Restaurante 1.084.000 · Transporte 780.000
--             · Licor 612.000 · Mercado 420.000
-- ============================================================================

insert into public.expenses (
  id, account_id, merchant, merchant_normalized, description, expense_date, total_cop,
  category_id, payer_person_id, status, confidence, source, message_id, evidence_path,
  image_hash, created_by, corrected_by, corrected_at
)
select
  ('60000000-0000-4000-8000-0000000000' || g.n)::uuid,
  '20000000-0000-4000-8000-000000000002'::uuid,
  g.comercio, g.normalizado, g.descripcion, g.fecha, g.total,
  ('40000000-0000-4000-8000-00000000001' || g.cat)::uuid,
  ('30000000-0000-4000-8000-00000000000' || g.pagador)::uuid,
  g.estado::public.expense_status, g.confianza, g.fuente,
  case when g.fuente = 'whatsapp' then ('e0000000-0000-4000-8000-0000000000' || g.n)::uuid end,
  case when g.fuente = 'whatsapp' then (select m.media_path from public.messages m where m.id = ('e0000000-0000-4000-8000-0000000000' || g.n)::uuid) end,
  g.huella,
  g.creado_por::uuid,
  case when g.corregido then '10000000-0000-4000-8000-000000000003'::uuid end,
  case when g.corregido then g.fecha + time '20:00' end
from (values
  -- n    comercio                        normalizado                    descripción (IA, inglés)         fecha               total    cat pagador estado            conf  fuente      huella              creado_por                              corregido
  ('11', 'Hostal Brisas del Rodadero',  'hostal brisas del rodadero',  'Hostel, nights 1 and 2',        date '2026-09-24',  640000, '5', '3', 'confirmed',       null, 'web',      null,               '10000000-0000-4000-8000-000000000001', false),
  ('12', 'Cabañas Taganga',             'cabanas taganga',             'Cabin rental, night 3',         date '2026-09-25',  640000, '5', '7', 'confirmed',       0.96, 'whatsapp', null,               null,                                   false),
  ('13', 'Posada Bahía Concha',         'posada bahia concha',         'Guesthouse, night 4',           date '2026-09-26',  640000, '5', '5', 'confirmed',       null, 'web',      null,               '10000000-0000-4000-8000-000000000003', false),
  ('14', 'Restaurante La Canoa',        'restaurante la canoa',        'Seafood dinner for the group',  date '2026-09-25',  374500, '6', '3', 'confirmed',       0.93, 'whatsapp', 'd1c38e0f9a2b4c57', null,                                   false),
  ('15', 'Arepas Doña Chela',           'arepas dona chela',           'Breakfast arepas',              date '2026-09-27',  113500, '6', '5', 'confirmed',       0.81, 'whatsapp', '9b0e44a1c3d2f687', null,                                   true),
  ('16', 'Pescadería El Muelle',        'pescaderia el muelle',        'Fried fish lunch',              date '2026-09-26',  212000, '6', '9', 'confirmed',       0.90, 'whatsapp', 'a4f1c0d9e8b7a615', null,                                   false),
  ('17', 'Asadero El Rodadero',         'asadero el rodadero',         'Farewell grill dinner',         date '2026-09-28',  272500, '6', 'a', 'pending_review',  0.71, 'whatsapp', 'f07c2b9d1e3a4c58', null,                                   false),
  ('18', 'Empanadas La Bahía',          'empanadas la bahia',          'Empanadas and juices',          date '2026-09-24',  111500, '6', '8', 'confirmed',       0.86, 'whatsapp', null,               null,                                   false),
  ('19', 'Estación de gasolina La Ye',  'estacion de gasolina la ye',  'Fuel for the road trip',        date '2026-09-24',  300000, '4', '4', 'confirmed',       0.95, 'whatsapp', '3e9d7a1f0c2b8e46', null,                                   false),
  ('1a', 'Peajes Ruta del Sol',         'peajes ruta del sol',         'Road tolls',                    date '2026-09-24',  169500, '4', '4', 'confirmed',       null, 'web',      null,               '10000000-0000-4000-8000-000000000002', false),
  ('1b', 'Lancha a Playa Cristal',      'lancha a playa cristal',      'Boat ride to the beach',        date '2026-09-26',  210500, '4', '8', 'confirmed',       0.78, 'whatsapp', null,               null,                                   true),
  ('1c', 'Taxis al aeropuerto',         'taxis al aeropuerto',         'Taxis to the airport',          date '2026-09-28',  100000, '4', '9', 'pending_review',  0.62, 'whatsapp', null,               null,                                   false),
  ('1d', 'Estanco El Paisa',            'estanco el paisa',            'Liquor and ice',                date '2026-09-25',  434000, '2', '6', 'confirmed',       0.88, 'whatsapp', '5c8a2e7f1b9d0a34', null,                                   true),
  ('1e', 'Licorera La 22',              'licorera la 22',              'Beer and rum',                  date '2026-09-27',  178000, '2', 'a', 'pending_review',  0.83, 'whatsapp', '7d1f9c3a5e0b2c86', null,                                   false),
  ('1f', 'Supermercado La Economía',    'supermercado la economia',    'Groceries for the house',       date '2026-09-24',  230000, '3', '7', 'confirmed',       0.97, 'whatsapp', 'b2e6f8a0c4d1e973', null,                                   false),
  ('20', 'Tienda Doña Rosa',            'tienda dona rosa',            'Snacks and water',              date '2026-09-26',  190000, '3', '9', 'confirmed',       0.74, 'whatsapp', 'c9a3d5f7b1e2048d', null,                                   true)
) as g (n, comercio, normalizado, descripcion, fecha, total, cat, pagador, estado, confianza, fuente, huella, creado_por, corregido);

-- Ítems leídos de dos recibos (suman el total del gasto)
insert into public.expense_items (id, expense_id, name, quantity, unit_price_cop, total_cop)
values
  ('70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-00000000001d', 'Aguardiente 750 ml',   4, 62500, 250000),
  ('70000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-00000000001d', 'Ron añejo 750 ml',     2, 58000, 116000),
  ('70000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-00000000001d', 'Cerveza lata 330 ml', 24,  2500,  60000),
  ('70000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-00000000001d', 'Hielo 5 kg',           2,  4000,   8000),
  ('70000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000017', 'Picada para 8',        1, 180000, 180000),
  ('70000000-0000-4000-8000-000000000006', '60000000-0000-4000-8000-000000000017', 'Limonada de coco',     5,  9500,  47500),
  ('70000000-0000-4000-8000-000000000007', '60000000-0000-4000-8000-000000000017', 'Patacones',            3, 15000,  45000);

-- División igual entre las 8 personas. Los pesos que no dan exacto (residuo
-- de dividir por 8) se reparten rotando, así a cada quien le tocan
-- exactamente $602.000 en todo el paseo.
with gastos as (
  select e.id, e.total_cop,
         row_number() over (partition by e.total_cop % 8 = 0 order by e.id) - 1 as n
  from public.expenses e
  where e.account_id = '20000000-0000-4000-8000-000000000002'
),
personas as (
  select p.id, row_number() over (order by p.id) - 1 as k
  from public.people p
  where p.account_id = '20000000-0000-4000-8000-000000000002'
)
insert into public.expense_splits (expense_id, person_id, amount_cop)
select g.id, p.id,
       g.total_cop / 8 + case when ((p.k - (g.n * 4) % 8) + 8) % 8 < g.total_cop % 8 then 1 else 0 end
from gastos g
cross join personas p;

-- ============================================================================
-- Gastos de Casa · mes en curso · total $2.395.200
-- Mercado 1.184.300 · Servicios 486.900 · Restaurante 312.000 ·
-- Transporte 231.700 · Licor 96.000 · Café 84.300
-- ============================================================================

insert into public.expenses (
  id, account_id, merchant, merchant_normalized, expense_date, total_cop,
  category_id, payer_person_id, status, confidence, source, message_id, evidence_path, created_by
)
select
  ('60000000-0000-4000-8000-000000000' || g.n)::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  g.comercio, g.normalizado,
  case when g.dia = 0 then current_date else pg_temp.dia(g.dia) end,
  g.total,
  ('40000000-0000-4000-8000-00000000000' || g.cat)::uuid,
  ('30000000-0000-4000-8000-00000000000' || g.pagador)::uuid,
  g.estado::public.expense_status, g.confianza, g.fuente,
  g.mensaje::uuid,
  (select m.media_path from public.messages m where m.id = g.mensaje::uuid),
  case when g.fuente = 'web' then
    case g.pagador when '1' then '10000000-0000-4000-8000-000000000001'::uuid
                   else '10000000-0000-4000-8000-000000000004'::uuid end
  end
from (values
  -- n     comercio                       normalizado                    día total   cat pagador estado           conf  fuente      mensaje
  ('101', 'Panadería La Espiga',        'panaderia la espiga',          0,  18400, '1', '2', 'pending_review', 0.74, 'whatsapp', 'e0000000-0000-4000-8000-000000000101'),
  ('102', 'Café Tostado La Molienda',   'cafe tostado la molienda',     3,  22500, '1', '1', 'confirmed',      null, 'web',      null),
  ('103', 'Panadería La Espiga',        'panaderia la espiga',         10,  14600, '1', '2', 'confirmed',      null, 'web',      null),
  ('104', 'Café de la Esquina',         'cafe de la esquina',          17,  28800, '1', '1', 'confirmed',      null, 'web',      null),
  ('105', 'Tienda Don Beto',            'tienda don beto',             29,  46900, '3', '1', 'confirmed',      null, 'web',      null),
  ('106', 'Supermercado La Economía',   'supermercado la economia',     6, 412600, '3', '1', 'confirmed',      null, 'web',      null),
  ('107', 'Fruver La Cosecha',          'fruver la cosecha',           13, 186000, '3', '2', 'confirmed',      null, 'web',      null),
  ('108', 'Supermercado La Economía',   'supermercado la economia',    20, 389500, '3', '2', 'confirmed',      null, 'web',      null),
  ('109', 'Carnicería El Novillo',      'carniceria el novillo',       22, 149300, '3', '1', 'confirmed',      null, 'web',      null),
  ('110', 'Factura acueducto',          'factura acueducto',           27,  96300, '7', '2', 'confirmed',      0.98, 'whatsapp', 'e0000000-0000-4000-8000-000000000102'),
  ('111', 'Factura de energía',         'factura de energia',          12, 214800, '7', '1', 'confirmed',      null, 'web',      null),
  ('112', 'Internet y TV Conecta',      'internet y tv conecta',        5, 119900, '7', '2', 'confirmed',      null, 'web',      null),
  ('113', 'Gas natural',                'gas natural',                 15,  55900, '7', '1', 'confirmed',      null, 'web',      null),
  ('114', 'Asadero Los Cerros',         'asadero los cerros',          26,  84300, '6', '1', 'confirmed',      null, 'web',      null),
  ('115', 'Pizzería Don Vito',          'pizzeria don vito',           13,  76500, '6', '2', 'confirmed',      null, 'web',      null),
  ('116', 'El Sazón de Mamá',           'el sazon de mama',            19,  41200, '6', '1', 'confirmed',      null, 'web',      null),
  ('117', 'Sushi Nikko',                'sushi nikko',                 21, 110000, '6', '2', 'confirmed',      null, 'web',      null),
  ('118', 'Parqueadero Calle 85',       'parqueadero calle 85',        26,  12000, '4', '2', 'confirmed',      null, 'web',      null),
  ('119', 'Estación de gasolina La 68', 'estacion de gasolina la 68',   8, 150000, '4', '2', 'confirmed',      null, 'web',      null),
  ('120', 'Taxi a la terminal',         'taxi a la terminal',          14,  38700, '4', '1', 'confirmed',      null, 'web',      null),
  ('121', 'Parqueadero La 93',          'parqueadero la 93',           24,  31000, '4', '1', 'confirmed',      null, 'web',      null),
  ('122', 'Estanco El Paisa',           'estanco el paisa',            25,  58000, '2', '1', 'confirmed',      null, 'web',      null),
  ('123', 'Licorera La 22',             'licorera la 22',              12,  38000, '2', '2', 'confirmed',      null, 'web',      null)
) as g (n, comercio, normalizado, dia, total, cat, pagador, estado, confianza, fuente, mensaje);

-- Casa: siempre a la mitad entre Valeria y Andrés
insert into public.expense_splits (expense_id, person_id, amount_cop)
select e.id, p.id,
       e.total_cop / 2 + case when p.id = '30000000-0000-4000-8000-000000000001' then e.total_cop % 2 else 0 end
from public.expenses e
join public.people p on p.account_id = e.account_id
where e.account_id = '20000000-0000-4000-8000-000000000001';

-- ============================================================================
-- Memoria de comercios (lo que aprendió cada cuenta)
-- ============================================================================

insert into public.merchant_memory (id, account_id, merchant_text, normalized, category_id, hits)
values
  ('90000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'PANADERIA LA ESPIGA',      'panaderia la espiga',      '40000000-0000-4000-8000-000000000001', 9),
  ('90000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'TIENDA DON BETO',          'tienda don beto',          '40000000-0000-4000-8000-000000000003', 7),
  ('90000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'SUPERMERCADO LA ECONOMIA', 'supermercado la economia', '40000000-0000-4000-8000-000000000003', 5),
  ('90000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'PARQUEADERO CALLE 85',     'parqueadero calle 85',     '40000000-0000-4000-8000-000000000004', 4),
  ('90000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', 'ESTANCO EL PAISA',         'estanco el paisa',         '40000000-0000-4000-8000-000000000002', 3),
  ('90000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001', 'EMPRESA DE ACUEDUCTO',     'factura acueducto',        '40000000-0000-4000-8000-000000000007', 6),
  ('90000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000002', 'ESTANCO EL PAISA',         'estanco el paisa',         '40000000-0000-4000-8000-000000000012', 1),
  ('90000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000002', 'SUPERMERCADO LA ECONOMIA', 'supermercado la economia', '40000000-0000-4000-8000-000000000013', 1),
  ('90000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000002', 'TIENDA DOÑA ROSA',         'tienda dona rosa',         '40000000-0000-4000-8000-000000000013', 1);

-- Ejemplos para reentrenar Laya: la corrección de Mafe (la IA dijo «Otros»)
insert into public.training_examples (account_id, expense_id, merchant_text, raw_text, category_id, source, created_by)
values
  ('20000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000020', 'TIENDA DOÑA ROSA',
   'TIENDA DOÑA ROSA / AGUA X6 / PAPAS / GALLETAS / TOTAL 190.000', '40000000-0000-4000-8000-000000000013',
   'correction', '10000000-0000-4000-8000-000000000003'),
  ('20000000-0000-4000-8000-000000000001', null, 'CAFE DE LA ESQUINA', 'CAFE DE LA ESQUINA / TINTO X2 / PANDEBONO X4',
   '40000000-0000-4000-8000-000000000001', 'seed', null);

-- ============================================================================
-- Invitaciones del paseo: la activa (6 de 16 usos) y una vieja revocada
-- ============================================================================

insert into public.invitations (id, account_id, code, role, expires_at, max_uses, uses, created_by, revoked_at, created_at)
values
  ('a0000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'PASEO-7K2Q', 'member',
   greatest(timestamptz '2026-10-05 23:59:00-05', now() + interval '7 days'), 16, 6,
   '10000000-0000-4000-8000-000000000001', null, timestamptz '2026-09-19 10:00:00-05'),
  ('a0000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'PASEO-3HWD', 'member',
   null, null, 1, '10000000-0000-4000-8000-000000000001', timestamptz '2026-09-19 09:58:00-05', timestamptz '2026-09-18 21:35:00-05');

commit;
