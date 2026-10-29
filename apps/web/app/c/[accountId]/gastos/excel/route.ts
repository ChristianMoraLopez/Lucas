import { nombreCategoria } from '@/components/lucas-core';
import { monthName } from '@/lib/dates';
import { type GastoExcel, libroDeGastos } from '@/lib/excel-gastos';
import { aplicarFiltros, leerFiltros, ordenarPorCercania, porCercania } from '@/lib/gastos-filtros';
import { getT } from '@/lib/i18n/server';
import { conCodigo, esMoneda, esMonedaRecibo } from '@/lib/moneda';
import { createClient } from '@/utils/supabase/server';

/*
 * El Excel de Gastos (lib/excel-gastos.ts): lo mismo que muestra la lista con
 * sus filtros (?q=&cat=&quien=&mes=&ver=&orden=), pero completo, sin el tope
 * de la pantalla. Solo para quien es de la cuenta (RLS).
 */

interface Fila {
  id: string;
  merchant: string;
  expense_date: string;
  total_cop: number;
  status: 'pending_review' | 'confirmed';
  source: 'whatsapp' | 'web' | 'import';
  categories: { name: string; tone: string } | null;
  people: { display_name: string } | null;
  messages: { kind: 'photo' | 'pdf' | 'text' } | null;
  expense_splits: { amount_cop: number; people: { display_name: string } | null }[];
  original_currency: string | null;
  original_total: number | null;
}

/** Cuántos gastos trae el Excel como máximo */
const TOPE = 5000;

export async function GET(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const url = new URL(request.url);
  const sp = url.searchParams;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return new Response('Inicia sesión para descargar el Excel', { status: 401 });

  const t = await getT();
  const { data: cuenta } = await supabase.from('accounts').select('id, name, type, currency').eq('id', accountId).maybeSingle();
  if (!cuenta) return new Response('Esa cuenta no existe', { status: 404 });
  const moneda = esMoneda(cuenta.currency) ? cuenta.currency : 'COP';
  const f = leerFiltros(sp, moneda);
  const [{ data: cat }, { data: quien }] = await Promise.all([
    f.cat ? supabase.from('categories').select('name').eq('id', f.cat).maybeSingle() : Promise.resolve({ data: null }),
    f.quien ? supabase.from('people').select('display_name').eq('id', f.quien).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const { data, error } = await aplicarFiltros(
    supabase
      .from('expenses')
      .select(
        'id, merchant, expense_date, total_cop, status, source, categories(name, tone), people!expenses_payer_person_id_fkey(display_name), messages(kind), expense_splits(amount_cop, people(display_name)), original_currency, original_total',
      )
      .eq('account_id', accountId)
      .limit(TOPE),
    f,
  );
  if (error) return new Response('No se pudieron leer los gastos', { status: 500 });

  const tipo: Record<string, string> = { photo: t('Foto'), pdf: 'PDF', text: t('Texto') };
  const fuente: Record<string, string> = { whatsapp: 'WhatsApp', web: 'Web', import: t('Chat importado') };
  const filas = (data ?? []) as unknown as Fila[];
  const gastos: GastoExcel[] = (porCercania(f) && f.monto ? ordenarPorCercania(filas, f.monto) : filas).map((r) => {
    // Lo de cada persona (por consumo, una fila por ítem: se suman)
    const division = new Map<string, number>();
    for (const s of r.expense_splits) {
      const k = s.people?.display_name ?? '?';
      division.set(k, (division.get(k) ?? 0) + Number(s.amount_cop));
    }
    return {
      id: r.id,
      fecha: r.expense_date,
      comercio: r.merchant,
      categoria: r.categories ? { nombre: nombreCategoria(r.categories.name, t), tono: r.categories.tone } : null,
      pagador: r.people?.display_name ?? null,
      total: Number(r.total_cop),
      pendiente: r.status === 'pending_review',
      origen: [fuente[r.source] ?? r.source, r.messages ? tipo[r.messages.kind] : null].filter(Boolean).join(' · '),
      original: r.original_total && esMonedaRecibo(r.original_currency) ? conCodigo(r.original_total, r.original_currency, t.idioma) : null,
      division: [...division].map(([persona, monto]) => ({ persona, monto })),
    };
  });

  const mesLargo = (m: string) => `${monthName(`${m}-01`, t.idioma)} ${m.slice(0, 4)}`;
  const filtros = [
    f.q ? t('Busca «{q}»', { q: f.q }) : null,
    cat ? `${t('Categoría')}: ${nombreCategoria(cat.name, t)}` : null,
    quien ? t('Pagó {nombre}', { nombre: quien.display_name }) : null,
    f.soloPendientes ? t('Por revisar') : null,
  ].filter((x): x is string => Boolean(x));
  const hoy = new Intl.DateTimeFormat(t.idioma === 'en' ? 'en-US' : 'es-CO', { dateStyle: 'long', timeZone: 'America/Bogota' }).format(new Date());

  const libro = await libroDeGastos(
    {
      cuenta: cuenta.name,
      tipo: cuenta.type,
      moneda,
      periodo: f.mes ? mesLargo(f.mes) : t('Todos los gastos'),
      filtros,
      exportado: hoy,
      web: url.origin,
      accountId,
      nombreMes: mesLargo,
      gastos,
    },
    t,
  );

  const nombre = `Luks - ${cuenta.name} - ${f.mes ? mesLargo(f.mes) : t('Todos los gastos')}.xlsx`.replace(/[\\/:*?"<>|]/g, '');
  return new Response(new Uint8Array(libro), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nombre.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      'Cache-Control': 'private, no-store',
    },
  });
}
