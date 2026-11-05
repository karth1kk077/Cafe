import { useEffect, useMemo, useRef, useState } from "react";
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
/** Espresso modules on white: high contrast, quiet zone of 4 modules, level M. */
const QR_COLOR = { dark: "#2b1d14", light: "#ffffff" };
const QR_OPTIONS = { margin: 4, color: QR_COLOR, errorCorrectionLevel: "M" as const };
/** A4 portrait fits six cards comfortably (two columns, three rows). */
const QR_PER_PAGE = 6;

function errText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function renderQrPng(url: string, width = 1024): Promise<string> {
  return QRCode.toDataURL(url, { ...QR_OPTIONS, width });
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
  return QRCode.toString(url, { ...QR_OPTIONS, type: "svg" }).then((svg) => {
    const href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    saveFile(href, filename);
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  });
}

function fileNameFor(table: AdminTable, ext: string): string {
  return `table-${table.number.replace(/[^a-z0-9]+/gi, "-")}.${ext}`;
}

function isLocalhostHost(host: string): boolean {
  const value = host.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    value === "localhost" ||
    value === "127.0.0.1" ||
    value === "::1" ||
    value.endsWith(".localhost")
  );
}

/** True when a printed QR points at a host phones cannot reach (or an http origin). */
function isInsecureQrUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || isLocalhostHost(parsed.hostname);
  } catch {
    return false;
  }
}

