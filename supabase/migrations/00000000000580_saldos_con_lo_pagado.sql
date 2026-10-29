-- ============================================================================
-- Lucas · 00000000000580_saldos_con_lo_pagado.sql
-- Nochita, ya liquidada: Samuel le pagó a Christian y se marcó en Liquidar.
-- Las tarjetas de arriba lo mostraron pagado, pero «¿Cuánto puso cada uno?»
-- seguía diciendo que Samuel debía $9.800 y que a Christian le debían todo.
--
-- Los saldos (saldos, de la 390) solo contaban los pagos hechos antes de
-- reabrir (settlement_payments), no las transferencias marcadas pagadas de la
-- liquidación vigente. Ahora cuentan las dos: «ya transfirió» y «ya recibió»
-- suben con cada transferencia pagada y el saldo queda en lo que falta (0, «a
-- paz y salvo», cuando ya pagó todo). Lo usan Liquidar, el resumen, el link
-- público y «cuánto debo» de Mister Luks.
--
-- No se cuenta doble: al reabrir, las transferencias pagadas pasan a
-- settlement_payments y la liquidación se borra (reabrir_liquidacion). Sin
-- liquidación, todo sigue igual (start_settlement solo mira saldos entonces).
-- ============================================================================

create or replace function public.saldos(p_account_id uuid, p_month date)
returns table (person_id uuid, paid bigint, share bigint, expenses int, sent bigint, received bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select b.person_id, b.paid, b.share, b.expenses,
         (coalesce((select sum(x.amount_cop) from public.settlement_payments x
                    where x.account_id = p_account_id and x.period is not distinct from p_month and x.from_person_id = b.person_id), 0)
          + coalesce((select sum(t.amount_cop) from public.settlement_transfers t
                      join public.settlements s on s.id = t.settlement_id
                      where s.account_id = p_account_id and s.period is not distinct from p_month
                        and t.paid_at is not null and t.from_person_id = b.person_id), 0))::bigint,
         (coalesce((select sum(x.amount_cop) from public.settlement_payments x
                    where x.account_id = p_account_id and x.period is not distinct from p_month and x.to_person_id = b.person_id), 0)
          + coalesce((select sum(t.amount_cop) from public.settlement_transfers t
                      join public.settlements s on s.id = t.settlement_id
                      where s.account_id = p_account_id and s.period is not distinct from p_month
                        and t.paid_at is not null and t.to_person_id = b.person_id), 0))::bigint
  from public.period_balances(p_account_id, p_month) b
$$;

revoke execute on function public.saldos(uuid, date) from public, anon, authenticated;
grant execute on function public.saldos(uuid, date) to service_role;
