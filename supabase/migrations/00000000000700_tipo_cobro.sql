-- ============================================================================
-- Lucas · 00000000000700_tipo_cobro.sql
-- Un tipo de cuenta nuevo, además de hogar y evento: cobro («Chepito»). Va
-- solo en su archivo: un valor nuevo de un enum no se puede usar en la misma
-- transacción en que se agrega (la 710 ya lo usa).
-- ============================================================================

alter type public.account_type add value if not exists 'cobro';
