-- ============================================================================
-- Lucas · 00000000000650_cuenta_con_mister_luks.sql
-- Quien manda un recibo por privado sin tener sesión en Luks recibe de una vez
-- el link para entrar (no hace falta el «sí»): con él crea su usuario, o entra
-- con el que tiene, y su número queda registrado con ese correo. Apenas entra
-- se abre «Cuenta con Mister Luks» con lo que mandó (como en la 640).
--
-- Aquí, el nombre de esa cuenta («Cuenta con Mister Luks») y el de su persona:
-- el de su usuario de Luks primero; si no, el de WhatsApp si dice algo.
-- ============================================================================

-- Su cuenta con Mister Luks: la abre ya (si su WhatsApp tiene usuario de Luks) o la deja por abrir
create or replace function public.connector_abrir_cuenta_privada(
  p_chat_jid text,
  p_wa_id text,
  p_phone text,
  p_lid text,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ident uuid;
  i public.whatsapp_identities%rowtype;
  q public.cuentas_por_abrir%rowtype;
  v_nombre text;
  v_cuenta text;
  v_idioma text := case when coalesce(p_phone, '') like '1%' then 'en' else 'es' end;
  v_id uuid := gen_random_uuid();
begin
  if public.chat_privado_con_luks(p_chat_jid) is null then
    return jsonb_build_object('ok', false, 'reason', 'sin_chat');
  end if;
  v_ident := public.wa_identidad(p_wa_id, p_phone, p_lid, p_name);
  select * into i from public.whatsapp_identities where id = v_ident;

  -- Ya la había pedido y sigue por abrir: la misma
  select * into q from public.cuentas_por_abrir x where x.identity_id = v_ident and x.opened_at is null order by x.created_at desc limit 1;
  if q.account_id is not null then
    return jsonb_build_object('ok', true, 'abierta', false, 'account_id', q.account_id, 'account_name', q.name, 'identity_id', v_ident);
  end if;

  -- Su nombre (para su persona en la cuenta): el de su usuario de Luks, o el de WhatsApp si dice algo
  v_nombre := coalesce(
    nullif(split_part(btrim(coalesce((select pf.full_name from public.profiles pf where pf.id = i.user_id), '')), ' ', 1), ''),
    nullif(split_part(btrim(coalesce(public.nombre_de_whatsapp(i.push_name), '')), ' ', 1), ''),
    nullif(split_part(btrim(coalesce(public.nombre_de_whatsapp(p_name), '')), ' ', 1), '')
  );
  v_cuenta := case when v_idioma = 'en' then 'My Mister Luks account' else 'Cuenta con Mister Luks' end;

  if i.user_id is not null and i.verified_at is not null then
    perform public.abrir_cuenta_de_whatsapp(v_id, i.user_id, v_ident, v_cuenta, coalesce(v_nombre, 'Yo'), v_idioma, p_chat_jid);
    return jsonb_build_object('ok', true, 'abierta', true, 'account_id', v_id, 'account_name', left(v_cuenta, 60), 'identity_id', v_ident);
  end if;

  insert into public.cuentas_por_abrir (account_id, identity_id, chat_jid, name, person_name, language)
  values (v_id, v_ident, p_chat_jid, left(v_cuenta, 60), left(coalesce(v_nombre, 'Yo'), 40), v_idioma);
  return jsonb_build_object('ok', true, 'abierta', false, 'account_id', v_id, 'account_name', left(v_cuenta, 60), 'identity_id', v_ident);
end;
$$;

revoke execute on function public.connector_abrir_cuenta_privada(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.connector_abrir_cuenta_privada(text, text, text, text, text) to service_role;
