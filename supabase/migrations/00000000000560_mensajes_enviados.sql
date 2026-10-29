-- ============================================================================
-- Lucas · 00000000000560_mensajes_enviados.sql
-- «Esperando el mensaje»: el celular de quien recibe no pudo descifrar algo
-- que mandó Mister Luks (estaba sin conexión, o cambió de dispositivo) y le
-- pide que lo reenvíe. Baileys guarda lo enviado solo cinco minutos y en
-- memoria (se pierde al reiniciar el connector, como en cada actualización):
-- después ya no había qué reenviar y el mensaje se quedaba esperando.
--
-- Aquí queda lo que manda cada sesión (el mensaje de WhatsApp tal cual, en
-- base64) para reenviarlo cuando lo pidan. Es una rueda de 20.000 lugares: el
-- más viejo se reemplaza con el nuevo, así no crece ni hay que borrar nada.
-- Solo el connector la lee y la escribe.
-- ============================================================================

create sequence public.whatsapp_enviados_turno;

create table public.whatsapp_enviados (
  lugar int primary key check (lugar >= 0 and lugar < 20000),
  wa_message_id text not null,
  chat_jid text not null,
  mensaje text not null check (length(mensaje) <= 131072),
  created_at timestamptz not null default now()
);
create index whatsapp_enviados_id_idx on public.whatsapp_enviados (wa_message_id);

alter table public.whatsapp_enviados enable row level security;
alter table public.whatsapp_enviados force row level security;
revoke all on public.whatsapp_enviados from anon, authenticated;
revoke all on sequence public.whatsapp_enviados_turno from anon, authenticated;

create or replace function public.connector_guardar_enviado(p_wa_message_id text, p_chat_jid text, p_mensaje text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_wa_message_id, '') !~ '^[A-Za-z0-9]{6,64}$' or coalesce(p_chat_jid, '') = '' or coalesce(p_mensaje, '') = ''
     or length(p_mensaje) > 131072 then
    return;
  end if;
  insert into public.whatsapp_enviados as e (lugar, wa_message_id, chat_jid, mensaje)
  values ((nextval('public.whatsapp_enviados_turno') % 20000)::int, p_wa_message_id, left(p_chat_jid, 120), p_mensaje)
  on conflict (lugar) do update
    set wa_message_id = excluded.wa_message_id, chat_jid = excluded.chat_jid, mensaje = excluded.mensaje, created_at = now();
end;
$$;

-- El mensaje para reenviarlo (el más reciente con ese id); null si ya no está
create or replace function public.connector_mensaje_enviado(p_wa_message_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select e.mensaje from public.whatsapp_enviados e
  where e.wa_message_id = p_wa_message_id
  order by e.created_at desc
  limit 1
$$;

revoke execute on function public.connector_guardar_enviado(text, text, text) from public, anon, authenticated;
revoke execute on function public.connector_mensaje_enviado(text) from public, anon, authenticated;
grant execute on function public.connector_guardar_enviado(text, text, text) to service_role;
grant execute on function public.connector_mensaje_enviado(text) to service_role;
