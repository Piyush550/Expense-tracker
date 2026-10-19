// Who should pay whom. Balances are "net" paise per person: positive means the group owes
// them money, negative means they owe the group. A group's balances always sum to zero.

export interface Transfer {
  from: string;
  to: string;
  amountPaise: number;
}

/** A directed debt: `from` owes `to` this much, before any netting. */
export interface Debt {
  from: string;
  to: string;
  amountPaise: number;
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Exact search is O(2^n · n); 16 people with a non-zero balance is ~1M steps.
const EXACT_LIMIT = 16;

/**
 * Splits the balances into the largest number of groups that each sum to zero.
 * A group of k people can always settle with k − 1 payments and never with fewer,
 * so more groups means fewer payments overall; this gives the true minimum.
 * dp[mask] = most zero-sum prefixes reachable when the people in `mask` are ordered well.
 */
function zeroSumGroups(vals: number[]): number[][] {
  const m = vals.length;
  const size = 1 << m;
  const sum = new Float64Array(size);
  const dp = new Int16Array(size);
  const last = new Int8Array(size);
  for (let mask = 1; mask < size; mask++) {
    const low = 31 - Math.clz32(mask & -mask);
    sum[mask] = sum[mask ^ (1 << low)]! + vals[low]!;
    let best = -1;
    let pick = 0;
    for (let j = 0; j < m; j++) {
      if (mask & (1 << j)) {
        const v = dp[mask ^ (1 << j)]!;
        if (v > best) {
          best = v;
          pick = j;
        }
      }
    }
    dp[mask] = best + (sum[mask] === 0 ? 1 : 0);
    last[mask] = pick;
  }
  // Rebuild the ordering, then cut it wherever the running total returns to zero.
  const order: number[] = [];
  for (let mask = size - 1; mask; mask ^= 1 << last[mask]!) order.push(last[mask]!);
  order.reverse();
  const groups: number[][] = [];
  let cur: number[] = [];
  let run = 0;
  for (const j of order) {
    cur.push(j);
    run += vals[j]!;
    if (run === 0) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

/** Biggest debtor pays biggest creditor until everyone in the set is square. */
function greedy(ids: string[], net: Map<string, number>, out: Transfer[]) {
  const order = (a: { id: string; amt: number }, b: { id: string; amt: number }) => b.amt - a.amt || byId(a.id, b.id);
  const debtors = ids.filter((id) => net.get(id)! < 0).map((id) => ({ id, amt: -net.get(id)! }));
  const creditors = ids.filter((id) => net.get(id)! > 0).map((id) => ({ id, amt: net.get(id)! }));
  while (debtors.length && creditors.length) {
    debtors.sort(order);
    creditors.sort(order);
    const d = debtors[0]!;
    const c = creditors[0]!;
    const amt = Math.min(d.amt, c.amt);
    out.push({ from: d.id, to: c.id, amountPaise: amt });
    d.amt -= amt;
    c.amt -= amt;
    if (d.amt === 0) debtors.shift();
    if (c.amt === 0) creditors.shift();
  }
}

/**
 * "Simplify debts": the fewest payments that make every balance zero. Exact for up to
 * 16 people with a non-zero balance; above that, exact opposite pairs are settled first
 * and the rest greedily. Payments may go between people who never shared an expense.
 */
export function simplifyDebts(balances: Record<string, number>): Transfer[] {
  const net = new Map<string, number>();
  let total = 0;
  for (const [id, v] of Object.entries(balances)) {
    if (!Number.isSafeInteger(v)) throw new Error(`Balance for ${id} is not a whole number of paise`);
    total += v;
    if (v !== 0) net.set(id, v);
  }
  if (total !== 0) throw new Error(`Balances must sum to zero, got ${total}`);

  const people = [...net.keys()].sort(byId);
  const out: Transfer[] = [];
  if (people.length <= EXACT_LIMIT) {
    for (const g of zeroSumGroups(people.map((id) => net.get(id)!))) greedy(g.map((i) => people[i]!), net, out);
    return out;
  }
  // Too many people for the exact search: settle exact opposites first (each such pair is
  // a zero-sum group of two), then fall back to greedy for everyone left.
  const remaining = new Set(people);
  for (const id of people) {
    if (!remaining.has(id) || net.get(id)! >= 0) continue;
    const match = people.find((o) => remaining.has(o) && net.get(o) === -net.get(id)!);
    if (match) {
      out.push({ from: id, to: match, amountPaise: net.get(match)! });
      remaining.delete(id);
      remaining.delete(match);
    }
  }
  greedy([...remaining], net, out);
  return out;
}

/**
 * Without simplification: each pair of people nets out only what they owe each other
 * directly, so nobody is asked to pay someone they never shared an expense with.
 */
export function pairwiseDebts(debts: Debt[]): Transfer[] {
  const owed = new Map<string, number>(); // "a|b" with a < b → positive means a owes b
  for (const d of debts) {
    if (d.from === d.to || d.amountPaise === 0) continue;
    const [a, b, sign] = d.from < d.to ? [d.from, d.to, 1] : [d.to, d.from, -1];
    const key = `${a}|${b}`;
    owed.set(key, (owed.get(key) ?? 0) + sign * d.amountPaise);
  }
  const out: Transfer[] = [];
  for (const [key, v] of owed) {
    if (v === 0) continue;
    const [a, b] = key.split("|") as [string, string];
    out.push(v > 0 ? { from: a, to: b, amountPaise: v } : { from: b, to: a, amountPaise: -v });
  }
  return out.sort((x, y) => byId(x.from, y.from) || byId(x.to, y.to));
}

/** Net balance per person implied by a list of directed debts (positive = is owed). */
export function balancesFromDebts(debts: Debt[]): Record<string, number> {
  const net: Record<string, number> = {};
  for (const d of debts) {
    net[d.from] = (net[d.from] ?? 0) - d.amountPaise;
    net[d.to] = (net[d.to] ?? 0) + d.amountPaise;
  }
  return net;
}
