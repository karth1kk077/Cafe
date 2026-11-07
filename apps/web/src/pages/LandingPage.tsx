import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BrandCupIcon, CoffeeIcon, LogInIcon, ScanIcon, MenuBookIcon, ClockIcon } from "../components/ui/Icon";

const STEPS = [
  { title: "Scan", copy: "Point your camera at the QR code on your table.", icon: ScanIcon },
  { title: "Choose", copy: "Build your order from the menu — no app to install.", icon: MenuBookIcon },
  { title: "Relax", copy: "Follow every dish from the kitchen to your table.", icon: ClockIcon },
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
      <header className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-4 pt-safe">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="brand-mark">
            <BrandCupIcon size={22} />
          </span>
          <div className="min-w-0">
            <div className="display truncate text-xl font-semibold leading-tight">Smart Café</div>
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted">At your table</div>
          </div>
        </div>
        <Link to="/login" className="btn btn-ghost !min-h-10 shrink-0 px-3 text-sm">
          <LogInIcon size={16} />
          <span className="hidden min-[390px]:inline">Staff sign in</span>
        </Link>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <section className="hero-ink animate-rise overflow-hidden rounded-card shadow-lift">
          <div className="relative px-6 pb-7 pt-7">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="display text-[2.1rem] font-semibold leading-[1.04]">Scan. Order. Enjoy.</h1>
                <p className="mt-3 max-w-[17rem] text-sm leading-relaxed text-white/75">
                  Order from your phone and we’ll bring it to your table. No download, no waiting in line.
                </p>
              </div>
              <div className="relative mt-1 hidden shrink-0 sm:block" aria-hidden>
                <div className="grid h-24 w-24 place-items-center rounded-full border border-white/15 bg-white/[0.06] shadow-[inset_0_1px_0_rgb(255_255_255/0.14)]">
                  <BrandCupIcon size={48} className="text-white/90" />
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-2.5">
              <span aria-hidden className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.06]">
                <CoffeeIcon size={19} className="text-white/85" />
              </span>
              <div className="text-xs leading-snug text-white/65">
                No download · No waiting in line
              </div>
            </div>
          </div>
        </section>

        <ol className="mt-4 overflow-hidden rounded-card border border-line bg-surface px-5 shadow-soft">
          {STEPS.map((step, index) => {
            const StepIcon = step.icon;
            return (
              <li key={step.title} className="flex gap-3.5 py-4 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line">
                <span className="relative flex flex-col items-center">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-cream-deep text-espresso ring-1 ring-line">
                    <StepIcon size={16} />
                  </span>
                </span>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="num text-[0.66rem] font-bold tracking-[0.12em] text-terracotta">0{index + 1}</span>
                    <span className="font-semibold">{step.title}</span>
                  </div>
                  <p className="mt-0.5 text-sm leading-snug text-muted">{step.copy}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mt-4 rounded-card border border-line bg-surface px-4 py-3 text-sm shadow-soft">
          <p className="text-center text-sm text-muted">Look for the QR code stand on your table.</p>
        </div>

        <details className="group mt-3 rounded-card border border-line bg-surface px-4 py-3 text-sm shadow-soft">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold text-muted [&::-webkit-details-marker]:hidden">
            Have a table code?
            <span
              aria-hidden
              className="grid h-6 w-6 place-items-center rounded-full bg-cream-deep text-xs text-espresso transition-transform duration-200 group-open:rotate-45"
            >
              +
            </span>
          </summary>
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

      <footer className="pb-safe px-4 py-5 text-center text-xs leading-relaxed text-muted">
        Prices and taxes are calculated by the café. Please ask a team member about allergies.
      </footer>
    </div>
  );
}
