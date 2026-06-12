import assert from "node:assert/strict";

import { test } from "vitest";

import { buildWearableSummaryBundleFromDataset } from "../src/wearables.ts";
import type {
  WearableDataset,
  WearableMetricCandidate,
  WearableSleepWindowCandidate,
} from "../src/wearables/types.ts";
import { composePublicWearableSummaryBundleFromStoredRows } from "../src/projection/wearable-summary-compose.ts";
import { buildWearableSummaryProjectionFromDataset } from "../src/projection/wearable-summary-projector.ts";
import { stringifyPublicWearableProjectionSummary } from "../src/projection/wearable-summary-public-json.ts";
import {
  parseStoredWearableSummary,
  stringifyStoredWearableProjectionSummary,
  type StoredWearableMetricSummaryKind,
} from "../src/projection/wearable-summary-stored-codec.ts";

function candidate(input: {
  date: string;
  provider: string;
  metric: string;
  value: number;
  unit?: string | null;
  facet: string;
  suffix?: string;
}): WearableMetricCandidate {
  return {
    candidateId: `${input.provider}:${input.facet}:${input.date}${input.suffix ?? ""}`,
    date: input.date,
    externalRef: {
      facet: input.facet,
      resourceId: `${input.facet}-${input.date}${input.suffix ?? ""}`,
      resourceType: "daily_summary",
      system: input.provider,
      version: null,
    },
    metric: input.metric,
    occurredAt: `${input.date}T07:00:00.000Z`,
    paths: [`ledger/events/2026/${input.date.slice(0, 7)}.jsonl`],
    provider: input.provider,
    recordedAt: `${input.date}T08:11:23.000Z`,
    recordIds: [`evt_${input.provider}_${input.facet}_${input.date}${input.suffix ?? ""}`],
    sourceFamily: "event",
    sourceKind: `observation:${input.facet}`,
    title: `${input.provider} ${input.facet}`,
    unit: input.unit ?? null,
    value: input.value,
  };
}

function sleepWindow(provider: string, date: string): WearableSleepWindowCandidate {
  return {
    candidateId: `${provider}:sleep-window:${date}`,
    date,
    durationMinutes: 432,
    endAt: `${date}T06:42:00.000Z`,
    externalRef: {
      facet: "sleep-window",
      resourceId: `sleep-${date}`,
      resourceType: "sleep",
      system: provider,
      version: null,
    },
    nap: false,
    occurredAt: `${date}T06:42:00.000Z`,
    paths: [`ledger/events/2026/${date.slice(0, 7)}.jsonl`],
    provider,
    recordedAt: `${date}T07:01:00.000Z`,
    recordIds: [`evt_${provider}_sleep_${date}`],
    sourceFamily: "event",
    sourceKind: "sleep-window",
    startAt: `${date}T23:08:00.000Z`,
    title: `${provider} sleep`,
  };
}

function buildFixtureDataset(providers: readonly string[]): WearableDataset {
  const metricCandidates: WearableMetricCandidate[] = [];
  const sleepWindows: WearableSleepWindowCandidate[] = [];

  for (const [providerIndex, provider] of providers.entries()) {
    for (const date of ["2026-05-01", "2026-05-02"]) {
      // Sparse activity day: most activity envelopes stay empty, steps has
      // a runner-up candidate plus an exact duplicate.
      metricCandidates.push(
        candidate({ date, facet: "steps", metric: "steps", provider, unit: "count", value: 8_000 + providerIndex * 900 }),
        candidate({ date, facet: "steps", metric: "steps", provider, suffix: ":dup", unit: "count", value: 8_000 + providerIndex * 900 }),
        candidate({ date, facet: "steps-watch", metric: "steps", provider, suffix: ":runner-up", unit: "count", value: 7_400 + providerIndex * 900 }),
        candidate({ date, facet: "active-calories", metric: "activeCalories", provider, unit: "kcal", value: 512.25 + providerIndex }),
      );

      // Mostly filled sleep night with a sleep window.
      sleepWindows.push(sleepWindow(provider, date));
      metricCandidates.push(
        candidate({ date, facet: "sleep-score", metric: "sleepScore", provider, unit: "score", value: 82 + providerIndex }),
        candidate({ date, facet: "sleep-hrv", metric: "hrv", provider, unit: "ms", value: 64.5 + providerIndex }),
        candidate({ date, facet: "asleep-minutes", metric: "totalSleepMinutes", provider, unit: "min", value: 421 + providerIndex }),
        candidate({ date, facet: "lowest-heart-rate", metric: "lowestHeartRate", provider, unit: "bpm", value: 47 + providerIndex }),
      );

      // Recovery day with no explicit resting heart rate, so the
      // restingHeartRate envelope resolves through the lowest sleep heart
      // rate fallback path.
      metricCandidates.push(
        candidate({ date, facet: "recovery-score", metric: "recoveryScore", provider, unit: "%", value: 61 + providerIndex }),
      );

      // Body state day.
      metricCandidates.push(
        candidate({ date, facet: "weight", metric: "weightKg", provider, unit: "kg", value: 81.4 + providerIndex }),
      );
    }
  }

  return {
    activitySessionAggregates: [],
    metricCandidates,
    provenanceDiagnostics: [],
    rawMetricCandidates: metricCandidates,
    sleepWindows,
  };
}

