/**
 * Best-effort haptics. iOS Safari ignores `vibrate`, and a few browsers throw
 * when the API is gated, so this must never be able to break a tap handler.
 */
export function haptic(pattern: number | number[] = 12): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    /* unsupported or blocked */
  }
}

/** A slightly stronger confirmation for "your order reached the kitchen". */
export const HAPTIC_SUCCESS = [18, 40, 18];
