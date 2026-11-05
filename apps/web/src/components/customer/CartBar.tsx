import { formatMoney } from "../../lib/api";

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
        className="mx-auto flex w-full max-w-md items-center justify-between gap-3 rounded-sheet bg-espresso px-4 py-3 text-left text-white shadow-lift transition-transform active:scale-[0.99]"
      >
        <span className="flex items-center gap-2">
          <span className="num inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-terracotta px-2 text-sm font-bold">
            {itemCount}
          </span>
          <span className="text-sm font-semibold">{itemCount === 1 ? "1 item" : `${itemCount} items`}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="num font-bold">{formatMoney(subtotalMinor)}</span>
          <span className="rounded-control bg-white/15 px-3 py-1.5 text-sm font-semibold">Review order</span>
        </span>
      </button>
    </div>
  );
}
