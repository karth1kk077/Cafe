import { formatMoney } from "../../lib/api";
import type { StoredCartLine } from "../../lib/session";
import { BottomSheet } from "./BottomSheet";
import { AlertIcon, MinusIcon, PlusIcon, ShoppingBagIcon } from "../ui/Icon";

/**
 * Review + submit. Quantity edits stay local and instant; the server remains
 * the only source of truth for prices and totals when the order is created.
 */
export function CartSheet({
  open,
  lines,
  subtotalMinor,
  onClose,
  onQuantity,
  onPlaceOrder,
  placing,
  error,
  canOrder,
}: {
  open: boolean;
  lines: StoredCartLine[];
  subtotalMinor: number;
  onClose: () => void;
  onQuantity: (key: string, delta: number) => void;
  onPlaceOrder: () => void;
  placing: boolean;
  error: string | null;
  canOrder: boolean;
}) {
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Your order"
      footer={
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">{itemCount === 1 ? "1 item" : `${itemCount} items`}</span>
            <span className="flex items-baseline gap-2">
              <span className="text-muted">Subtotal</span>
              <span className="num text-lg font-bold">{formatMoney(subtotalMinor)}</span>
            </span>
          </div>
          <button
            type="button"
            className="btn btn-accent w-full"
            onClick={onPlaceOrder}
            disabled={placing || !lines.length || !canOrder}
          >
            {placing ? "Sending to the kitchen…" : `Place order · ${formatMoney(subtotalMinor)}`}
          </button>
          <p className="text-center text-xs text-muted">
            Taxes and service are added to your bill at the table.
          </p>
        </div>
      }
    >
      {error && (
        <div
          className="mb-3 flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
          role="alert"
        >
          <AlertIcon size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {lines.length === 0 ? (
        <div className="py-10 text-center text-muted">
          <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-cream-deep text-copper/70">
            <ShoppingBagIcon size={26} />
          </span>
          <p className="display text-lg font-semibold text-espresso">Your order is empty</p>
          <p className="mt-1 text-sm">Close this and tap Add on something you like.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {lines.map((line) => (
            <li key={line.key} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold leading-snug">{line.name}</span>
                  <span className="num shrink-0 font-semibold">{formatMoney(line.unitPriceMinor * line.quantity)}</span>
                </div>
                {(line.variantName || line.addonNames.length > 0) && (
                  <p className="mt-0.5 text-xs text-muted">
                    {[line.variantName, ...line.addonNames].filter(Boolean).join(" · ")}
                  </p>
                )}
                {line.specialInstructions && <p className="mt-0.5 text-xs italic text-muted">“{line.specialInstructions}”</p>}
                <div className="mt-2 inline-flex items-center gap-1 rounded-control border border-line bg-cream/60 p-0.5">
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon !min-h-9 !border-0 !bg-transparent !px-2"
                    aria-label={`Remove one ${line.name}`}
                    onClick={() => onQuantity(line.key, -1)}
                  >
                    <MinusIcon size={15} />
                  </button>
                  <span className="num min-w-6 text-center text-sm font-bold">{line.quantity}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon !min-h-9 !border-0 !bg-transparent !px-2"
                    aria-label={`Add one ${line.name}`}
                    onClick={() => onQuantity(line.key, 1)}
                  >
                    <PlusIcon size={15} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  );
}
