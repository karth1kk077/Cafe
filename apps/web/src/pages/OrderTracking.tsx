import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type TableResponse,
  type SessionOrdersResponse,
  type CustomerBillResponse,
  type OrderItemStatus,
} from "../lib/api";
import { SOCKET_EVENTS, getSocket } from "../lib/socket";
import { loadSession } from "../lib/session";
import { haptic, HAPTIC_SUCCESS } from "../lib/haptics";
import { BillCard } from "../components/customer/BillCard";
import { OrderCard } from "../components/customer/OrderCard";
import { Toast, type ToastMessage, type ToastTone } from "../components/customer/Toast";
import {
  AlertIcon,
  BrandCupIcon,
  ClockIcon,
  ConciergeBellIcon,
  MenuBookIcon,
  ReceiptIcon,
  RefreshIcon,
} from "../components/ui/Icon";

function TrackingSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-3 p-4" aria-busy="true" aria-live="polite">
      <div className="h-20 animate-pulse rounded-card bg-line" />
      <div className="h-40 animate-pulse rounded-card bg-line" />
      <div className="h-40 animate-pulse rounded-card bg-line" />
      <span className="sr-only">Loading your order…</span>
    </div>
  );
}

const STATUS_COPY: Record<string, string> = {
  ACTIVE: "Ordering open",
  PENDING: "Waiting for confirmation",
  BILL_REQUESTED: "Bill requested",
  PAYMENT_PENDING: "Payment in progress",
  CLOSED: "Table closed",
};

