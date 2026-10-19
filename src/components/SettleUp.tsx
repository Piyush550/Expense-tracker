import type { Balances } from "../../shared/api";
import { formatMoney } from "../../shared/money";
import type { Transfer } from "../../shared/settlement";
import { Chip, useName, Who } from "./People";

export function SettleUp({ balances, meId, onRecord, onCopy }: {
  balances: Balances | undefined;
  meId: string;
  onRecord(t: Transfer): void;
  onCopy(): void;
}) {
  const name = useName();
  const head = (
    <div className="sechead">
      <h2>Settle up</h2>
      {balances?.transfers.length ? <button type="button" className="btn small" onClick={onCopy}>Copy summary</button> : null}
    </div>
  );
  if (!balances) return <section className="sec">{head}<div className="card muted">Loading balances…</div></section>;
  const ts = balances.transfers;
  if (!ts.length) return <section className="sec">{head}<div className="allsq">Everyone is settled up.</div></section>;

  const byFrom = new Map<string, Transfer[]>();
  ts.forEach((t) => byFrom.set(t.from, [...(byFrom.get(t.from) ?? []), t]));
  return (
    <section className="sec">
      {head}
      {[...byFrom].map(([from, list]) => (
        <article key={from} className="card debtor">
          <header>
            <Who id={from} you={meId} />
            <span><span className="muted">owes </span><span className="amt neg">{formatMoney(list.reduce((a, t) => a + t.amountPaise, 0))}</span></span>
          </header>
          <ul className="pays">
            {list.map((t) => (
              <li key={t.to}>
                <span className="who">pays <Chip id={t.to} /><strong>{name(t.to)}{t.to === meId ? " (you)" : ""}</strong></span>
                <span className="amt">{formatMoney(t.amountPaise)}</span>
                <button type="button" className="btn small" onClick={() => onRecord(t)}>Record payment</button>
              </li>
            ))}
          </ul>
        </article>
      ))}
      <p className="note">
        {balances.simplified
          ? `The fewest payments that square the whole group: ${ts.length}. Balances cover every month, not just this one.`
          : "Simplify debts is off, so each person pays back exactly who they owe. Balances cover every month."}
      </p>
    </section>
  );
}
