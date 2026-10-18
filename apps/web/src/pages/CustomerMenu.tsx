import { useMemo, useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatMoney, type PublicMenuResponse, type TableResponse } from "../lib/api";
import { SOCKET_EVENTS, getSocket } from "../lib/socket";

interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  variantId?: string;
  variantName?: string;
  addonIds: string[];
  addonNames: string[];
  unitPriceMinor: number;
  quantity: number;
  specialInstructions?: string;
}

function newIdempotencyKey() {
  return (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`);
}

export function CustomerMenu() {
  const { tableCode = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [customizing, setCustomizing] = useState<PublicMenuResponse["categories"][0]["items"][0] | null>(null);
  const [customVariant, setCustomVariant] = useState<string | undefined>();
  const [customAddons, setCustomAddons] = useState<string[]>([]);
  const [customQty, setCustomQty] = useState(1);
  const [customNotes, setCustomNotes] = useState("");
  const [orderError, setOrderError] = useState<string | null>(null);

  const { data: menu } = useQuery<PublicMenuResponse>({
    queryKey: ["menu"],
    queryFn: () => api.get("/public/menu"),
  });

  const { data: tableInfo } = useQuery<TableResponse>({
    queryKey: ["table", tableCode],
    queryFn: () => api.get(`/public/tables/${tableCode}`),
  });

  const { data: sessionOrders, refetch: refetchOrders } = useQuery({
    queryKey: ["session-orders", tableInfo?.session?.id],
    enabled: !!tableInfo?.session?.id,
    queryFn: () => api.get(`/public/sessions/${tableInfo!.session!.id}/orders`),
  });

  useEffect(() => {
    const socket = getSocket();
    const onOrder = () => refetchOrders();
    socket.on(SOCKET_EVENTS.ORDER_STATUS, onOrder);
    socket.on(SOCKET_EVENTS.SESSION_CLOSED, onOrder);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_STATUS, onOrder);
      socket.off(SOCKET_EVENTS.SESSION_CLOSED, onOrder);
    };
  }, [refetchOrders]);

  const sessionId = tableInfo?.session?.id;
  const canOrder = tableInfo?.canOrder;

  const subtotal = useMemo(
    () => cart.reduce((a, l) => a + l.unitPriceMinor * l.quantity, 0),
    [cart]
  );

  const orderMutation = useMutation({
    mutationFn: (payload: unknown) => api.post("/public/orders", payload),
    onSuccess: () => {
      setCart([]);
      setOrderError(null);
      refetchOrders();
    },
    onError: (e: Error) => setOrderError(e.message),
  });

  function openCustomizer(item: PublicMenuResponse["categories"][0]["items"][0]) {
    setCustomizing(item);
    setCustomVariant(item.variants[0]?.id);
    setCustomAddons([]);
    setCustomQty(1);
    setCustomNotes("");
  }

  function addFromCustomizer() {
    if (!customizing) return;
    const variant = customizing.variants.find((v) => v.id === customVariant);
    const addons = customizing.addons.filter((a) => customAddons.includes(a.id));
    const unit = customizing.priceMinor + (variant?.priceDeltaMinor ?? 0) + addons.reduce((s, a) => s + a.priceMinor, 0);
    const key = [customizing.id, customVariant ?? "", [...customAddons].sort().join(","), customNotes].join("|");
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + customQty } : l));
      }
      return [
        ...prev,
        {
          key,
          menuItemId: customizing.id,
          name: customizing.name,
          variantId: customVariant,
          variantName: variant?.name,
          addonIds: addons.map((a) => a.id),
          addonNames: addons.map((a) => a.name),
          unitPriceMinor: unit,
          quantity: customQty,
          specialInstructions: customNotes.trim() || undefined,
        },
      ];
    });
    setCustomizing(null);
  }

  function changeQty(key: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    );
  }

  async function submitOrder() {
    if (!cart.length) return;
    setOrderError(null);
    const payload = {
      tableCode,
      idempotencyKey: newIdempotencyKey(),
      items: cart.map((l) => ({
        menuItemId: l.menuItemId,
        variantId: l.variantId,
        addonIds: l.addonIds,
        quantity: l.quantity,
        specialInstructions: l.specialInstructions,
      })),
    };
    orderMutation.mutate(payload);
  }

  const categories = menu?.categories ?? [];
  const shown = activeCat ? categories.filter((c) => c.id === activeCat) : categories;

  return (
    <div className="min-h-screen pb-40">
      <header className="sticky top-0 z-20 bg-slate-900 text-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm opacity-70">{menu?.settings.cafeName ?? "Smart Café"}</div>
            <div className="text-lg font-bold">Table {tableInfo?.table.number ?? "…"}</div>
          </div>
          <div className="flex gap-2">
            <Link to={`/t/${tableCode}/orders`} className="btn btn-ghost !text-white !border-white/30 text-sm">
              My Orders
            </Link>
          </div>
        </div>
        {!canOrder && (
          <div className="mt-2 rounded-lg bg-orange-600/20 border border-orange-400/40 px-3 py-2 text-sm">
            {tableInfo?.session
              ? "Ordering is closed for this table. Please see a waiter for the bill."
              : "No active session at this table. Please ask a waiter to open your table."}
          </div>
        )}
      </header>

      <nav className="sticky top-[72px] z-10 flex gap-2 overflow-x-auto bg-white border-b px-3 py-2">
        <button
          className={`badge whitespace-nowrap ${activeCat === null ? "!bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
          onClick={() => setActiveCat(null)}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            className={`badge whitespace-nowrap ${activeCat === c.id ? "!bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
            onClick={() => setActiveCat(c.id)}
          >
            {c.name}
          </button>
        ))}
      </nav>

      <main className="p-3 space-y-4">
        {shown.map((cat) => (
          <section key={cat.id}>
            <h2 className="px-1 mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">{cat.name}</h2>
            <div className="grid gap-3">
              {cat.items.map((item) => (
                <div key={item.id} className="card p-3 flex gap-3">
                  <div className="w-20 h-20 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-2xl">☕</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between gap-2">
                      <h3 className="font-semibold">{item.name}</h3>
                      <div className="font-bold whitespace-nowrap">{formatMoney(item.priceMinor)}</div>
                    </div>
                    {item.description && <p className="text-sm text-slate-500 mt-0.5">{item.description}</p>}
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {item.dietaryTags.map((t) => (
                        <span key={t} className="badge bg-green-100 text-green-700">{t}</span>
                      ))}
                      {item.allergens.length > 0 && (
                        <span className="badge bg-amber-100 text-amber-700">contains {item.allergens.join(", ")}</span>
                      )}
                    </div>
                    {canOrder && (
                      <button className="btn btn-primary mt-2 text-sm" onClick={() => openCustomizer(item)}>
                        {item.variants.length || item.addons.length ? "Customize" : "Add"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        {!categories.length && <div className="p-8 text-center text-slate-500">Loading menu…</div>}
      </main>

      {cart.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t p-3">
          <div className="flex justify-between text-sm text-slate-600 mb-2">
            <span>{cart.reduce((s, l) => s + l.quantity, 0)} items</span>
            <span>Subtotal {formatMoney(subtotal)}</span>
          </div>
          {orderError && <div className="mb-2 rounded bg-red-50 text-red-700 text-sm px-3 py-2">{orderError}</div>}
          <div className="flex gap-2">
            <div className="flex-1 space-y-1 max-h-32 overflow-y-auto">
              {cart.map((l) => (
                <div key={l.key} className="flex items-center justify-between text-sm">
                  <span className="truncate">
                    {l.quantity}× {l.name}
                    {l.variantName ? ` (${l.variantName})` : ""}
                  </span>
                  <div className="flex items-center gap-2">
                    <button className="btn btn-ghost !px-2 !py-0.5" onClick={() => changeQty(l.key, -1)}>−</button>
                    <span>{l.quantity}</span>
                    <button className="btn btn-ghost !px-2 !py-0.5" onClick={() => changeQty(l.key, 1)}>+</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <button
            className="btn btn-accent w-full mt-2"
            onClick={submitOrder}
            disabled={orderMutation.isPending || !canOrder}
          >
            {orderMutation.isPending ? "Placing order…" : `Place Order · ${formatMoney(subtotal)}`}
          </button>
        </div>
      )}

      {customizing && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-lg font-bold">{customizing.name}</h3>
              <button className="btn btn-ghost !px-2" onClick={() => setCustomizing(null)}>✕</button>
            </div>
            {customizing.variants.length > 0 && (
              <div className="mb-3">
                <div className="text-sm font-semibold mb-1">Size</div>
                <div className="flex gap-2 flex-wrap">
                  {customizing.variants.map((v) => (
                    <button
                      key={v.id}
                      className={`badge ${customVariant === v.id ? "!bg-slate-900 text-white" : "bg-slate-100"}`}
                      onClick={() => setCustomVariant(v.id)}
                    >
                      {v.name} {v.priceDeltaMinor ? `+${formatMoney(v.priceDeltaMinor)}` : ""}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {customizing.addons.length > 0 && (
              <div className="mb-3">
                <div className="text-sm font-semibold mb-1">Add-ons</div>
                <div className="flex gap-2 flex-wrap">
                  {customizing.addons.map((a) => (
                    <button
                      key={a.id}
                      className={`badge ${customAddons.includes(a.id) ? "!bg-slate-900 text-white" : "bg-slate-100"}`}
                      onClick={() =>
                        setCustomAddons((prev) =>
                          prev.includes(a.id) ? prev.filter((x) => x !== a.id) : [...prev, a.id]
                        )
                      }
                    >
                      {a.name} +{formatMoney(a.priceMinor)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mb-3">
              <div className="text-sm font-semibold mb-1">Special instructions</div>
              <input
                className="input"
                maxLength={200}
                value={customNotes}
                onChange={(e) => setCustomNotes(e.target.value)}
                placeholder="e.g. less sugar, no onions"
              />
            </div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold">Quantity</span>
              <div className="flex items-center gap-3">
                <button className="btn btn-ghost !px-3" onClick={() => setCustomQty((q) => Math.max(1, q - 1))}>−</button>
                <span className="font-bold">{customQty}</span>
                <button className="btn btn-ghost !px-3" onClick={() => setCustomQty((q) => q + 1)}>+</button>
              </div>
            </div>
            <button className="btn btn-accent w-full" onClick={addFromCustomizer}>
              Add to cart
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
