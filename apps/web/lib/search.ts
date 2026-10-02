/**
 * Lo que se busca, escrito como public.normalize_merchant guarda los comercios
 * (expenses.merchant_normalized): minúsculas, sin tildes y sin signos. Así
 * «panaderia» encuentra «Panadería La Espiga».
 */
export function normalizarBusqueda(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, ' ')
    .trim()
    .slice(0, 60);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un id de la URL (?cat=, ?quien=) solo si tiene forma de uuid. */
export const uuidOrNull = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null);
