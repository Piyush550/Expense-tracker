import type { Balances } from "../../shared/api";
import { formatMoney } from "../../shared/money";
import type { Transfer } from "../../shared/settlement";
import { useName } from "./People";

/** "A pays C ₹x" lines, in the order the payments should happen. */
export function SettleUp({ balances, meId, scope, onRecord, onCopy }: {
  balances: Balances | undefined;
  meId: string;
  scope: string;
  onRecord(t: Transfer): void;
  onCopy(): void;
}) {
  const name = useName();
  const label = (id: string) => `${name(id)}${id === meId ? " (you)" : ""}`;
  const head = (
    <div className="sechead">
      <h2>Settle up · {scope}</h2>
      {balances?.transfers.length ? <button type="button" className="btn small" onClick={onCopy}>Copy summary</button> : null}
    </div>
  );
  if (!balances) return <section className="sec">{head}<div className="card muted">Working out the balances…</div></section>;
  const ts = balances.transfers;
  if (!ts.length) return <section className="sec">{head}<div className="allsq">Everyone is settled up.</div></section>;

  return (
    <section className="sec">
      {head}
      <div className="card" style={{ padding: 0 }}>
        <ol className="paysteps">
          {ts.map((t, i) => (
            <li key={`${t.from}-${t.to}`}>
              <span className="stepno">{i + 1}</span>
              <span className="steptext">
                <strong>{label(t.from)}</strong> pays <strong>{label(t.to)}</strong>
              </span>
              <span className="amt">{formatMoney(t.amountPaise)}</span>
              <button type="button" className="btn small" onClick={() => onRecord(t)}>Record</button>
            </li>
          ))}
        </ol>
      </div>
      <p className="note">
        {balances.simplified
          ? `${ts.length} ${ts.length === 1 ? "payment settles" : "payments settle"} everyone: the fewest possible.`
          : "Simplify debts is off, so each person pays back exactly who they owe."}{" "}
        Press Record once the money has moved.
      </p>
    </section>
  );
}
