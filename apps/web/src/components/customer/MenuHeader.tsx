import { Link } from "react-router-dom";
import { BrandCupIcon, ReceiptIcon, SearchIcon } from "../ui/Icon";

export interface MenuStatus {
  tone: "info" | "warn" | "success";
  message: string;
}

const STATUS_STYLE: Record<MenuStatus["tone"], string> = {
  info: "border-white/20 bg-white/10 text-white/90",
  warn: "border-line-strong bg-amber-soft text-amber-ink",
  success: "border-forest/20 bg-forest-soft text-forest",
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
    <header className="topbar px-4 pb-3 pt-safe">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="brand-mark brand-mark-sm">
            <BrandCupIcon size={18} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-white/55">
              {cafeName}
            </div>
            <div className="display truncate text-[1.4rem] font-semibold leading-tight">Table {tableNumber}</div>
          </div>
        </div>
        <Link
          to={ordersHref}
          className="btn btn-ghost !min-h-10 shrink-0 !border-white/20 !bg-white/10 !px-3 !text-white"
        >
          <ReceiptIcon size={16} />
          <span className="hidden text-sm min-[380px]:inline">Orders &amp; bill</span>
        </Link>
      </div>

      <div className="relative mt-3">
        <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/55">
          <SearchIcon size={18} />
        </span>
        <input
          type="search"
          className="input input-ink !pl-10"
          placeholder="Search the menu"
          aria-label="Search the menu"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>

      {status && (
        <div
          className={`mt-3 flex items-start gap-2 rounded-control border px-3 py-2 text-sm ${STATUS_STYLE[status.tone]}`}
          role="status"
        >
          <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />
          <span>{status.message}</span>
        </div>
      )}
    </header>
  );
}
