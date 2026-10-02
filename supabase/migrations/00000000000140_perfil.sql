-- ============================================================================
-- Lucas · 00000000000140_perfil.sql
-- La sección Perfil: ver lo de uno, cambiar lo que se puede cambiar, bajar
-- los datos propios y borrar la cuenta (Ley 1581: acceso, rectificación,
-- portabilidad y supresión).
--
--   · my_profile(): correo, con qué entra, fechas, política aceptada, cuentas
--     (con cómo lo llaman en cada una) y sus números de WhatsApp
--   · update_my_name / update_my_person_name: el nombre y el de cada cuenta
--   · add_my_whatsapp / remove_my_whatsapp: los gastos que manda al grupo
--     desde ese número quedan a su nombre
--   · my_data_export(): todo lo suyo en un JSON
--   · delete_my_account(): borra el usuario; sus cuentas pasan a otra persona
--     (00000000000060) y, si quiere, su nombre deja de verse en las demás
-- ============================================================================

create or replace function public.my_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'full_name', p.full_name,
    'created_at', coalesce(p.created_at, u.created_at),
    'last_sign_in_at', (select max(i.last_sign_in_at) from auth.identities i where i.user_id = u.id),
    'providers', coalesce((select jsonb_agg(distinct i.provider) from auth.identities i where i.user_id = u.id), '[]'::jsonb),
    'privacy_accepted_at', p.privacy_accepted_at,
    'privacy_version', p.privacy_version,
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'type', a.type, 'status', a.status, 'role', am.role,
        'person_id', pp.id, 'person_name', pp.display_name, 'person_tone', pp.tone
      ) order by am.joined_at)
      from public.account_members am
      join public.accounts a on a.id = am.account_id
      left join public.people pp on pp.account_id = a.id and pp.claimed_by = u.id
      where am.user_id = u.id
    ), '[]'::jsonb),
    'whatsapp', coalesce((
      select jsonb_agg(distinct w.wa_id)
      from public.person_whatsapp_ids w
      join public.people pp on pp.id = w.person_id
      where pp.claimed_by = u.id
    ), '[]'::jsonb)
  )
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = auth.uid()
$$;

