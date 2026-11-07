import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatMoney, type OrderItemStatus } from "../lib/api";
import { SOCKET_EVENTS, getSocket } from "../lib/socket";
import { useAuth } from "../lib/auth";
import {
  AlertIcon,
  BellIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  ConciergeBellIcon,
  GridIcon,
  InfoIcon,
  LogOutIcon,
  ReceiptIcon,
  RefreshIcon,
  UtensilsIcon,
} from "../components/ui/Icon";

interface Table {
  id: string;
  number: string;
  status: string;
  qrToken: string;
  sessions: Array<{
    id: string;
    status: string;
    orders: Array<{
      id: string;
      status: string;
      items: Array<{ id: string; nameSnapshot: string; quantity: number; status: OrderItemStatus }>;
    }>;
    bills: Array<{
      id: string;
      status: string;
      totalMinor: number;
      subtotalMinor: number;
      taxMinor: number;
      serviceChargeMinor: number;
      discountMinor: number;
      roundingMinor: number;
      lineItems?: Array<{ id: string; nameSnapshot: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }>;
      payments?: Array<{ id: string; amountMinor: number; method: string; status: string }>;
    }>;
  }>;
}

interface ReadyItem {
  id: string;
  nameSnapshot: string;
  quantity: number;
  readyAt?: string | null;
  addons: Array<{ nameSnapshot: string }>;
  order: { id: string; orderNumber: string; table: { number: string } };
}

const STATUS_COLOR: Record<string, string> = {
  AVAILABLE: "bg-forest-soft text-forest",
  OCCUPIED: "bg-espresso text-white",
  BILL_REQUESTED: "bg-amber-soft text-amber-ink",
  PAYMENT_PENDING: "bg-amber-soft text-amber-ink",
  CLOSED: "bg-cream text-muted",
};

const ITEM_STYLE: Record<OrderItemStatus, string> = {
  QUEUED: "bg-cream text-espresso",
  PREPARING: "bg-amber-soft text-amber-ink",
  READY: "bg-forest-soft text-forest",
  SERVED: "bg-cream text-muted",
  CANCELLED: "bg-danger-soft text-danger",
};

