import assert from "node:assert/strict";

import { test } from "vitest";

import { resolveMetric } from "../src/wearables/selection.ts";
import type { WearableMetricCandidate } from "../src/wearables/types.ts";

const date = "2026-05-03";

function steps(
  source: string,
  sourceType: string,
  value: number,
  overrides: { recordedAt?: string; stream?: "activity" | "steps" } = {},
): WearableMetricCandidate {
  const stream = overrides.stream ?? "activity";
  const candidateId = `junction:${source}:${stream}`;
  return {
    candidateId,
    dataOrigin: { version: 1, aggregatorProvider: "junction", sourceProviderSlug: source, sourceType },
    date,
    externalRef: {
      facet: "daily-steps",
      resourceId: `${source}-${stream}`,
      resourceType: `junction-${source}-${stream}`,
      system: "junction",
      version: null,
    },
    metric: "steps",
    occurredAt: `${date}T00:00:00.000Z`,
    paths: [`/virtual/${candidateId}.jsonl`],
    provider: "junction",
    recordedAt: overrides.recordedAt ?? `${date}T20:00:00.000Z`,
    recordIds: [candidateId],
    sourceFamily: "event",
    sourceKind: "observation",
    title: null,
    unit: "count",
    value,
  };
}

const appleHealth = (value: number, recordedAt?: string) =>
  steps("apple-health-kit", "multiple_sources", value, { recordedAt });
const selected = (...candidates: WearableMetricCandidate[]) =>
  resolveMetric("steps", candidates, { metricFamily: "activity" }).selection.value;

test("a worn device's daily total replaces a merged total that counted it twice", () => {
  assert.equal(selected(appleHealth(15_000, `${date}T23:00:00.000Z`), steps("whoop-v2", "watch", 10_000)), 10_000);
});

test("a worn device's daily total replaces a merged total that missed steps", () => {
  assert.equal(selected(appleHealth(9_000, `${date}T23:00:00.000Z`), steps("garmin", "watch", 10_000)), 10_000);
});

test("the device's daily total wins over its own higher intraday stream", () => {
  assert.equal(selected(
    appleHealth(9_000),
    steps("garmin", "watch", 10_000),
    steps("garmin", "watch", 11_000, { stream: "steps" }),
  ), 10_000);
});

test("the highest worn device wins when two report", () => {
  assert.equal(selected(appleHealth(12_000), steps("whoop-v2", "watch", 8_000), steps("oura", "ring", 10_000)), 10_000);
});

test("a device counting at least half of the merged total was worn", () => {
  assert.equal(selected(appleHealth(10_000), steps("garmin", "watch", 5_000)), 5_000);
});

test("the merged total stands when the device came off or reported nothing", () => {
  assert.equal(selected(appleHealth(10_000), steps("garmin", "watch", 4_999)), 10_000);
  assert.equal(selected(appleHealth(10_000), steps("whoop-v2", "watch", 0)), 10_000);
});

test("an off device does not win on recency when it has no direct integration", () => {
  assert.equal(selected(appleHealth(10_000), steps("fitbit", "watch", 4_000, { recordedAt: `${date}T23:00:00.000Z` })), 10_000);
});

test("a retained direct row does not cancel a worn device's preference over the merged total", () => {
  const direct: WearableMetricCandidate = {
    ...steps("garmin", "watch", 10_000),
    candidateId: "garmin:direct",
    dataOrigin: null,
    externalRef: { facet: null, resourceId: "direct", resourceType: "daily_activity", system: "garmin", version: null },
    provider: "garmin",
  };
  assert.equal(selected(appleHealth(15_000), steps("garmin", "watch", 10_000), direct), 10_000);
});

test("stored source types keep their normalized spelling", () => {
  assert.equal(selected(steps("apple-health-kit", "multiple-sources", 15_000), steps("garmin", "watch", 10_000)), 10_000);
});

test("a device's intraday stream alone does not replace the merged total", () => {
  assert.equal(selected(appleHealth(10_000), steps("garmin", "watch", 12_000, { stream: "steps" })), 10_000);
});

test("without a worn device the daily total is chosen as before", () => {
  assert.equal(selected(appleHealth(10_000), steps("apple-health-kit", "multiple_sources", 2_000, { stream: "steps" })), 10_000);
});

test("every candidate stays on the resolved metric so raw rows are still suppressed", () => {
  const candidates = [appleHealth(15_000), steps("whoop-v2", "watch", 10_000)];
  const resolved = resolveMetric("steps", candidates, { metricFamily: "activity" });
  assert.equal(resolved.candidates.length, candidates.length);
  assert.equal(resolved.candidates[0]?.value, 10_000);
});
