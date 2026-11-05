import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatMoney } from "../lib/api";
import { useAuth } from "../lib/auth";
import { TablesQrPanel } from "../components/TablesQrPanel";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
}

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
}

interface MenuItemAdmin {
  id: string;
  name: string;
  description?: string | null;
  priceMinor: number;
  isAvailable: boolean;
  categoryId: string;
  dietaryTags: string[];
  allergens: string[];
}

interface MenuCategoryAdmin {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  sortOrder: number;
  items: MenuItemAdmin[];
}

const TABS = ["Staff", "Tables & QR", "Menu", "Audit", "Settings"] as const;

export function AdminPage() {
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Staff");

  const { data: users } = useQuery<{ users: User[] }>({
    queryKey: ["admin-users"],
    queryFn: () => api.get("/staff/admin/users"),
  });

  const { data: audit } = useQuery<{ logs: AuditLog[] }>({
    queryKey: ["admin-audit"],
    queryFn: () => api.get("/staff/admin/audit"),
  });

  const { data: settings } = useQuery<{
    settings: {
      cafeName: string;
      currency: string;
      taxRateBps: number;
      serviceChargeBps: number;
      roundingEnabled: boolean;
      upiId: string | null;
    };
  }>({
    queryKey: ["admin-settings"],
    queryFn: () => api.get("/staff/admin/settings"),
  });

  const { data: menu } = useQuery<{ categories: MenuCategoryAdmin[] }>({
    queryKey: ["admin-menu-full"],
    queryFn: () => api.get("/staff/admin/menu"),
  });

  const [newUser, setNewUser] = useState({ email: "", password: "", name: "", role: "WAITER" });
  const [newCategory, setNewCategory] = useState({ name: "" });
  const [newItem, setNewItem] = useState({ categoryId: "", name: "", priceMinor: "" });
  const [settingsDraft, setSettingsDraft] = useState({
    cafeName: "",
    taxRateBps: "",
    serviceChargeBps: "",
    currency: "",
    roundingEnabled: "true",
    upiId: "",
  });

  const createUser = useMutation({
    mutationFn: () => api.post("/staff/admin/users", newUser),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setNewUser({ email: "", password: "", name: "", role: "WAITER" });
    },
  });

  const toggleUser = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.patch(`/staff/admin/users/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const createCategory = useMutation({
    mutationFn: () => api.post("/staff/admin/menu/categories", { name: newCategory.name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-menu-full"] });
      setNewCategory({ name: "" });
    },
  });

  const toggleCategory = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.patch(`/staff/admin/menu/categories/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-menu-full"] }),
  });

  const createItem = useMutation({
    mutationFn: () =>
      api.post("/staff/admin/menu/items", {
        categoryId: newItem.categoryId,
        name: newItem.name,
        priceMinor: Number(newItem.priceMinor),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-menu-full"] });
      setNewItem({ categoryId: newItem.categoryId, name: "", priceMinor: "" });
    },
  });

  const updateItem = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.patch(`/staff/admin/menu/items/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-menu-full"] }),
  });

  const saveSettings = useMutation({
    mutationFn: () =>
      api.patch("/staff/admin/settings", {
        cafeName: settingsDraft.cafeName || undefined,
        taxRateBps: settingsDraft.taxRateBps ? Number(settingsDraft.taxRateBps) : undefined,
        serviceChargeBps: settingsDraft.serviceChargeBps ? Number(settingsDraft.serviceChargeBps) : undefined,
        currency: settingsDraft.currency || undefined,
        roundingEnabled: settingsDraft.roundingEnabled === "true",
        upiId: settingsDraft.upiId === "" ? null : settingsDraft.upiId || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
      queryClient.invalidateQueries({ queryKey: ["menu"] });
    },
  });

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header + tab bar stick together so the tab bar can't slide under the
          header on narrow screens. */}
      <div className="sticky top-0 z-20 print:hidden">
        <header className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-bold">Admin</div>
            <div className="text-xs opacity-70">{user?.name}</div>
          </div>
          <button className="btn btn-ghost !text-white !border-white/30 text-sm" onClick={() => { logout(); location.href = "/login"; }}>Exit</button>
        </header>

        <nav className="flex gap-2 overflow-x-auto bg-white border-b px-3 py-2">
          {TABS.map((t) => (
            <button
              key={t}
              className={`chip whitespace-nowrap ${tab === t ? "!bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      <main className="p-3">
        {tab === "Tables & QR" && <TablesQrPanel />}

        {tab === "Staff" && (
          <div className="space-y-4">
            <div className="card p-3 space-y-2">
              <div className="font-semibold">Add staff</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input className="input" placeholder="Name" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} />
                <input className="input" placeholder="Email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
                <input className="input" placeholder="Password" type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
                <select className="input" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                  <option value="WAITER">Waiter</option>
                  <option value="KITCHEN">Kitchen</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
              <button className="btn btn-primary" onClick={() => createUser.mutate()} disabled={createUser.isPending}>Create staff</button>
            </div>
            <div className="card divide-y">
              {users?.users.map((u) => (
                <div key={u.id} className="p-3 flex justify-between items-center">
                  <div>
                    <div className="font-semibold">{u.name}</div>
                    <div className="text-sm text-slate-500">
                      {u.email} · {u.role}
                    </div>
                  </div>
                  <button
                    className={`btn text-xs ${u.isActive ? "btn-ghost" : "btn-primary"}`}
                    disabled={toggleUser.isPending || u.id === user?.id}
                    onClick={() => toggleUser.mutate({ id: u.id, isActive: !u.isActive })}
                  >
                    {u.isActive ? "Deactivate" : "Activate"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "Menu" && (
          <div className="space-y-4">
            <div className="card p-3 space-y-2">
              <div className="font-semibold">Add category</div>
              <div className="flex gap-2">
                <input className="input flex-1" placeholder="Category name" value={newCategory.name} onChange={(e) => setNewCategory({ name: e.target.value })} />
                <button className="btn btn-primary" onClick={() => createCategory.mutate()} disabled={createCategory.isPending || !newCategory.name}>
                  Add category
                </button>
              </div>
            </div>
            <div className="card p-3 space-y-2">
              <div className="font-semibold">Add menu item</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <select className="input" value={newItem.categoryId} onChange={(e) => setNewItem({ ...newItem, categoryId: e.target.value })}>
                  <option value="">Select category…</option>
                  {menu?.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input className="input" placeholder="Name" value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} />
                <input className="input" placeholder="Price (paise)" value={newItem.priceMinor} onChange={(e) => setNewItem({ ...newItem, priceMinor: e.target.value })} />
              </div>
              <button className="btn btn-primary" onClick={() => createItem.mutate()} disabled={createItem.isPending || !newItem.categoryId || !newItem.name}>
                Add item
              </button>
            </div>
            {menu?.categories.map((c) => (
              <div key={c.id} className="card p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    {!c.isActive && <div className="text-xs text-slate-500">Inactive</div>}
                  </div>
                  <button className="btn btn-ghost text-xs" onClick={() => toggleCategory.mutate({ id: c.id, isActive: !c.isActive })}>
                    {c.isActive ? "Hide category" : "Show category"}
                  </button>
                </div>
                <div className="divide-y">
                  {c.items.map((item) => (
                    <div key={item.id} className="py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-slate-500">{formatMoney(item.priceMinor)}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="btn btn-ghost text-xs"
                          onClick={() => updateItem.mutate({ id: item.id, data: { priceMinor: item.priceMinor + 100 } })}
                        >
                          +₹1
                        </button>
                        <button
                          className="btn btn-ghost text-xs"
                          onClick={() => updateItem.mutate({ id: item.id, data: { priceMinor: Math.max(1, item.priceMinor - 100) } })}
                        >
                          -₹1
                        </button>
                        <button
                          className={`btn text-xs ${item.isAvailable ? "btn-ghost" : "btn-primary"}`}
                          onClick={() => updateItem.mutate({ id: item.id, data: { isAvailable: !item.isAvailable } })}
                        >
                          {item.isAvailable ? "86 this item" : "Make available"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "Audit" && (
          <div className="card divide-y">
            {audit?.logs.map((l) => (
              <div key={l.id} className="p-3 flex justify-between items-center text-sm">
                <div>
                  <div className="font-semibold">{l.action}</div>
                  <div className="text-slate-500">{l.entityType}</div>
                </div>
                <div className="text-xs text-slate-400">{new Date(l.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}

        {tab === "Settings" && (
          <div className="card p-3 space-y-2">
            <div className="font-semibold">Café settings</div>
            <div className="text-sm text-slate-600">
              Currency: {settings?.settings.currency} · Tax: {(settings?.settings.taxRateBps ?? 0) / 100}% · Service: {(settings?.settings.serviceChargeBps ?? 0) / 100}%
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="input" placeholder="Café name" defaultValue={settings?.settings.cafeName} onChange={(e) => setSettingsDraft({ ...settingsDraft, cafeName: e.target.value })} />
              <input className="input" placeholder="Currency (e.g. INR)" defaultValue={settings?.settings.currency} onChange={(e) => setSettingsDraft({ ...settingsDraft, currency: e.target.value })} />
              <input className="input" placeholder="Tax (bps)" defaultValue={settings?.settings.taxRateBps} onChange={(e) => setSettingsDraft({ ...settingsDraft, taxRateBps: e.target.value })} />
              <input className="input" placeholder="Service charge (bps)" defaultValue={settings?.settings.serviceChargeBps} onChange={(e) => setSettingsDraft({ ...settingsDraft, serviceChargeBps: e.target.value })} />
              <input className="input" placeholder="UPI ID (e.g. cafe@upi)" defaultValue={settings?.settings.upiId ?? ""} onChange={(e) => setSettingsDraft({ ...settingsDraft, upiId: e.target.value })} />
              <select
                className="input"
                defaultValue={settings?.settings.roundingEnabled ? "true" : "false"}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, roundingEnabled: e.target.value })}
              >
                <option value="true">Rounding enabled</option>
                <option value="false">Rounding disabled</option>
              </select>
            </div>
            <button className="btn btn-primary" onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
              Save settings
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
