/* Quién le paga a quién con el menor número de transferencias: el mismo
   cálculo de Liquidar en la app (apps/web/lib/settlement.ts, minTransfers y
   aQuienPagoPor),
   copiado aquí porque la imagen del connector se arma solo con su carpeta.
   test/liquidacion.test.ts revisa que los dos den lo mismo: si cambia uno,
   se cambia el otro. Ver allá cómo funciona (programación dinámica sobre
   subconjuntos hasta 20 personas con saldo; voraz por encima). */

export interface Balance {
  id: string;
  name: string;
  /** pagó − le tocaba, en pesos enteros */
  balance: number;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

/** Hasta aquí se busca el óptimo exacto (2^n estados × n). */
export const EXACT_LIMIT = 20;

export function minTransfers(balances: Balance[]): Transfer[] {
  for (const b of balances) {
    if (!Number.isSafeInteger(b.balance)) throw new Error(`El saldo de ${b.name} no es un número entero de pesos`);
  }
  const total = balances.reduce((s, b) => s + b.balance, 0);
  if (total !== 0) throw new Error(`Los saldos no cuadran: sobran ${total} pesos`);

  // Orden estable: primero a quien más le deben, después a quien más debe; a igualdad, por nombre
  const people = balances
    .filter((b) => b.balance !== 0)
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id));

  const groups = people.length <= EXACT_LIMIT ? zeroSumGroups(people) : [people];
  const transfers = groups.flatMap(settleGroup);
  return transfers.sort((a, b) => b.amount - a.amount || nameOf(balances, a.from).localeCompare(nameOf(balances, b.from), 'es'));
}

const nameOf = (list: Balance[], id: string) => list.find((b) => b.id === id)?.name ?? id;

/**
 * Parte a las personas en el máximo número de grupos que suman cero.
 * dp[mask] = cuántas veces llega a cero la suma al agregar las personas de
 * `mask` en el mejor orden. Reconstruir ese orden y cortar donde la suma
 * parcial es cero da los grupos.
 */
function zeroSumGroups(people: Balance[]): Balance[][] {
  const n = people.length;
  if (n === 0) return [];
  const size = 1 << n;
  const sum = new Array<number>(size).fill(0);
  const dp = new Int8Array(size);
  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask;
    const i = 31 - Math.clz32(low);
    sum[mask] = sum[mask ^ low] + people[i].balance;
    let best = 0;
    for (let j = 0; j < n; j++) {
      if (mask & (1 << j)) best = Math.max(best, dp[mask ^ (1 << j)]);
    }
    dp[mask] = best + (sum[mask] === 0 ? 1 : 0);
  }

  // Reconstruye el orden de atrás hacia adelante (determinista: el primer j que sirve)
  const order: number[] = [];
  let mask = size - 1;
  while (mask) {
    const bonus = sum[mask] === 0 ? 1 : 0;
    for (let j = 0; j < n; j++) {
      if (mask & (1 << j) && dp[mask ^ (1 << j)] + bonus === dp[mask]) {
        order.unshift(j);
        mask ^= 1 << j;
        break;
      }
    }
  }

  const groups: Balance[][] = [];
  let current: Balance[] = [];
  let acc = 0;
  for (const j of order) {
    current.push(people[j]);
    acc += people[j].balance;
    if (acc === 0) {
      groups.push(current);
      current = [];
    }
  }
  return groups;
}

/** Salda un grupo que suma cero: el que más debe le paga al que más le deben. */
function settleGroup(group: Balance[]): Transfer[] {
  const creditors = group.filter((p) => p.balance > 0).map((p) => ({ ...p }));
  const debtors = group.filter((p) => p.balance < 0).map((p) => ({ ...p, balance: -p.balance }));
  const byAmount = (a: { balance: number; name: string }, b: { balance: number; name: string }) => b.balance - a.balance || a.name.localeCompare(b.name, 'es');
  const out: Transfer[] = [];
  while (creditors.length && debtors.length) {
    creditors.sort(byAmount);
    debtors.sort(byAmount);
    const c = creditors[0];
    const d = debtors[0];
    const amount = Math.min(c.balance, d.balance);
    out.push({ from: d.id, to: c.id, amount });
    c.balance -= amount;
    d.balance -= amount;
    if (c.balance === 0) creditors.shift();
    if (d.balance === 0) debtors.shift();
  }
  return out;
}

/**
 * Cada quien le paga solo a alguien que pagó algo suyo (`pagaronPor`: deudor →
 * quienes pagaron gastos en los que tuvo parte), con pocas transferencias:
 * primero los que tienen menos opciones; cada uno le paga a quien más le
 * deben entre esas (si a alguno le deben justo lo que él debe, a ese). null si
 * así no cuadra: entonces se usan las transferencias por pareja.
 */
export function aQuienPagoPor(balances: Balance[], pagaronPor: Map<string, Iterable<string>>): Transfer[] | null {
  if (balances.some((b) => !Number.isSafeInteger(b.balance)) || balances.reduce((s, b) => s + b.balance, 0) !== 0) return null;
  const credito = new Map(balances.filter((b) => b.balance > 0).map((b) => [b.id, b.balance]));
  const deudores = balances
    .filter((b) => b.balance < 0)
    .map((b) => ({ ...b, opciones: [...new Set(pagaronPor.get(b.id) ?? [])].filter((c) => credito.has(c)) }))
    .sort((a, b) => a.opciones.length - b.opciones.length || a.balance - b.balance || a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id));
  const out: Transfer[] = [];
  for (const d of deudores) {
    let falta = -d.balance;
    while (falta > 0) {
      const vivos = d.opciones.filter((c) => (credito.get(c) ?? 0) > 0);
      if (!vivos.length) return null;
      const c =
        vivos.find((x) => credito.get(x) === falta) ?? vivos.sort((x, y) => (credito.get(y) as number) - (credito.get(x) as number) || x.localeCompare(y))[0];
      const monto = Math.min(falta, credito.get(c) as number);
      out.push({ from: d.id, to: c, amount: monto });
      credito.set(c, (credito.get(c) as number) - monto);
      falta -= monto;
    }
  }
  return out.sort((a, b) => b.amount - a.amount || nameOf(balances, a.from).localeCompare(nameOf(balances, b.from), 'es'));
}
