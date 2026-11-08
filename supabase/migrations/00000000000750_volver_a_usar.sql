-- ============================================================================
-- Lucas · 00000000000750_volver_a_usar.sql
-- «Gentelinda» se liquidó y se cerró, y anoche volvieron a salir: desde la app,
-- quien administra la vuelve a usar con un botón. Se abre la siguiente
-- («Gentelinda 2») en ceros, con:
--
--   · la misma gente (toda la de la cuenta, no solo quienes usan Luks: en la
--     app no hay grupo que diga quién sigue), con sus números de WhatsApp, y
--     quienes usan Luks con su rol;
--   · sus categorías, lo que aprendió de los comercios y quién dijo «no me
--     cuentes»;
--   · sus grupos de WhatsApp, si tenía: lo que llegue desde ya se anota en
--     la nueva.
--
-- La cerrada queda como estaba, con sus gastos y su liquidación, y se archiva
-- para quien la volvió a usar (sale de su inicio; se saca del archivo cuando
-- quiera). Dos clics no abren dos: si ya tiene siguiente abierta, va a esa.
-- ============================================================================

create or replace function public.volver_a_usar(p_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  a public.accounts%rowtype;
  v_nueva uuid;
  v_grupo uuid;
  p record;
  v_persona uuid;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if not public.has_account_role(p_account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quien administra la cuenta puede volver a usarla';
  end if;
  select * into a from public.accounts where id = p_account_id for update;
  if a.type not in ('hogar', 'evento') or a.status not in ('settling', 'closed') then
    raise exception 'Solo se vuelve a usar una cuenta liquidada o cerrada';
  end if;

  select x.id into v_nueva
  from public.accounts x
  where x.previous_account_id = a.id and x.status = 'active'
  order by x.created_at desc
  limit 1;
  if v_nueva is not null then
    return v_nueva;
  end if;

  insert into public.accounts (name, type, owner_id, starts_on, currency, language, previous_account_id,
                               continuation_announced_at, auto_cobros, settle_direct)
  values (public.nombre_siguiente(a.id), a.type, a.owner_id,
          case when a.type = 'evento' then (now() at time zone 'America/Bogota')::date end,
          a.currency, a.language, a.id, now(), a.auto_cobros, a.settle_direct)
  returning id into v_nueva;

  for p in
    select pp.id, pp.display_name, pp.tone, pp.claimed_by, pp.name_source, am.user_id as miembro, am.role
    from public.people pp
    left join public.account_members am on am.account_id = a.id and am.person_id = pp.id
    where pp.account_id = a.id
    order by pp.created_at, pp.id
  loop
    insert into public.people (account_id, display_name, tone, claimed_by, name_source)
    values (v_nueva, p.display_name, p.tone, case when p.miembro is not null then p.claimed_by end, p.name_source)
    returning id into v_persona;
    insert into public.person_whatsapp_ids (person_id, wa_id)
    select v_persona, w.wa_id from public.person_whatsapp_ids w where w.person_id = p.id
    on conflict (person_id, wa_id) do nothing;
    if p.miembro is not null then
      insert into public.account_members (account_id, user_id, role, person_id)
      values (v_nueva, p.miembro, p.role, v_persona)
      on conflict do nothing;
    end if;
  end loop;

  insert into public.account_optouts (account_id, identity_id)
  select v_nueva, o.identity_id from public.account_optouts o where o.account_id = a.id
  on conflict do nothing;

  insert into public.categories (account_id, name, letter, tone, is_default, description)
  select v_nueva, c.name, c.letter, c.tone, c.is_default, c.description
  from public.categories c
  where c.account_id = a.id;
  if not found then
    perform public.add_default_categories(v_nueva);
  end if;
  insert into public.merchant_memory (account_id, merchant_text, normalized, category_id, hits)
  select v_nueva, mm.merchant_text, mm.normalized, nc.id, mm.hits
  from public.merchant_memory mm
  join public.categories oc on oc.id = mm.category_id
  join public.categories nc on nc.account_id = v_nueva and nc.name = oc.name
  where mm.account_id = a.id
  on conflict (account_id, normalized) do nothing;

  -- Sus grupos pasan a la nueva: se anota desde ya
  for v_grupo in
    select l.group_id from public.account_group_links l where l.account_id = a.id order by l.group_id
  loop
    perform 1 from public.whatsapp_groups where id = v_grupo for update;
    update public.account_group_links
    set account_id = v_nueva, linked_by = v_uid, history = 'desde_ya', history_at = now(), ingest_from = now() - interval '1 minute'
    where group_id = v_grupo;
    perform public.sync_group_people(v_grupo);
    if exists (select 1 from public.whatsapp_group_members m where m.group_id = v_grupo and m.left_at is null) then
      update public.account_group_links set members_synced_at = now() where group_id = v_grupo;
    end if;
  end loop;

  -- La cerrada sale del inicio de quien la volvió a usar (con todo guardado)
  if a.status = 'closed' then
    update public.account_members set archived_at = coalesce(archived_at, now())
    where account_id = a.id and user_id = v_uid;
  end if;
  return v_nueva;
end;
$$;

revoke execute on function public.volver_a_usar(uuid) from public, anon;
grant execute on function public.volver_a_usar(uuid) to authenticated;
