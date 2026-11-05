import { Link } from "react-router-dom";

export interface MenuStatus {
  tone: "info" | "warn" | "success";
  message: string;
}

const STATUS_STYLE: Record<MenuStatus["tone"], string> = {
  info: "bg-white/10 border-white/20 text-white/90",
  warn: "bg-amber-soft border-line-strong text-amber-ink",
  success: "bg-forest-soft border-forest/20 text-forest",
};

/**
 * Sticky customer header: identity, search, order-tracking shortcut and a
 * single plain-language banner that explains whether ordering is available.
 */
export function MenuHeader({
  cafeName,
  tableNumber,
  search,
  onSearchChange,
  status,
  ordersHref,
}: {
  cafeName: string;
  tableNumber: string;
  search: string;
  onSearchChange: (value: string) => void;
  status: MenuStatus | null;
  ordersHref: string;
}) {
  return (
    <header className="bg-espresso text-white px-4 pt-3 pb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium uppercase tracking-[0.14em] text-white/60">{cafeName}</div>
          <div className="display truncate text-2xl font-semibold leading-tight">Table {tableNumber}</div>
        </div>
        <Link to={ordersHref} className="btn btn-ghost shrink-0 !min-h-10 !border-white/25 !bg-white/10 !px-3 !text-white text-sm">
          Orders & bill
        </Link>
      </div>

      <div className="relative mt-3">
        <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/50">
          ⌕
        </span>
        <input
          type="search"
          className="input !border-white/25 !bg-white/10 !pl-9 !text-white"
          placeholder="Search the menu"
          aria-label="Search the menu"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>

      {status && (
        <div className={`mt-3 rounded-control border px-3 py-2 text-sm ${STATUS_STYLE[status.tone]}`} role="status">
          {status.message}
        </div>
      )}
    </header>
  );
}
