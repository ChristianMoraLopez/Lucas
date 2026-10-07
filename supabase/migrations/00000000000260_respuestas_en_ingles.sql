-- ============================================================================
-- Luks también responde en inglés (y en la moneda de la cuenta).
--
-- · Al enlazar un grupo, el connector recibe el idioma de la cuenta para
--   contestar «Listo: este grupo quedó conectado…» o «Done: this group…».
-- · Las respuestas en inglés («Logged: Taxi · $45.00», «Received: …»,
--   «Already logged: …»), los montos en bolivianos («· Bs 12,50») y la firma
--   «Made with mrluks.com» también son de Luks y no se anotan como gasto.
--   Lo mismo revisan el connector (services/connector/src/text.ts) y el worker
--   (lucas_worker/luks.py).
-- ============================================================================

create or replace function public.es_mensaje_de_luks(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_text, '') ~* '(esto se hizo en mrluks\.com|made with mrluks\.com|cuentas hechas con luks|hecho con luks|(mrluks\.com|\.vercel\.app)/r/[A-Za-z0-9_-]{20,64})'
      or coalesce(p_text, '') ~* '^\s*(anotad[oa]s?|recibido|ya estaba anotado|logged|received|already logged)[\s:].*·\s*(\$|bs\s?)\d'
$$;

create or replace function public.connector_link_group(
  p_connection_id uuid,
  p_jid text,
  p_name text,
  p_code text,
  p_sender_wa_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
  v_account uuid;
  v_current uuid;
  v_name text;
  v_language text;
  v_user uuid;
  v_added int;
begin
  v_account := public.wa_account_for_code(p_code);
  if v_account is null then
    return jsonb_build_object('ok', false, 'error', 'codigo_invalido');
  end if;

  v_group := (public.connector_upsert_group(p_connection_id, p_jid, p_name) ->> 'group_id')::uuid;
  perform 1 from public.whatsapp_groups where id = v_group for update;

  select l.account_id into v_current from public.account_group_links l where l.group_id = v_group;
  select a.name, a.language into v_name, v_language from public.accounts a where a.id = v_account;
  if v_current = v_account then
    return jsonb_build_object('ok', true, 'already', true, 'account_id', v_account, 'account_name', v_name, 'group_id', v_group,
                              'language', v_language);
  end if;
  if v_current is not null then
    return jsonb_build_object('ok', false, 'error', 'otra_cuenta');
  end if;

  -- Si quien escribió el código ya tiene usuario en la cuenta, queda como quien enlazó
  select p.claimed_by into v_user
  from public.people p
  where p.id = public.wa_person(v_account, p_sender_wa_id);

  insert into public.account_group_links (group_id, account_id, linked_by, linked_by_wa_id)
  values (v_group, v_account, v_user, p_sender_wa_id);

  -- Los integrantes del grupo pasan a ser las personas de la cuenta
  v_added := public.sync_group_people(v_group);

  return jsonb_build_object('ok', true, 'already', false, 'account_id', v_account, 'account_name', v_name, 'group_id', v_group,
                            'people_added', v_added, 'members', public.group_member_count(v_group), 'language', v_language);
end;
$$;
