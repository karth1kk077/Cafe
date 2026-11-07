import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatMoney } from "../lib/api";
import { useAuth } from "../lib/auth";
import { TablesQrPanel } from "../components/TablesQrPanel";
import {
  ClipboardIcon,
  LogOutIcon,
  MenuBookIcon,
  PlusIcon,
  QrCodeIcon,
  SettingsIcon,
  UsersIcon,
} from "../components/ui/Icon";

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

/** One glyph per tab, so the rail scans without reading every word. */
function TabGlyph({ tab }: { tab: (typeof TABS)[number] }) {
  switch (tab) {
    case "Staff":
      return <UsersIcon size={15} />;
    case "Tables & QR":
      return <QrCodeIcon size={15} />;
    case "Menu":
      return <MenuBookIcon size={15} />;
    case "Audit":
      return <ClipboardIcon size={15} />;
    case "Settings":
      return <SettingsIcon size={15} />;
  }
}

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
    <div className="min-h-screen bg-cream">
      {/* Header + tab bar stick together so the tab bar can't slide under the
          header on narrow screens. */}
      <div className="sticky top-0 z-20 print:hidden">
        <header className="topbar px-4 pb-3 pt-safe">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="brand-mark brand-mark-sm">
                <SettingsIcon size={18} />
              </span>
              <div className="min-w-0">
                <div className="display truncate text-lg font-bold leading-tight">Admin</div>
                <div className="truncate text-xs text-white/60">{user?.name}</div>
              </div>
            </div>
            <button
              className="btn btn-ghost btn-icon !min-h-10 !border-white/20 !bg-white/10 !text-white"
              aria-label="Exit admin"
              onClick={() => { logout(); location.href = "/login"; }}
            >
              <LogOutIcon size={17} />
            </button>
          </div>
        </header>

        <nav className="border-b border-line bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-3 py-2">
            {TABS.map((t) => (
              <button
                key={t}
                aria-pressed={tab === t}
                className={`chip shrink-0 whitespace-nowrap ${tab === t ? "!bg-espresso text-white shadow-sm" : "bg-cream text-espresso"}`}
                onClick={() => setTab(t)}
              >
                <TabGlyph tab={t} />
                {t}
              </button>
            ))}
          </div>
        </nav>
      </div>

      <main className="mx-auto max-w-5xl px-4 py-5">
        {tab === "Tables & QR" && <TablesQrPanel />}

        {tab === "Staff" && (
          <div className="space-y-5">
            <section className="card p-4">
              <h2 className="font-semibold">Add staff</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <input
                  className="input"
                  aria-label="Name"
                  placeholder="Name"
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                />
                <input
                  className="input"
                  aria-label="Email"
                  placeholder="Email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                />
                <input
                  className="input"
                  aria-label="Password"
                  placeholder="Password"
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                />
                <select
                  className="input"
                  aria-label="Role"
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                >
                  <option value="WAITER">Waiter</option>
                  <option value="KITCHEN">Kitchen</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
              <button
                className="btn btn-primary mt-3"
                onClick={() => createUser.mutate()}
                disabled={createUser.isPending}
              >
                <PlusIcon size={15} />
                Create staff
              </button>
            </section>

            <section className="space-y-2">
              <h2 className="section-label">
                <UsersIcon size={14} />
                <span>Team</span>
              </h2>
              <div className="card divide-y divide-line overflow-hidden">
                {users?.users.map((u) => (
                  <div key={u.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className="display flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cream-deep text-sm font-bold text-espresso"
                        aria-hidden="true"
                      >
                        {u.name.trim().charAt(0).toUpperCase() || "?"}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{u.name}</div>
                        <div className="truncate text-sm text-muted">
                          {u.email} · {u.role}
                        </div>
                      </div>
                    </div>
                    <button
                      className={`btn btn-sm shrink-0 text-xs ${u.isActive ? "btn-ghost" : "btn-primary"}`}
                      disabled={toggleUser.isPending || u.id === user?.id}
                      onClick={() => toggleUser.mutate({ id: u.id, isActive: !u.isActive })}
                    >
                      {u.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                ))}
                {users && users.users.length === 0 && (
                  <div className="p-4 text-sm text-muted">No staff accounts yet.</div>
                )}
              </div>
            </section>
          </div>
        )}

        {tab === "Menu" && (
          <div className="space-y-5">
            <section className="card p-4">
              <h2 className="font-semibold">Add category</h2>
              <div className="mt-3 flex gap-2">
                <input
                  className="input flex-1"
                  aria-label="Category name"
                  placeholder="Category name"
                  value={newCategory.name}
                  onChange={(e) => setNewCategory({ name: e.target.value })}
                />
                <button
                  className="btn btn-primary shrink-0"
                  onClick={() => createCategory.mutate()}
                  disabled={createCategory.isPending || !newCategory.name}
                >
                  Add category
                </button>
              </div>
            </section>

            <section className="card p-4">
              <h2 className="font-semibold">Add menu item</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <select
                  className="input"
                  aria-label="Item category"
                  value={newItem.categoryId}
                  onChange={(e) => setNewItem({ ...newItem, categoryId: e.target.value })}
                >
                  <option value="">Select category…</option>
                  {menu?.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  aria-label="Item name"
                  placeholder="Name"
                  value={newItem.name}
                  onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                />
                <input
                  className="input"
                  aria-label="Price in paise"
                  placeholder="Price (paise)"
                  value={newItem.priceMinor}
                  onChange={(e) => setNewItem({ ...newItem, priceMinor: e.target.value })}
                />
              </div>
              <button
                className="btn btn-primary mt-3"
                onClick={() => createItem.mutate()}
                disabled={createItem.isPending || !newItem.categoryId || !newItem.name}
              >
                <PlusIcon size={15} />
                Add item
              </button>
            </section>

            <section className="space-y-2">
              <h2 className="section-label">
                <MenuBookIcon size={14} />
                <span>Menu</span>
              </h2>
              <div className="space-y-3">
                {menu?.categories.map((c) => (
                  <div key={c.id} className="card p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{c.name}</div>
                        {!c.isActive && <div className="text-xs text-muted">Inactive</div>}
                      </div>
                      <button
                        className="btn btn-ghost btn-sm shrink-0 text-xs"
                        onClick={() => toggleCategory.mutate({ id: c.id, isActive: !c.isActive })}
                      >
                        {c.isActive ? "Hide category" : "Show category"}
                      </button>
                    </div>
                    <div className="mt-2 divide-y divide-line">
                      {c.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{item.name}</div>
                            <div className="num text-xs text-muted">{formatMoney(item.priceMinor)}</div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              className="btn btn-ghost btn-sm text-xs"
                              aria-label={`Increase price of ${item.name} by one rupee`}
                              onClick={() => updateItem.mutate({ id: item.id, data: { priceMinor: item.priceMinor + 100 } })}
                            >
                              +₹1
                            </button>
                            <button
                              className="btn btn-ghost btn-sm text-xs"
                              aria-label={`Decrease price of ${item.name} by one rupee`}
                              onClick={() => updateItem.mutate({ id: item.id, data: { priceMinor: Math.max(1, item.priceMinor - 100) } })}
                            >
                              -₹1
                            </button>
                            <button
                              className={`btn btn-sm text-xs ${item.isAvailable ? "btn-ghost" : "btn-primary"}`}
                              onClick={() => updateItem.mutate({ id: item.id, data: { isAvailable: !item.isAvailable } })}
                            >
                              {item.isAvailable ? "86 this item" : "Make available"}
                            </button>
                          </div>
                        </div>
                      ))}
                      {c.items.length === 0 && <div className="py-2 text-sm text-muted">No items in this category yet.</div>}
                    </div>
                  </div>
                ))}
                {menu && menu.categories.length === 0 && (
                  <div className="card p-4 text-sm text-muted">No categories yet.</div>
                )}
              </div>
            </section>
          </div>
        )}

        {tab === "Audit" && (
          <section className="space-y-2">
            <h2 className="section-label">
              <ClipboardIcon size={14} />
              <span>Audit log</span>
            </h2>
            <div className="card divide-y divide-line overflow-hidden">
              {audit?.logs.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{l.action}</div>
                    <div className="truncate text-muted">{l.entityType}</div>
                  </div>
                  <div className="num shrink-0 text-xs text-muted">{new Date(l.createdAt).toLocaleString()}</div>
                </div>
              ))}
              {audit && audit.logs.length === 0 && (
                <div className="p-4 text-sm text-muted">No activity recorded yet.</div>
              )}
            </div>
          </section>
        )}

        {tab === "Settings" && (
          <section className="card p-4">
            <h2 className="font-semibold">Café settings</h2>
            <p className="mt-0.5 text-sm text-muted">
              Currency: {settings?.settings.currency} · Tax: {(settings?.settings.taxRateBps ?? 0) / 100}% · Service: {(settings?.settings.serviceChargeBps ?? 0) / 100}%
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input
                className="input"
                aria-label="Café name"
                placeholder="Café name"
                defaultValue={settings?.settings.cafeName}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, cafeName: e.target.value })}
              />
              <input
                className="input"
                aria-label="Currency"
                placeholder="Currency (e.g. INR)"
                defaultValue={settings?.settings.currency}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, currency: e.target.value })}
              />
              <input
                className="input"
                aria-label="Tax in basis points"
                placeholder="Tax (bps)"
                defaultValue={settings?.settings.taxRateBps}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, taxRateBps: e.target.value })}
              />
              <input
                className="input"
                aria-label="Service charge in basis points"
                placeholder="Service charge (bps)"
                defaultValue={settings?.settings.serviceChargeBps}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, serviceChargeBps: e.target.value })}
              />
              <input
                className="input"
                aria-label="UPI ID"
                placeholder="UPI ID (e.g. cafe@upi)"
                defaultValue={settings?.settings.upiId ?? ""}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, upiId: e.target.value })}
              />
              <select
                className="input"
                aria-label="Rounding"
                defaultValue={settings?.settings.roundingEnabled ? "true" : "false"}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, roundingEnabled: e.target.value })}
              >
                <option value="true">Rounding enabled</option>
                <option value="false">Rounding disabled</option>
              </select>
            </div>
            <button className="btn btn-primary mt-3" onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
              Save settings
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
