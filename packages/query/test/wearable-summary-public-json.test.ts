import assert from "node:assert/strict";

import { test } from "vitest";

import {
  projectPublicWearableSummaryBundle,
  stringifyPublicWearableProjectionSummary,
} from "../src/projection/wearable-summary-public-json.ts";
import { parseJsonValue } from "../src/projection/schema.ts";
import {
  buildWearableSummaryBundleFromDataset,
  type ProjectedWearableSummaryBundle,
  type WearableSummaryBundle,
} from "../src/wearables.ts";
import { buildActivitySessionAggregates, buildActivitySessionDayRollups } from "../src/wearables/candidates.ts";
import type { WearableMetricCandidate, WearableSleepWindowCandidate } from "../src/wearables/types.ts";

const BUNDLE_KEYS = ["activityDays", "bodyStateDays", "recoveryDays", "sleepNights", "sourceHealth"] as const;
const PRIVATE_KEYS = [
  "activityEvidence",
  "activitySessions",
  "candidateId",
  "dataOrigin",
  "externalRef",
  "reconciliationDurationConsistent",
  "reconciliationExactKey",
  "reconciliationResourceKey",
  "sessionContributors",
  "workoutMetricContributors",
];
const EMPTIED_KEYS = ["candidates", "paths", "recordIds"];

// The projection contract that predates the direct copy.
function textProjection(summaries: readonly unknown[]): unknown[] {
  return summaries
    .map((summary) => parseJsonValue<unknown>(stringifyPublicWearableProjectionSummary(summary), null))
    .filter((summary) => summary !== null);
}

type BundleKey = (typeof BUNDLE_KEYS)[number];
type MalformedBundle = Record<BundleKey, readonly unknown[]>;

function bundleOf(summaries: readonly unknown[]): MalformedBundle {
  return {
    activityDays: summaries,
    bodyStateDays: summaries,
    recoveryDays: summaries,
    sleepNights: summaries,
    sourceHealth: summaries,
  };
}

function assertTextParity(bundle: MalformedBundle, projected: ProjectedWearableSummaryBundle): void {
  assert.deepEqual(Object.keys(projected), [...BUNDLE_KEYS]);
  for (const key of BUNDLE_KEYS) {
    const expected = textProjection(bundle[key]);
    assert.deepStrictEqual(projected[key], expected);
    assert.equal(JSON.stringify(projected[key]), JSON.stringify(expected));
  }
}

/** Projects deliberately malformed summaries; its output is inspected as untyped data. */
function projectMalformed(bundle: MalformedBundle): Record<BundleKey, readonly unknown[]> {
  // @ts-expect-error The runtime boundary receives summaries outside WearableSummaryBundle.
  const projected = projectPublicWearableSummaryBundle(bundle);
  assertTextParity(bundle, projected);
  return projected;
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
}

function collectKeys(value: unknown, keys = new Map<string, unknown[]>()): Map<string, unknown[]> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
  } else if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      keys.set(key, [...(keys.get(key) ?? []), entry]);
      collectKeys(entry, keys);
    }
  }
  return keys;
}

function metricCandidate(provider: string, date: string, metric: string, value: number): WearableMetricCandidate {
  return {
    candidateId: `${provider}:${metric}:${date}`,
    dataOrigin: { version: 1, sourceProviderSlug: provider },
    date,
    externalRef: { facet: metric, resourceId: `${metric}-${date}`, resourceType: "daily", system: provider, version: null },
    metric,
    occurredAt: `${date}T07:00:00.000Z`,
    paths: [`ledger/events/2026/${date.slice(0, 7)}.jsonl`],
    provider,
    recordedAt: `${date}T08:00:00.000Z`,
    recordIds: [`evt_${provider}_${metric}_${date}`],
    sourceFamily: "event",
    sourceKind: `observation:${metric}`,
    title: `${provider} ${metric}`,
    unit: null,
    value,
  };
}

