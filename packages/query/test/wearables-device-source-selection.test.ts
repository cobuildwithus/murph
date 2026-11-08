import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveMetric, resolveSleepWindowSelection } from "../src/wearables/selection.ts";
import type { WearableMetricCandidate, WearableSleepWindowCandidate } from "../src/wearables/types.ts";

const date = "2026-05-03";
function reading(source: string, sourceType: string, value: number, hour = "20"): WearableMetricCandidate {
  return {
    candidateId: source, date, metric: "restingHeartRate", value, unit: "bpm",
    provider: "junction", sourceFamily: "event", sourceKind: "observation:resting-heart-rate",
    occurredAt: `${date}T06:00:00Z`, recordedAt: `${date}T${hour}:00:00Z`, title: null,
    recordIds: [source], paths: [`ledger/events/${date}.jsonl`],
    dataOrigin: { version: 1, aggregatorProvider: "junction", sourceProviderSlug: source, sourceType },
    externalRef: { system: "junction", resourceType: `junction-${source}-activity`, resourceId: source,
      facet: "resting-heart-rate", version: null },
  };
}
const store = () => reading("apple-health-kit", "multiple_sources", 62, "23");
const device = () => reading("whoop-v2", "watch", 54, "07");

test("WHOOP wins over a newer Apple Health copy and retains losing candidates", () => {
  const result = resolveMetric("restingHeartRate", [store(), device()]);
  assert.equal(result.selection.value, 54);
  assert.deepEqual(result.selection.recordIds, ["whoop-v2"]);
  assert.equal(result.candidates.length, 2);
});

test("other worn devices also outrank merged stores, independently of arrival order", () => {
  for (const [source, type] of [["oura", "ring"], ["garmin", "watch"], ["fitbit", "watch"]]) {
    for (const reversed of [false, true]) {
      const candidates = [store(), reading(source!, type!, 55, "07")];
      const result = resolveMetric("restingHeartRate", reversed ? candidates.reverse() : candidates);
      assert.equal(result.selection.value, 55);
    }
  }
});

test("a retained direct WHOOP record needs no Junction source-type metadata", () => {
  const whoop = { ...device(), provider: "whoop", dataOrigin: null,
    externalRef: { ...device().externalRef!, system: "whoop", resourceType: "recovery" } };
  assert.equal(resolveMetric("restingHeartRate", [store(), whoop]).selection.value, 54);
});

test("Apple Health remains a fallback without a device reading for that day", () => {
  assert.equal(resolveMetric("restingHeartRate", [store()]).selection.value, 62);
  const priorDay = { ...device(), date: "2026-05-02" };
  assert.equal(resolveMetric("restingHeartRate", [store(), priorDay]).selection.value, 62);
});

test("sleep windows prefer the wearable's own full night over a health-store copy", () => {
  const window = (candidate: WearableMetricCandidate, durationMinutes: number): WearableSleepWindowCandidate => ({
    ...candidate, durationMinutes, nap: false, sleepType: "main_sleep", startAt: `${date}T00:00:00Z`,
    endAt: `${date}T08:00:00Z`,
  });
  const result = resolveSleepWindowSelection([window(store(), 495), window(device(), 465)]);
  assert.equal(result.selection?.durationMinutes, 465);
});
