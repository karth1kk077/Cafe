import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth";

// Route-level code splitting keeps the customer menu (the QR entry point) small
// on a phone; staff tools and the admin console load only when visited.
const CustomerMenu = lazy(() => import("./pages/CustomerMenu").then((m) => ({ default: m.CustomerMenu })));
const OrderTracking = lazy(() => import("./pages/OrderTracking").then((m) => ({ default: m.OrderTracking })));
const LoginPage = lazy(() => import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const KitchenPage = lazy(() => import("./pages/KitchenPage").then((m) => ({ default: m.KitchenPage })));
const WaiterPage = lazy(() => import("./pages/WaiterPage").then((m) => ({ default: m.WaiterPage })));
const AdminPage = lazy(() => import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })));

function RouteFallback() {
  return (
    <div className="p-8 space-y-3" aria-busy="true" aria-live="polite">
      <div className="h-6 w-40 rounded bg-slate-200 animate-pulse" />
      <div className="h-24 rounded-xl bg-slate-100 animate-pulse" />
      <div className="h-24 rounded-xl bg-slate-100 animate-pulse" />
    </div>
  );
}

function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  if (online) return null;
  return (
    <div className="fixed top-0 inset-x-0 z-50 bg-amber-500 text-slate-900 text-center text-sm py-2 px-4" role="status">
      You are offline — we will refresh automatically when the connection returns.
    </div>
  );
}

function StaffRoute({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-center">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <div className="p-8 text-center">Access denied.</div>;
  return <>{children}</>;
}

export function App() {
  return (
    <>
      <OfflineBanner />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/t/:tableCode" element={<CustomerMenu />} />
          <Route path="/t/:tableCode/orders" element={<OrderTracking />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/kitchen"
            element={
              <StaffRoute roles={["KITCHEN", "ADMIN"]}>
                <KitchenPage />
              </StaffRoute>
            }
          />
          <Route
            path="/waiter"
            element={
              <StaffRoute roles={["WAITER", "ADMIN"]}>
                <WaiterPage />
              </StaffRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <StaffRoute roles={["ADMIN"]}>
                <AdminPage />
              </StaffRoute>
            }
          />
          <Route path="*" element={<div className="p-8 text-center">Not found</div>} />
        </Routes>
      </Suspense>
    </>
  );
}