function isLocalhostQrUrl(value: string): boolean {
  try {
    return isLocalhostHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

function originOf(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
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
  const printed = useRef(false);

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
    if ((png || failed) && !printed.current) {
      printed.current = true;
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

/** Print-only A4 sheet: all selected tables, six cards per page. */
function PrintAllSheet({
  tables,
  cafeName,
  onDone,
}: {
  tables: AdminTable[];
  cafeName?: string;
  onDone: () => void;
}) {
  const [pngs, setPngs] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const printed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      tables.map(async (table) => {
        try {
          return [table.id, await renderQrPng(table.qrUrl)] as const;
        } catch {
          return [table.id, ""] as const;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setPngs(Object.fromEntries(entries));
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [tables]);

  // Wait for every image, then open the print dialog exactly once.
  useEffect(() => {
    if (ready && !printed.current) {
      printed.current = true;
      window.print();
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const pages = chunk(tables, QR_PER_PAGE);

  return (
    <div className="hidden print:block">
      {pages.map((page, pageIndex) => (
        <section
          key={pageIndex}
          style={{
            breakAfter: pageIndex < pages.length - 1 ? "page" : "auto",
            pageBreakAfter: pageIndex < pages.length - 1 ? "always" : "auto",
          }}
        >
          {cafeName ? (
            <div
              style={{
                textAlign: "center",
                fontSize: "10pt",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                marginBottom: "4mm",
              }}
            >
              {cafeName}
            </div>
          ) : null}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4mm" }}>
            {page.map((table) => (
              <div
                key={table.id}
                style={{
                  border: "1px solid #dccbb9",
                  borderRadius: "4mm",
                  padding: "3mm",
                  textAlign: "center",
                  breakInside: "avoid",
                  pageBreakInside: "avoid",
                }}
              >
                <div
                  style={{
                    fontSize: "8pt",
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: "#7a6a5d",
                  }}
                >
                  Table {table.number}
                </div>
                <div style={{ fontSize: "18pt", fontWeight: 700, lineHeight: 1.1, marginTop: "1mm" }}>
                  Scan to order
                </div>
                {pngs[table.id] ? (
                  <img
                    src={pngs[table.id]}
                    alt={`QR code for table ${table.number}`}
                    style={{
                      width: "50mm",
                      height: "50mm",
                      margin: "2mm auto",
                      display: "block",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: "50mm",
                      height: "50mm",
                      margin: "2mm auto",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "9pt",
                      color: "#7a6a5d",
                    }}
                  >
                    {ready ? "QR unavailable" : "Rendering QR…"}
                  </div>
                )}
                <div style={{ fontSize: "9pt", lineHeight: 1.35 }}>{INSTRUCTION}</div>
                <div
                  style={{
                    fontSize: "6.5pt",
                    color: "#7a6a5d",
                    wordBreak: "break-all",
                    marginTop: "1mm",
                  }}
                >
                  {table.qrUrl}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
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
  const [printAllIds, setPrintAllIds] = useState<string[] | null>(null);
  const [qrPng, setQrPng] = useState("");
  const [qrError, setQrError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);

  const tablesQuery = useQuery<{ tables: AdminTable[] }>({
    queryKey: ["admin-tables"],
    queryFn: () => api.get("/staff/admin/tables"),
  });
  // Same key as the Settings tab, so React Query dedupes the call.
  const settingsQuery = useQuery<{ settings: { cafeName: string } }>({
    queryKey: ["admin-settings"],
    queryFn: () => api.get("/staff/admin/settings"),
  });

  const tables = useMemo(() => tablesQuery.data?.tables ?? [], [tablesQuery.data]);
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

  // Only active tables have working QR codes; printing an inactive code would
  // hand customers a dead link. The current search/status filter still applies.
  const printable = useMemo(() => filtered.filter((t) => t.isActive), [filtered]);
  const printAllTables = useMemo(() => {
    if (!printAllIds) return [];
    const byId = new Map(tables.map((t) => [t.id, t]));
    return printAllIds
      .map((id) => byId.get(id))
      .filter((table): table is AdminTable => Boolean(table));
  }, [printAllIds, tables]);

  // QR URLs come from the API (PUBLIC_APP_BASE_URL), so inspect them rather
  // than assuming the admin browser's host matches what the code encodes.
  // In dev the API falls back to WEB_ORIGIN, so this catches localhost links.
  const insecureTable = useMemo(
    () => tables.find((table) => isInsecureQrUrl(table.qrUrl)) ?? null,
    [tables]
  );
  const showLinkWarning = !warningDismissed && Boolean(insecureTable);
  const warningOrigin = insecureTable ? originOf(insecureTable.qrUrl) : "";
  const warningIsLocalhost = insecureTable ? isLocalhostQrUrl(insecureTable.qrUrl) : false;

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
    onSuccess: async (data, vars) => {
      setEditId(null);
      setError("");
      // Wait for the rotated token to land in the cache before opening print,
      // otherwise the dialog could print the previous (now dead) QR code.
      await refresh();
      if (vars.body.rotateQr) {
        setPreviewId(data.table.id);
        setPrintAllIds(null);
        setPrintId(data.table.id);
      }
    },
    onError: (e) => setError(errText(e, "Could not save the table.")),
  });

  // Render the QR preview whenever the selected table (or its token) changes.
  const previewQrUrl = preview?.qrUrl ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!previewQrUrl) return;
    renderQrPng(previewQrUrl)
      .then((value) => {
        if (!cancelled) {
          setQrPng(value);
          setQrError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setQrError(errText(e, "Could not render the QR code."));
      });
    return () => {
      cancelled = true;
    };
  }, [previewQrUrl]);

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
      `Rotate the QR code for table ${table.number}?\n\nThe code currently on the table stand stops working immediately. After rotating, print the new code and replace the stand.`
    );
    if (confirmed) updateTable.mutate({ id: table.id, body: { rotateQr: true } });
  }

  function startPrint(table: AdminTable) {
    setPrintAllIds(null);
    setPrintId(table.id);
  }

  function startPrintAll() {
    if (printable.length === 0) return;
    setPrintId(null);
    setPrintAllIds(printable.map((table) => table.id));
  }

  return (
    <>
      <div className="print:hidden space-y-4">
        {error && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-danger-soft text-danger px-3 py-2 text-sm">
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

        {showLinkWarning && (
          <div className="flex items-start justify-between gap-3 rounded-lg bg-amber-soft text-amber-ink px-3 py-2 text-sm">
            <div>
              <div className="font-semibold">Check the QR link before printing</div>
              <p className="mt-0.5">
                {warningIsLocalhost
                  ? `These codes point to ${warningOrigin}. Phones on your Wi-Fi cannot open a localhost link — set PUBLIC_APP_BASE_URL to your LAN address or public HTTPS URL, then reload.`
                  : `These codes use ${warningOrigin}. Some phone cameras and browsers warn about insecure http links — use an HTTPS public address before printing.`}
              </p>
            </div>
            <button
              className="shrink-0 self-start rounded-md p-2 font-bold"
              aria-label="Dismiss QR link warning"
              onClick={() => setWarningDismissed(true)}
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
          <div className="text-xs text-muted">
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
          <button
            className="btn btn-ghost btn-sm sm:ml-auto"
            disabled={printable.length === 0}
            onClick={startPrintAll}
          >
            Print active QR codes ({printable.length})
          </button>
        </div>
        <div className="text-xs text-muted">
          Print all lays out six codes per A4 page for the active tables in this view.
        </div>

        {tablesQuery.isPending && (
          <div className="card p-4 text-sm text-muted">Loading tables…</div>
        )}

        {tablesQuery.isError && (
          <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-danger">
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
            <div className="text-sm text-muted">
              Add your first table above to generate its QR code.
            </div>
          </div>
        )}

        {tables.length > 0 && (
          <div className="card divide-y divide-line">
            {filtered.map((t) => (
              <div key={t.id}>
                <div className="p-3 flex flex-wrap gap-3 justify-between items-center">
                  <div className="min-w-0">
                    <div className="font-semibold flex flex-wrap items-center gap-2">
                      Table {t.number}
                      <span className="badge bg-cream text-espresso">{t.status}</span>
                      <span
                        className={
                          t.isActive
                            ? "badge bg-forest-soft text-forest"
                            : "badge bg-cream text-muted"
                        }
                      >
                        {t.isActive ? "Active" : "Inactive"}
                      </span>
                      {t.activeSession && (
                        <span className="badge bg-amber-soft text-amber-ink">
                          Session {t.activeSession.status.replace("_", " ")}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted mt-1">
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
                    <a
                      className="btn btn-ghost btn-sm"
                      href={t.qrUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Test scan ↗
                    </a>
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
                    <div className="rounded-xl bg-cream border border-line p-3 grid gap-2 sm:grid-cols-3">
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
              <div className="p-4 text-sm text-muted">No tables match your search.</div>
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
              <div className="rounded-xl border border-line bg-white p-3 self-start shrink-0">
                {qrPng ? (
                  <img
                    src={qrPng}
                    alt={`QR code for table ${preview.number}`}
                    className="w-48 h-48"
                  />
                ) : (
                  <div className="w-48 h-48 flex items-center justify-center text-sm text-muted text-center px-3">
                    {qrError || "Rendering…"}
                  </div>
                )}
              </div>
              <div className="space-y-2 text-sm min-w-0">
                <div className="text-2xl font-bold">Table {preview.number}</div>
                <div className="text-muted">
                  {preview.seats} seats · {preview.isActive ? "Active" : "Inactive"} ·{" "}
                  {preview.status}
                </div>
                <div className="font-mono text-xs break-all bg-cream rounded-lg p-2">
                  {preview.qrUrl}
                </div>
                <div className="text-muted">{INSTRUCTION}</div>
                {isInsecureQrUrl(preview.qrUrl) && (
                  <div className="rounded-lg bg-amber-soft text-amber-ink px-2 py-1 text-xs">
                    This link may not open on a phone. Set PUBLIC_APP_BASE_URL to a public HTTPS
                    address before printing.
                  </div>
                )}
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
                  <a
                    className="btn btn-ghost btn-sm"
                    href={preview.qrUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Test scan ↗
                  </a>
                  <button className="btn btn-ghost btn-sm" onClick={() => startPrint(preview)}>
                    Print
                  </button>
                  <button
                    className="btn btn-ghost btn-sm text-danger"
                    onClick={() => rotateQr(preview)}
                  >
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

      {printAllTables.length > 0 && (
        <PrintAllSheet
          key={printAllIds?.join(",")}
          tables={printAllTables}
          cafeName={settingsQuery.data?.settings.cafeName}
          onDone={() => setPrintAllIds(null)}
        />
      )}
    </>
  );
}
