/* Dividir un gasto por consumo: quién pidió qué de la factura. Función pura
   (la usa la pantalla para mostrar los montos mientras se marcan los ítems);
   la base valida que las partes sumen el total (split_by_items). */

export interface ItemConsumo {
  total: number;
  /** Quiénes lo consumieron; vacío = entre todos los que estaban */
  people: string[];
}

export interface DivisionConsumo {
  /** Lo que consumió cada uno según los ítems (sin propina), con decimales */
  consumo: Record<string, number>;
  /** Lo que le tocaría según su consumo, ya con la propina y lo que no está en los ítems */
  justo: Record<string, number>;
  /** Lo que paga cada uno: pesos enteros que suman exactamente el total */
  partes: Record<string, number>;
  /** Lo que suman los ítems */
  items: number;
  /** Total − ítems: propina, servicio, impuestos (negativo = descuento o ítems de más) */
  extra: number;
  error: string | null;
}

/**
 * Reparte `total` en enteros proporcionales a `pesos` (el residuo, a las
 * fracciones más grandes; si empatan, en el orden en que vienen).
 */
export function repartir(total: number, ids: string[], pesos: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  if (!ids.length) return out;
  const suma = ids.reduce((s, id) => s + Math.max(0, pesos[id] ?? 0), 0);
  const w = (id: string) => (suma > 0 ? Math.max(0, pesos[id] ?? 0) / suma : 1 / ids.length);
  const crudo = ids.map((id) => ({ id, v: total * w(id) }));
  let resto = total;
  for (const c of crudo) {
    out[c.id] = Math.floor(c.v + 1e-9);
    resto -= out[c.id];
  }
  const orden = crudo.map((c, i) => ({ id: c.id, f: c.v - Math.floor(c.v + 1e-9), i })).sort((a, b) => (Math.abs(b.f - a.f) > 1e-9 ? b.f - a.f : a.i - b.i));
  for (let k = 0; resto > 0 && orden.length; k = (k + 1) % orden.length, resto--) out[orden[k].id] += 1;
  return out;
}

/**
 * Cada ítem se divide por igual entre quienes lo consumieron. Lo que no está
 * en los ítems (propina, servicio) se reparte en proporción a lo que consumió
 * cada uno. Quien fija un monto («Juan pone $150.000») pone eso, y el resto
 * se reparte entre los demás en la misma proporción.
 */
export function dividirPorConsumo({
  total,
  personas,
  items,
  fijos = {},
}: {
  total: number;
  /** Quiénes estaban, en el orden en que se muestran */
  personas: string[];
  items: ItemConsumo[];
  /** person_id → lo que pone, para quien fijó un monto */
  fijos?: Record<string, number>;
}): DivisionConsumo {
  const consumo: Record<string, number> = Object.fromEntries(personas.map((p) => [p, 0]));
  const vacio = { consumo, justo: { ...consumo }, partes: Object.fromEntries(personas.map((p) => [p, 0])), items: 0, extra: total };
  if (!personas.length) return { ...vacio, error: 'Elige quiénes estaban' };

  const estan = new Set(personas);
  let suma = 0;
  for (const it of items) {
    const valor = Math.max(0, Math.round(it.total) || 0);
    if (!valor) continue;
    suma += valor;
    const quienes = it.people.filter((p) => estan.has(p));
    const entre = quienes.length ? quienes : personas;
    for (const p of entre) consumo[p] += valor / entre.length;
  }

  // Lo justo: el consumo llevado al total (si no hay ítems, por igual)
  const justo: Record<string, number> = {};
  for (const p of personas) justo[p] = suma > 0 ? (consumo[p] * total) / suma : total / personas.length;
  const base = { consumo, justo, items: suma, extra: total - suma };

  const fijados = personas.filter((p) => fijos[p] != null);
  const fijo = fijados.reduce((s, p) => s + Math.max(0, Math.round(fijos[p])), 0);
  const libres = personas.filter((p) => fijos[p] == null);
  if (fijo > total) return { ...base, partes: vacio.partes, error: 'Lo que ponen fijo pasa el total de la cuenta' };
  if (!libres.length && fijo !== total) return { ...base, partes: vacio.partes, error: 'Si todos ponen un monto fijo, tienen que sumar el total' };

  const partes: Record<string, number> = { ...repartir(total - fijo, libres, justo) };
  for (const p of fijados) partes[p] = Math.max(0, Math.round(fijos[p]));
  return { ...base, partes: Object.fromEntries(personas.map((p) => [p, partes[p] ?? 0])), error: null };
}
