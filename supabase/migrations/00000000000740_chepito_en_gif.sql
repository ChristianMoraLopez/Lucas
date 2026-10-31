-- ============================================================================
-- Lucas · 00000000000740_chepito_en_gif.sql
-- Chepito se ve en el mensaje: el aviso de cobro sale con su GIF (un .mp4 que
-- se repite, en public/brand) y el texto de pie. connector_chepito_avisar
-- recibe la URL; la de 3 parámetros (la que usa el connector anterior) sigue
-- igual, sin GIF.
-- ============================================================================

create or replace function public.connector_chepito_avisar(p_cobro_id uuid, p_avisos int, p_body text, p_gif_url text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.cobros%rowtype;
begin
  select * into c from public.cobros where id = p_cobro_id for update;
  if c.id is null or not public.cobro_abierto(c) or c.avisos <> p_avisos or nullif(btrim(p_body), '') is null
     or exists (select 1 from public.cobros_no_escribir n where n.telefono = c.telefono)
     or (c.avisos = 0 and c.avisar_desde > now())
     or (c.avisos > 0 and c.avisado_at >= now() - interval '2 days' + interval '30 minutes') then
    return false;
  end if;
  insert into public.whatsapp_outbox (chat_jid, reason, body, image_url, dedupe_key)
  values (
    c.telefono || '@s.whatsapp.net', 'answer', left(p_body, 4000),
    case when p_gif_url ~ '^https://[^\s]+\.mp4$' then p_gif_url end,
    'chepito:' || c.id || ':' || (c.avisos + 1)
  )
  on conflict (dedupe_key) do nothing;
  update public.cobros
  set avisos = avisos + 1, avisado_at = now(), primer_aviso_at = coalesce(primer_aviso_at, now())
  where id = c.id;
  return true;
end;
$$;

create or replace function public.connector_chepito_avisar(p_cobro_id uuid, p_avisos int, p_body text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.connector_chepito_avisar(p_cobro_id, p_avisos, p_body, null)
$$;

revoke execute on function public.connector_chepito_avisar(uuid, int, text, text) from public, anon, authenticated;
grant execute on function public.connector_chepito_avisar(uuid, int, text, text) to service_role;