-- Nombre: de 1 a 80 letras, sin espacios de más
create or replace function public.update_my_name(p_full_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nombre text := btrim(regexp_replace(coalesce(p_full_name, ''), '[[:space:]]+', ' ', 'g'));
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if length(v_nombre) < 1 or length(v_nombre) > 80 then
    raise exception 'Escribe tu nombre (máximo 80 letras)';
  end if;
  update public.profiles set full_name = v_nombre where id = auth.uid();
  return v_nombre;
end;
$$;

-- Cómo lo llaman en una cuenta («Vale» en el paseo, «Valeria» en la casa)
create or replace function public.update_my_person_name(p_person_id uuid, p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nombre text := btrim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g'));
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if length(v_nombre) < 1 or length(v_nombre) > 40 then
    raise exception 'El nombre en la cuenta va de 1 a 40 letras';
  end if;
  update public.people set display_name = v_nombre where id = p_person_id and claimed_by = auth.uid();
  if not found then
    raise exception 'Esa persona no eres tú';
  end if;
  return v_nombre;
end;
$$;

-- Su número de WhatsApp en todas sus cuentas. En una cuenta donde ese número
-- ya es de otra persona no se pone (lo arregla un admin con «¿Quién es este
-- número?»). Los mensajes y gastos sin dueño que llegaron de ese número
-- quedan a su nombre, como en identify_wa_sender.
create or replace function public.add_my_whatsapp(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_wa text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  pp public.people%rowtype;
  v_en int := 0;
  v_ocupado text[] := '{}';
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  -- «300 123 4567» → 573001234567
  if length(v_wa) = 10 and left(v_wa, 1) = '3' then
    v_wa := '57' || v_wa;
  end if;
  if v_wa !~ '^[0-9]{11,15}$' then
    raise exception 'Escribe tu número con el indicativo, por ejemplo 300 123 4567 o +57 300 123 4567';
  end if;

  for pp in select * from public.people where claimed_by = v_uid loop
    if exists (
      select 1 from public.person_whatsapp_ids w join public.people x on x.id = w.person_id
      where x.account_id = pp.account_id and w.wa_id = v_wa and x.id <> pp.id
    ) then
      v_ocupado := v_ocupado || (select a.name from public.accounts a where a.id = pp.account_id);
      continue;
    end if;
    insert into public.person_whatsapp_ids (person_id, wa_id) values (pp.id, v_wa) on conflict (person_id, wa_id) do nothing;
    v_en := v_en + 1;

    update public.messages m set sender_person_id = pp.id
    where m.account_id = pp.account_id and m.sender_wa_id = v_wa and m.sender_person_id is null;
    update public.expenses e set payer_person_id = pp.id
    from public.messages m
    where m.id = e.message_id and m.account_id = pp.account_id and m.sender_wa_id = v_wa
      and e.payer_person_id is null and e.status = 'pending_review';
  end loop;

  return jsonb_build_object('wa_id', v_wa, 'accounts', v_en, 'taken_in', to_jsonb(v_ocupado));
end;
$$;

create or replace function public.remove_my_whatsapp(p_wa_id text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  delete from public.person_whatsapp_ids w
  using public.people pp
  where w.person_id = pp.id and pp.claimed_by = auth.uid() and w.wa_id = p_wa_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Todo lo suyo, para descargarlo (portabilidad)
create or replace function public.my_data_export()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with yo as (select pp.* from public.people pp where pp.claimed_by = auth.uid())
  select jsonb_build_object(
    'exported_at', now(),
    'profile', public.my_profile(),
    'expenses_paid', coalesce((
      select jsonb_agg(jsonb_build_object(
        'account', a.name, 'date', e.expense_date, 'merchant', e.merchant, 'total_cop', e.total_cop,
        'category', c.name, 'status', e.status
      ) order by e.expense_date, e.created_at)
      from public.expenses e
      join yo on yo.id = e.payer_person_id
      join public.accounts a on a.id = e.account_id
      left join public.categories c on c.id = e.category_id
    ), '[]'::jsonb),
    'my_shares', coalesce((
      select jsonb_agg(jsonb_build_object(
        'account', a.name, 'date', e.expense_date, 'merchant', e.merchant, 'total_cop', e.total_cop, 'my_part_cop', s.amount_cop
      ) order by e.expense_date, e.created_at)
      from public.expense_splits s
      join yo on yo.id = s.person_id
      join public.expenses e on e.id = s.expense_id
      join public.accounts a on a.id = e.account_id
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'account', a.name, 'received_at', m.received_at, 'source', m.source, 'kind', m.kind,
        'text', m.text_body, 'file_name', m.file_name
      ) order by m.received_at)
      from public.messages m
      join public.accounts a on a.id = m.account_id
      where m.uploaded_by = auth.uid() or m.sender_person_id in (select yo.id from yo)
    ), '[]'::jsonb)
  )
$$;

-- Borrar la cuenta. Sus cuentas pasan a un admin o a quien lleve más tiempo
-- (si nadie más queda, se borran: 00000000000060). En las cuentas que siguen,
-- sus gastos se quedan para que los saldos cuadren; con p_anonimizar su
-- nombre pasa a «Persona eliminada». Sus números de WhatsApp se borran.
create or replace function public.delete_my_account(p_anonimizar boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if p_anonimizar then
    update public.people set display_name = 'Persona eliminada' where claimed_by = v_uid;
  end if;
  delete from public.person_whatsapp_ids w using public.people pp where w.person_id = pp.id and pp.claimed_by = v_uid;
  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.my_profile() from public, anon;
revoke execute on function public.update_my_name(text) from public, anon;
revoke execute on function public.update_my_person_name(uuid, text) from public, anon;
revoke execute on function public.add_my_whatsapp(text) from public, anon;
revoke execute on function public.remove_my_whatsapp(text) from public, anon;
revoke execute on function public.my_data_export() from public, anon;
revoke execute on function public.delete_my_account(boolean) from public, anon;
grant execute on function public.my_profile() to authenticated;
grant execute on function public.update_my_name(text) to authenticated;
grant execute on function public.update_my_person_name(uuid, text) to authenticated;
grant execute on function public.add_my_whatsapp(text) to authenticated;
grant execute on function public.remove_my_whatsapp(text) to authenticated;
grant execute on function public.my_data_export() to authenticated;
grant execute on function public.delete_my_account(boolean) to authenticated;
