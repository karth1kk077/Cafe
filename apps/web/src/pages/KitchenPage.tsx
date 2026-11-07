import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatMoney, type OrderItemStatus, type OrderStatus } from "../lib/api";
import { SOCKET_EVENTS, getSocket } from "../lib/socket";
import { useAuth } from "../lib/auth";
import {
  BellIcon,
  BellOffIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  LogOutIcon,
  RefreshIcon,
  UtensilsIcon,
} from "../components/ui/Icon";

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
  QUEUED: "bg-cream text-espresso",
  PREPARING: "bg-amber-soft text-amber-ink",
  READY: "bg-forest-soft text-forest",
  SERVED: "bg-cream text-muted",
  CANCELLED: "bg-danger-soft text-danger",
};

function minutesSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export function KitchenPage() {
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const [filter, setFilter] = useState<FilterKey>("queued");
  const [soundOn, setSoundOn] = useState(true);
  const [soundReady, setSoundReady] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);

  // Browsers keep WebAudio suspended until a user gesture. Surface a clear
  // "Enable sound" tap so a reload does not silently mute new-order alerts.
  async function enableSound() {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = audioRef.current || new AudioCtx();
      audioRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      setSoundReady(ctx.state === "running");
      setSoundOn(true);
    } catch {
      /* audio unavailable */
    }
  }

  // Keep the kitchen phone awake while the screen is in use.
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    let cancelled = false;
    async function acquire() {
      try {
        if (!("wakeLock" in navigator) || cancelled) return;
        wakeLock = await navigator.wakeLock.request("screen");
      } catch {
        /* unsupported or denied */
      }
    }
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void wakeLock?.release().catch(() => {});
    };
  }, []);

  const { data, refetch } = useQuery<{ orders: KitchenOrder[] }>({
    queryKey: ["kitchen-orders"],
    queryFn: () => api.get("/staff/orders"),
    refetchInterval: 60000,
  });

  const playBeep = useCallback(() => {
    try {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = audioRef.current || new AudioCtx();
      audioRef.current = ctx;
      if (ctx.state === "suspended") {
        void ctx.resume();
        return;
      }
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
  }, []);

  useEffect(() => {
    const socket = getSocket(localStorage.getItem("cafe_token") || undefined);
    socket.emit("subscribe:kitchen");
    const onCreated = () => {
      refetch();
      if (soundOn) playBeep();
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
  }, [playBeep, refetch, soundOn]);

  // Chef-driven transitions only: QUEUED -> PREPARING -> READY.
  const setItemStatus = useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: OrderItemStatus }) =>
      api.patch(`/staff/order-items/${itemId}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kitchen-orders"] }),
  });

  const bulkReady = useMutation({
    mutationFn: async (items: KitchenOrder["items"]) => {
      for (const it of items) {
        if (it.status === "PREPARING") {
          await api.patch(`/staff/order-items/${it.id}/status`, { status: "READY" });
        }
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kitchen-orders"] }),
  });

  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const orders = (data?.orders ?? [])
    .map((o) => ({ ...o, items: o.items.filter((it) => activeFilter.match.includes(it.status)) }))
    .filter((o) => o.items.length > 0);

  return (
    <div className="min-h-screen bg-cream">
      {/* Header + filter bar stick together so they never overlap, whatever
          the header's height ends up being. */}
      <div className="sticky top-0 z-20">
        <header className="topbar px-4 pb-3 pt-safe">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="brand-mark brand-mark-sm">
                <UtensilsIcon size={18} />
              </span>
              <div className="min-w-0">
                <div className="display text-lg font-bold leading-tight">Kitchen</div>
                <div className="truncate text-xs text-white/60">{user?.name}</div>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              {!soundReady ? (
                <button className="btn btn-accent text-xs" onClick={enableSound}>
                  <BellIcon size={15} />
                  Enable sound
                </button>
              ) : (
                <button
                  className={`chip ${soundOn ? "!bg-forest text-white" : "bg-white/10 text-white/70"}`}
                  onClick={() => setSoundOn((s) => !s)}
                >
                  {soundOn ? <BellIcon size={14} /> : <BellOffIcon size={14} />}
                  {soundOn ? "On" : "Off"}
                </button>
              )}
              <button
                className="btn btn-ghost btn-icon !min-h-10 !border-white/20 !bg-white/10 !text-white"
                aria-label="Sign out"
                onClick={() => { logout(); location.href = "/login"; }}
              >
                <LogOutIcon size={17} />
              </button>
            </div>
          </div>
        </header>

        <nav className="flex items-center gap-2 overflow-x-auto border-b border-line bg-surface/95 px-3 py-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip whitespace-nowrap ${filter === f.key ? "!bg-espresso text-white" : "bg-cream text-espresso"}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <button className="btn btn-ghost btn-sm ml-auto shrink-0" aria-label="Refresh orders" onClick={() => refetch()}>
            <RefreshIcon size={15} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </nav>
      </div>

      <main className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
        {!orders.length && (
          <div className="card col-span-full p-10 text-center">
            <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-cream-deep text-copper/70">
              <UtensilsIcon size={26} />
            </span>
            <p className="display text-lg font-semibold">No dishes in this view</p>
            <p className="mt-1 text-sm text-muted">New orders will appear here as they arrive.</p>
          </div>
        )}
        {orders.map((o) => {
          const mins = minutesSince(o.createdAt);
          return (
            <div key={o.id} className="card p-3">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="display text-xl font-bold">Table {o.table.number}</div>
                  <div className="text-xs text-muted">{o.orderNumber}</div>
                </div>
                <div className="text-right">
                  <span className={`badge badge-plain ${mins > 10 ? "bg-danger-soft text-danger" : "bg-cream text-espresso"}`}>
                    <ClockIcon size={11} />
                    {mins}m
                  </span>
                  <div className="mt-1 text-[0.66rem] font-semibold uppercase tracking-[0.1em] text-muted">{o.status}</div>
                </div>
              </div>
              {o.items.some((it) => it.status === "PREPARING") && (
                <button
                  className="btn btn-ghost btn-sm mt-2 w-full"
                  disabled={bulkReady.isPending}
                  onClick={() => bulkReady.mutate(o.items)}
                >
                  <CheckIcon size={14} />
                  Mark all items for this order ready
                </button>
              )}
              <ul className="mt-2 space-y-2">
                {o.items.map((it) => (
                  <li key={it.id} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <span className="font-semibold">{it.quantity}× {it.nameSnapshot}</span>
                        {it.addons.length > 0 && (
                          <span className="text-muted"> + {it.addons.map((a) => a.nameSnapshot).join(", ")}</span>
                        )}
                        {it.specialInstructions && (
                          <div className="mt-0.5 text-xs text-amber-ink">{it.specialInstructions}</div>
                        )}
                      </div>
                      <span className={`badge whitespace-nowrap ${ITEM_STYLE[it.status]}`}>{it.status}</span>
                    </div>
                    <div className="mt-1.5 flex gap-2">
                      {it.status === "QUEUED" && (
                        <button
                          className="btn btn-accent btn-sm"
                          disabled={setItemStatus.isPending}
                          onClick={() => setItemStatus.mutate({ itemId: it.id, status: "PREPARING" })}
                        >
                          <UtensilsIcon size={14} />
                          Start preparing
                        </button>
                      )}
                      {it.status === "PREPARING" && (
                        <button
                          className="btn btn-primary btn-sm !bg-forest"
                          disabled={setItemStatus.isPending}
                          onClick={() => setItemStatus.mutate({ itemId: it.id, status: "READY" })}
                        >
                          <CheckIcon size={14} />
                          Mark ready
                        </button>
                      )}
                      {it.status === "READY" && (
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-forest">
                          <CheckCircleIcon size={14} />
                          Waiting for pickup
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-xs text-muted">
                <span>Order total</span>
                <span className="num font-semibold text-espresso">{formatMoney(o.totalMinor)}</span>
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}