function bundleSummariesByKind(
  dataset: WearableDataset,
): Array<[StoredWearableMetricSummaryKind, readonly object[]]> {
  const bundle = buildWearableSummaryBundleFromDataset(dataset);
  return [
    ["activity", bundle.activityDays],
    ["body_state", bundle.bodyStateDays],
    ["recovery", bundle.recoveryDays],
    ["sleep", bundle.sleepNights],
  ];
}

test("stored wearable summary codec round-trips summaries byte-exactly", () => {
  for (const providers of [["whoop"], ["whoop", "oura"]] as const) {
    const summaryGroups = bundleSummariesByKind(buildFixtureDataset(providers));

    for (const [summaryKind, summaries] of summaryGroups) {
      assert.ok(summaries.length > 0, `expected ${summaryKind} fixture summaries`);

      for (const summary of summaries) {
        const legacyJson = stringifyPublicWearableProjectionSummary(summary);
        const storedJson = stringifyStoredWearableProjectionSummary(summaryKind, summary);

        const parsedStored = parseStoredWearableSummary(summaryKind, storedJson);
        assert.equal(JSON.stringify(parsedStored), legacyJson);

        const parsedLegacy = parseStoredWearableSummary(summaryKind, legacyJson);
        assert.equal(JSON.stringify(parsedLegacy), legacyJson);

        assert.ok(
          storedJson.length < legacyJson.length,
          `expected stored ${summaryKind} summary to be smaller than the public form`,
        );
      }

      if (summaryKind === "activity") {
        const storedActivity = stringifyStoredWearableProjectionSummary(summaryKind, summaries[0]!);
        // Populated envelopes compact to { confidence, selection } and
        // evidence-free envelopes collapse to null markers.
        assert.match(storedActivity, /"steps":\{"confidence":/u);
        assert.match(storedActivity, /"dayStrain":null/u);
        assert.doesNotMatch(storedActivity, /"candidates":/u);
      }
    }
  }
});

test("stored wearable summary codec round-trips conflict, duplicate, and fallback envelopes", () => {
  const conflicted = buildFixtureDataset(["whoop", "oura"]);
  const bundle = buildWearableSummaryBundleFromDataset(conflicted);

  const steps = bundle.activityDays[0]?.steps;
  assert.ok(steps);
  assert.ok(steps.confidence.conflictingProviders.length > 0, "expected a conflicting-provider envelope");

  const restingHeartRate = bundle.recoveryDays[0]?.restingHeartRate;
  assert.ok(restingHeartRate);
  assert.equal(restingHeartRate.selection.resolution, "fallback");

  for (const [summaryKind, summaries] of bundleSummariesByKind(conflicted)) {
    for (const summary of summaries) {
      const storedJson = stringifyStoredWearableProjectionSummary(summaryKind, summary);
      assert.equal(
        JSON.stringify(parseStoredWearableSummary(summaryKind, storedJson)),
        stringifyPublicWearableProjectionSummary(summary),
      );
    }
  }
});

test("stored wearable summary codec fails open to the full envelope when bytes would change", () => {
  const bundle = buildWearableSummaryBundleFromDataset(buildFixtureDataset(["whoop"]));
  const doctored = JSON.parse(stringifyPublicWearableProjectionSummary(bundle.activityDays[0]));
  doctored.steps.selection.futureField = "not yet known to the codec";

  const storedJson = stringifyStoredWearableProjectionSummary("activity", doctored);
  assert.ok(storedJson.includes('"futureField"'), "expected the unknown field to survive storage");
  assert.ok(storedJson.includes('"metric":"steps"'), "expected the unknown-shaped envelope to stay in full form");
  assert.equal(
    JSON.stringify(parseStoredWearableSummary("activity", storedJson)),
    stringifyPublicWearableProjectionSummary(doctored),
  );
});

test("compose output from compact stored rows matches legacy full-form rows", () => {
  const rows = buildWearableSummaryProjectionFromDataset(buildFixtureDataset(["whoop", "oura"]));
  assert.ok(rows.length > 0);

  const legacyRows = rows.map((row) =>
    row.summaryKind === "source_health"
      ? row
      : {
          ...row,
          summaryJson: JSON.stringify(parseStoredWearableSummary(row.summaryKind, row.summaryJson)),
        }
  );
  assert.ok(
    legacyRows.some((legacyRow, index) => legacyRow.summaryJson !== rows[index]?.summaryJson),
    "expected compact rows to differ from legacy rows on disk",
  );

  const scopes = [
    { providerFilterWasProvided: true, providers: ["whoop"] },
    { providerFilterWasProvided: true, providers: ["oura", "whoop"] },
  ];
  const filterSets = [{}, { date: "2026-05-01" }, { from: "2026-05-02", to: "2026-05-02" }];

  for (const scope of scopes) {
    const scopeKeys = new Set(scope.providers.map((provider) => `providers:${provider}`));
    const scopedRows = rows.filter((row) => scopeKeys.has(row.providerScopeKey));
    const scopedLegacyRows = legacyRows.filter((row) => scopeKeys.has(row.providerScopeKey));
    assert.ok(scopedRows.length > 0);

    for (const filters of filterSets) {
      const composed = composePublicWearableSummaryBundleFromStoredRows(
        { ...scope, rows: scopedRows },
        filters,
      );
      const legacyComposed = composePublicWearableSummaryBundleFromStoredRows(
        { ...scope, rows: scopedLegacyRows },
        filters,
      );

      assert.equal(JSON.stringify(composed), JSON.stringify(legacyComposed));
      if (filters === filterSets[0]) {
        assert.ok(
          composed.activityDays.length + composed.sleepNights.length + composed.recoveryDays.length > 0,
          "expected the unfiltered compose to return summaries",
        );
      }
    }
  }
});

test("parseStoredWearableSummary returns null for corrupt or non-object rows", () => {
  assert.equal(parseStoredWearableSummary("activity", '{"steps":'), null);
  assert.equal(parseStoredWearableSummary("sleep", "null"), null);
  assert.equal(parseStoredWearableSummary("recovery", "42"), null);
  assert.equal(parseStoredWearableSummary("body_state", '"not an object"'), null);
});

test("stored wearable summary codec stores unrecognized envelope shapes verbatim", () => {
  const bundle = buildWearableSummaryBundleFromDataset(buildFixtureDataset(["whoop"]));
  const doctored = JSON.parse(stringifyPublicWearableProjectionSummary(bundle.activityDays[0]));
  doctored.steps = 1234;
  doctored.activeCalories.confidence = "corrupt";

  const storedJson = stringifyStoredWearableProjectionSummary("activity", doctored);
  assert.ok(storedJson.includes('"steps":1234'), "expected the non-object envelope to be stored verbatim");
  assert.ok(
    storedJson.includes('"metric":"activeCalories"'),
    "expected the non-object-confidence envelope to stay in full form",
  );
  assert.equal(
    JSON.stringify(parseStoredWearableSummary("activity", storedJson)),
    stringifyPublicWearableProjectionSummary(doctored),
  );
});

test("stored wearable summary codec fails open when a no-evidence envelope carries extra detail", () => {
  const bundle = buildWearableSummaryBundleFromDataset(buildFixtureDataset(["whoop"]));
  const doctored = JSON.parse(stringifyPublicWearableProjectionSummary(bundle.activityDays[0]));
  assert.equal(doctored.dayStrain.selection.resolution, "none");
  doctored.dayStrain.confidence.reasons = [...doctored.dayStrain.confidence.reasons, "non-canonical detail"];

  const storedJson = stringifyStoredWearableProjectionSummary("activity", doctored);
  // The null marker would lose the extra reason, so the round-trip
  // verification must keep this envelope in full form.
  assert.doesNotMatch(storedJson, /"dayStrain":null/u);
  assert.ok(storedJson.includes('"metric":"dayStrain"'), "expected the envelope to stay in full form");
  assert.ok(storedJson.includes('"non-canonical detail"'), "expected the extra reason to survive storage");
  assert.equal(
    JSON.stringify(parseStoredWearableSummary("activity", storedJson)),
    stringifyPublicWearableProjectionSummary(doctored),
  );
});

test("stored wearable summary codec decode discriminates and survives tampered envelope objects", () => {
  const bundle = buildWearableSummaryBundleFromDataset(buildFixtureDataset(["whoop"]));
  const storedJson = stringifyStoredWearableProjectionSummary("activity", bundle.activityDays[0]!);

  const reparseSteps = (steps: unknown): unknown => {
    const tampered = JSON.parse(storedJson);
    tampered.steps = steps;
    const parsed = parseStoredWearableSummary<Record<string, unknown>>("activity", JSON.stringify(tampered));
    assert.ok(parsed);
    return parsed.steps;
  };

  // Any key beyond { confidence, selection } means "not the compact form":
  // the object must pass through untouched instead of being rebuilt.
  assert.deepEqual(
    reparseSteps({ confidence: {}, selection: {}, extra: 1 }),
    { confidence: {}, selection: {}, extra: 1 },
  );

  // Shapes the writer cannot produce fail closed: they pass through
  // untouched instead of being synthesized into high-confidence direct
  // selections. The writer always emits both keys as plain objects, so a
  // missing or non-object part means corruption or tampering.
  assert.deepEqual(reparseSteps({}), {});
  assert.deepEqual(
    reparseSteps({ confidence: 5, selection: "corrupt" }),
    { confidence: 5, selection: "corrupt" },
  );
  assert.deepEqual(reparseSteps({ selection: { value: 7 } }), { selection: { value: 7 } });

  // A genuine writer-shaped compact envelope (both keys, both plain
  // objects) still rebuilds with the documented defaults.
  assert.deepEqual(reparseSteps({ confidence: {}, selection: { value: 7 } }), {
    candidates: [],
    confidence: {
      candidateCount: 1,
      conflictingProviders: [],
      exactDuplicateCount: 0,
      level: "high",
      reasons: [],
    },
    metric: "steps",
    selection: {
      occurredAt: null,
      paths: [],
      provider: null,
      recordedAt: null,
      recordIds: [],
      resolution: "direct",
      sourceFamily: null,
      sourceKind: null,
      title: null,
      fallbackFromMetric: null,
      fallbackReason: null,
      unit: null,
      value: 7,
    },
  });

  // Arrays in the summary cell are corrupt rows, not summaries.
  assert.equal(parseStoredWearableSummary("activity", "[]"), null);
});

test("null-marker envelopes decode to fresh objects on every parse", () => {
  const bundle = buildWearableSummaryBundleFromDataset(buildFixtureDataset(["whoop"]));
  const summary = bundle.activityDays[0]!;
  const legacyJson = stringifyPublicWearableProjectionSummary(summary);
  const storedJson = stringifyStoredWearableProjectionSummary("activity", summary);
  assert.match(storedJson, /"dayStrain":null/u);

  const first = parseStoredWearableSummary<{ dayStrain: { selection: { resolution: string } } }>(
    "activity",
    storedJson,
  );
  assert.ok(first);
  assert.equal(first.dayStrain.selection.resolution, "none");
  first.dayStrain.selection.resolution = "mutated by a careless caller";

  // The codec memoizes empty envelopes by their JSON; a later parse must not
  // see another caller's mutation.
  assert.equal(JSON.stringify(parseStoredWearableSummary("activity", storedJson)), legacyJson);
});
