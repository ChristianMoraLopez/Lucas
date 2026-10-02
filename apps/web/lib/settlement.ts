/* Liquidación: quién le paga a quién con el menor número de transferencias.

   Saldo de cada persona = lo que pagó − lo que le tocaba (en pesos enteros).
   Positivo: le deben. Negativo: debe. La suma de todos los saldos es cero.

   El mínimo de transferencias es n − g, donde n es la cantidad de personas con
   saldo distinto de cero y g el máximo número de grupos disjuntos cuyos saldos
   suman cero (cada grupo se salda por dentro con k − 1 transferencias).
   Encontrar g es NP-difícil en general, pero con programación dinámica sobre
   subconjuntos es instantáneo para los tamaños de un paseo (hasta ~20 personas
   con saldo). Por encima de eso se usa el método voraz, que da como mucho n − 1. */

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

/** Saldos a partir de lo pagado y lo que le tocaba a cada quien. */
export function balancesFrom(people: { id: string; name: string; paid: number; share: number }[]): Balance[] {
  return people.map((p) => ({ id: p.id, name: p.name, balance: p.paid - p.share }));
}

/** ¿Estas transferencias dejan a todos a paz y salvo? */
export function settlesAll(balances: Balance[], transfers: Transfer[]) {
  const left = new Map(balances.map((b) => [b.id, b.balance]));
  for (const t of transfers) {
    if (t.amount <= 0 || !Number.isSafeInteger(t.amount) || t.from === t.to) return false;
    if (!left.has(t.from) || !left.has(t.to)) return false;
    left.set(t.from, (left.get(t.from) as number) + t.amount);
    left.set(t.to, (left.get(t.to) as number) - t.amount);
  }
  return [...left.values()].every((v) => v === 0);
}