function minutesSince(iso?: string | null) {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export function WaiterPage() {
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const [selected, setSelected] = useState<Table | null>(null);
  const [payAmount, setPayAmount] = useState("");
  // Surfaced in the table sheet: without this, a rejected action (e.g. closing
  // with an unpaid bill) looked like the button simply did nothing.
  const [actionError, setActionError] = useState("");
  const audioRef = useRef<AudioContext | null>(null);

  const { data, refetch } = useQuery<{ tables: Table[] }>({
    queryKey: ["tables"],
    queryFn: () => api.get("/staff/tables"),
  });

  const { data: ready, refetch: refetchReady } = useQuery<{ items: ReadyItem[] }>({
    queryKey: ["ready-items"],
    queryFn: () => api.get("/staff/order-items/ready"),
    refetchInterval: 60000,
  });

  const { data: assistance } = useQuery<{ requests: Array<{ id: string; status: string; table: { number: string }; message?: string }> }>({
    queryKey: ["assistance"],
    queryFn: () => api.get("/staff/assistance"),
  });

  const playAlert = useCallback(() => {
    try {
      if (typeof window === "undefined") return;
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = audioRef.current || new AudioCtx();
      audioRef.current = ctx;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        (navigator as Navigator & { vibrate: (pattern: number | number[]) => boolean }).vibrate([200, 100, 200]);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const socket = getSocket(localStorage.getItem("cafe_token") || undefined);
    const refresh = () => {
      refetch();
      refetchReady();
      queryClient.invalidateQueries({ queryKey: ["assistance"] });
    };
    const onItemReady = () => {
      playAlert();
      refresh();
    };
    const onAssistance = () => {
      playAlert();
      refresh();
    };
    socket.on(SOCKET_EVENTS.ORDER_CREATED, refresh);
    socket.on(SOCKET_EVENTS.SESSION_OPENED, refresh);
    socket.on(SOCKET_EVENTS.ITEM_READY, onItemReady);
    socket.on(SOCKET_EVENTS.ITEM_STATUS, refresh);
    socket.on(SOCKET_EVENTS.BILL_REQUESTED, refresh);
    socket.on(SOCKET_EVENTS.ASSISTANCE_REQUESTED, onAssistance);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_CREATED, refresh);
      socket.off(SOCKET_EVENTS.SESSION_OPENED, refresh);
      socket.off(SOCKET_EVENTS.ITEM_READY, onItemReady);
      socket.off(SOCKET_EVENTS.ITEM_STATUS, refresh);
      socket.off(SOCKET_EVENTS.BILL_REQUESTED, refresh);
      socket.off(SOCKET_EVENTS.ASSISTANCE_REQUESTED, onAssistance);
    };
  }, [playAlert, refetch, refetchReady, queryClient]);

  // The table sheet is a dialog: Escape and a scrim tap close it, matching the
  // customer-side sheets.
  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelected(null);
        setActionError("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const openSession = useMutation({
    mutationFn: (tableId: string) => api.post(`/staff/tables/${tableId}/sessions`),
    onSuccess: () => { setActionError(""); refetch(); },
    onError: (e: Error) => setActionError(e.message),
  });

  const confirmSession = useMutation({
    mutationFn: (sessionId: string) => api.post(`/staff/sessions/${sessionId}/confirm`),
    onSuccess: () => { setActionError(""); refetch(); },
    onError: (e: Error) => setActionError(e.message),
  });

  const closeSession = useMutation({
    mutationFn: (sessionId: string) => api.post(`/staff/sessions/${sessionId}/close`, {}),
    onSuccess: () => { setActionError(""); refetch(); setSelected(null); },
    onError: (e: Error) => { setActionError(e.message); refetch(); },
  });

  const generateBill = useMutation({
    mutationFn: (sessionId: string) => api.post("/staff/bills/generate", { sessionId }),
    onSuccess: () => { setActionError(""); refetch(); },
    onError: (e: Error) => setActionError(e.message),
  });

  const recordPayment = useMutation({
    mutationFn: ({
      billId,
      amountMinor,
      method,
    }: {
      billId: string;
      amountMinor: number;
      method: "CASH" | "OTHER";
    }) => api.post("/staff/payments", { billId, amountMinor, method }),
    onSuccess: () => { setActionError(""); refetch(); setPayAmount(""); },
    onError: (e: Error) => setActionError(e.message),
  });

  const resolveAssistance = useMutation({
    mutationFn: (id: string) => api.patch(`/staff/assistance/${id}`, { status: "RESOLVED" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assistance"] }),
    onError: (e: Error) => setActionError(e.message),
  });

  // The waiter's job: collect READY dishes and mark each one SERVED.
  const serveItem = useMutation({
    mutationFn: (itemId: string) => api.patch(`/staff/order-items/${itemId}/status`, { status: "SERVED" }),
    onSuccess: () => { refetch(); refetchReady(); setSelected(null); },
    onError: (e: Error) => alert(e.message),
  });

  const cancelItem = useMutation({
    mutationFn: ({ itemId, reason }: { itemId: string; reason: string }) =>
      api.post(`/staff/order-items/${itemId}/cancel`, { reason }),
    onSuccess: () => { refetch(); refetchReady(); },
    onError: (e: Error) => alert(e.message),
  });

  const tables = data?.tables ?? [];
  const billRequested = tables.filter((t) => t.status === "BILL_REQUESTED");
  const active = assistance?.requests ?? [];
  const readyItems = ready?.items ?? [];

  // Group ready dishes by table + order for the pickup queue.
  const readyGroups = readyItems.reduce<Record<string, { tableNumber: string; orderNumber: string; items: ReadyItem[] }>>(
    (acc, item) => {
      const key = item.order.id;
      if (!acc[key]) {
        acc[key] = { tableNumber: item.order.table.number, orderNumber: item.order.orderNumber, items: [] };
      }
      acc[key].items.push(item);
      return acc;
    },
    {}
  );

  return (
    <div className="min-h-screen bg-cream">
      <header className="topbar sticky top-0 z-20 px-4 pb-3 pt-safe">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="brand-mark brand-mark-sm">
              <ConciergeBellIcon size={18} />
            </span>
            <div className="min-w-0">
              <div className="display truncate text-lg font-bold leading-tight">Waiter Dashboard</div>
              <div className="truncate text-xs text-white/60">{user?.name}</div>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              className="btn btn-ghost btn-icon !min-h-10 !border-white/20 !bg-white/10 !text-white"
              aria-label="Refresh dashboard"
              onClick={() => { refetch(); refetchReady(); }}
            >
              <RefreshIcon size={17} />
            </button>
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

      {(billRequested.length > 0 || active.length > 0) && (
        <div className="border-b border-line bg-amber-soft px-4 py-2.5">
          <div className="mx-auto max-w-5xl space-y-1.5">
            {billRequested.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-sm font-semibold text-amber-ink">
                <ReceiptIcon size={16} className="shrink-0" />
                <span>Bill requested — Table {t.number}</span>
              </div>
            ))}
            {active.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 text-sm text-amber-ink">
                <span className="flex min-w-0 items-center gap-2">
                  <BellIcon size={16} className="shrink-0" />
                  <span className="truncate">
                    Assistance — Table {r.table.number}
                    {r.message ? ` · ${r.message}` : ""}
                  </span>
                </span>
                <button
                  className="btn btn-ghost btn-sm shrink-0"
                  disabled={resolveAssistance.isPending}
                  onClick={() => resolveAssistance.mutate(r.id)}
                >
                  Resolve
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-5xl px-4 pb-10">
        {/* Ready dish pickup queue (spec 8.2). */}
        <section className="pt-5">
          <h2 className="section-label mb-3">
            <UtensilsIcon size={14} />
            <span>Ready to serve</span>
            {readyItems.length > 0 && (
              <span className="badge badge-plain bg-forest-soft text-forest">{readyItems.length}</span>
            )}
          </h2>
          {readyItems.length === 0 && (
            <div className="card p-4 text-sm text-muted">Nothing waiting for pickup.</div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(readyGroups).map(([orderId, group]) => (
              <div key={orderId} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-forest-soft text-forest">
                      <UtensilsIcon size={17} />
                    </span>
                    <div className="min-w-0">
                      <div className="display truncate font-bold leading-tight">Table {group.tableNumber}</div>
                      <div className="num truncate text-xs text-muted">{group.orderNumber}</div>
                    </div>
                  </div>
                  <span className="badge badge-plain bg-forest-soft text-forest">
                    {group.items.length} dish{group.items.length > 1 ? "es" : ""}
                  </span>
                </div>
                <ul className="mt-3 space-y-2.5">
                  {group.items.map((it) => (
                    <li
                      key={it.id}
                      className="flex items-center justify-between gap-3 border-t border-line pt-2.5 first:border-t-0 first:pt-0"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">
                          {it.quantity}× {it.nameSnapshot}
                        </div>
                        {it.addons.length > 0 && (
                          <div className="text-xs text-muted">+ {it.addons.map((a) => a.nameSnapshot).join(", ")}</div>
                        )}
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                          <ClockIcon size={12} />
                          ready {minutesSince(it.readyAt)}m ago
                        </div>
                      </div>
                      <button
                        className="btn btn-primary btn-sm shrink-0"
                        disabled={serveItem.isPending}
                        onClick={() => serveItem.mutate(it.id)}
                      >
                        <CheckIcon size={14} />
                        Served
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="pt-7">
          <h2 className="section-label mb-3">
            <GridIcon size={14} />
            <span>Tables</span>
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {tables.map((t) => {
              const session = t.sessions[0];
              const openItems =
                session?.orders.reduce(
                  (n, o) => n + o.items.filter((it) => it.status !== "SERVED" && it.status !== "CANCELLED").length,
                  0
                ) ?? 0;
              return (
                <button
                  key={t.id}
                  className={`card card-interactive p-3.5 ${
                    t.status === "BILL_REQUESTED" ? "border-amber-ink/50" : ""
                  }`}
                  onClick={() => setSelected(t)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="display min-w-0 truncate text-lg font-bold leading-none">T{t.number}</div>
                    <span
                      className={`badge shrink-0 ${
                        session?.status === "PENDING"
                          ? "bg-amber-soft text-amber-ink"
                          : STATUS_COLOR[t.status] ?? "bg-cream text-muted"
                      }`}
                    >
                      {session?.status === "PENDING" ? "REQUESTED" : t.status.replace("_", " ")}
                    </span>
                  </div>
                  {session && (
                    <div className="mt-2 text-xs text-muted">
                      {openItems > 0 ? `${openItems} dish${openItems > 1 ? "es" : ""} active` : "No open dishes"}
                    </div>
                  )}
                  {!session && t.status === "AVAILABLE" && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-forest">
                      <span className="h-1.5 w-1.5 rounded-full bg-forest" aria-hidden="true" />
                      Available
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center"
          onClick={() => {
            setSelected(null);
            setActionError("");
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="table-sheet-title"
            className="animate-rise max-h-[90dvh] w-full overflow-y-auto rounded-t-[var(--radius-sheet)] bg-surface p-4 pb-safe shadow-lift sm:max-w-md sm:rounded-[var(--radius-sheet)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id="table-sheet-title" className="display truncate text-lg font-bold leading-tight">
                  Table {selected.number}
                </h3>
                <div className="mt-0.5 text-xs text-muted">Status: {selected.status}</div>
              </div>
              <button
                className="btn btn-ghost btn-icon shrink-0"
                aria-label="Close table details"
                onClick={() => {
                  setSelected(null);
                  setActionError("");
                }}
              >
                <CloseIcon size={18} />
              </button>
            </div>

            {actionError && (
              <div
                role="alert"
                className="mb-3 flex items-start justify-between gap-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger"
              >
                <span className="flex items-start gap-2">
                  <AlertIcon size={16} className="mt-0.5 shrink-0" />
                  {actionError}
                </span>
                <button
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-danger/10"
                  aria-label="Dismiss message"
                  onClick={() => setActionError("")}
                >
                  <CloseIcon size={16} />
                </button>
              </div>
            )}

            {!selected.sessions[0] && selected.status === "AVAILABLE" && (
              <button className="btn btn-primary w-full" onClick={() => openSession.mutate(selected.id)} disabled={openSession.isPending}>
                Open session
              </button>
            )}

            {selected.sessions[0] && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-sm font-semibold">
                    Session <span className="num">{selected.sessions[0].id.slice(0, 8)}…</span>
                  </div>
                  <span className="badge badge-plain shrink-0 bg-cream text-muted">{selected.sessions[0].status}</span>
                </div>

                {selected.sessions[0].status === "PENDING" && (
                  <button
                    className="btn btn-accent w-full"
                    disabled={confirmSession.isPending}
                    onClick={() => confirmSession.mutate(selected.sessions[0].id)}
                  >
                    <CheckIcon size={16} />
                    Confirm ordering for this table
                  </button>
                )}

                {selected.sessions[0].orders.map((o) => (
                  <div key={o.id} className="card overflow-hidden">
                    <div className="flex items-center justify-between border-b border-line bg-cream/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      <span>Order</span>
                      <span>{o.status}</span>
                    </div>
                    <ul className="divide-y divide-line px-3">
                      {o.items.map((it) => (
                        <li key={it.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                          <span className="min-w-0 truncate">{it.quantity}× {it.nameSnapshot}</span>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className={`badge ${ITEM_STYLE[it.status]}`}>{it.status}</span>
                            {it.status === "READY" && (
                              <button className="btn btn-primary btn-sm" disabled={serveItem.isPending} onClick={() => serveItem.mutate(it.id)}>
                                <CheckIcon size={13} />
                                Served
                              </button>
                            )}
                            {(it.status === "QUEUED" || it.status === "PREPARING") && (
                              <button
                                className="btn btn-ghost btn-sm"
                                disabled={cancelItem.isPending}
                                onClick={() => {
                                  const reason = window.prompt("Reason for cancelling this item?") ?? "";
                                  cancelItem.mutate({ itemId: it.id, reason });
                                }}
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

                <div className="flex gap-2">
                  <button className="btn btn-ghost flex-1 text-sm" onClick={() => generateBill.mutate(selected.sessions[0].id)} disabled={generateBill.isPending}>
                    <ReceiptIcon size={15} />
                    Generate bill
                  </button>
                  <button className="btn btn-primary flex-1 text-sm" onClick={() => closeSession.mutate(selected.sessions[0].id)} disabled={closeSession.isPending}>
                    <CheckIcon size={15} />
                    Close session
                  </button>
                </div>
                {(selected.sessions[0].bills ?? [])
                  .filter((b) => b.status !== "PAID" && b.status !== "VOID")
                  .map((b) => {
                    const paid = (b.payments ?? [])
                      .filter((p) => p.status !== "FAILED" && p.status !== "REFUNDED")
                      .reduce((sum, p) => sum + p.amountMinor, 0);
                    const due = Math.max(0, b.totalMinor - paid);
                    const amountMinor = Math.round((Number(payAmount) || 0) * 100);
                    return (
                      <div key={b.id} className="card space-y-2 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 font-semibold">
                            <ReceiptIcon size={16} className="text-muted" />
                            Bill
                          </span>
                          <span className={`badge ${b.status === "PARTIAL" ? "bg-amber-soft text-amber-ink" : "bg-cream text-espresso"}`}>
                            {b.status}
                          </span>
                        </div>
                        {b.lineItems && b.lineItems.length > 0 && (
                          <div className="num divide-y divide-line text-sm">
                            {b.lineItems.map((l) => (
                              <div key={l.id} className="flex justify-between py-1">
                                <span>
                                  {l.quantity}× {l.nameSnapshot}
                                </span>
                                <span>{formatMoney(l.lineTotalMinor)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="num space-y-0.5 border-t border-line pt-2 text-sm">
                          <div className="flex justify-between">
                            <span>Subtotal</span>
                            <span>{formatMoney(b.subtotalMinor)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Tax</span>
                            <span>{formatMoney(b.taxMinor)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Service</span>
                            <span>{formatMoney(b.serviceChargeMinor)}</span>
                          </div>
                          {b.roundingMinor !== 0 && (
                            <div className="flex justify-between">
                              <span>Rounding</span>
                              <span>{formatMoney(b.roundingMinor)}</span>
                            </div>
                          )}
                          <div className="flex justify-between font-semibold border-t border-line pt-1">
                            <span>Total</span>
                            <span>{formatMoney(b.totalMinor)}</span>
                          </div>
                          {paid > 0 && (
                            <div className="flex justify-between text-forest">
                              <span>Paid</span>
                              <span>{formatMoney(paid)}</span>
                            </div>
                          )}
                          <div className="flex justify-between font-bold">
                            <span>Due</span>
                            <span>{formatMoney(due)}</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            className="btn btn-ghost text-xs"
                            onClick={() => setPayAmount(due > 0 ? (due / 100).toFixed(2) : "0.00")}
                          >
                            Exact amount
                          </button>
                          <button
                            className="btn btn-ghost text-xs"
                            onClick={() => {
                              setPayAmount(due > 0 ? (due / 100).toFixed(2) : "0.00");
                              if (due > 0) recordPayment.mutate({ billId: b.id, amountMinor: due, method: "CASH" });
                            }}
                            disabled={recordPayment.isPending || due === 0}
                          >
                            Cash
                          </button>
                          <button
                            className="btn btn-ghost text-xs"
                            onClick={() => {
                              setPayAmount(due > 0 ? (due / 100).toFixed(2) : "0.00");
                              if (due > 0) recordPayment.mutate({ billId: b.id, amountMinor: due, method: "OTHER" });
                            }}
                            disabled={recordPayment.isPending || due === 0}
                          >
                            UPI
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <input
                            className="input flex-1"
                            inputMode="decimal"
                            placeholder="Amount (₹)"
                            value={payAmount}
                            onChange={(e) => setPayAmount(e.target.value)}
                          />
                          <button
                            className="btn btn-accent text-sm"
                            onClick={() =>
                              recordPayment.mutate({
                                billId: b.id,
                                amountMinor,
                                method: "CASH",
                              })
                            }
                            disabled={!amountMinor || amountMinor <= 0 || recordPayment.isPending}
                          >
                            Record
                          </button>
                        </div>
                        <div className="flex items-start gap-1.5 text-xs text-amber-ink">
                          <InfoIcon size={13} className="mt-0.5 shrink-0" />
                          The session can only close once this bill is PAID.
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
