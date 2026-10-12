-- ============================================================================
-- Borra los integrantes guardados de grupos que no son de ninguna cuenta y que
-- no lee Mister Luks (el número contador). Son los grupos de los WhatsApp
-- vinculados de las personas: de ellos Luks solo necesita el nombre y el JID.
-- Ley 1581 (migración 280: de ahora en adelante ya no se guardan).
--
-- Se corre a mano en el SQL Editor de Supabase (proyecto zlmpsbwvtlyvwkkuknpj),
-- después de aplicar la migración 280. No toca grupos, cuentas, personas,
-- mensajes ni gastos: solo whatsapp_group_members.
--
-- El 11 de octubre de 2026 eran unos 10.200 registros de 134 grupos.
-- ============================================================================

begin;

-- 1. Lo que se va a borrar (revísalo antes de seguir)
select count(*) as integrantes, count(distinct m.group_id) as grupos
from public.whatsapp_group_members m
where not public.grupo_guarda_integrantes(m.group_id);

-- 2. Lo que se queda: los grupos con cuenta (y los que lee Mister Luks)
select count(*) as integrantes, count(distinct m.group_id) as grupos
from public.whatsapp_group_members m
where public.grupo_guarda_integrantes(m.group_id);

-- 3. El borrado
delete from public.whatsapp_group_members m
where not public.grupo_guarda_integrantes(m.group_id);

-- 4. Comprobación: debe dar 0
select count(*) as quedan_sin_cuenta
from public.whatsapp_group_members m
where not public.grupo_guarda_integrantes(m.group_id);

commit;
