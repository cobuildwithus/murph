import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientUnits } from "../../companion/client-info";
import { encodePolyline } from "../../game/progress/route-geometry";
import { previewRecordedCandidate, resolveRecordedSelection } from "../card-options";
import { buildRecordedCards } from "./recorded";
import type { RecordedActivity } from "./types";

// Two disjoint lines on a synthetic grid in open ocean.
const paths = [
  encodePolyline([[-140, 0.001], [-139.999, 0.001], [-139.999, 0.002]]),
  encodePolyline([[-139.997, 0.002], [-139.996, 0.002]]),
];
const route = {
  distanceM: 2500, climbM: 18, paths,
  splits: [{ distanceM: 1000, seconds: 375 }, { distanceM: 1000, seconds: 350 }, { distanceM: 500, seconds: 175 }],
};
const run = {
  id: "74df7cc7-554c-4793-9a00-773a1f701d3c", kind: "run",
  startedAt: "2037-03-12T08:23:00Z", elapsedSec: 1060, movingSec: 900, route,
} satisfies RecordedActivity;
const context = { day: "2037-03-12", hour: 8, units: "metric" } as const;

function cards(activity: RecordedActivity = run, units: ClientUnits = "metric") {
  return buildRecordedCards(activity, { ...context, units }).candidates.map(previewRecordedCandidate);
}

