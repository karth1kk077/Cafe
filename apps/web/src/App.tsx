import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Routes, Route, Navigate, Link } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { AlertIcon, BrandCupIcon } from "./components/ui/Icon";

// Route-level code splitting keeps the customer menu (the QR entry point) small
// on a phone; staff tools and the admin console load only when visited.
const LandingPage = lazy(() => import("./pages/LandingPage").then((m) => ({ default: m.LandingPage })));
const CustomerMenu = lazy(() => import("./pages/CustomerMenu").then((m) => ({ default: m.CustomerMenu })));
const OrderTracking = lazy(() => import("./pages/OrderTracking").then((m) => ({ default: m.OrderTracking })));
const LoginPage = lazy(() => import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const KitchenPage = lazy(() => import("./pages/KitchenPage").then((m) => ({ default: m.KitchenPage })));
const WaiterPage = lazy(() => import("./pages/WaiterPage").then((m) => ({ default: m.WaiterPage })));
const AdminPage = lazy(() => import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })));

function RouteFallback() {
  return (
    <div className="p-8 space-y-3" aria-busy="true" aria-live="polite">
      <div className="h-6 w-40 animate-pulse rounded bg-line" />
      <div className="h-24 animate-pulse rounded-card border border-line bg-surface" />
      <div className="h-24 animate-pulse rounded-card border border-line bg-surface" />
      <span className="sr-only">Loading…</span>
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
    <div className="fixed top-0 inset-x-0 z-50 flex items-center justify-center gap-2 border-b border-line bg-amber-soft px-4 py-2 text-center text-sm text-amber-ink" role="status">
      <AlertIcon size={15} className="shrink-0" />
      You are offline — we will refresh automatically when the connection returns.
    </div>
  );
}

function StaffRoute({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-center text-muted" aria-busy="true">
        <div className="flex items-center gap-2.5">
          <span className="brand-mark brand-mark-sm">
            <BrandCupIcon size={18} />
          </span>
          Loading…
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="card w-full max-w-sm p-6 text-center">
          <span aria-hidden className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-danger-soft text-danger">
            <AlertIcon size={26} />
          </span>
          <h1 className="display text-xl font-semibold">Access denied</h1>
          <p className="mt-2 text-sm text-muted">Your account does not have permission for this area.</p>
          <Link to="/login" className="btn btn-primary mt-5 w-full">
            Sign in with another account
          </Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function App() {
  return (
    <>
      <OfflineBanner />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
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
          <Route
            path="*"
            element={
              <div className="flex min-h-screen items-center justify-center p-4">
                <div className="card w-full max-w-sm p-6 text-center">
                  <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-cream-deep text-copper/70">
                    <BrandCupIcon size={26} />
                  </span>
                  <h1 className="display text-xl font-semibold">Page not found</h1>
                  <p className="mt-2 text-sm text-muted">That link does not point anywhere in this café.</p>
                  <Link to="/" className="btn btn-primary mt-5 w-full">
                    Go to start
                  </Link>
                </div>
              </div>
            }
          />
        </Routes>
      </Suspense>
    </>
  );
}
