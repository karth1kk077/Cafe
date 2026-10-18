import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, formatMoney, type TableResponse, type SessionOrdersResponse } from "../lib/api";

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-700",
  ACCEPTED: "bg-blue-100 text-blue-700",
  PREPARING: "bg-amber-100 text-amber-700",
  READY: "bg-green-100 text-green-700",
  SERVED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-red-100 text-red-700",
};

export function OrderTracking() {
  const { tableCode = "" } = useParams();

  const { data: tableInfo } = useQuery<TableResponse>({
    queryKey: ["table", tableCode],
    queryFn: () => api.get(`/public/tables/${tableCode}`),
  });

  const sessionId = tableInfo?.session?.id;
  const { data, refetch } = useQuery<SessionOrdersResponse>({
    queryKey: ["session-orders", sessionId],
    enabled: !!sessionId,
    queryFn: () => api.get(`/public/sessions/${sessionId}/orders`),
  });

  const requestBill = useMutation({
    mutationFn: () => api.post(`/public/sessions/${sessionId}/request-bill`),
    onSuccess: () => refetch(),
  });

  const assistance = useMutation({
    mutationFn: () => api.post(`/public/sessions/${sessionId}/assistance`, {}),
  });

  const orders = data?.orders ?? [];

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
              <span className={`badge ${STATUS_STYLE[o.status] ?? "bg-slate-100"}`}>{o.status}</span>
            </div>
            <div className="mt-2 space-y-1">
              {o.items.map((it) => (
                <div key={it.id} className="flex justify-between text-sm">
                  <span>{it.quantity}× {it.nameSnapshot}</span>
                  <span>{formatMoney(it.lineTotalMinor)}</span>
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

      {sessionId && data?.session.status === "ACTIVE" && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t p-3 flex gap-2">
          <button className="btn btn-ghost flex-1" onClick={() => assistance.mutate()} disabled={assistance.isPending}>
            Call waiter
          </button>
          <button className="btn btn-primary flex-1" onClick={() => requestBill.mutate()} disabled={requestBill.isPending}>
            Request bill
          </button>
        </div>
      )}
      {data?.session.status === "BILL_REQUESTED" && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-amber-50 border-t border-amber-200 p-3 text-center text-amber-800">
          Bill requested. A waiter will assist you shortly.
        </div>
      )}
      {data?.session.status === "CLOSED" && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-slate-100 border-t p-3 text-center text-slate-600">
          This session is closed. Thank you!
        </div>
      )}
    </div>
  );
}
