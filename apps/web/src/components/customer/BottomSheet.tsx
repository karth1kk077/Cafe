import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

const HISTORY_FLAG = "cafeSheet";

/**
 * Mobile bottom sheet with the accessibility and navigation behaviour a phone
 * user expects:
 *  - Android/iOS back closes the sheet instead of leaving the menu
 *  - Escape closes it, Tab is trapped inside, focus is restored on close
 *  - background scroll is locked while it is open
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // One history entry per sheet makes hardware/browser back a "close".
    window.history.pushState({ ...(window.history.state ?? {}), [HISTORY_FLAG]: true }, "");

    let active = true;
    const onPop = () => {
      if (!active) return;
      active = false;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);

    const focusTimer = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      (first ?? panelRef.current)?.focus();
    }, 40);

    return () => {
      active = false;
      window.clearTimeout(focusTimer);
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
      // Programmatic close (button, Escape, order placed): drop our history
      // entry too, so the next Back does not appear to do nothing.
      if (window.history.state?.[HISTORY_FLAG]) window.history.back();
    };
  }, [open]);

  if (!open) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCloseRef.current();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusables = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-espresso/50 animate-fade"
        onClick={() => onCloseRef.current()}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="relative w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-sheet sm:rounded-sheet bg-surface shadow-lift animate-rise outline-none"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
          <h2 id={titleId} className="display text-lg font-semibold">
            {title}
          </h2>
          <button className="btn btn-ghost !min-h-10 !px-3" aria-label="Close" onClick={() => onCloseRef.current()}>
            ✕
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer && (
          <div className="sticky bottom-0 border-t border-line bg-surface px-4 py-3 pb-safe">{footer}</div>
        )}
      </div>
    </div>
  );
}
