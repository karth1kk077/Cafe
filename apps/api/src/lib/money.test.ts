import { describe, it, expect } from "vitest";
import { rupeesToMinor, minorToRupees, applyBps, computeRounding, sumMinor, formatMoney } from "../lib/money.js";

describe("money (integer minor units)", () => {
  it("converts rupees to minor without float drift", () => {
    expect(rupeesToMinor(18)).toBe(1800);
    expect(rupeesToMinor("199.99")).toBe(19999);
    expect(rupeesToMinor(0.1)).toBe(10);
    // 1.005 would be 100 or 101 with floats; rounding half-up gives 101 (0.1*1000 style safe)
    expect(rupeesToMinor("10.5")).toBe(1050);
  });

  it("round-trips minor <-> rupees", () => {
    expect(minorToRupees(1800)).toBe(18);
    expect(minorToRupees(19999)).toBe(199.99);
  });

  it("applies basis-point tax with integer rounding", () => {
    // 5% of 50000 = 2500
    expect(applyBps(50000, 500)).toBe(2500);
    // 5% of 12345 = 617.25 -> 617
    expect(applyBps(12345, 500)).toBe(617);
    // 0 bps = 0
    expect(applyBps(12345, 0)).toBe(0);
    // 100% = full
    expect(applyBps(9999, 10000)).toBe(9999);
  });

  it("rounds to nearest rupee only when enabled", () => {
    // 1050 -> 1100 (delta +50)
    expect(computeRounding(1050, true)).toBe(50);
    // 1049 -> 1000 (delta -49)
    expect(computeRounding(1049, true)).toBe(-49);
    // disabled -> 0
    expect(computeRounding(1050, false)).toBe(0);
    // exact multiple -> 0
    expect(computeRounding(1100, true)).toBe(0);
  });

  it("sums minor values exactly", () => {
    expect(sumMinor([1800, 4000, 3000])).toBe(8800);
    expect(sumMinor([])).toBe(0);
  });

  it("formats currency", () => {
    expect(formatMoney(52500)).toContain("525.00");
  });

  it("rejects non-finite input", () => {
    expect(() => rupeesToMinor(Number.NaN)).toThrow();
    expect(() => rupeesToMinor("abc")).toThrow();
  });
});
