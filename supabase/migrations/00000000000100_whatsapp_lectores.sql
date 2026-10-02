-- ============================================================================
-- Lucas · 00000000000100_whatsapp_lectores.sql
-- La pantalla «Conecta el grupo de WhatsApp» decía «Luks no está leyendo el
-- grupo» cuando no había número contador, aunque el grupo lo estuviera leyendo
-- el WhatsApp personal de alguien de la cuenta. whatsapp_overview ahora
-- devuelve también `lectores`: los WhatsApp personales vinculados y vivos de
-- los miembros de la cuenta (cada uno lee los grupos donde está).
-- Misma firma y mismo tipo: los permisos de la 080 se mantienen.
-- ============================================================================

create or replace function public.whatsapp_overview(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean;
  c public.whatsapp_connections%rowtype;
begin
  if not public.is_account_member(p_account_id) then
    raise exception 'No eres miembro de esta cuenta';
  end if;
  v_admin := public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]);
  select * into c from public.whatsapp_connections where kind = 'contador';

  return jsonb_build_object(
    'is_admin', v_admin,
    'contador', case when c.id is null then null else jsonb_build_object(
      'phone', c.phone_number,
      'connected', c.status = 'connected' and c.last_seen_at > now() - interval '3 minutes',
      'status', c.status,
      'last_seen_at', c.last_seen_at
    ) end,
    -- El código para escribir en el grupo: la invitación vigente más nueva (solo admins lo ven)
    'code', case when v_admin then (
      select i.code from public.invitations i
      where i.account_id = p_account_id and i.revoked_at is null
        and (i.expires_at is null or i.expires_at > now())
        and (i.max_uses is null or i.uses < i.max_uses)
      order by i.created_at desc limit 1
    ) end,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'group_id', g.id, 'name', g.name, 'linked_at', l.created_at,
        'confirm_in_group', l.confirm_in_group, 'participants', g.participants_count,
        'last_message_at', g.last_message_at, 'left_at', g.left_at,
        'connection_ok', wc.status = 'connected' and wc.last_seen_at > now() - interval '3 minutes',
        'connection_kind', wc.kind,
        'messages', (select count(*) from public.messages m where m.group_id = g.id),
        'expenses', (select count(*) from public.messages m where m.group_id = g.id and m.status = 'done'),
        'last_sender', (
          select coalesce(p.display_name, m.sender_name) from public.messages m
          left join public.people p on p.id = m.sender_person_id
          where m.group_id = g.id order by m.received_at desc limit 1
        )
      ) order by l.created_at)
      from public.account_group_links l
      join public.whatsapp_groups g on g.id = l.group_id
      left join public.whatsapp_connections wc on wc.id = g.connection_id
      where l.account_id = p_account_id
    ), '[]'::jsonb),
    -- Quién más lee los grupos de esta cuenta: los WhatsApp personales
    -- vinculados (y vivos) de sus miembros. Cada uno lee los grupos donde está.
    'lectores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(p.display_name, pr.full_name, 'Alguien'),
        'is_me', wc.owner_id = auth.uid()
      ) order by wc.connected_at)
      from public.whatsapp_connections wc
      join public.account_members am on am.user_id = wc.owner_id and am.account_id = p_account_id
      left join public.people p on p.id = am.person_id
      left join public.profiles pr on pr.id = wc.owner_id
      where wc.kind = 'personal' and wc.status = 'connected'
        and wc.last_seen_at > now() - interval '3 minutes'
        and wc.stop_requested_at is null
    ), '[]'::jsonb),
    'unknown_senders', case when v_admin then coalesce((
      select jsonb_agg(jsonb_build_object(
        'wa_id', s.wa_id, 'push_name', s.push_name, 'message_count', s.message_count,
        'last_seen_at', s.last_seen_at
      ) order by s.last_seen_at desc)
      from public.whatsapp_senders s
      where s.account_id = p_account_id and s.dismissed_at is null
        and public.wa_person(p_account_id, s.wa_id) is null
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;
