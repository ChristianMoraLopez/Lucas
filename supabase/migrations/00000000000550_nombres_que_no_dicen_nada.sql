-- ============================================================================
-- Lucas · 00000000000550_nombres_que_no_dicen_nada.sql
-- Tiago se puso «Hh» en WhatsApp y en Nochita quedó «Hh», aunque su usuario
-- (@tiago.film) sí dice quién es. Un nombre de WhatsApp sin vocales o de una
-- sola letra repetida («Hh», «Jjj», «X») no cuenta como nombre: si tiene
-- usuario queda «@tiago.film»; si no, como quien no tiene nombre («WhatsApp
-- 4567»), hasta que se sepa algo mejor.
--
-- nombre_de_whatsapp (la 200) es la que dice si un nombre sirve: la usan
-- aprender_nombre (cada mensaje), sync_group_people (los integrantes) y
-- nombre_de_identidad (la 530). Y lo que ya había: quien quedó con un nombre
-- así vuelve al automático y toma su usuario.
-- ============================================================================

create or replace function public.nombre_de_whatsapp(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when v = '' or v ~ '^[-0-9+() .]*$' then null
    -- «Hh», «Jjj», «X», «Brr»: letras sin vocales o una sola repetida (los emojis solos sí quedan)
    when letras <> '' and (letras ~ '^(.)\1*$' or letras !~ '[aeiouyáéíóúü]') then null
    else btrim(left(v, 34))
  end
  from (
    select v, lower(regexp_replace(v, '[^[:alpha:]]', '', 'g')) as letras
    from (select btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'), '[[:space:]]+', ' ', 'g')) as v) x
  ) y
$$;

-- Lo que ya había: «Hh» (o «Hh 4372», si se repetía) vuelve al automático y toma su @usuario si lo tiene
update public.people p
set name_source = 'auto'
where p.claimed_by is null and p.name_source = 'whatsapp'
  and public.nombre_de_whatsapp(regexp_replace(p.display_name, '\s+\d{4}$', '')) is null;

select public.nombrar_con_whatsapp(p.id)
from public.people p
where p.name_source = 'auto' and p.claimed_by is null;