describe("recorded route cards", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the moving clock for the headline and keeps separate path segments", () => {
    const [map, splits] = cards();
    expect(map).toMatchObject({
      kind: "activity_route", candidateId: `activity:${run.id}:activity_route`,
      title: { number: "2.5 km", measure: "run" }, subtitle: "in 15:00, 6:00 a km",
      source_note: "Recorded on Mar 12, morning",
      chart: { type: "route_map", paths, chips: ["2.5 km", "6:00 /km"], stats: [
        { label: "Distance", value: "2.5", unit: "km" },
        { label: "Pace", value: "6:00", unit: "/km" },
        { label: "Time", value: "15:00" },
        { label: "Climb", value: "18", unit: "m" },
      ] },
    });
    expect(splits).toMatchObject({
      kind: "activity_splits", title: map.title, subtitle: "fastest km 5:50",
      chart: {
        type: "splits", unit: "km", fastest: 1, splits: [
          { label: "Km 1", seconds: 375, text: "6:15" },
          { label: "Km 2", seconds: 350, text: "5:50" },
          { label: "0.5 km", seconds: 175, text: "2:55", partial: true },
        ],
      },
    });
    expect(JSON.stringify([map, splits])).not.toContain("08:23");
  });

  it("only gives the opaque art key to a published selection, including one with hidden numbers", () => {
    const { candidates } = buildRecordedCards(run, context);
    const preview = previewRecordedCandidate(candidates[0]);
    expect(JSON.stringify(preview)).not.toContain("area:v2:");
    for (const option of preview.change_options.filter(item => item.id !== "hide_map")) {
      const frozen = resolveRecordedSelection(candidates, {
        candidateId: preview.candidateId, option: option.id, specRevision: option.specRevision,
      });
      const displayed = option.id === "original" ? preview : option.spec;
      expect(frozen?.spec.chart).toEqual({ ...displayed?.chart, art: { key: expect.stringMatching(/^area:v2:[\w-]{43}$/u) } });
    }
  });

  it("retains the native map on publication when the privacy key is missing", () => {
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", "");
    const { candidates } = buildRecordedCards(run, context);
    const preview = previewRecordedCandidate(candidates[0]);
    const frozen = resolveRecordedSelection(candidates, {
      candidateId: preview.candidateId, option: "original", specRevision: preview.specRevision,
    });
    expect(frozen?.spec.chart).toMatchObject({ paths, frame: expect.any(Object) });
    expect(frozen?.spec.chart).not.toHaveProperty("art");
  });

  it("keeps the splits and drops the map when trimming left no path", () => {
    for (const [name, measure] of [[undefined, "run"], ["Trail jog", "trail jog"]] as const) {
      const trimmed = cards({ ...run, name, route: { ...route, paths: [] } });
      expect(trimmed.map(card => card.kind)).toEqual(["activity_splits"]);
      expect(trimmed[0]).toMatchObject({ subtitle: "fastest km 5:50", title: { number: "2.5 km", measure } });
    }
  });

  it.each(["us", "uk"] as const)("presents distance and pace in %s units while preserving the recorded splits", units => {
    const [metricMap, metricSplits] = cards();
    const [map, splits] = cards(run, units);
    expect(map).toMatchObject({
      title: { number: "1.55 mi", measure: "run" }, subtitle: "in 15:00, 9:39 a mile",
      chart: { chips: ["1.55 mi", "9:39 /mi"], stats: [
        { label: "Distance", value: "1.55", unit: "mi" },
        { label: "Pace", value: "9:39", unit: "/mi" },
        { label: "Time", value: "15:00" },
        { label: "Climb", value: units === "us" ? "59" : "18", unit: units === "us" ? "ft" : "m" },
      ] },
    });
    expect(map.specRevision).not.toBe(metricMap.specRevision);
    if (splits.chart.type !== "splits" || metricSplits.chart.type !== "splits") throw new Error("Expected splits");
    expect(splits.chart).toMatchObject({ unit: "km", fastest: 1, splits: metricSplits.chart.splits });
    expect(splits.chart.line).toContain(units === "us" ? "59 ft up" : "18 m up");
    expect(splits.chart.line).toContain("9:39 a mile");
    expect(splits.subtitle).toBe(metricSplits.subtitle);
  });

  it.each([0, 0.4])("omits a climb of %s metres and leaves heart rate to its own card", climbM => {
    const result = cards({ ...run, elapsedSec: 4000, movingSec: 3725,
      route: { ...route, climbM, distanceM: 5000, splits: Array.from({ length: 5 }, () => ({ distanceM: 1000, seconds: 745 })) },
      heartRate: { lowBpm: 95, avgBpm: 127, peakBpm: 152 },
    });
    expect(result.map(card => card.kind)).toEqual(["activity_route", "activity_splits"]);
    expect(result[0].chart).toMatchObject({ stats: [
      { label: "Distance", value: "5", unit: "km" },
      { label: "Pace", value: "12:25", unit: "/km" },
      { label: "Time", value: "1:02:05" },
    ] });
    expect(JSON.stringify(result[0])).not.toMatch(/bpm|\b127\b/u);
  });

  it("recognizes mile splits on a metric client and ignores a partial and later ties for fastest", () => {
    const mile = 1609.344;
    const [map, splits] = cards({ ...run, movingSec: 990, route: {
      ...route, distanceM: mile * 2.25,
      splits: [{ distanceM: mile, seconds: 440 }, { distanceM: mile, seconds: 440 }, { distanceM: mile / 4, seconds: 110 }],
    } });
    expect(map.title.number).toBe("3.62 km");
    expect(splits).toMatchObject({
      subtitle: "fastest mile 7:20",
      chart: { unit: "mi", fastest: 0, splits: [
        { label: "Mile 1" }, { label: "Mile 2" }, { label: "0.25 mi", partial: true },
      ] },
    });
  });

  it("shows moving time and pace when just one split is full", () => {
    const [, splits] = cards({ ...run, movingSec: 510, route: {
      ...route, distanceM: 1500, splits: [{ distanceM: 1000, seconds: 360 }, { distanceM: 500, seconds: 150 }],
    } });
    expect(splits).toMatchObject({ subtitle: "in 8:30, 5:40 a km", chart: { fastest: null } });
  });

  it("makes no fastest full-split claim for a short walk", () => {
    const activity = { ...run, kind: "walk" as const, movingSec: 270, route: {
      ...route, distanceM: 500, splits: [{ distanceM: 500, seconds: 270 }],
    } };
    const [map, splits] = cards(activity);
    expect(map.title).toEqual({ number: "0.5 km", measure: "walk" });
    expect(splits.chart).toMatchObject({ fastest: null, splits: [{ seconds: 270, partial: true }] });
    expect(splits.subtitle).not.toContain("fastest");
    const morning = buildRecordedCards(activity, context);
    const after = buildRecordedCards(activity, { ...context, previous: { kind: "sauna" } });
    expect(morning.suggestedTitle).toBe("Morning walk");
    expect(after.suggestedTitle).toBe("Walk after your sauna");
    expect(after.candidates).toEqual(morning.candidates);
  });

  it("keeps only the map when its numbers are hidden and discloses no values on the hidden splits and heart rate", () => {
    const activity = { ...run, name: "Trail jog", heartRate: {
      avgBpm: 111, lowBpm: 101, peakBpm: 139, perMinute: Array.from({ length: 15 }, () => 111),
    } };
    const visible = cards(activity);
    expect(visible.map(card => card.kind)).toEqual(["activity_route", "activity_splits", "activity_heart_rate"]);
    expect(visible.map(card => card.title.measure)).toEqual(["trail jog", "trail jog", "trail jog"]);
    expect(visible[0].chart).toMatchObject({ stats: [
      { label: "Distance" }, { label: "Pace" }, { label: "Time" }, { label: "Climb" },
    ] });
    // Heart rate lives only on its own card, so hiding or leaving out that card keeps it off the post.
    for (const card of visible.slice(0, 2)) expect(JSON.stringify(card)).not.toMatch(/bpm|111/u);
    const [map, splits, hr] = visible.map(card => card.change_options.find(option => option.id === "hide_numbers")?.spec);
    const original = visible[0].chart;
    if (original.type !== "route_map") throw new Error("Expected route");
    expect(map?.chart).toStrictEqual({ type: "route_map", paths, frame: original.frame });
    for (const spec of [map, splits, hr]) {
      expect(spec?.title).toEqual({ number: "", measure: "Went for a run" });
      expect(spec?.subtitle).toBe("Shared without numbers.");
    }
    expect(splits?.chart).toEqual({ type: "hidden" });
    expect(hr?.chart).toEqual({ type: "hidden" });
  });

  it("omits the whole map on selection and checks the chosen option's final-spec revision", () => {
    const { candidates } = buildRecordedCards(run, context);
    const [map, splits] = candidates.map(previewRecordedCandidate);
    const option = map.change_options.find(item => item.id === "hide_map")!;
    expect(option).toEqual({
      id: "hide_map", label: "Hide the map", spec: null, specRevision: createHash("sha256").update("null").digest("hex"),
    });
    expect(splits.change_options.map(item => item.id)).not.toContain("hide_map");
    const hide = { candidateId: map.candidateId, option: option.id, specRevision: option.specRevision };
    const keep = { candidateId: splits.candidateId, option: "original", specRevision: splits.specRevision };
    expect(resolveRecordedSelection(candidates, hide)).toBeNull();
    expect(resolveRecordedSelection(candidates, keep)?.spec.chart.type).toBe("splits");
    expect(() => resolveRecordedSelection(candidates, { ...hide, specRevision: map.specRevision })).toThrow();
    const shifted = buildRecordedCards({ ...run, route: { ...route, paths: [paths[1]] } }, context).candidates;
    expect(shifted).not.toEqual(candidates);
    expect(resolveRecordedSelection(shifted, hide)).toBeNull();
    expect(resolveRecordedSelection(shifted, keep)).toEqual(resolveRecordedSelection(candidates, keep));
    expect(() => resolveRecordedSelection(shifted, {
      candidateId: map.candidateId, option: "original", specRevision: map.specRevision,
    })).toThrow();
    expect(buildRecordedCards(run, context).candidates).toEqual(candidates);
  });
});