function syntheticBundle(): WearableSummaryBundle {
  const metricCandidates: WearableMetricCandidate[] = [];
  const sessions: WearableMetricCandidate[] = [];
  const sleepWindows: WearableSleepWindowCandidate[] = [];
  for (const [index, provider] of ["garmin", "oura", "whoop"].entries()) {
    for (const date of ["2026-05-01", "2026-05-02"]) {
      metricCandidates.push(
        metricCandidate(provider, date, "steps", 8_000 + index * 700),
        metricCandidate(provider, date, "sleepScore", 80 + index),
        metricCandidate(provider, date, "totalSleepMinutes", 420 + index),
        metricCandidate(provider, date, "recoveryScore", 60 + index),
        metricCandidate(provider, date, "weightKg", 81.25 + index),
      );
      sleepWindows.push({
        ...metricCandidate(provider, date, "sleep-window", 0),
        durationMinutes: 430,
        endAt: `${date}T06:40:00.000Z`,
        nap: false,
        startAt: `${date}T23:30:00.000Z`,
      } as WearableSleepWindowCandidate);
      sessions.push({
        ...metricCandidate(provider, date, "sessionMinutes", 31 + index),
        activityType: "run",
        heartRateZones: [{ durationMinutes: 12, zone: 2 }],
        sessionEndAt: `${date}T18:31:00.000Z`,
        sessionStartAt: `${date}T18:00:00.000Z`,
        sourceKind: "activity_session",
        unit: "minutes",
        workoutMetricKeys: [],
        workoutMetricValues: {},
      });
    }
  }
  return buildWearableSummaryBundleFromDataset({
    activitySessionCandidates: sessions,
    activitySessionAggregates: buildActivitySessionAggregates(sessions),
    activitySessionDayRollups: buildActivitySessionDayRollups(sessions),
    metricSuppressionEvidence: [],
    metricCandidates,
    provenanceDiagnostics: [],
    rawMetricCandidates: metricCandidates,
    sleepWindows,
    workoutFeatures: [],
  });
}

test("public wearable projection equals the text projection for composed multi-provider summaries", () => {
  const bundle = syntheticBundle();
  const before = JSON.stringify(bundle);
  const rawKeys = collectKeys(bundle);
  // The fixture must carry provenance for the stripping assertions to mean anything.
  for (const key of ["candidateId", "externalRef", "dataOrigin", ...EMPTIED_KEYS]) {
    assert.ok(rawKeys.has(key), `fixture lacks ${key}`);
  }
  assert.ok(rawKeys.get("paths")!.some((paths) => Array.isArray(paths) && paths.length > 0));

  const projected = projectPublicWearableSummaryBundle(bundle);
  assertTextParity(bundle, projected);
  for (const key of BUNDLE_KEYS) {
    assert.ok(projected[key].length > 0, `fixture lacks ${key}`);
  }
  const publicKeys = collectKeys(projected);
  for (const key of PRIVATE_KEYS) assert.equal(publicKeys.has(key), false, key);
  for (const key of EMPTIED_KEYS) {
    for (const value of publicKeys.get(key) ?? []) assert.deepEqual(value, []);
  }

  // Fresh containers: mutating the projection leaves input and siblings alone.
  const night = projected.sleepNights[0]!;
  const paths: string[] = night.sleepScore.selection.paths;
  paths.push("private");
  night.sleepScore.confidence.reasons.push("changed");
  assert.equal(JSON.stringify(bundle), before);
  assert.deepEqual(projected.sleepNights[1]!.sleepScore.selection.paths, []);
  assert.deepEqual(projectPublicWearableSummaryBundle(bundle), projectPublicWearableSummaryBundle(bundle));
});

