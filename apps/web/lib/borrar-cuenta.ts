/* Borrar una cuenta del todo: primero sus fotos y PDF en Storage (mientras
   quien la borra todavía tiene permiso), después la cuenta en la base
   (delete_account_forever, que se lleva todo lo demás). */

import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'evidencias';
const POR_VEZ = 100;

/** El nombre escrito coincide con el de la cuenta (sin importar mayúsculas ni espacios de más) */
export const nombreCoincide = (escrito: string, nombre: string) =>
  escrito.trim().replace(/\s+/g, ' ').toLowerCase() === nombre.trim().replace(/\s+/g, ' ').toLowerCase();

/** Parte una lista en tandas */
export function enTandas<T>(lista: T[], tamano = POR_VEZ): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) out.push(lista.slice(i, i + tamano));
  return out;
}

type Listar = (carpeta: string) => Promise<{ name: string; id: string | null }[]>;

/** Todos los archivos bajo una carpeta (Storage lista un nivel a la vez; las carpetas no tienen id) */
export async function archivosBajo(carpeta: string, listar: Listar): Promise<string[]> {
  const out: string[] = [];
  const pendientes = [carpeta];
  while (pendientes.length) {
    const actual = pendientes.shift() as string;
    for (const e of await listar(actual)) {
      const ruta = `${actual}/${e.name}`;
      if (e.id === null) pendientes.push(ruta);
      else out.push(ruta);
    }
  }
  return out;
}

/** Las fotos y PDF de la cuenta: lo que hay en su carpeta y lo que nombran sus mensajes */
export async function archivosDeLaCuenta(supabase: SupabaseClient, accountId: string): Promise<string[]> {
  const listar: Listar = async (carpeta) => {
    const todos: { name: string; id: string | null }[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await supabase.storage.from(BUCKET).list(carpeta, { limit: 1000, offset: desde });
      if (error) throw error;
      todos.push(...(data ?? []));
      if (!data || data.length < 1000) return todos;
    }
  };
  const [enCarpeta, mensajes] = await Promise.all([
    archivosBajo(accountId, listar),
    supabase.from('messages').select('media_path').eq('account_id', accountId).not('media_path', 'is', null),
  ]);
  if (mensajes.error) throw mensajes.error;
  const nombrados = (mensajes.data ?? []).map((m) => m.media_path as string).filter((p) => p.startsWith(`${accountId}/`));
  return [...new Set([...enCarpeta, ...nombrados])];
}

/**
 * Borra la cuenta del todo. `avance` cuenta los archivos que ya se borraron.
 * Si algo falla, la cuenta no se toca (se puede intentar otra vez).
 */
export async function borrarCuenta(
  supabase: SupabaseClient,
  accountId: string,
  confirmacion: string,
  avance: (hechos: number, total: number) => void = () => {},
): Promise<void> {
  const archivos = await archivosDeLaCuenta(supabase, accountId);
  let hechos = 0;
  avance(0, archivos.length);
  for (const tanda of enTandas(archivos)) {
    const { error } = await supabase.storage.from(BUCKET).remove(tanda);
    if (error) throw error;
    hechos += tanda.length;
    avance(hechos, archivos.length);
  }
  const { error } = await supabase.rpc('delete_account_forever', { p_account_id: accountId, p_confirm: confirmacion });
  if (error) throw error;
}
