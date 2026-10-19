import type { Balances } from "../../shared/api";
import { formatMoney } from "../../shared/money";
import { usePeople, Who } from "./People";

export function BalancesTable({ balances, meId }: { balances: Balances | undefined; meId: string }) {
  const people = usePeople();
  const head = <div className="sechead"><h2>Balances</h2></div>;
  if (!balances) return <section className="sec">{head}<div className="card muted">Loading…</div></section>;
  const rows = balances.members
    .filter((m) => people.get(m.userId)?.active || m.paidPaise || m.sharePaise || m.settledPaise)
    .sort((a, b) => (people.get(a.userId)?.name ?? "").localeCompare(people.get(b.userId)?.name ?? ""));
  return (
    <section className="sec">
      {head}
      <div className="card">
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Person</th><th className="r">Paid</th><th className="r">Share</th><th className="r">Net</th></tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.userId}>
                  <td>
                    <Who id={m.userId} you={meId} />
                    {m.settledPaise !== 0 && (
                      <small className="settled">{m.settledPaise > 0 ? `paid back ${formatMoney(m.settledPaise)}` : `received ${formatMoney(-m.settledPaise)}`}</small>
                    )}
                  </td>
                  <td className="r amt">{formatMoney(m.paidPaise)}</td>
                  <td className="r amt">{formatMoney(m.sharePaise)}</td>
                  <td className="r">
                    {m.netPaise > 0 ? <span className="badge pos">gets {formatMoney(m.netPaise)}</span>
                      : m.netPaise < 0 ? <span className="badge neg">owes {formatMoney(-m.netPaise)}</span>
                      : <span className="badge zero">square</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">Paid is what they put down for expenses and Share is their part of the expenses they were in. Net also counts payments already made between people.</p>
      </div>
    </section>
  );
}
