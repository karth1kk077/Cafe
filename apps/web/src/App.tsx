import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { CustomerMenu } from "./pages/CustomerMenu";
import { OrderTracking } from "./pages/OrderTracking";
import { LoginPage } from "./pages/LoginPage";
import { KitchenPage } from "./pages/KitchenPage";
import { WaiterPage } from "./pages/WaiterPage";
import { AdminPage } from "./pages/AdminPage";
import type { ReactNode } from "react";

function StaffRoute({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-center">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <div className="p-8 text-center">Access denied.</div>;
  return <>{children}</>;
}

export function App() {
  return (
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
  );
}
