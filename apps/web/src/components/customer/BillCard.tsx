import { formatMoney, type CustomerBillResponse } from "../../lib/api";

/**
 * Itemised customer bill. Until the waiter generates the final snapshot this
 * renders a clearly-labelled preview of the same server-side calculation.
 */
export function BillCard({
  data,
  tableNumber,
}: {
  data: CustomerBillResponse;
  tableNumber: string;
}) {
  const { bill } = data;
  const upiLink = data.settings.upiId
    ? `upi://pay?pa=${encodeURIComponent(data.settings.upiId)}&pn=${encodeURIComponent(
        data.settings.cafeName
      )}&am=${(data.dueMinor / 100).toFixed(2)}&cu=${bill.currency}&tn=${encodeURIComponent(
        `Table ${tableNumber} ${bill.billNumber ?? "Bill"}`
      )}`
    : null;

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="display text-lg font-semibold">{data.isPreview ? "Running total" : `Bill ${bill.billNumber ?? ""}`}</h2>
        <span className={`badge ${bill.status === "PAID" ? "bg-forest-soft text-forest" : "bg-amber-soft text-amber-ink"}`}>
          {bill.status.replace("_", " ")}
        </span>
      </div>

      <ul className="mt-3 divide-y divide-line text-sm">
        {bill.lineItems.map((line) => (
          <li key={line.id} className="flex justify-between gap-3 py-1.5">
            <span className="min-w-0">
              <span className="num">{line.quantity}×</span> {line.nameSnapshot}
            </span>
            <span className="num shrink-0">{formatMoney(line.lineTotalMinor, bill.currency)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="num">{formatMoney(bill.subtotalMinor, bill.currency)}</span>
        </div>
        <div className="flex justify-between">
          <span>Tax</span>
          <span className="num">{formatMoney(bill.taxMinor, bill.currency)}</span>
        </div>
        <div className="flex justify-between">
          <span>Service charge</span>
          <span className="num">{formatMoney(bill.serviceChargeMinor, bill.currency)}</span>
        </div>
        {bill.roundingMinor !== 0 && (
          <div className="flex justify-between">
            <span>Rounding</span>
            <span className="num">{formatMoney(bill.roundingMinor, bill.currency)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-line pt-2 font-semibold">
          <span>Total</span>
          <span className="num">{formatMoney(bill.totalMinor, bill.currency)}</span>
        </div>
        {data.paidMinor > 0 && (
          <div className="flex justify-between text-forest">
            <span>Paid</span>
            <span className="num">{formatMoney(data.paidMinor, bill.currency)}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-bold">
          <span>Amount due</span>
          <span className="num">{formatMoney(data.dueMinor, bill.currency)}</span>
        </div>
      </div>

      {upiLink && data.dueMinor > 0 && (
        <a className="btn btn-accent mt-3 w-full" href={upiLink}>
          Pay with UPI
        </a>
      )}

      {data.isPreview && (
        <p className="mt-3 text-xs text-muted">
          This is a running total. It becomes the final bill when a team member closes your table.
        </p>
      )}
    </section>
  );
}
