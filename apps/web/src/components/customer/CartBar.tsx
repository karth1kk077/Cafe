import { formatMoney } from "../../lib/api";
import { ArrowRightIcon, ShoppingBagIcon } from "../ui/Icon";

/**
 * Floating summary that keeps the order one tap away while browsing. Hidden
 * while the cart sheet is open so the two never fight for the bottom edge.
 */
export function CartBar({
  itemCount,
  subtotalMinor,
  onOpen,
}: {
  itemCount: number;
  subtotalMinor: number;
  onOpen: () => void;
}) {
  if (itemCount === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-safe">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Review order: ${itemCount} ${itemCount === 1 ? "item" : "items"}, subtotal ${formatMoney(subtotalMinor)}`}
        className="mx-auto flex w-full max-w-md items-center justify-between gap-3 rounded-sheet border border-white/10 bg-espresso px-4 py-3 text-left text-white shadow-lift transition-transform active:scale-[0.99]"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10">
            <ShoppingBagIcon size={18} />
            <span className="num absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-terracotta px-1 text-[0.66rem] font-bold text-white ring-2 ring-espresso">
              {itemCount}
            </span>
          </span>
          <span className="min-w-0">
            <span className="block text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-white/55">
              Your order
            </span>
            <span className="num block text-sm font-semibold">{formatMoney(subtotalMinor)}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 rounded-control bg-white/12 px-3 py-2 text-sm font-semibold">
          Review order
          <ArrowRightIcon size={15} />
        </span>
      </button>
    </div>
  );
}
