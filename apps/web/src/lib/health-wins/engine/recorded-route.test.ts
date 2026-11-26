import { describe, expect, it } from "vitest";
import { encodePolyline, type Coordinate } from "../../game/progress/route-geometry";
import { previewActivityBody, saveActivityBody, sealedActivitySummary } from "../request";
import { recordedActivitySummary, validateRecordedActivity } from "./recorded";
import type { RecordedActivity, RecordedRoute } from "./types";

// Synthetic east-west grid in the open ocean.
const path = (...offsets: number[]) => encodePolyline(offsets.map(offset => [-146 + offset, 0]));
const split = (distanceM: number, seconds = 60) => ({ distanceM, seconds });
const route: RecordedRoute = { distanceM: 1000, climbM: 0, splits: [split(1000)], paths: [path(0, 0.0004)] };
const run = {
  id: "42cb57bf-a1aa-468c-9b57-915cdaa3fa0c", kind: "run", startedAt: "2035-06-11T09:00:00Z",
  elapsedSec: 900, movingSec: 400, route,
} satisfies RecordedActivity;

function check(changes: Partial<RecordedRoute>, activity: Partial<Omit<RecordedActivity, "route">> = {}) {
  validateRecordedActivity({ ...run, ...activity, route: { ...route, ...changes } });
}

describe("recorded route admission", () => {
  it.each(["lift", "sauna", "other", "cold_plunge"] as const)("rejects a route on %s", kind => {
    expect(() => check({}, { kind })).toThrow("route summary");
  });

  it("accepts inclusive distance, climb and split count limits", () => {
    expect(() => check({ distanceM: 100_000, climbM: 3000, splits: Array.from({ length: 100 }, () => split(1000, 150)) },
      { movingSec: 15_000, elapsedSec: 15_000 })).not.toThrow();
    for (const distanceM of [0, -1, NaN, Infinity, 100_000.1]) {
      expect(() => check({ distanceM })).toThrow("route summary");
    }
    for (const climbM of [-0.1, NaN, Infinity, 3000.1]) {
      expect(() => check({ climbM })).toThrow("route summary");
    }
    expect(() => check({ splits: Array.from({ length: 101 }, () => split(1000)) })).toThrow("splits");
  });

  it.each([["run", 150, 1200], ["walk", 300, 2400]] as const)("uses moving time for both inclusive %s pace bounds", (kind, min, max) => {
    for (const movingSec of [min, max]) expect(() => check({}, { kind, movingSec, elapsedSec: 3000 })).not.toThrow();
    for (const movingSec of [min - 1, max + 1]) expect(() => check({}, { kind, movingSec, elapsedSec: 3000 })).toThrow("pace");
  });

  it("accepts metric and mile splits with only the last partial, including sub-unit recordings", () => {
    for (const distances of [[1000, 1000, 420], [1609.344, 1609.344, 1200], [400], [1400]]) {
      const distanceM = distances.reduce((sum, value) => sum + value, 0);
      const movingSec = Math.ceil(distanceM / 2);
      expect(() => check({ distanceM, splits: distances.map(d => split(d)) }, { movingSec, elapsedSec: movingSec })).not.toThrow();
    }
    for (const distances of [[], [400, 600], [1000, 1609.344], [1800], [0], [-50], [NaN], [Infinity]]) {
      expect(() => check({ splits: distances.map(d => split(d)) })).toThrow("splits");
    }
  });

  it("requires split distances within one percent and integer seconds within the one-second allowance", () => {
    expect(() => check({ splits: [split(990, 401)] })).not.toThrow();
    expect(() => check({ splits: [split(1010, 401)] })).not.toThrow();
    for (const distanceM of [989.9, 1010.1]) expect(() => check({ splits: [split(distanceM)] })).toThrow("splits");
    for (const seconds of [0, 1.5, 402, Infinity]) expect(() => check({ splits: [split(1000, seconds)] })).toThrow("splits");
  });

  it("includes both one-percent boundaries for a sequence of full miles", () => {
    const splits = Array.from({ length: 25 }, () => split(1609.344, 320));
    const timing = { movingSec: 8000, elapsedSec: 8100 };
    for (const fraction of [0.99, 1.01]) {
      const distanceM = 25 * 1609.344 / fraction;
      expect(() => check({ distanceM, splits }, timing)).not.toThrow();
    }
  });

  it("bounds the segment count and the total point count across segments", () => {
    const paths = Array<string>(8).fill(route.paths[0]);
    expect(() => check({ paths })).not.toThrow();
    for (const invalid of [[], [...paths, paths[0]]]) expect(() => check({ paths: invalid })).toThrow("paths");
    const repeated = (count: number) => path(...Array<number>(count).fill(0));
    expect(() => check({ paths: [repeated(750), repeated(250)] })).not.toThrow();
    expect(() => check({ paths: [repeated(750), repeated(251)] })).toThrow("paths");
  });

  it("requires complete canonical polylines on the four-decimal degree grid", () => {
    const offGrid = (point: Coordinate) => encodePolyline([[-146, 0], point]);
    expect(() => check({ paths: [path(0)] })).not.toThrow();
    for (const invalid of ["", route.paths[0] + "?", route.paths[0] + "_", route.paths[0] + "!!",
      offGrid([-146.00001, 0]), offGrid([-146, 0.00001]), offGrid([-181, 0]), offGrid([-146, 91])]) {
      expect(() => check({ paths: [invalid] })).toThrow("paths");
    }
  });

  it("bounds each path's decoded length including both rounding allowances", () => {
    expect(() => check({ paths: [path(0, 0.0045, 0), path(0, 0.0045, 0)] })).not.toThrow();
    expect(() => check({ paths: [path(0, 0.0046, 0)] })).toThrow("paths");
    const longer = { distanceM: 5000, splits: Array.from({ length: 5 }, () => split(1000)) };
    const timing = { movingSec: 2000, elapsedSec: 2000 };
    expect(() => check({ ...longer, paths: [path(0, 0.0227, 0)] }, timing)).not.toThrow();
    expect(() => check({ ...longer, paths: [path(0, 0.0228, 0)] }, timing)).toThrow("paths");
  });

  it("bounds the combined box diagonal with no length allowance", () => {
    expect(() => check({ paths: [path(0, 0.002), path(0.008, 0.0089)] })).not.toThrow();
    expect(() => check({ paths: [path(0, 0.002), path(0.008, 0.009)] })).toThrow("paths");
  });

  it("admits only summary fields for a private save and strips geometry before sealing", () => {
    const { distanceM, climbM, splits } = route;
    const saveInput = { ...run, route: { distanceM, climbM, splits } };
    const saved = recordedActivitySummary(run);
    expect(saved.route).toEqual({ distanceM, climbM, splitSec: [60] });
    expect(recordedActivitySummary(saveInput)).toEqual(saved);
    expect(sealedActivitySummary.safeParse(saved).success).toBe(true);
    expect(sealedActivitySummary.safeParse(saveInput).success).toBe(false);
    expect(saveActivityBody.safeParse({ activity: saveInput }).success).toBe(true);
    expect(saveActivityBody.safeParse({ activity: saved }).success).toBe(false);
    expect(saveActivityBody.safeParse({ activity: run }).success).toBe(false);
    expect(previewActivityBody.safeParse({ activity: saved }).success).toBe(false);
    expect(previewActivityBody.safeParse({ activity: run }).success).toBe(true);
    expect(() => validateRecordedActivity(saveInput)).not.toThrow();
  });
});
