import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  formatMoney,
  type PublicMenuResponse,
  type PublicMenuItem,
  type TableResponse,
} from "../lib/api";
import { SOCKET_EVENTS, getSocket } from "../lib/socket";
import { saveSession, loadSession, loadCart, saveCart, type StoredCartLine } from "../lib/session";
import { haptic, HAPTIC_SUCCESS } from "../lib/haptics";
import { MenuHeader, type MenuStatus } from "../components/customer/MenuHeader";
import { CategoryTabs } from "../components/customer/CategoryTabs";
import { MenuItemCard } from "../components/customer/MenuItemCard";
import { ItemSheet } from "../components/customer/ItemSheet";
import { CartBar } from "../components/customer/CartBar";
import { CartSheet } from "../components/customer/CartSheet";
import { Toast, type ToastMessage, type ToastTone } from "../components/customer/Toast";
import { AlertIcon, CoffeeIcon, MenuBookIcon, RefreshIcon } from "../components/ui/Icon";

function newIdempotencyKey() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function MenuSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4" aria-busy="true" aria-live="polite">
      <div className="h-8 w-32 animate-pulse rounded bg-line" />
      <div className="h-11 animate-pulse rounded-control bg-line" />
      {[0, 1, 2].map((row) => (
        <div key={row} className="card flex gap-3 p-3">
          <div className="grid h-[5.5rem] w-[5.5rem] shrink-0 animate-pulse place-items-center rounded-control bg-cream-deep">
            <CoffeeIcon size={26} className="text-line-strong" />
          </div>
          <div className="flex-1 space-y-2 py-1">
            <div className="h-4 w-2/3 animate-pulse rounded bg-line" />
            <div className="h-3 w-full animate-pulse rounded bg-line" />
            <div className="h-8 w-20 animate-pulse rounded-control bg-line" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading menu…</span>
    </div>
  );
}

function TableProblem({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream p-4">
      <div className="card w-full max-w-sm p-6 text-center">
        <div aria-hidden className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-amber-soft text-amber-ink">
          <AlertIcon size={26} />
        </div>
        <h1 className="display text-xl font-semibold">We couldn’t open this table</h1>
        <p className="mt-2 text-sm text-muted">{message}</p>
        <div className="mt-5 space-y-2">
          <button type="button" className="btn btn-primary w-full" onClick={retry}>
            <RefreshIcon size={16} />
            Try again
          </button>
          <Link to="/" className="btn btn-ghost w-full">
            Go to start
          </Link>
        </div>
        <p className="mt-4 text-xs text-muted">If this keeps happening, please ask a team member for help.</p>
      </div>
    </div>
  );
}

export function CustomerMenu() {
  const { tableCode = "" } = useParams();
  const queryClient = useQueryClient();
  const [cart, setCart] = useState<StoredCartLine[]>(() => loadCart(tableCode));
  const [menuSearch, setMenuSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [customizing, setCustomizing] = useState<PublicMenuItem | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  // Kept across retries so a double tap or flaky network still creates one order.
  const pendingKeyRef = useRef<string | null>(null);

  function showToast(text: string, tone: ToastTone = "success") {
    setToast({ id: Date.now(), text, tone });
  }

  const {
    data: menu,
    error: menuError,
    refetch: refetchMenu,
  } = useQuery<PublicMenuResponse>({
    queryKey: ["menu"],
    queryFn: () => api.get("/public/menu"),
  });

  const {
    data: tableInfo,
    error: tableError,
    isLoading: tableLoading,
    refetch: refetchTable,
  } = useQuery<TableResponse>({
    queryKey: ["table", tableCode],
    queryFn: () => api.get(`/public/tables/${tableCode}`),
    // Legacy PENDING sessions still flip to ACTIVE after a waiter confirms.
    refetchInterval: (query) => (query.state.data?.session?.status === "PENDING" ? 5000 : false),
  });

  useEffect(() => {
    saveCart(tableCode, cart);
  }, [cart, tableCode]);

  // A different cart means a different order body, so the previous idempotency
  // key must not be reused (the server would replay the old order).
  useEffect(() => {
    pendingKeyRef.current = null;
  }, [cart]);

  // Keep the session token for the tracking screen. Never erase a stored token
  // just because the table has no active session — that token still authorises
  // read-only access to a recently closed bill.
  useEffect(() => {
    if (!tableInfo?.sessionToken || !tableInfo.session) return;
    saveSession(tableCode, { token: tableInfo.sessionToken, sessionId: tableInfo.session.id });
  }, [tableInfo?.sessionToken, tableInfo?.session?.id, tableCode]);

  useEffect(() => {
    const token = tableInfo?.sessionToken ?? loadSession(tableCode)?.token ?? undefined;
    const socket = getSocket(token);
    const refreshTable = () => queryClient.invalidateQueries({ queryKey: ["table", tableCode] });
    const refreshMenu = () => queryClient.invalidateQueries({ queryKey: ["menu"] });
    socket.on(SOCKET_EVENTS.ORDER_UPDATED, refreshTable);
    socket.on(SOCKET_EVENTS.ITEM_STATUS, refreshTable);
    socket.on(SOCKET_EVENTS.SESSION_CLOSED, refreshTable);
    socket.on(SOCKET_EVENTS.SESSION_REOPENED, refreshTable);
    socket.on(SOCKET_EVENTS.MENU_UPDATED, refreshMenu);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_UPDATED, refreshTable);
      socket.off(SOCKET_EVENTS.ITEM_STATUS, refreshTable);
      socket.off(SOCKET_EVENTS.SESSION_CLOSED, refreshTable);
      socket.off(SOCKET_EVENTS.SESSION_REOPENED, refreshTable);
      socket.off(SOCKET_EVENTS.MENU_UPDATED, refreshMenu);
    };
  }, [tableInfo?.sessionToken, tableCode, queryClient]);

  const categories = useMemo(() => menu?.categories ?? [], [menu]);
  const canOrder = tableInfo?.canOrder ?? false;
  const orderable = tableInfo?.orderable ?? false;
  const canBrowseOrder = canOrder || orderable;
  const sessionStatus = tableInfo?.session?.status;

  // Scroll-spy: the chip for the section whose heading passed under the sticky
  // header wins. Runs on scroll and whenever filtering changes the layout.
  const updateActiveCategory = useCallback(() => {
    if (!categories.length) return;
    const threshold = 210;
    let current: string | null = null;
    for (const category of categories) {
      const section = sectionRefs.current[category.id];
      if (section && section.getBoundingClientRect().top <= threshold) current = category.id;
    }
    const next = current ?? categories[0]?.id ?? null;
    setActiveCategory((previous) => (previous === next ? previous : next));
  }, [categories]);

  useEffect(() => {
    updateActiveCategory();
    window.addEventListener("scroll", updateActiveCategory, { passive: true });
    window.addEventListener("resize", updateActiveCategory);
    return () => {
      window.removeEventListener("scroll", updateActiveCategory);
      window.removeEventListener("resize", updateActiveCategory);
    };
  }, [updateActiveCategory]);

  const filtered = useMemo(() => {
    const query = menuSearch.trim().toLowerCase();
    if (!query) return categories;
    return categories
      .map((category) => ({
        ...category,
        items: category.items.filter(
          (item) =>
            item.name.toLowerCase().includes(query) || item.description?.toLowerCase().includes(query)
        ),
      }))
      .filter((category) => category.items.length > 0);
  }, [categories, menuSearch]);

  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = cart.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);

  function addLine(line: StoredCartLine) {
    setCart((previous) => {
      const existing = previous.find((entry) => entry.key === line.key);
      if (existing) {
        return previous.map((entry) =>
          entry.key === line.key ? { ...entry, quantity: entry.quantity + line.quantity } : entry
        );
      }
      return [...previous, line];
    });
    haptic();
    showToast(`${line.name} added`, "success");
  }

  function addSimpleItem(item: PublicMenuItem) {
    addLine({
      key: item.id,
      menuItemId: item.id,
      name: item.name,
      addonIds: [],
      addonNames: [],
      unitPriceMinor: item.priceMinor,
      quantity: 1,
    });
  }

  function changeQuantity(key: string, delta: number) {
    setCart((previous) =>
      previous
        .map((line) => (line.key === key ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0)
    );
    haptic(8);
  }

  function selectCategory(id: string) {
    setActiveCategory(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /**
   * Open or join the table's session at the moment of the first order. A second
   * phone at the same table receives the same session and token.
   */
  async function ensureSessionToken(): Promise<string> {
    if (tableInfo?.sessionToken) return tableInfo.sessionToken;
    const fresh = await api.post<TableResponse>(`/public/tables/${tableCode}/session`, {});
    queryClient.setQueryData(["table", tableCode], fresh);
    if (fresh.sessionToken && fresh.session) {
      saveSession(tableCode, { token: fresh.sessionToken, sessionId: fresh.session.id });
    }
    if (!fresh.sessionToken) {
      throw new Error(
        fresh.session?.status === "BILL_REQUESTED" || fresh.session?.status === "PAYMENT_PENDING"
          ? "The bill has been requested for this table. Please ask a team member if you would like to order more."
          : "Ordering is currently unavailable for this table. Please ask a team member for help."
      );
    }
    return fresh.sessionToken;
  }

  const orderMutation = useMutation({
    mutationFn: async (payload: unknown) => {
      const token = await ensureSessionToken();
      try {
        return await api.post("/public/orders", payload, token);
      } catch (error) {
        // A resumed tab can hold a token for an old session. Re-resolve the QR
        // once and retry with the same payload (and idempotency key).
        if ((error as Error & { status?: number }).status === 401) {
          const fresh = await api.get<TableResponse>(`/public/tables/${tableCode}`);
          queryClient.setQueryData(["table", tableCode], fresh);
          if (fresh.sessionToken) return api.post("/public/orders", payload, fresh.sessionToken);
        }
        throw error;
      }
    },
    onSuccess: () => {
      pendingKeyRef.current = null;
      setCart([]);
      saveCart(tableCode, []);
      setOrderError(null);
      setCartOpen(false);
      haptic(HAPTIC_SUCCESS);
      showToast("Order placed — the kitchen has it.", "success");
      queryClient.invalidateQueries({ queryKey: ["table", tableCode] });
      queryClient.invalidateQueries({ queryKey: ["session-orders"] });
    },
    onError: (error: Error) => {
      setOrderError(error.message);
      if ((error as Error & { status?: number }).status === 401 || (error as Error & { status?: number }).status === 409) {
        queryClient.invalidateQueries({ queryKey: ["table", tableCode] });
      }
    },
  });

  function placeOrder() {
    if (!cart.length || orderMutation.isPending) return;
    setOrderError(null);
    const idempotencyKey = pendingKeyRef.current ?? newIdempotencyKey();
    pendingKeyRef.current = idempotencyKey;
    orderMutation.mutate({
      idempotencyKey,
      items: cart.map((line) => ({
        menuItemId: line.menuItemId,
        variantId: line.variantId,
        addonIds: line.addonIds,
        quantity: line.quantity,
        specialInstructions: line.specialInstructions,
      })),
    });
  }

  const tableStatus = ((): MenuStatus | null => {
    if (!tableInfo) return null;
    if (sessionStatus === "PENDING") {
      return {
        tone: "warn",
        message: "Your table is waiting for a team member to confirm. Browse and build your order in the meantime.",
      } satisfies MenuStatus;
    }
    if (sessionStatus === "BILL_REQUESTED" || sessionStatus === "PAYMENT_PENDING") {
      return {
        tone: "warn",
        message: "Ordering is paused while your bill is settled. Ask a team member if you would like to add something.",
      } satisfies MenuStatus;
    }
    if (!orderable) {
      return {
        tone: "warn",
        message: "This table isn’t taking orders right now. Please ask a team member for help.",
      } satisfies MenuStatus;
    }
    if (!canOrder) {
      return {
        tone: "info",
        message: "Browse freely — your table opens automatically when you place your first order.",
      } satisfies MenuStatus;
    }
    return null;
  })();

  if (tableLoading) return <MenuSkeleton />;

  if (tableError) {
    const status = (tableError as Error & { status?: number }).status;
    return (
      <TableProblem
        message={
          status === 404
            ? "This QR code doesn’t match a table. Please scan the code on your table again."
            : tableError.message
        }
        retry={() => refetchTable()}
      />
    );
  }

  return (
    <div className="min-h-screen bg-cream pb-32">
      <div className="sticky top-0 z-20">
        <MenuHeader
          cafeName={menu?.settings.cafeName ?? "Smart Café"}
          tableNumber={tableInfo?.table.number ?? "…"}
          search={menuSearch}
          onSearchChange={setMenuSearch}
          status={tableStatus}
          ordersHref={`/t/${tableCode}/orders`}
        />
        <CategoryTabs categories={filtered} activeId={activeCategory} onSelect={selectCategory} />
      </div>

      <main className="mx-auto max-w-2xl space-y-6 p-3 pt-4">
        {menuError && (
          <div className="card p-4 text-sm" role="alert">
            <div className="flex items-start gap-2">
              <AlertIcon size={17} className="mt-0.5 shrink-0 text-danger" />
              <div>
                <p className="font-semibold">The menu didn’t load.</p>
                <p className="mt-1 text-muted">{menuError.message}</p>
              </div>
            </div>
            <button type="button" className="btn btn-ghost mt-3" onClick={() => refetchMenu()}>
              <RefreshIcon size={15} />
              Try again
            </button>
          </div>
        )}

        {!menu && !menuError && <MenuSkeleton />}

        {filtered.map((category) => (
          <section
            key={category.id}
            id={`menu-${category.id}`}
            ref={(element) => {
              sectionRefs.current[category.id] = element;
            }}
            className="scroll-mt-52"
            aria-labelledby={`menu-heading-${category.id}`}
          >
            <h2
              id={`menu-heading-${category.id}`}
              className="section-label mb-2 px-1"
            >
              {category.name}
            </h2>
            <div className="grid gap-3">
              {category.items.map((item) => (
                <MenuItemCard key={item.id} item={item} onAdd={addSimpleItem} onCustomize={setCustomizing} />
              ))}
            </div>
          </section>
        ))}

        {menu && !filtered.length && (
          <div className="card p-8 text-center">
            <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-cream-deep text-copper/70">
              <MenuBookIcon size={26} />
            </span>
            <p className="display text-lg font-semibold">
              {menuSearch.trim() ? "Nothing matched that search" : "The menu is being updated"}
            </p>
            <p className="mt-1 text-sm text-muted">
              {menuSearch.trim() ? "Try a shorter word, or clear the search to see everything." : "Please ask a team member for help."}
            </p>
            {menuSearch.trim() && (
              <button type="button" className="btn btn-ghost mt-4" onClick={() => setMenuSearch("")}>
                Clear search
              </button>
            )}
          </div>
        )}
      </main>

      {!cartOpen && <CartBar itemCount={itemCount} subtotalMinor={subtotal} onOpen={() => setCartOpen(true)} />}

      <CartSheet
        open={cartOpen}
        lines={cart}
        subtotalMinor={subtotal}
        onClose={() => setCartOpen(false)}
        onQuantity={changeQuantity}
        onPlaceOrder={placeOrder}
        placing={orderMutation.isPending}
        error={orderError}
        canOrder={canBrowseOrder}
      />

      <ItemSheet
        key={customizing?.id ?? "closed"}
        item={customizing}
        open={!!customizing}
        onClose={() => setCustomizing(null)}
        onAdd={addLine}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} className="bottom-24" />

      {itemCount > 0 && (
        <span className="sr-only" aria-live="polite">
          {itemCount} {itemCount === 1 ? "item" : "items"} in your order, subtotal {formatMoney(subtotal)}.
        </span>
      )}
    </div>
  );
}
