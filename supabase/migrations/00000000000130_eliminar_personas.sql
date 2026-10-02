-- ============================================================================
-- Lucas · 00000000000130_eliminar_personas.sql
-- Eliminar a alguien de la cuenta y pasarle sus gastos a otra persona.
--
-- «Sacar» (remove_member) solo le quita el acceso: su nombre y sus gastos se
-- quedan. Eliminar borra a la persona: lo que pagó y su parte de cada gasto
-- pasan a quien elijan (si esa persona ya estaba en el gasto, las partes se
-- suman), así los totales y los saldos no cambian. Sirve también para juntar
-- a alguien que quedó repetido («Vale» y «Valeria»): con p_move_whatsapp sus
-- números de WhatsApp y sus mensajes pasan a la otra persona.
-- ============================================================================

create or replace function public.delete_person(p_person_id uuid, p_reassign_to uuid default null, p_move_whatsapp boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  x public.people%rowtype;
  a public.accounts%rowtype;
  v_rol public.member_role;
  v_gastos int;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into x from public.people where id = p_person_id for update;
  if not found or not public.has_account_role(x.account_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Solo quienes administran la cuenta pueden eliminar a alguien';
  end if;
  select * into a from public.accounts where id = x.account_id;
  if a.status = 'closed' then
    raise exception 'La cuenta está cerrada: ya no cambia';
  end if;
  if x.claimed_by = a.owner_id then
    raise exception 'No se puede eliminar al titular de la cuenta';
  end if;
  if x.claimed_by = v_uid then
    raise exception 'Para salirte de la cuenta usa «Salir de esta cuenta»';
  end if;
  if x.claimed_by is not null then
    select am.role into v_rol from public.account_members am where am.account_id = a.id and am.user_id = x.claimed_by;
    if v_rol = 'admin' and not public.has_account_role(a.id, array['owner']::public.member_role[]) then
      raise exception 'Un administrador no puede eliminar a otro administrador';
    end if;
  end if;
  if exists (select 1 from public.settlement_transfers t where x.id in (t.from_person_id, t.to_person_id)) then
    raise exception '% está en una liquidación: reábranla antes de eliminarlo', x.display_name;
  end if;

  if p_reassign_to is not null then
    if p_reassign_to = x.id or not exists (select 1 from public.people p where p.id = p_reassign_to and p.account_id = a.id) then
      raise exception 'Elige a otra persona de la cuenta para pasarle sus gastos';
    end if;
  elsif exists (select 1 from public.expenses e where e.payer_person_id = x.id)
     or exists (select 1 from public.expense_splits s where s.person_id = x.id) then
    raise exception 'Elige a quién pasan los gastos de %', x.display_name;
  end if;

  -- 1) Lo que pagó (también lo que leyó la IA, para que no salga como corrección)
  update public.expenses e
  set payer_person_id = p_reassign_to,
      ai_snapshot = case
        when e.ai_snapshot ->> 'payer_person_id' = x.id::text then jsonb_set(e.ai_snapshot, '{payer_person_id}', to_jsonb(p_reassign_to))
        else e.ai_snapshot
      end
  where e.payer_person_id = x.id;
  get diagnostics v_gastos = row_count;

  -- 2) Su parte de cada gasto: si la otra persona ya estaba, se suman
  update public.expense_splits y
  set amount_cop = y.amount_cop + s.amount_cop,
      share_percent = case
        when y.share_percent is null and s.share_percent is null then null
        else coalesce(y.share_percent, 0) + coalesce(s.share_percent, 0)
      end
  from public.expense_splits s
  where s.person_id = x.id and y.person_id = p_reassign_to
    and y.expense_id = s.expense_id and y.item_id is not distinct from s.item_id;
  delete from public.expense_splits s
  where s.person_id = x.id
    and exists (
      select 1 from public.expense_splits y
      where y.person_id = p_reassign_to and y.expense_id = s.expense_id and y.item_id is not distinct from s.item_id
    );
  update public.expense_splits s set person_id = p_reassign_to where s.person_id = x.id;

  -- 3) Si era la misma persona: sus números de WhatsApp y sus mensajes
  if p_move_whatsapp and p_reassign_to is not null then
    insert into public.person_whatsapp_ids (person_id, wa_id)
    select p_reassign_to, w.wa_id from public.person_whatsapp_ids w where w.person_id = x.id
    on conflict (person_id, wa_id) do nothing;
    update public.messages m set sender_person_id = p_reassign_to where m.sender_person_id = x.id;
  end if;

  -- 4) Si tenía usuario, deja de ver la cuenta
  if x.claimed_by is not null then
    delete from public.account_members am where am.account_id = a.id and am.user_id = x.claimed_by;
  end if;
  delete from public.people where id = x.id;
  return v_gastos;
end;
$$;

revoke execute on function public.delete_person(uuid, uuid, boolean) from public, anon;
grant execute on function public.delete_person(uuid, uuid, boolean) to authenticated;
