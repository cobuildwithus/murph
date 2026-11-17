import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  listMetricPoints,
  rebuildQueryProjection,
  summarizeWearableActivityRuntime,
} from "../src/index.ts";
import { dropJunctionTimeseriesTotalsBesideActivitySummary } from "../src/wearables/candidates.ts";
import type { WearableMetricCandidate } from "../src/wearables/types.ts";

// A source's steps timeseries also yields a day total: one device's samples
// summed over a UTC day. It stands in for a day with no activity summary from
// that source; beside the summary it is a partial copy, not a second opinion.

const date = "2026-05-03";

function candidate(
  source: string,
  resource: string,
  value: number,
  overrides: Partial<WearableMetricCandidate> = {},
): WearableMetricCandidate {
  const candidateId = `junction:${source}:${resource}:${value}`;
  return {
    candidateId,
    dataOrigin: { version: 1, aggregatorProvider: "junction", sourceProviderSlug: source, sourceType: "watch" },
    date,
    externalRef: {
      facet: "daily-steps",
      resourceId: `${source}-${resource}-${value}`,
      resourceType: `junction-${source}-${resource}`,
      system: "junction",
      version: null,
    },
    metric: "steps",
    occurredAt: `${date}T00:00:00.000Z`,
    paths: [`/virtual/${candidateId}.jsonl`],
    provider: "junction",
    recordedAt: `${date}T20:00:00.000Z`,
    recordIds: [candidateId],
    sourceFamily: "event",
    sourceKind: "observation:daily-steps",
    title: null,
    unit: "count",
    value,
    ...overrides,
  };
}

const kept = (...candidates: WearableMetricCandidate[]) =>
  dropJunctionTimeseriesTotalsBesideActivitySummary(candidates).candidates.map((entry) => entry.value);

test("a source's timeseries day total is dropped beside its own activity summary", () => {
  assert.deepEqual(kept(
    candidate("apple-health-kit", "activity", 7_700),
    candidate("apple-health-kit", "steps", 4_100),
    candidate("apple-health-kit", "steps", 900),
  ), [7_700]);
});

test("a dropped total's raw record is named for metric-point suppression", () => {
  const watch = candidate("apple-health-kit", "steps", 4_100);
  const floors = candidate("apple-health-kit", "floors-climbed", 2, { metric: "floorsClimbed" });
  const { suppressionEvidence } = dropJunctionTimeseriesTotalsBesideActivitySummary([
    candidate("apple-health-kit", "activity", 7_700),
    candidate("apple-health-kit", "activity", 9, { metric: "floorsClimbed" }),
    watch,
    floors,
    candidate("whoop-v2", "steps", 3_000),
  ]);

  assert.deepEqual(suppressionEvidence, [
    { date, metricKey: "steps", recordIds: watch.recordIds },
    { date, metricKey: "floors-climbed", recordIds: floors.recordIds },
  ]);
});

test("the timeseries day total stands in when the source sent no activity summary", () => {
  assert.deepEqual(kept(candidate("apple-health-kit", "steps", 4_100)), [4_100]);
});

test("another source's activity summary does not remove it", () => {
  assert.deepEqual(kept(
    candidate("whoop-v2", "activity", 4_500),
    candidate("apple-health-kit", "steps", 4_100),
  ), [4_500, 4_100]);
});

test("a summary for another day or another metric does not remove it", () => {
  assert.deepEqual(kept(
    candidate("apple-health-kit", "activity", 7_700, { date: "2026-05-04" }),
    candidate("apple-health-kit", "activity", 3, { metric: "floorsClimbed" }),
    candidate("apple-health-kit", "steps", 4_100),
  ), [7_700, 3, 4_100]);
});

test("records that are not that source's steps, distance or floors timeseries stay", () => {
  assert.deepEqual(kept(
    candidate("apple-health-kit", "activity", 7_700),
    candidate("apple-health-kit", "workout-distance", 5),
    candidate("apple-health-kit", "sleep", 6),
    candidate("apple-health-kit", "steps", 7, { sourceFamily: "sample" }),
    candidate("apple-health-kit", "steps", 8, { dataOrigin: null }),
  ), [7_700, 5, 6, 7, 8]);
});

test("the stored projection keeps one steps candidate and one steps point when a source has both", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-junction-timeseries-total-"));
  const eventLedgerPath = path.join(vaultRoot, "ledger/events/2026/2026-05.jsonl");
  const fallbackDate = "2026-05-04";
  const record = (id: string, resource: string, sourceType: string, value: number, day = date) => ({
    schemaVersion: "murph.event.v1",
    id,
    kind: "observation",
    occurredAt: `${day}T22:00:00Z`,
    recordedAt: `${day}T22:05:00Z`,
    dayKey: day,
    source: "device",
    title: "Junction steps",
    metric: "daily-steps",
    observationGrain: "summary",
    value,
    unit: "count",
    externalRef: {
      system: "junction",
      resourceType: `junction-apple-health-kit-${resource}`,
      resourceId: `${resource}-${id}`,
      facet: "daily-steps",
    },
    dataOrigin: {
      version: 1,
      aggregatorProvider: "junction",
      sourceProviderSlug: "apple-health-kit",
      sourceType,
    },
  });

  try {
    await mkdir(path.dirname(eventLedgerPath), { recursive: true });
    await writeFile(eventLedgerPath, [
      record("evt_timeseries_total_summary", "activity", "multiple_sources", 7_700),
      record("evt_timeseries_total_watch", "steps", "watch", 4_100),
      record("evt_timeseries_total_phone", "steps", "phone", 900),
      // A day the source sent no activity summary for.
      record("evt_timeseries_total_fallback", "steps", "watch", 3_300, fallbackDate),
    ].map((entry) => JSON.stringify(entry)).join("\n").concat("\n"));
    await rebuildQueryProjection(vaultRoot);

    const [summary] = await summarizeWearableActivityRuntime(vaultRoot, { date });

    assert.equal(summary?.steps.selection.value, 7_700);
    assert.equal(summary?.steps.confidence.candidateCount, 1);

    // Goals and experiments aggregate metric points, so the partial totals
    // must not surface there as extra points for the day.
    const points = await listMetricPoints(vaultRoot, { metricKey: "steps" });
    const valuesOn = (day: string) => points
      .filter((point) => point.effectiveDate.slice(0, 10) === day)
      .map((point) => point.value);
    assert.deepEqual(valuesOn(date), [7_700]);
    assert.deepEqual(valuesOn(fallbackDate), [3_300]);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
