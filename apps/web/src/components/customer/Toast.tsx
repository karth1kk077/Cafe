import { useEffect } from "react";
import { AlertIcon, CheckCircleIcon, InfoIcon } from "../ui/Icon";

export type ToastTone = "success" | "error" | "info";

export interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
}

const TONE_STYLE: Record<ToastTone, string> = {
  success: "bg-forest text-white",
  error: "bg-danger text-white",
  info: "bg-espresso text-white",
};

const TONE_ICON = {
  success: CheckCircleIcon,
  error: AlertIcon,
  info: InfoIcon,
} as const;

/**
 * Single transient message, rendered above the cart bar / bottom actions.
 * Announced politely so screen readers hear order and bill updates.
 */
export function Toast({
  toast,
  onDismiss,
  className = "",
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
  className?: string;
}) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onDismiss, 3600);
    return () => window.clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;
  const ToneIcon = TONE_ICON[toast.tone];

  return (
    <div
      key={toast.id}
      role="status"
      aria-live="polite"
      className={`fixed inset-x-4 z-50 mx-auto flex max-w-sm items-center gap-2.5 rounded-control px-4 py-3 text-sm font-semibold shadow-lift animate-rise ${TONE_STYLE[toast.tone]} ${className}`}
    >
      <ToneIcon size={18} className="shrink-0" />
      <span>{toast.text}</span>
    </div>
  );
}