export function OrderTracking() {
  const { tableCode = "" } = useParams();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const previousStatuses = useRef<Map<string, OrderItemStatus>>(new Map());
  const sawOrdersOnce = useRef(false);

  const showToast = useCallback((text: string, tone: ToastTone = "success") => {
    setToast({ id: Date.now(), text, tone });
  }, []);

  const {
    data: tableInfo,
    isLoading: tableLoading,
  } = useQuery<TableResponse>({
    queryKey: ["table", tableCode],
    queryFn: () => api.get(`/public/tables/${tableCode}`),
    refetchInterval: (query) => (query.state.data?.session?.status === "CLOSED" ? false : 15000),
  });

  const stored = loadSession(tableCode);
  const sessionId = tableInfo?.session?.id ?? stored?.sessionId;
  const token = tableInfo?.sessionToken ?? stored?.token ?? null;

  /** Recover once from a token that outlived its tab, then surface the error. */
  async function fetchWithSession<T>(path: string): Promise<T> {
    try {
      return await api.get<T>(path, token);
    } catch (error) {
      if ((error as Error & { status?: number }).status === 401) {
        const fresh = await api.get<TableResponse>(`/public/tables/${tableCode}`);
        queryClient.setQueryData(["table", tableCode], fresh);
        if (fresh.sessionToken) return api.get<T>(path, fresh.sessionToken);
      }
      throw error;
    }
  }

  const ordersQuery = useQuery<SessionOrdersResponse>({
    queryKey: ["session-orders", sessionId],
    enabled: !!sessionId && !!token,
    queryFn: () => fetchWithSession<SessionOrdersResponse>(`/public/sessions/${sessionId}/orders`),
    // Poll as a safety net for phones where the socket is suspended in the
    // background; realtime still makes the normal path feel instant.
    refetchInterval: (query) => (query.state.data?.session.status === "CLOSED" ? false : 10000),
  });

  const billQuery = useQuery<CustomerBillResponse>({
    queryKey: ["customer-bill", sessionId],
    enabled: !!sessionId && !!token,
    queryFn: () => fetchWithSession<CustomerBillResponse>(`/public/sessions/${sessionId}/bill`),
    refetchInterval: (query) => (query.state.data?.bill.status === "PAID" ? false : 15000),
  });

  const refreshAll = useCallback(() => {
    void ordersQuery.refetch();
    void billQuery.refetch();
    queryClient.invalidateQueries({ queryKey: ["table", tableCode] });
  }, [ordersQuery.refetch, billQuery.refetch, queryClient, tableCode]);

  useEffect(() => {
    if (!token) return;
    const socket = getSocket(token);
    socket.on(SOCKET_EVENTS.ORDER_CREATED, refreshAll);
    socket.on(SOCKET_EVENTS.ORDER_UPDATED, refreshAll);
    socket.on(SOCKET_EVENTS.ITEM_STATUS, refreshAll);
    socket.on(SOCKET_EVENTS.BILL_REQUESTED, refreshAll);
    socket.on(SOCKET_EVENTS.SESSION_CLOSED, refreshAll);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_CREATED, refreshAll);
      socket.off(SOCKET_EVENTS.ORDER_UPDATED, refreshAll);
      socket.off(SOCKET_EVENTS.ITEM_STATUS, refreshAll);
      socket.off(SOCKET_EVENTS.BILL_REQUESTED, refreshAll);
      socket.off(SOCKET_EVENTS.SESSION_CLOSED, refreshAll);
    };
  }, [token, refreshAll]);

  const requestBill = useMutation({
    mutationFn: () => api.post(`/public/sessions/${sessionId}/request-bill`, {}, token),
    onSuccess: () => {
      haptic();
      showToast("Bill requested — a team member is on the way.", "success");
      refreshAll();
    },
    onError: (error: Error) => showToast(error.message, "error"),
  });

  const assistance = useMutation({
    mutationFn: () => api.post(`/public/sessions/${sessionId}/assistance`, {}, token),
    onSuccess: () => {
      haptic();
      showToast("A team member has been notified.", "info");
    },
    onError: (error: Error) => showToast(error.message, "error"),
  });

  const cancelItem = useMutation({
    mutationFn: (itemId: string) => api.post(`/public/order-items/${itemId}/cancel`, {}, token),
    onSuccess: () => {
      haptic();
      showToast("Item cancelled.", "info");
      refreshAll();
    },
    onError: (error: Error) => showToast(error.message, "error"),
  });

  const orders = ordersQuery.data?.orders ?? [];
  const sessionStatus = ordersQuery.data?.session.status ?? tableInfo?.session?.status;
  const bill = billQuery.data;

  // Announce dishes reaching READY/SERVED once, with a short buzz.
  useEffect(() => {
    if (!orders.length) return;
    if (!sawOrdersOnce.current) {
      for (const order of orders) {
        for (const item of order.items) previousStatuses.current.set(item.id, item.status);
      }
      sawOrdersOnce.current = true;
      return;
    }
    const announcements: string[] = [];
    for (const order of orders) {
      for (const item of order.items) {
        const previous = previousStatuses.current.get(item.id);
        if (previous === item.status) continue;
        previousStatuses.current.set(item.id, item.status);
        if (item.status === "READY") announcements.push(`${item.nameSnapshot} is ready`);
        else if (item.status === "SERVED") announcements.push(`${item.nameSnapshot} was served`);
      }
    }
    if (announcements.length) {
      haptic(HAPTIC_SUCCESS);
      // Deferred a tick so the toast does not cascade a render inside the
      // status-diff effect.
      const timer = window.setTimeout(() => showToast(announcements[0], "success"), 0);
      return () => window.clearTimeout(timer);
    }
  }, [orders, showToast]);

  const activeDishes = orders.reduce(
    (sum, order) =>
      sum + order.items.filter((item) => item.status !== "SERVED" && item.status !== "CANCELLED").length,
    0
  );

  if (tableLoading) return <TrackingSkeleton />;

  return (
    <div className="min-h-screen bg-cream pb-28">
      <header className="topbar sticky top-0 z-20 px-4 pb-3 pt-safe">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="brand-mark brand-mark-sm">
              <BrandCupIcon size={18} />
            </span>
            <div className="min-w-0">
              <h1 className="display truncate text-xl font-semibold leading-tight">Your order</h1>
              <span className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-white/70">
                Table {tableInfo?.table.number ?? "…"}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-icon !min-h-10 !border-white/20 !bg-white/10 !text-white"
              aria-label="Refresh order"
              onClick={refreshAll}
            >
              <RefreshIcon size={17} />
            </button>
            <Link
              to={`/t/${tableCode}`}
              className="btn btn-ghost !min-h-10 !border-white/20 !bg-white/10 !px-3 !text-white text-sm"
            >
              <MenuBookIcon size={16} />
              Menu
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-3 p-3">
        <section className="card flex items-center gap-3 p-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-cream-deep text-copper ring-1 ring-line">
            <ClockIcon size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[0.66rem] font-bold uppercase tracking-[0.14em] text-muted">Status</div>
            <div className="display text-lg font-semibold leading-tight">
              {sessionStatus ? STATUS_COPY[sessionStatus] ?? sessionStatus.replace("_", " ") : "No open session"}
            </div>
            <p className="mt-0.5 text-sm text-muted">
              {activeDishes > 0
                ? `${activeDishes} ${activeDishes === 1 ? "dish" : "dishes"} still on the way`
                : orders.length
                  ? "Everything has been served."
                  : "Place an order from the menu to get started."}
            </p>
          </div>
          <span className="badge badge-plain shrink-0 bg-cream text-espresso">
            {orders.length} {orders.length === 1 ? "order" : "orders"}
          </span>
        </section>

        {ordersQuery.isLoading && <TrackingSkeleton />}

        {ordersQuery.error && (
          <div className="card p-4 text-sm" role="alert">
            <div className="flex items-start gap-2">
              <AlertIcon size={17} className="mt-0.5 shrink-0 text-danger" />
              <div>
                <p className="font-semibold">We couldn’t load your orders.</p>
                <p className="mt-1 text-muted">{ordersQuery.error.message}</p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" className="btn btn-ghost" onClick={refreshAll}>
                <RefreshIcon size={15} />
                Try again
              </button>
              <Link to={`/t/${tableCode}`} className="btn btn-primary">
                Scan again
              </Link>
            </div>
          </div>
        )}

        {!ordersQuery.isLoading && !orders.length && !bill && !ordersQuery.error && (
          <div className="card p-8 text-center">
            <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-cream-deep text-copper/70">
              <MenuBookIcon size={26} />
            </span>
            <p className="display text-lg font-semibold">Nothing ordered yet</p>
            <p className="mt-1 text-sm text-muted">Head back to the menu and add something you like.</p>
            <Link to={`/t/${tableCode}`} className="btn btn-accent mt-4">
              Browse the menu
            </Link>
          </div>
        )}

        {orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            canCancel={sessionStatus === "ACTIVE"}
            cancelling={cancelItem.isPending}
            onCancel={(itemId) => {
              if (window.confirm("Remove this dish from your order?")) cancelItem.mutate(itemId);
            }}
          />
        ))}

        {bill && <BillCard data={bill} tableNumber={tableInfo?.table.number ?? ""} />}
      </main>

      {sessionStatus === "ACTIVE" && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-line bg-surface p-3 pb-safe shadow-[0_-10px_30px_-24px_rgb(43_29_20/0.5)]">
          <button
            type="button"
            className="btn btn-ghost flex-1"
            onClick={() => assistance.mutate()}
            disabled={assistance.isPending}
          >
            <ConciergeBellIcon size={16} />
            {assistance.isPending ? "Calling…" : "Call waiter"}
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1"
            onClick={() => requestBill.mutate()}
            disabled={requestBill.isPending}
          >
            <ReceiptIcon size={16} />
            {requestBill.isPending ? "Requesting…" : "Request bill"}
          </button>
        </div>
      )}

      {sessionStatus === "BILL_REQUESTED" && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-center gap-2 border-t border-line bg-amber-soft p-3 pb-safe text-center text-sm font-semibold text-amber-ink">
          <AlertIcon size={16} />
          Bill requested. A team member will be with you shortly.
        </div>
      )}
      {sessionStatus === "PAYMENT_PENDING" && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-center gap-2 border-t border-line bg-amber-soft p-3 pb-safe text-center text-sm font-semibold text-amber-ink">
          <ClockIcon size={16} />
          Payment in progress. Please wait for a team member to confirm.
        </div>
      )}
      {sessionStatus === "CLOSED" && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-line bg-surface p-3 pb-safe">
          <span className="text-sm text-muted">This table is closed. Thank you!</span>
          <Link to={`/t/${tableCode}`} className="btn btn-ghost !min-h-10 text-sm">
            Order again
          </Link>
        </div>
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} className="bottom-24" />
    </div>
  );
}
