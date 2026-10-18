import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatMoney } from "../lib/api";
import { SOCKET_EVENTS, getSocket } from "../lib/socket";
import { useAuth } from "../lib/auth";

interface KitchenOrder {
  id: string;
  orderNumber: string;
  status: string;
  totalMinor: number;
  createdAt: string;
  table: { number: string };
  items: Array<{
    id: string;
    nameSnapshot: string;
    quantity: number;
    unitPriceMinor: number;
    specialInstructions?: string;
    addons: Array<{ nameSnapshot: string }>;
  }>;
}

const FILTERS = [
  { key: "PENDING,ACCEPTED", label: "New" },
  { key: "PREPARING", label: "Preparing" },
  { key: "READY", label: "Ready" },
  { key: "SERVED,CANCELLED", label: "Done" },
] as const;

const STATUS_COLOR: Record<string, string> = {
  PENDING: "border-l-slate-400",
  ACCEPTED: "border-l-blue-500",
  PREPARING: "border-l-amber-500",
  READY: "border-l-green-500",
  SERVED: "border-l-emerald-300",
  CANCELLED: "border-l-red-400",
};

function minutesSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export function KitchenPage() {
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const [filter, setFilter] = useState<string>(FILTERS[0].key);
  const [soundOn, setSoundOn] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data, refetch } = useQuery<{ orders: KitchenOrder[] }>({
    queryKey: ["kitchen-orders"],
    queryFn: () => api.get(`/staff/orders?status=${filter}`),
  });

  useEffect(() => {
    const socket = getSocket(localStorage.getItem("cafe_token") || undefined);
    socket.emit("subscribe:kitchen");
    const onCreated = () => {
      refetch();
      if (soundOn) playBeep();
    };
    const onStatus = () => refetch();
    socket.on(SOCKET_EVENTS.ORDER_CREATED, onCreated);
    socket.on(SOCKET_EVENTS.ORDER_STATUS, onStatus);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_CREATED, onCreated);
      socket.off(SOCKET_EVENTS.ORDER_STATUS, onStatus);
    };
  }, [refetch, soundOn]);

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

  const transition = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/staff/orders/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kitchen-orders"] }),
  });

  const orders = data?.orders ?? [];

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
            onClick={() => { setFilter(f.key); refetch(); }}
          >
            {f.label}
          </button>
        ))}
        <button className="btn btn-ghost !py-0.5 text-xs" onClick={() => refetch()}>↻ Refresh</button>
      </nav>

      <main className="p-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {!orders.length && <div className="p-8 text-center text-slate-500 col-span-full">No orders in this view.</div>}
        {orders.map((o) => {
          const mins = minutesSince(o.createdAt);
          return (
            <div key={o.id} className={`card border-l-4 ${STATUS_COLOR[o.status] ?? ""} p-3`}>
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
              <ul className="mt-2 space-y-1">
                {o.items.map((it) => (
                  <li key={it.id} className="text-sm">
                    <span className="font-semibold">{it.quantity}× {it.nameSnapshot}</span>
                    {it.addons.length > 0 && (
                      <span className="text-slate-500"> + {it.addons.map((a) => a.nameSnapshot).join(", ")}</span>
                    )}
                    {it.specialInstructions && (
                      <div className="text-amber-700 text-xs mt-0.5">✎ {it.specialInstructions}</div>
                    )}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 mt-3">
                {o.status === "PENDING" && (
                  <button className="btn btn-primary flex-1 text-sm" onClick={() => transition.mutate({ id: o.id, status: "ACCEPTED" })}>
                    Accept
                  </button>
                )}
                {o.status === "ACCEPTED" && (
                  <button className="btn btn-accent flex-1 text-sm" onClick={() => transition.mutate({ id: o.id, status: "PREPARING" })}>
                    Start preparing
                  </button>
                )}
                {o.status === "PREPARING" && (
                  <button className="btn btn-primary flex-1 text-sm !bg-green-600" onClick={() => transition.mutate({ id: o.id, status: "READY" })}>
                    Mark ready
                  </button>
                )}
                {o.status !== "SERVED" && o.status !== "CANCELLED" && (
                  <button className="btn btn-ghost text-sm" onClick={() => transition.mutate({ id: o.id, status: "CANCELLED" })}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}
