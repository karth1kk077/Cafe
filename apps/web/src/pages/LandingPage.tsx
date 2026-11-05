import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

const STEPS = [
  { title: "Scan", copy: "Point your camera at the QR code on your table." },
  { title: "Choose", copy: "Build your order from the menu — no app to install." },
  { title: "Relax", copy: "Follow every dish from the kitchen to your table." },
];

export function LandingPage() {
  const navigate = useNavigate();
  const [tableCode, setTableCode] = useState("");

  function openTable(event: FormEvent) {
    event.preventDefault();
    const code = tableCode.trim();
    if (code) navigate(`/t/${encodeURIComponent(code)}`);
  }

  return (
    <div className="flex min-h-screen flex-col bg-cream">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 pt-5">
        <div>
          <div className="display text-xl font-semibold">Smart Café</div>
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted">At your table</div>
        </div>
        <Link to="/login" className="btn btn-ghost !min-h-10 text-sm">
          Staff sign in
        </Link>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        <div className="card overflow-hidden">
          <div className="bg-espresso px-6 py-8 text-white">
            <div aria-hidden className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-terracotta text-2xl">
              ☕
            </div>
            <h1 className="display text-3xl font-semibold leading-tight">Scan. Order. Enjoy.</h1>
            <p className="mt-2 text-sm leading-relaxed text-white/75">
              Order from your phone and we’ll bring it to your table. No download, no waiting in line.
            </p>
          </div>

          <ol className="divide-y divide-line px-6">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-3 py-4">
                <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cream text-sm font-bold">
                  {index + 1}
                </span>
                <div>
                  <div className="font-semibold">{step.title}</div>
                  <p className="mt-0.5 text-sm leading-snug text-muted">{step.copy}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="border-t border-line px-6 py-5">
            <p className="text-center text-sm text-muted">Look for the QR code stand on your table.</p>
          </div>
        </div>

        <details className="mt-4 rounded-card border border-line bg-surface px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold text-muted">Have a table code?</summary>
          <form onSubmit={openTable} className="mt-3 flex gap-2">
            <input
              className="input flex-1"
              value={tableCode}
              onChange={(event) => setTableCode(event.target.value)}
              placeholder="Enter table code"
              aria-label="Table code"
            />
            <button type="submit" className="btn btn-primary" disabled={!tableCode.trim()}>
              Open
            </button>
          </form>
        </details>
      </main>

      <footer className="pb-safe px-4 py-5 text-center text-xs text-muted">
        Prices and taxes are calculated by the café. Please ask a team member about allergies.
      </footer>
    </div>
  );
}
