import { useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  api,
  formatMoney,
  type TableResponse,
  type SessionOrdersResponse,
  type OrderStatus,
  type OrderItemStatus,
} from "../lib/api";
import { SOCKET_EVENTS, getSocket } from "../lib/socket";
import { loadSession } from "../lib/session";

const ORDER_STYLE: Record<OrderStatus, string> = {
  RECEIVED: "bg-slate-100 text-slate-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  PARTIALLY_READY: "bg-lime-100 text-lime-800",
  READY: "bg-green-100 text-green-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-red-100 text-red-700",
};

// Customer-facing wording: READY = being brought out, SERVED = on your table.
const ITEM_LABEL: Record<OrderItemStatus, string> = {
  QUEUED: "Ordered",
  PREPARING: "Being prepared",
  READY: "Ready",
  SERVED: "Served",
  CANCELLED: "Cancelled",
};

const ITEM_STYLE: Record<OrderItemStatus, string> = {
  QUEUED: "bg-slate-100 text-slate-600",
  PREPARING: "bg-amber-100 text-amber-800",
  READY: "bg-green-100 text-green-800",
  SERVED: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-red-100 text-red-700",
};

export function OrderTracking() {
  const { tableCode = "" } = useParams();

  const { data: tableInfo } = useQuery<TableResponse>({
    queryKey: ["table", tableCode],
    queryFn: () => api.get(`/public/tables/${tableCode}`),
  });

  const stored = loadSession(tableCode);
  const sessionId = tableInfo?.session?.id ?? stored?.sessionId;
  const token = tableInfo?.sessionToken ?? stored?.token ?? null;

  const { data, refetch } = useQuery<SessionOrdersResponse>({
    queryKey: ["session-orders", sessionId],
    enabled: !!sessionId,
    queryFn: () => api.get(`/public/sessions/${sessionId}/orders`, token),
  });

  useEffect(() => {
    if (!token) return;
    const socket = getSocket(token);
    const refresh = () => refetch();
    socket.on(SOCKET_EVENTS.ORDER_CREATED, refresh);
    socket.on(SOCKET_EVENTS.ORDER_UPDATED, refresh);
    socket.on(SOCKET_EVENTS.ITEM_STATUS, refresh);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_CREATED, refresh);
      socket.off(SOCKET_EVENTS.ORDER_UPDATED, refresh);
      socket.off(SOCKET_EVENTS.ITEM_STATUS, refresh);
    };
  }, [token, refetch]);

  const requestBill = useMutation({
    mutationFn: () => api.post(`/public/sessions/${sessionId}/request-bill`, {}, token),
    onSuccess: () => refetch(),
  });

  const assistance = useMutation({
    mutationFn: () => api.post(`/public/sessions/${sessionId}/assistance`, {}, token),
  });

  const orders = data?.orders ?? [];
  const sessionStatus = data?.session.status ?? tableInfo?.session?.status;

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-20 bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-sm opacity-70">Table {tableInfo?.table.number ?? "…"}</div>
          <div className="text-lg font-bold">My Orders</div>
        </div>
        <Link to={`/t/${tableCode}`} className="btn btn-ghost !text-white !border-white/30 text-sm">
          ← Menu
        </Link>
      </header>

      <main className="p-3 space-y-3">
        {!orders.length && <div className="p-8 text-center text-slate-500">No orders yet.</div>}
        {orders.map((o) => (
          <div key={o.id} className="card p-3">
            <div className="flex justify-between items-center">
              <div className="font-semibold">{o.orderNumber}</div>
              <span className={`badge ${ORDER_STYLE[o.status] ?? "bg-slate-100"}`}>{o.status.replace("_", " ")}</span>
            </div>
            <div className="mt-2 space-y-2">
              {o.items.map((it) => (
                <div key={it.id} className="flex justify-between items-center gap-2 text-sm">
                  <span className={it.status === "CANCELLED" ? "line-through text-slate-400" : ""}>
                    {it.quantity}× {it.nameSnapshot}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`badge ${ITEM_STYLE[it.status]}`}>{ITEM_LABEL[it.status]}</span>
                    <span>{formatMoney(it.lineTotalMinor)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-2 pt-2 border-t text-sm font-semibold">
              <span>Total</span>
              <span>{formatMoney(o.totalMinor)}</span>
            </div>
          </div>
        ))}
      </main>

      {sessionStatus === "ACTIVE" && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t p-3 flex gap-2">
          <button className="btn btn-ghost flex-1" onClick={() => assistance.mutate()} disabled={assistance.isPending}>
            Call waiter
          </button>
          <button className="btn btn-primary flex-1" onClick={() => requestBill.mutate()} disabled={requestBill.isPending}>
            Request bill
          </button>
        </div>
      )}
      {sessionStatus === "BILL_REQUESTED" && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-amber-50 border-t border-amber-200 p-3 text-center text-amber-800">
          Bill requested. A waiter will assist you shortly.
        </div>
      )}
      {sessionStatus === "CLOSED" && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-slate-100 border-t p-3 text-center text-slate-600">
          This session is closed. Thank you!
        </div>
      )}
      {sessionStatus === "PAYMENT_PENDING" && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-orange-50 border-t border-orange-200 p-3 text-center text-orange-800">
          Payment in progress. A waiter will assist you shortly.
        </div>
      )}
    </div>
  );
}
