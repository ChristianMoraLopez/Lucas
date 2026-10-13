-- ============================================================================
-- Mister Luks ya no confirma cada gasto en el grupo («✅ Anotado: …»): era
-- redundante. Los gastos se ven en la app; si un grupo quiere confirmaciones,
-- un admin las prende en Conectar WhatsApp («Confirmar en el grupo»).
--
-- Lo que estaba esperando confirmación tampoco se manda: connector_pending_replies
-- lo da por respondido en su próxima vuelta (como en los grupos que las apagaban).
-- ============================================================================

alter table public.account_group_links alter column confirm_in_group set default false;
update public.account_group_links set confirm_in_group = false where confirm_in_group;
