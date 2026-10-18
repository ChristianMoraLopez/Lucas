import type { Logger } from './log.js';
import { reciboDe } from './recibo.js';
import type { Cobro, OutboxItem, Store } from './store.js';
import { formatCOP, type Idioma } from './text.js';

/*
 * Avisos de cobro (migración 410): si la cuenta los tiene prendidos, apenas se
 * liquida Mister Luks le escribe a cada quien que debe cuánto, a quién y por
 * qué (ítem por ítem), y se lo recuerda cada 3 días hasta que lo marquen
 * pagado (como mucho 3 veces). La base decide qué toca y a dónde
 * (connector_cobros): por privado solo a quien ya le escribió a Mister Luks;
 * a los demás, un mensaje en el grupo. Todo sale por la bandeja de salida,
 * con el mismo límite de frecuencia de lo demás que escribe.
 *
 * Firman con «Más detalle en mrluks.com»: así nadie los anota como gasto
 * (es_mensaje_de_luks, en el connector, el worker y la base).
 */

const FIRMA: Record<Idioma, string> = { es: '📊 Más detalle en mrluks.com', en: '📊 More detail at mrluks.com' };
const MAX_GASTOS = 6;
const MAX_ITEMS = 12;

/** Los nombres van tal cual, sin los signos con que WhatsApp pone negrilla, cursiva o tachado */
const limpio = (s: string | null | undefined) => (s ?? '').replace(/[*_~`]/g, '').trim();
const primerNombre = (s: string | null | undefined) => limpio(s).split(/\s+/)[0] ?? '';
const idiomaDe = (c: Pick<Cobro, 'account'>): Idioma => (c.account.language === 'en' ? 'en' : 'es');

function lista(partes: string[], idioma: Idioma) {
  if (partes.length <= 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')}${idioma === 'en' ? ' and ' : ' y '}${partes.at(-1)}`;
}

/** El link donde ve lo suyo y lo marca pagado */
function linkDe(c: Cobro, webUrl: string, persona: string | null) {
  if (!c.token) return null;
  const q = new URLSearchParams();
  if (persona) q.set('p', persona);
  if (c.account.type === 'hogar' && c.account.month) q.set('mes', c.account.month.slice(0, 7));
  if (idiomaDe(c) === 'en') q.set('l', 'en');
  const s = q.toString();
  return `${webUrl}/r/${c.token}${s ? `?${s}` : ''}`;
}

/** Lo que le tocó a quien debe, gasto por gasto e ítem por ítem */
function detalle(c: Cobro, idioma: Idioma) {
  const en = idioma === 'en';
  const $ = (n: number) => formatCOP(n, c.account.currency, idioma);
  const lineas: string[] = [];
  let consumo = 0;
  for (const [k, e] of c.expenses.entries()) {
    const r = reciboDe(e, c.from.id);
    if (!r) continue;
    consumo += r.parte;
    if (k >= MAX_GASTOS) continue;
    lineas.push('', en ? `*${limpio(e.merchant)}* (${limpio(e.payer_name)} paid)` : `*${limpio(e.merchant)}* (pagó ${limpio(e.payer_name)})`);
    if (!r.items.length) {
      const entre = e.shares.filter((x) => Number(x.amount_cop) > 0).length;
      const parte = en ? (entre > 1 ? `Your share (among ${entre})` : 'Your share') : entre > 1 ? `Tu parte (entre ${entre})` : 'Tu parte';
      lineas.push(`• ${parte}: ${$(r.parte)}`);
      continue;
    }
    for (const i of r.items.slice(0, MAX_ITEMS)) {
      const cuantas = i.units ? (en ? `${i.units} of ${i.de}` : `${i.units} de ${i.de}`) : i.entre > 1 ? (en ? `among ${i.entre}` : `entre ${i.entre}`) : '';
      lineas.push(`• ${limpio(i.name)}${cuantas ? ` (${cuantas})` : ''}: ${$(i.amount)}`);
    }
    if (r.items.length > MAX_ITEMS) {
      const mas = r.items.length - MAX_ITEMS;
      lineas.push(en ? `• … and ${mas} more in the link` : `• … y ${mas} más en el link`);
    }
    if (Math.abs(r.resto) > r.items.length) {
      lineas.push(
        r.resto > 0
          ? `• ${en ? 'Tip and service' : 'Propina y servicio'}: ${$(r.resto)}`
          : `• ${en ? 'What someone else chipped in' : 'Lo que otro puso de más'}: −${$(-r.resto)}`,
      );
    }
    lineas.push(`Total: *${$(r.parte)}*`);
  }
  if (c.expenses.length > MAX_GASTOS) {
    const mas = c.expenses.length - MAX_GASTOS;
    lineas.push('', en ? `… and ${mas} more in the link` : `… y ${mas} más en el link`);
  }
  return { lineas, consumo };
}

/** El mensaje por privado a quien debe: cuánto, a quién y por qué */
export function mensajeCobro(c: Cobro, webUrl: string): string {
  const idioma = idiomaDe(c);
  const en = idioma === 'en';
  const $ = (n: number) => formatCOP(n, c.account.currency, idioma);
  const nombre = primerNombre(c.from.name);
  const cuenta = limpio(c.account.name);
  const a = limpio(c.to.name);
  // Lo que le falta pagar en esta liquidación (si le paga a varios, un solo mensaje con todo)
  const todas = c.transfers?.length ? c.transfers : [{ to: c.to.name, amount: c.amount }];
  const debe = todas.reduce((s, t) => s + Number(t.amount), 0);
  const varios = todas.length > 1;
  const cuanto = varios
    ? `${en ? 'you owe' : 'debes'} *${$(debe)}*`
    : en
      ? `you owe ${a} *${$(Number(c.amount))}*`
      : `le debes a ${a} *${$(Number(c.amount))}*`;
  const lineas = [
    // Recordatorio solo si ya le había llegado por privado (si solo se le avisó en el grupo, este es el primero)
    c.avisado_privado
      ? en
        ? `⏰ Hi ${nombre}, a reminder: for “${cuenta}” ${cuanto}.`
        : `⏰ Hola ${nombre}, te recuerdo: de «${cuenta}» ${cuanto}.`
      : en
        ? `💸 Hi ${nombre} 👋 “${cuenta}” was settled: ${cuanto}.`
        : `💸 Hola ${nombre} 👋 Ya liquidamos «${cuenta}»: ${cuanto}.`,
  ];

  const { lineas: suyo, consumo } = detalle(c, idioma);
  if (suyo.length) lineas.push('', en ? '🧾 *Your share, item by item:*' : '🧾 *Lo tuyo, ítem por ítem:*', ...suyo);

  const cierre: string[] = [];
  if (consumo > debe) {
    cierre.push(
      en ? `➖ ${$(consumo - debe)} from what you paid for others or already paid` : `➖ ${$(consumo - debe)} de lo que tú pagaste por otros o ya pagaste`,
    );
  }
  if (varios) {
    const cada = todas.map((t) => (en ? `${$(Number(t.amount))} to ${limpio(t.to)}` : `${$(Number(t.amount))} a ${limpio(t.to)}`));
    cierre.push(en ? `You pay ${lista(cada, idioma)}.` : `Le pagas ${lista(cada, idioma)}.`);
  }
  if (c.expenses.length && !c.expenses.some((e) => e.payer_person_id === c.to.id)) {
    cierre.push(
      en
        ? `Debts were netted out for fewer transfers: that's why you pay ${a}.`
        : `Se cruzaron las deudas para hacer menos transferencias: por eso le pagas a ${a}.`,
    );
  }
  if (cierre.length) lineas.push('', ...cierre);

  const link = linkDe(c, webUrl, c.from.id);
  if (link) lineas.push('', en ? `🔗 All the detail: ${link}` : `🔗 Todo el detalle: ${link}`);
  // Con «ya pagué» queda marcado (pagos.ts)
  const a1 = primerNombre(todas[0].to);
  lineas.push(
    '',
    varios
      ? en
        ? `When you pay, reply *I paid ${a1}* (or *I paid everyone*) and I’ll mark it ✅`
        : `Cuando les pagues, respóndeme *ya le pagué a ${a1}* (o *ya les pagué a todos*) y lo marco ✅`
      : en
        ? 'When you pay, reply *paid* and I’ll mark it ✅'
        : 'Cuando le pagues, respóndeme *ya pagué* y lo marco ✅',
  );
  lineas.push('', FIRMA[idioma]);
  return lineas.join('\n');
}

/** Para quienes no le han escrito a Mister Luks: un solo mensaje en el grupo con lo que falta */
export function mensajeGrupo(cs: Cobro[], webUrl: string): string {
  const c = cs[0];
  const idioma = idiomaDe(c);
  const en = idioma === 'en';
  const $ = (n: number) => formatCOP(n, c.account.currency, idioma);
  const cuenta = limpio(c.account.name);
  const recordatorio = cs.every((x) => x.avisos > 0);
  const lineas = [
    recordatorio
      ? en
        ? `⏰ Reminder for “${cuenta}”: still to pay`
        : `⏰ Recordatorio de «${cuenta}»: falta por pagar`
      : en
        ? `💸 “${cuenta}” was settled. Still to pay:`
        : `💸 Ya liquidamos «${cuenta}». Falta por pagar:`,
    ...cs.map((x) => `• ${limpio(x.from.name)} → ${limpio(x.to.name)}: *${$(Number(x.amount))}*`),
  ];
  const link = linkDe(c, webUrl, null);
  if (link) lineas.push('', en ? `Everyone can see their share, item by item, here: ${link}` : `Cada uno ve lo suyo, ítem por ítem, aquí: ${link}`);
  const a1 = primerNombre(c.to.name);
  lineas.push(
    '',
    en
      ? `When you pay, write me “luks I paid ${a1}” and I’ll mark it ✅ If you message me privately, I’ll send you your details there.`
      : `Cuando paguen, escríbanme «luks ya le pagué a ${a1}» y lo marco ✅ Si me escriben por privado, les mando el detalle por allá.`,
  );
  lineas.push('', FIRMA[idioma]);
  return lineas.join('\n');
}

/**
 * Una vuelta: lo que toca avisar ahora, a la bandeja de salida. Por privado,
 * uno por transferencia; en el grupo, uno por liquidación con todo lo que
 * falta de quienes no tienen el chat abierto. Devuelve cuántos encoló.
 */
export async function avisarCobros(store: Store, webUrl: string, log: Logger): Promise<number> {
  const cobros = await store.cobros(40);
  if (!cobros.length) return 0;
  const items: OutboxItem[] = [];
  const privados: string[] = [];
  const enGrupo: string[] = [];
  // Por privado, uno por persona y liquidación (con todo lo que le falta pagar); en el grupo, uno por liquidación
  const porPersona = new Map<string, Cobro[]>();
  const porGrupo = new Map<string, Cobro[]>();
  for (const c of cobros) {
    const [mapa, clave] = c.private_jid ? [porPersona, `${c.private_jid}|${c.settlement_id}`] : [porGrupo, `${c.group_jid}|${c.settlement_id}`];
    if (!c.private_jid && !c.group_jid) continue;
    mapa.set(clave, [...(mapa.get(clave) ?? []), c]);
  }
  for (const [clave, [c, ...otros]] of porPersona) {
    const [jid] = clave.split('|');
    items.push({ chat_jid: jid, reason: 'answer', body: mensajeCobro(c, webUrl), dedupe_key: `cobro:${c.transfer_id}:${c.avisos}` });
    privados.push(c.transfer_id, ...otros.map((x) => x.transfer_id));
  }
  for (const [clave, cs] of porGrupo) {
    const [jid, liquidacion] = clave.split('|');
    const vuelta = Math.min(...cs.map((x) => x.avisos));
    items.push({ chat_jid: jid, reason: 'answer', body: mensajeGrupo(cs, webUrl), dedupe_key: `cobro-grupo:${liquidacion}:${vuelta}` });
    enGrupo.push(...cs.map((x) => x.transfer_id));
  }
  const nuevos = await store.outboxEnqueue(items);
  await store.cobrosAvisados(privados, enGrupo);
  log.info({ privados: porPersona.size, grupos: porGrupo.size, nuevos: nuevos.length }, 'Avisos de cobro');
  return nuevos.length;
}
