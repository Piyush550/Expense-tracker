// Split and settlement logic. All money is integer paise.
export function splitShares(paise, ids) {
  const s = [...ids].sort();
  const n = s.length;
  const base = Math.floor(paise / n);
  const rem = paise - base * n;
  const out = {};
  s.forEach((id, i) => { out[id] = base + (i < rem ? 1 : 0); });
  return out;
}

// Largest number of zero-sum groups the non-zero balances can be split into.
// Each group of k people needs k-1 payments, so more groups means fewer payments.
function zeroSumGroups(vals) {
  const m = vals.length;
  const N = 1 << m;
  const sum = new Float64Array(N);
  const dp = new Int16Array(N);
  const prev = new Int8Array(N);
  for (let mask = 1; mask < N; mask++) {
    const low = 31 - Math.clz32(mask & -mask);
    sum[mask] = sum[mask ^ (1 << low)] + vals[low];
    let best = -1, bj = 0;
    for (let j = 0; j < m; j++) {
      if (mask & (1 << j)) {
        const v = dp[mask ^ (1 << j)];
        if (v > best) { best = v; bj = j; }
      }
    }
    dp[mask] = best + (sum[mask] === 0 ? 1 : 0);
    prev[mask] = bj;
  }
  const seq = [];
  let mask = N - 1;
  while (mask) { const j = prev[mask]; seq.push(j); mask ^= (1 << j); }
  seq.reverse();
  const groups = [];
  let cur = [], run = 0;
  for (const j of seq) {
    cur.push(j); run += vals[j];
    if (run === 0) { groups.push(cur); cur = []; }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

export function minTransfers(net) {
  const people = Object.keys(net).filter(id => net[id] !== 0).sort();
  if (!people.length) return [];
  const groups = people.length <= 16
    ? zeroSumGroups(people.map(id => net[id])).map(g => g.map(i => people[i]))
    : [people];
  const byAmt = (a, b) => (b.amt - a.amt) || (a.id < b.id ? -1 : 1);
  const out = [];
  for (const g of groups) {
    const debt = g.filter(id => net[id] < 0).map(id => ({ id, amt: -net[id] }));
    const cred = g.filter(id => net[id] > 0).map(id => ({ id, amt: net[id] }));
    while (debt.length && cred.length) {
      debt.sort(byAmt); cred.sort(byAmt);
      const d = debt[0], c = cred[0];
      const amt = Math.min(d.amt, c.amt);
      out.push({ from: d.id, to: c.id, paise: amt });
      d.amt -= amt; c.amt -= amt;
      if (d.amt === 0) debt.shift();
      if (c.amt === 0) cred.shift();
    }
  }
  return out;
}

export function computeMonth(expenses, memberIds) {
  const paid = {}, share = {}, net = {};
  memberIds.forEach(id => { paid[id] = 0; share[id] = 0; });
  for (const e of expenses) {
    const ppl = (e.people || []).filter(Boolean);
    if (!ppl.length || !(e.paise > 0)) continue;
    paid[e.payer] = (paid[e.payer] || 0) + e.paise;
    const sh = splitShares(e.paise, ppl);
    for (const id in sh) share[id] = (share[id] || 0) + sh[id];
  }
  new Set([...Object.keys(paid), ...Object.keys(share)]).forEach(id => {
    paid[id] = paid[id] || 0; share[id] = share[id] || 0; net[id] = paid[id] - share[id];
  });
  return { paid, share, net, transfers: minTransfers(net) };
}
