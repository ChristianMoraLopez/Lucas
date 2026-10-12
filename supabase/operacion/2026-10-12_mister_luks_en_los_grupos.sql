-- ============================================================================
-- Fase 3 · Mister Luks en los grupos que ya estaban conectados (opcional)
--
-- Los grupos que hoy lee un WhatsApp vinculado siguen funcionando igual: no hay
-- nada que migrar. Agregar también a Mister Luks sirve para que confirme en el
-- grupo («✅ Anotado: …») y, más adelante, responda preguntas. El grupo se
-- reconoce por su JID: la cuenta, las personas y los gastos no cambian, y los
-- mensajes no se duplican (unique (group_id, wa_message_id): el segundo que lo
-- lee recibe «repetido»).
--
-- Paso a paso (lo hace alguien del grupo, desde su celular):
--   1. Guardar a Mister Luks como contacto: +57 333 762 7471 (o «Guardar
--      contacto» en mrluks.com/guia o en Conectar WhatsApp).
--   2. Agregarlo al grupo como a cualquiera. Si el grupo no deja, mandarle por
--      privado el link del grupo (Info del grupo → Invitar con enlace).
--   3. Mister Luks saluda una sola vez: «¡Hola, parche! 👋 Soy Mister Luks y desde
--      hoy llevo las cuentas de «Cuenta»…», con la guía en imagen.
--   4. No hay que escribir «luks CÓDIGO»: el grupo ya es de la cuenta.
--   5. Si el grupo solo deja escribir a los admins, hacer admin a Mister Luks
--      para que pueda confirmar.
--
-- Estas consultas son de solo lectura: se corren en el SQL Editor de Supabase
-- (proyecto zlmpsbwvtlyvwkkuknpj), cada una por separado.
-- ============================================================================

-- 1. Quién lee cada grupo con cuenta: después de agregarlo, «contador, personal»
--    y Mister Luks como lector principal
select g.name as grupo, a.name as cuenta,
  (select string_agg(c.kind, ', ' order by c.kind)
   from public.whatsapp_group_sessions s join public.whatsapp_connections c on c.id = s.connection_id
   where s.group_id = g.id and s.left_at is null) as lo_leen,
  (select c.kind from public.whatsapp_connections c where c.id = g.connection_id) as lector_principal,
  g.hello_sent_at as saludo,
  l.confirm_in_group as confirma_en_el_grupo
from public.account_group_links l
join public.whatsapp_groups g on g.id = l.group_id
join public.accounts a on a.id = l.account_id
order by l.created_at;

-- 2. Ningún mensaje repetido: debe salir vacío
select g.name as grupo, m.wa_message_id, count(*) as veces
from public.messages m
join public.whatsapp_groups g on g.id = m.group_id
group by g.name, m.wa_message_id
having count(*) > 1;

-- 3. Lo último que entró de cada grupo y si Mister Luks lo confirmó
select g.name as grupo, m.received_at, m.status, m.sender_name,
  m.group_reply_at is not null as respondido
from public.messages m
join public.whatsapp_groups g on g.id = m.group_id
join public.account_group_links l on l.group_id = g.id
order by m.received_at desc
limit 20;

-- 4. Lo que Mister Luks escribió por su cuenta (saludos, bienvenidas, guía)
select o.created_at, o.reason, coalesce(g.name, 'privado') as chat,
  o.sent_at is not null as enviado, o.dropped_at is not null as descartado, o.attempts, o.last_error
from public.whatsapp_outbox o
left join public.whatsapp_groups g on g.wa_group_jid = o.chat_jid and g.chat_kind = 'grupo'
order by o.created_at desc
limit 20;
