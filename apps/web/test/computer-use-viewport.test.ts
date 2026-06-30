import { describe, expect, test } from "vitest";

import {
  isMateriallyDifferentComputerHandoffViewportSize,
  normalizeComputerHandoffViewportObservation,
  normalizeComputerHandoffViewportSize,
  toComputerBrowserViewport,
} from "@/src/lib/computer-use/viewport";

describe("normalizeComputerHandoffViewportSize", () => {
  test.each([
    [{ height: 725, width: 414 }, { height: 724, width: 416 }],
    [{ height: 1, width: 1 }, { height: 320, width: 320 }],
    [{ height: 10_000, width: 10_000 }, { height: 1200, width: 1920 }],
    [{ height: 722.2, width: 393.9 }, { height: 724, width: 392 }],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeComputerHandoffViewportSize(input)).toEqual(expected);
  });

  test.each([
    null,
    undefined,
    {},
    { height: 700 },
    { width: 400 },
    { height: 0, width: 400 },
    { height: 700, width: 0 },
    { height: Number.NaN, width: 400 },
    { height: 700, width: Infinity },
    { height: "700", width: 400 },
  ])("rejects invalid input %j", (input) => {
    expect(normalizeComputerHandoffViewportSize(input)).toBeNull();
  });
});

describe("normalizeComputerHandoffViewportObservation", () => {
  test("normalizes viewport size and observed time", () => {
    expect(normalizeComputerHandoffViewportObservation({
      height: 844,
      observedAt: "2026-06-29T12:00:00.000Z",
      width: 390,
    }, { now: new Date("2026-06-29T12:00:01.000Z") })).toEqual({
      height: 844,
      observedAt: new Date("2026-06-29T12:00:00.000Z"),
      width: 392,
    });
  });

  test.each([
    { height: 844, width: 390 },
    { height: 844, observedAt: "not-a-date", width: 390 },
    { height: 844, observedAt: 0, width: 390 },
    { height: 844, observedAt: "2026-06-29T12:00:06.001Z", width: 390 },
  ])("falls back to server time for unusable observation timestamps %j", (input) => {
    expect(
      normalizeComputerHandoffViewportObservation(input, {
        now: new Date("2026-06-29T12:00:01.000Z"),
      }),
    ).toEqual({
      height: 844,
      observedAt: new Date("2026-06-29T12:00:01.000Z"),
      width: 392,
    });
  });

  test("rejects invalid viewport dimensions", () => {
    expect(
      normalizeComputerHandoffViewportObservation({
        height: "844",
        observedAt: "2026-06-29T12:00:00.000Z",
        width: 390,
      }, {
        now: new Date("2026-06-29T12:00:01.000Z"),
      }),
    ).toBeNull();
  });
});

describe("toComputerBrowserViewport", () => {
  test.each([
    [{ height: 724, width: 392 }, { height: 724, refresh_rate: 60, width: 392 }],
    [{ height: 900, width: 1024 }, { height: 900, refresh_rate: 60, width: 1024 }],
    [{ height: 1080, width: 1440 }, { height: 1080, refresh_rate: 25, width: 1440 }],
  ] as const)("derives refresh rate for %j", (size, expected) => {
    expect(toComputerBrowserViewport(size)).toEqual(expected);
  });
});

describe("isMateriallyDifferentComputerHandoffViewportSize", () => {
  test("treats missing values as different", () => {
    expect(isMateriallyDifferentComputerHandoffViewportSize(null, { height: 700, width: 400 }))
      .toBe(true);
    expect(isMateriallyDifferentComputerHandoffViewportSize({ height: 700, width: 400 }, null))
      .toBe(true);
  });

  test("ignores minor viewport jitter", () => {
    expect(isMateriallyDifferentComputerHandoffViewportSize(
      { height: 700, width: 400 },
      { height: 715, width: 415 },
    )).toBe(false);
  });

  test("detects material differences", () => {
    expect(isMateriallyDifferentComputerHandoffViewportSize(
      { height: 700, width: 400 },
      { height: 716, width: 400 },
    )).toBe(true);
    expect(isMateriallyDifferentComputerHandoffViewportSize(
      { height: 700, width: 400 },
      { height: 700, width: 416 },
    )).toBe(true);
  });
});
