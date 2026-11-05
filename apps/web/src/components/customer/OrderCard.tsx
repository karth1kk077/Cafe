import { formatMoney, type SessionOrdersResponse } from "../../lib/api";
import { OrderProgress } from "./OrderProgress";

type TrackedOrder = SessionOrdersResponse["orders"][number];

const ITEM_LABEL: Record<TrackedOrder["items"][number]["status"], string> = {
  QUEUED: "Ordered",
  PREPARING: "Being prepared",
  READY: "Ready",
  SERVED: "Served",
  CANCELLED: "Cancelled",
};

const ITEM_STYLE: Record<TrackedOrder["items"][number]["status"], string> = {
  QUEUED: "bg-cream text-espresso",
  PREPARING: "bg-amber-soft text-amber-ink",
  READY: "bg-forest-soft text-forest",
  SERVED: "bg-forest-soft text-forest",
  CANCELLED: "bg-danger-soft text-danger",
};

export function OrderCard({
  order,
  canCancel,
  cancelling,
  onCancel,
}: {
  order: TrackedOrder;
  canCancel: boolean;
  cancelling: boolean;
  onCancel: (itemId: string) => void;
}) {
  return (
    <article className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{order.orderNumber}</div>
          <div className="text-xs text-muted">
            Placed{" "}
            {new Date(order.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </div>
        </div>
        <span className="num shrink-0 font-bold">{formatMoney(order.totalMinor)}</span>
      </div>

      <div className="my-3">
        <OrderProgress order={order} />
      </div>

      <ul className="space-y-2 border-t border-line pt-3">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
            <span className={item.status === "CANCELLED" ? "text-muted line-through" : ""}>
              <span className="num">{item.quantity}×</span> {item.nameSnapshot}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`badge ${ITEM_STYLE[item.status]}`}>{ITEM_LABEL[item.status]}</span>
              {item.status === "QUEUED" && canCancel && (
                <button
                  type="button"
                  className="btn btn-ghost !min-h-9 !px-2 text-xs"
                  disabled={cancelling}
                  aria-label={`Cancel ${item.nameSnapshot}`}
                  onClick={() => onCancel(item.id)}
                >
                  Cancel
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}
