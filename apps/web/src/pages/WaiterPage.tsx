import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatMoney } from "../lib/api";
import { SOCKET_EVENTS, getSocket } from "../lib/socket";
import { useAuth } from "../lib/auth";

interface Table {
  id: string;
  number: string;
  status: string;
  qrToken: string;
  sessions: Array<{
    id: string;
    status: string;
    orders: Array<{ id: string; status: string }>;
    bills: Array<{ id: string; status: string; totalMinor: number }>;
  }>;
}

const STATUS_COLOR: Record<string, string> = {
  AVAILABLE: "bg-green-100 text-green-800",
  OCCUPIED: "bg-blue-100 text-blue-800",
  BILL_REQUESTED: "bg-amber-100 text-amber-800",
  PAYMENT_PENDING: "bg-orange-100 text-orange-800",
  CLOSED: "bg-slate-100 text-slate-600",
};

export function WaiterPage() {
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const [selected, setSelected] = useState<Table | null>(null);
  const [payAmount, setPayAmount] = useState("");

  const { data, refetch } = useQuery<{ tables: Table[] }>({
    queryKey: ["tables"],
    queryFn: () => api.get("/staff/tables"),
  });

  const { data: assistance } = useQuery<{ requests: Array<{ id: string; table: { number: string }; message?: string }> }>({
    queryKey: ["assistance"],
    queryFn: () => api.get("/staff/assistance"),
  });

  useEffect(() => {
    const socket = getSocket(localStorage.getItem("cafe_token") || undefined);
    const refresh = () => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ["assistance"] });
    };
    socket.on(SOCKET_EVENTS.ORDER_CREATED, refresh);
    socket.on(SOCKET_EVENTS.BILL_REQUESTED, refresh);
    socket.on(SOCKET_EVENTS.ASSISTANCE_REQUESTED, refresh);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_CREATED, refresh);
      socket.off(SOCKET_EVENTS.BILL_REQUESTED, refresh);
      socket.off(SOCKET_EVENTS.ASSISTANCE_REQUESTED, refresh);
    };
  }, [refetch, queryClient]);

  const openSession = useMutation({
    mutationFn: (tableId: string) => api.post(`/staff/tables/${tableId}/sessions`),
    onSuccess: () => refetch(),
  });

  const closeSession = useMutation({
    mutationFn: (sessionId: string) => api.post(`/staff/sessions/${sessionId}/close`, {}),
    onSuccess: () => { refetch(); setSelected(null); },
  });

  const generateBill = useMutation({
    mutationFn: (sessionId: string) => api.post("/staff/bills/generate", { sessionId }),
    onSuccess: () => { refetch(); },
  });

  const recordPayment = useMutation({
    mutationFn: ({ billId, amountMinor }: { billId: string; amountMinor: number }) =>
      api.post("/staff/payments", { billId, amountMinor, method: "CASH" }),
    onSuccess: () => { refetch(); setPayAmount(""); },
  });

  const markReady = useMutation({
    mutationFn: (orderId: string) => api.patch(`/staff/orders/${orderId}/status`, { status: "SERVED" }),
    onSuccess: () => refetch(),
  });

  const tables = data?.tables ?? [];
  const billRequested = tables.filter((t) => t.status === "BILL_REQUESTED");
  const active = assistance?.requests ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-lg font-bold">Waiter Dashboard</div>
          <div className="text-xs opacity-70">{user?.name}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost !text-white !border-white/30 text-sm" onClick={() => refetch()}>↻</button>
          <button className="btn btn-ghost !text-white !border-white/30 text-sm" onClick={() => { logout(); location.href = "/login"; }}>Exit</button>
        </div>
      </header>

      {(billRequested.length > 0 || active.length > 0) && (
        <div className="bg-amber-50 border-b border-amber-200 p-3 space-y-1">
          {billRequested.map((t) => (
            <div key={t.id} className="text-amber-800 text-sm font-semibold">🧾 Bill requested — Table {t.number}</div>
          ))}
          {active.map((r) => (
            <div key={r.id} className="text-amber-800 text-sm">🙋 Assistance — Table {r.table.number}</div>
          ))}
        </div>
      )}

      <main className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {tables.map((t) => {
          const session = t.sessions[0];
          const openOrders = session?.orders.filter((o) => !["SERVED", "CANCELLED"].includes(o.status)).length ?? 0;
          return (
            <button
              key={t.id}
              className={`card p-3 text-left ${t.status === "BILL_REQUESTED" ? "!border-amber-400" : ""}`}
              onClick={() => setSelected(t)}
            >
              <div className="flex justify-between items-start">
                <div className="text-lg font-bold">T{t.number}</div>
                <span className={`badge ${STATUS_COLOR[t.status] ?? "bg-slate-100"}`}>{t.status.replace("_", " ")}</span>
              </div>
              {session && (
                <div className="mt-1 text-xs text-slate-600">
                  {openOrders > 0 ? `${openOrders} open order${openOrders > 1 ? "s" : ""}` : "No open orders"}
                </div>
              )}
              {!session && t.status === "AVAILABLE" && <div className="mt-1 text-xs text-green-600">Available</div>}
            </button>
          );
        })}
      </main>

      {selected && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-bold">Table {selected.number}</h3>
              <button className="btn btn-ghost !px-2" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="text-sm text-slate-600 mb-3">Status: {selected.status}</div>

            {!selected.sessions[0] && selected.status === "AVAILABLE" && (
              <button className="btn btn-primary w-full" onClick={() => openSession.mutate(selected.id)} disabled={openSession.isPending}>
                Open session
              </button>
            )}

            {selected.sessions[0] && (
              <div className="space-y-3">
                <div className="text-sm">
                  <div className="font-semibold">Session {selected.sessions[0].id.slice(0, 8)}… ({selected.sessions[0].status})</div>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-ghost flex-1 text-sm" onClick={() => generateBill.mutate(selected.sessions[0].id)} disabled={generateBill.isPending}>
                    Generate bill
                  </button>
                  <button className="btn btn-primary flex-1 text-sm" onClick={() => closeSession.mutate(selected.sessions[0].id)} disabled={closeSession.isPending}>
                    Close session
                  </button>
                </div>
                {selected.sessions[0].bills.filter((b) => b.status !== "PAID" && b.status !== "VOID").map((b) => (
                  <div key={b.id} className="card p-3">
                    <div className="flex justify-between text-sm">
                      <span className="font-semibold">Bill total</span>
                      <span>{formatMoney(b.totalMinor)}</span>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <input
                        className="input flex-1"
                        placeholder="Amount (minor)"
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                      />
                      <button
                        className="btn btn-accent text-sm"
                        onClick={() => recordPayment.mutate({ billId: b.id, amountMinor: Number(payAmount) })}
                        disabled={!payAmount || recordPayment.isPending}
                      >
                        Record payment
                      </button>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">Enter amount in minor units (paise). Full = {b.totalMinor}.</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
