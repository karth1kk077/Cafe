import type { SessionOrdersResponse } from "../../lib/api";
import { CheckIcon } from "../ui/Icon";

type TrackedOrder = SessionOrdersResponse["orders"][number];

const STEPS = ["Ordered", "Preparing", "Ready", "Served"] as const;

function stageFor(order: TrackedOrder): number {
  const active = order.items.filter((item) => item.status !== "CANCELLED");
  if (!active.length) return -1;
  if (order.status === "COMPLETED" || active.every((item) => item.status === "SERVED")) return 3;
  if (active.every((item) => item.status === "READY" || item.status === "SERVED")) return 2;
  if (
    order.status === "IN_PROGRESS" ||
    order.status === "PARTIALLY_READY" ||
    order.status === "READY" ||
    active.some((item) => item.status === "PREPARING" || item.status === "READY")
  ) {
    return 1;
  }
  return 0;
}

/**
 * Four-stop progress rail. Each stop is complete behind the current stage,
 * filled at the current stage, and quiet ahead of it. The current stage is also
 * written out, so colour is never the only signal.
 */
export function OrderProgress({ order }: { order: TrackedOrder }) {
  const stage = stageFor(order);
  if (stage === -1) {
    return <div className="rounded-control bg-cream px-3 py-2 text-sm text-muted">This order was cancelled.</div>;
  }

  const currentLabel = STEPS[stage];

  return (
    <div className="pt-1">
      <div className="flex items-center" aria-hidden>
        {STEPS.map((step, index) => {
          const complete = index < stage || (index === stage && stage === 3);
          const current = index === stage && stage !== 3;
          return (
            <div key={step} className={`flex items-center ${index === STEPS.length - 1 ? "" : "flex-1"}`}>
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold transition-colors duration-300 ${
                  complete
                    ? "border-forest bg-forest text-white"
                    : current
                      ? "border-terracotta bg-terracotta text-white shadow-[0_0_0_3px_rgb(194_65_12/0.14)]"
                      : "border-line-strong bg-surface text-muted"
                }`}
              >
                {complete ? <CheckIcon size={12} strokeWidth={2.2} /> : index + 1}
              </span>
              {index < STEPS.length - 1 && (
                <span
                  className={`mx-1 h-0.5 flex-1 rounded-full transition-colors duration-300 ${
                    index < stage ? "bg-forest" : "bg-line"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] font-medium text-muted">
        {STEPS.map((step, index) => (
          <span key={step} className={index === stage ? "font-bold text-espresso" : ""}>
            {step}
          </span>
        ))}
      </div>
      <p className="sr-only" role="status">
        Current status: {currentLabel}
      </p>
    </div>
  );
}
