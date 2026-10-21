import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { api } from "../lib/api";

/** Row shape returned by GET /api/staff/admin/tables. */
interface AdminTable {
  id: string;
  number: string;
  seats: number;
  status: string;
  isActive: boolean;
  qrToken: string;
  qrUrl: string;
  createdAt: string;
  updatedAt: string;
  activeSession: { id: string; status: string; openedAt: string } | null;
}

const INSTRUCTION = "Scan to open this table's ordering page.";
/** High contrast dark modules on white: quiet zone of 4 modules, per QR print guidance. */
const QR_COLOR = { dark: "#0f172a", light: "#ffffff" };

function errText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function renderQrPng(url: string): Promise<string> {
  return QRCode.toDataURL(url, { width: 1024, margin: 4, color: QR_COLOR });
}

function saveFile(href: string, filename: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadSvg(url: string, filename: string) {
  return QRCode.toString(url, { type: "svg", margin: 4, color: QR_COLOR }).then((svg) => {
    const href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    saveFile(href, filename);
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  });
}

function fileNameFor(table: AdminTable, ext: string): string {
  return `table-${table.number.replace(/[^a-z0-9]+/gi, "-")}.${ext}`;
}

/** Print-only sheet: café branding, big table label, and a crisp scan-ready QR. */
function PrintSheet({
  table,
  cafeName,
  onDone,
}: {
  table: AdminTable;
  cafeName?: string;
  onDone: () => void;
}) {
  const [png, setPng] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    renderQrPng(table.qrUrl)
      .then((value) => {
        if (!cancelled) setPng(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [table.qrUrl]);

  // Only open the print dialog once the QR image has settled, so the sheet
  // never prints blank. onDone is intentionally not a dependency: this must
  // run exactly once per print request, not on every parent re-render.
  useEffect(() => {
    if (png || failed) {
      window.print();
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [png, failed]);

  return (
    <div className="hidden print:block text-center text-black p-10">
      {cafeName ? <div className="text-sm uppercase tracking-widest">{cafeName}</div> : null}
      <div className="text-4xl font-bold mt-2">Table {table.number}</div>
      {png ? (
        <img
          src={png}
          alt={`QR code for table ${table.number}`}
          width={340}
          height={340}
          className="mx-auto my-6"
        />
      ) : (
        <div className="my-6 text-sm">{failed ? table.qrUrl : "Rendering QR code…"}</div>
      )}
      <div className="text-sm">{INSTRUCTION}</div>
      <div className="text-xs break-all mt-1">{table.qrUrl}</div>
    </div>
  );
}

export function TablesQrPanel() {
  const queryClient = useQueryClient();

  const [error, setError] = useState("");
  const [draft, setDraft] = useState({ number: "", seats: "4" });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ number: "", seats: "" });
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [printId, setPrintId] = useState<string | null>(null);
  const [qrPng, setQrPng] = useState("");
  const [qrError, setQrError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const tablesQuery = useQuery<{ tables: AdminTable[] }>({
    queryKey: ["admin-tables"],
    queryFn: () => api.get("/staff/admin/tables"),
  });
  // Same key as the Settings tab, so React Query dedupes the call.
  const settingsQuery = useQuery<{ settings: { cafeName: string } }>({
    queryKey: ["admin-settings"],
    queryFn: () => api.get("/staff/admin/settings"),
  });

  const tables = tablesQuery.data?.tables ?? [];
  // Derived from the list so a refetch (edit, rotate) updates open panels too.
  const preview = previewId ? (tables.find((t) => t.id === previewId) ?? null) : null;
  const printTable = printId ? (tables.find((t) => t.id === printId) ?? null) : null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-tables"] });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tables.filter((t) => {
      const matchesQuery = !q || t.number.toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === "all" || (statusFilter === "active" ? t.isActive : !t.isActive);
      return matchesQuery && matchesStatus;
    });
  }, [tables, search, statusFilter]);

  const createTable = useMutation({
    mutationFn: () =>
      api.post<{ table: AdminTable }>("/staff/tables", {
        number: draft.number.trim(),
        seats: draft.seats ? Number(draft.seats) : undefined,
      }),
    onSuccess: (data) => {
      setDraft({ number: "", seats: "4" });
      setError("");
      refresh();
      // Jump straight to the QR preview, matching the plan's create -> preview flow.
      setPreviewId(data.table.id);
    },
    onError: (e) => setError(errText(e, "Could not create the table.")),
  });

  const updateTable = useMutation({
    mutationFn: (vars: { id: string; body: Record<string, unknown> }) =>
      api.patch<{ table: AdminTable }>(`/staff/tables/${vars.id}`, vars.body),
    onSuccess: () => {
      setEditId(null);
      setError("");
      refresh();
    },
    onError: (e) => setError(errText(e, "Could not save the table.")),
  });

  // Render the QR preview whenever the selected table (or its token) changes.
  useEffect(() => {
    let cancelled = false;
    if (!preview) {
      setQrPng("");
      setQrError("");
      return;
    }
    renderQrPng(preview.qrUrl)
      .then((value) => {
        if (!cancelled) setQrPng(value);
      })
      .catch((e) => {
        if (!cancelled) setQrError(errText(e, "Could not render the QR code."));
      });
    return () => {
      cancelled = true;
    };
  }, [preview?.qrUrl]);

  async function copyLink(table: AdminTable) {
    try {
      await navigator.clipboard.writeText(table.qrUrl);
      setCopiedId(table.id);
      setTimeout(() => setCopiedId((current) => (current === table.id ? null : current)), 1500);
    } catch {
      setError("Could not copy the link automatically — select the URL and copy it manually.");
    }
  }

  function toggleActive(table: AdminTable) {
    const next = !table.isActive;
    const confirmed = window.confirm(
      next
        ? `Reactivate table ${table.number}? Its QR code will start resolving again.`
        : `Deactivate table ${table.number}? Its QR code will stop resolving until you reactivate it.`
    );
    if (confirmed) updateTable.mutate({ id: table.id, body: { isActive: next } });
  }

  function rotateQr(table: AdminTable) {
    const confirmed = window.confirm(
      `Rotate the QR code for table ${table.number}?\n\nThe current printed QR code will stop working immediately and the table stand must be reprinted.`
    );
    if (confirmed) updateTable.mutate({ id: table.id, body: { rotateQr: true } });
  }

  return (
    <>
      <div className="print:hidden space-y-4">
        {error && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">
            <span>{error}</span>
            <button
              className="shrink-0 self-start rounded-md p-2 font-bold"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              ✕
            </button>
          </div>
        )}

        {/* Add table */}
        <div className="card p-3 space-y-2">
          <div className="font-semibold">Add table</div>
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              className="input"
              placeholder="Table number (e.g. 4 or Patio2)"
              aria-label="Table number"
              value={draft.number}
              onChange={(e) => setDraft({ ...draft, number: e.target.value })}
            />
            <input
              className="input"
              type="number"
              min={1}
              max={50}
              placeholder="Seats"
              aria-label="Seats"
              value={draft.seats}
              onChange={(e) => setDraft({ ...draft, seats: e.target.value })}
            />
            <button
              className="btn btn-primary"
              disabled={createTable.isPending}
              onClick={() => createTable.mutate()}
            >
              {createTable.isPending ? "Adding…" : "Add table"}
            </button>
          </div>
          <div className="text-xs text-slate-500">
            Each table gets its own permanent QR link. Duplicating an existing table number is
            rejected.
          </div>
        </div>

        {/* Search + filter */}
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className="input max-w-xs"
            placeholder="Search table number…"
            aria-label="Search tables"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input max-w-40"
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All tables</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {tablesQuery.isPending && (
          <div className="card p-4 text-sm text-slate-500">Loading tables…</div>
        )}

        {tablesQuery.isError && (
          <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-red-700">
              {errText(tablesQuery.error, "Could not load tables.")}
            </span>
            <button className="btn btn-ghost" onClick={() => tablesQuery.refetch()}>
              Retry
            </button>
          </div>
        )}

        {!tablesQuery.isPending && !tablesQuery.isError && tables.length === 0 && (
          <div className="card p-6 text-center space-y-2">
            <div className="font-semibold">No tables yet</div>
            <div className="text-sm text-slate-500">
              Add your first table above to generate its QR code.
            </div>
          </div>
        )}

        {tables.length > 0 && (
          <div className="card divide-y">
            {filtered.map((t) => (
              <div key={t.id}>
                <div className="p-3 flex flex-wrap gap-3 justify-between items-center">
                  <div className="min-w-0">
                    <div className="font-semibold flex flex-wrap items-center gap-2">
                      Table {t.number}
                      <span className="badge bg-slate-100 text-slate-700">{t.status}</span>
                      <span
                        className={
                          t.isActive
                            ? "badge bg-emerald-100 text-emerald-700"
                            : "badge bg-slate-200 text-slate-500"
                        }
                      >
                        {t.isActive ? "Active" : "Inactive"}
                      </span>
                      {t.activeSession && (
                        <span className="badge bg-amber-100 text-amber-800">
                          Session {t.activeSession.status.replace("_", " ")}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {t.seats} seats · QR ready · updated{" "}
                      {new Date(t.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setError("");
                        setPreviewId(previewId === t.id ? null : t.id);
                      }}
                    >
                      {previewId === t.id ? "Hide QR" : "View QR"}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => copyLink(t)}>
                      {copiedId === t.id ? "Copied!" : "Copy link"}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setError("");
                        setEditId(editId === t.id ? null : t.id);
                        setEditDraft({ number: t.number, seats: String(t.seats) });
                      }}
                    >
                      Edit
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(t)}>
                      {t.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </div>

                {editId === t.id && (
                  <div className="p-3 pt-0">
                    <div className="rounded-xl bg-slate-50 border p-3 grid gap-2 sm:grid-cols-3">
                      <input
                        className="input"
                        placeholder="Table number"
                        aria-label={`New number for table ${t.number}`}
                        value={editDraft.number}
                        onChange={(e) => setEditDraft({ ...editDraft, number: e.target.value })}
                      />
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={50}
                        placeholder="Seats"
                        aria-label={`New seat count for table ${t.number}`}
                        value={editDraft.seats}
                        onChange={(e) => setEditDraft({ ...editDraft, seats: e.target.value })}
                      />
                      <div className="flex gap-2">
                        <button
                          className="btn btn-primary btn-sm flex-1"
                          disabled={updateTable.isPending}
                          onClick={() =>
                            updateTable.mutate({
                              id: t.id,
                              body: {
                                number: editDraft.number.trim(),
                                seats: editDraft.seats ? Number(editDraft.seats) : undefined,
                              },
                            })
                          }
                        >
                          Save
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="p-4 text-sm text-slate-500">No tables match your search.</div>
            )}
          </div>
        )}

        {/* QR preview */}
        {preview && (
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold">QR code · Table {preview.number}</div>
              <button
                className="btn btn-ghost btn-sm"
                aria-label="Close QR preview"
                onClick={() => setPreviewId(null)}
              >
                ✕
              </button>
            </div>
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <div className="rounded-xl border bg-white p-3 self-start shrink-0">
                {qrPng ? (
                  <img
                    src={qrPng}
                    alt={`QR code for table ${preview.number}`}
                    className="w-48 h-48"
                  />
                ) : (
                  <div className="w-48 h-48 flex items-center justify-center text-sm text-slate-400 text-center px-3">
                    {qrError || "Rendering…"}
                  </div>
                )}
              </div>
              <div className="space-y-2 text-sm min-w-0">
                <div className="text-2xl font-bold">Table {preview.number}</div>
                <div className="text-slate-500">
                  {preview.seats} seats · {preview.isActive ? "Active" : "Inactive"} ·{" "}
                  {preview.status}
                </div>
                <div className="font-mono text-xs break-all bg-slate-100 rounded-lg p-2">
                  {preview.qrUrl}
                </div>
                <div className="text-slate-600">{INSTRUCTION}</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() =>
                      renderQrPng(preview.qrUrl)
                        .then((href) => saveFile(href, fileNameFor(preview, "png")))
                        .catch((e) => setError(errText(e, "Could not build the PNG.")))
                    }
                  >
                    Download PNG
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      downloadSvg(preview.qrUrl, fileNameFor(preview, "svg")).catch((e) =>
                        setError(errText(e, "Could not build the SVG."))
                      )
                    }
                  >
                    Download SVG
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => copyLink(preview)}>
                    {copiedId === preview.id ? "Copied!" : "Copy link"}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setPrintId(preview.id)}>
                    Print
                  </button>
                  <button className="btn btn-ghost btn-sm text-red-600" onClick={() => rotateQr(preview)}>
                    Rotate QR
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {printTable && (
        <PrintSheet
          table={printTable}
          cafeName={settingsQuery.data?.settings.cafeName}
          onDone={() => setPrintId(null)}
        />
      )}
    </>
  );
}