test("public wearable projection strips provenance keys at every depth and in arrays", () => {
  const privateFields = (seed: string) => Object.fromEntries(PRIVATE_KEYS.map((key) => [key, { seed, key }]));
  const summary = {
    ...privateFields("root"),
    candidates: "not-an-array",
    date: "2026-05-01",
    nested: {
      ...privateFields("nested"),
      deeper: [{ ...privateFields("array"), candidates: undefined, paths: null, recordIds: { private: true }, kept: 1 }],
      paths: ["ledger/private.jsonl"],
      recordIds: ["evt_private"],
    },
    candidates2: [{ candidates: [{ recordIds: ["evt_private"] }] }],
  };
  const projected = projectMalformed(bundleOf([summary]));
  assert.deepEqual(projected.activityDays, [{
    candidates: [],
    date: "2026-05-01",
    nested: { deeper: [{ candidates: [], kept: 1, paths: [], recordIds: [] }], paths: [], recordIds: [] },
    candidates2: [{ candidates: [] }],
  }]);
});

test("public wearable projection keeps JSON value semantics", () => {
  class Instance {
    constructor(readonly value: number) {}
  }
  const sparse = Object.assign(new Array<number>(3), { 0: 1, 2: 3 });
  const summaries = [
    {
      array: [undefined, () => 1, Symbol("x"), Number.NaN, -0, Number.POSITIVE_INFINITY, "\ud800"],
      date: new Date("2026-05-01T00:00:00.000Z"),
      fn: () => 1,
      instance: new Instance(2),
      missing: undefined,
      negativeZero: -0,
      nonFinite: Number.NEGATIVE_INFINITY,
      nullPrototype: Object.assign(Object.create(null), { recordIds: ["evt_private"], value: 1 }),
      sparse,
      symbol: Symbol("y"),
      toJsonObject: { toJSON: () => ({ paths: ["private"], candidateId: "private", visible: true }) },
    },
    undefined,
    null,
    "text",
    7,
    { "2": "b", "1": "a", z: { "10": 1, "9": 2 } },
    { nested: { toJSON: () => ({ paths: ["private"], candidateId: "private", visible: true }) } },
  ];
  // Unsupported values take the text path for the whole summary; check both.
  const plain = summaries.map((summary) =>
    typeof summary === "object" && summary !== null && "date" in summary
      ? { ...summary, date: undefined, instance: undefined, toJsonObject: undefined }
      : summary
  );
  for (const input of [summaries, plain]) {
    const projected = projectMalformed(bundleOf(input)).activityDays;
    assert.equal(projected.length, 5);
    assert.deepEqual(projected[4], { nested: { paths: [], visible: true } });
    const [first] = projected;
    assertRecord(first);
    assert.equal(Object.is(first.negativeZero, 0), true);
    assert.ok(Array.isArray(first.array));
    assert.equal(Object.is(first.array[4], 0), true);
  }
});

test("public wearable projection keeps __proto__ as an own data property", () => {
  const summary: unknown = JSON.parse('{"__proto__":{"polluted":true},"inner":{"__proto__":[1],"paths":["private"]}}');
  const [projected] = projectMalformed(bundleOf([summary])).activityDays;
  assertRecord(projected);
  assert.equal(Object.getPrototypeOf(projected), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptor(projected, "__proto__")?.value, { polluted: true });
  assert.equal(Reflect.get({}, "polluted"), undefined);
  const inner = projected.inner;
  assertRecord(inner);
  assert.equal(Object.getPrototypeOf(inner), Object.prototype);
  assert.deepEqual(Object.keys(inner), ["__proto__", "paths"]);
});

test("public wearable projection preserves JSON errors for bigint and cycles", () => {
  const cyclic: Record<string, unknown> = { date: "2026-05-01" };
  cyclic.self = { parent: cyclic };
  for (const summary of [{ value: 1n }, cyclic]) {
    assert.throws(() => stringifyPublicWearableProjectionSummary(summary), TypeError);
    assert.throws(() => projectMalformed(bundleOf([summary])), TypeError);
  }
});
