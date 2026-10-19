import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatMoney, type OrderItemStatus, type OrderStatus } from "../lib/api";
import { SOCKET_EVENTS, getSocket } from "../lib/socket";
import { useAuth } from "../lib/auth";

interface KitchenOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalMinor: number;
  createdAt: string;
  table: { number: string };
  items: Array<{
    id: string;
    nameSnapshot: string;
    quantity: number;
    unitPriceMinor: number;
    specialInstructions?: string | null;
    status: OrderItemStatus;
    addons: Array<{ nameSnapshot: string }>;
  }>;
}

type FilterKey = "queued" | "preparing" | "ready" | "all";

const FILTERS: Array<{ key: FilterKey; label: string; match: OrderItemStatus[] }> = [
  { key: "queued", label: "New", match: ["QUEUED"] },
  { key: "preparing", label: "Preparing", match: ["PREPARING"] },
  { key: "ready", label: "Ready", match: ["READY"] },
  { key: "all", label: "All active", match: ["QUEUED", "PREPARING", "READY"] },
];

const ITEM_STYLE: Record<OrderItemStatus, string> = {
  QUEUED: "bg-slate-100 text-slate-700",
  PREPARING: "bg-amber-100 text-amber-800",
  READY: "bg-green-100 text-green-800",
  SERVED: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-red-100 text-red-700",
};

function minutesSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export function KitchenPage() {
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const [filter, setFilter] = useState<FilterKey>("queued");
  const [soundOn, setSoundOn] = useState(true);
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;

  const { data, refetch } = useQuery<{ orders: KitchenOrder[] }>({
    queryKey: ["kitchen-orders"],
    queryFn: () => api.get("/staff/orders"),
    refetchInterval: 15000,
  });

  useEffect(() => {
    const socket = getSocket(localStorage.getItem("cafe_token") || undefined);
    socket.emit("subscribe:kitchen");
    const onCreated = () => {
      refetch();
      if (soundRef.current) playBeep();
    };
    const onChanged = () => refetch();
    socket.on(SOCKET_EVENTS.ORDER_CREATED, onCreated);
    socket.on(SOCKET_EVENTS.ITEM_STATUS, onChanged);
    socket.on(SOCKET_EVENTS.ORDER_UPDATED, onChanged);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_CREATED, onCreated);
      socket.off(SOCKET_EVENTS.ITEM_STATUS, onChanged);
      socket.off(SOCKET_EVENTS.ORDER_UPDATED, onChanged);
    };
  }, [refetch]);

  function playBeep() {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch {
      /* audio blocked */
    }
  }

  // Chef-driven transitions only: QUEUED -> PREPARING -> READY.
  const setItemStatus = useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: OrderItemStatus }) =>
      api.patch(`/staff/order-items/${itemId}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kitchen-orders"] }),
  });

  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const orders = (data?.orders ?? [])
    .map((o) => ({ ...o, items: o.items.filter((it) => activeFilter.match.includes(it.status)) }))
    .filter((o) => o.items.length > 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 bg-slate-900 text-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold">Kitchen</div>
            <div className="text-xs opacity-70">{user?.name}</div>
          </div>
          <div className="flex gap-2">
            <button
              className={`badge ${soundOn ? "!bg-green-600 text-white" : "bg-slate-700 text-slate-300"}`}
              onClick={() => setSoundOn((s) => !s)}
            >
              🔔 {soundOn ? "On" : "Off"}
            </button>
            <button className="btn btn-ghost !text-white !border-white/30 text-sm" onClick={() => { logout(); location.href = "/login"; }}>
              Exit
            </button>
          </div>
        </div>
      </header>

      <nav className="sticky top-[64px] z-10 flex gap-2 overflow-x-auto bg-white border-b px-3 py-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`badge whitespace-nowrap ${filter === f.key ? "!bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
        <button className="btn btn-ghost !py-0.5 text-xs" onClick={() => refetch()}>↻ Refresh</button>
      </nav>

      <main className="p-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {!orders.length && <div className="p-8 text-center text-slate-500 col-span-full">No dishes in this view.</div>}
        {orders.map((o) => {
          const mins = minutesSince(o.createdAt);
          return (
            <div key={o.id} className="card border-l-4 border-l-slate-400 p-3">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-xl font-bold">Table {o.table.number}</div>
                  <div className="text-xs text-slate-500">{o.orderNumber}</div>
                </div>
                <div className="text-right">
                  <span className={`badge ${mins > 10 ? "!bg-red-100 text-red-700" : "bg-slate-100"}`}>{mins}m</span>
                  <div className="text-xs text-slate-500 mt-1">{o.status}</div>
                </div>
              </div>
              <ul className="mt-2 space-y-2">
                {o.items.map((it) => (
                  <li key={it.id} className="border-t pt-2 first:border-t-0 first:pt-0">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <span className="font-semibold">{it.quantity}× {it.nameSnapshot}</span>
                        {it.addons.length > 0 && (
                          <span className="text-slate-500"> + {it.addons.map((a) => a.nameSnapshot).join(", ")}</span>
                        )}
                        {it.specialInstructions && (
                          <div className="text-amber-700 text-xs mt-0.5">✎ {it.specialInstructions}</div>
                        )}
                      </div>
                      <span className={`badge whitespace-nowrap ${ITEM_STYLE[it.status]}`}>{it.status}</span>
                    </div>
                    <div className="flex gap-2 mt-1.5">
                      {it.status === "QUEUED" && (
                        <button
                          className="btn btn-accent text-xs !py-1"
                          disabled={setItemStatus.isPending}
                          onClick={() => setItemStatus.mutate({ itemId: it.id, status: "PREPARING" })}
                        >
                          Start preparing
                        </button>
                      )}
                      {it.status === "PREPARING" && (
                        <button
                          className="btn btn-primary text-xs !py-1 !bg-green-600"
                          disabled={setItemStatus.isPending}
                          onClick={() => setItemStatus.mutate({ itemId: it.id, status: "READY" })}
                        >
                          Mark ready
                        </button>
                      )}
                      {it.status === "READY" && <span className="text-xs text-green-700 font-semibold">✓ Waiting for pickup</span>}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="text-xs text-slate-400 mt-2">Order total {formatMoney(o.totalMinor)}</div>
            </div>
          );
        })}
      </main>
    </div>
  );
}
