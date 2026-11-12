import assert from "node:assert/strict";
import { test } from "vitest";
import { resolveMetric, resolveSleepWindowSelection } from "../src/wearables/selection.ts";
import type { WearableExternalRef, WearableMetricCandidate, WearableSleepWindowCandidate } from "../src/wearables/types.ts";

function makeExternalRef(overrides: Partial<WearableExternalRef> = {}): WearableExternalRef {
  return {
    facet: null,
    resourceId: null,
    resourceType: null,
    system: null,
    version: null,
    ...overrides,
  };
}

function makeMetricCandidate(
  overrides: Partial<WearableMetricCandidate> & Pick<
    WearableMetricCandidate,
    "candidateId" | "date" | "metric" | "provider" | "sourceFamily" | "sourceKind" | "unit" | "value"
  >,
): WearableMetricCandidate {
  return {
    candidateId: overrides.candidateId,
    dataOrigin: overrides.dataOrigin ?? null,
    date: overrides.date,
    externalRef: overrides.externalRef ?? null,
    metric: overrides.metric,
    occurredAt: overrides.occurredAt ?? null,
    paths: overrides.paths ?? [`/virtual/${overrides.candidateId}.jsonl`],
    provider: overrides.provider,
    recordedAt: overrides.recordedAt ?? null,
    recordIds: overrides.recordIds ?? [overrides.candidateId],
    sourceFamily: overrides.sourceFamily,
    sourceKind: overrides.sourceKind,
    title: overrides.title ?? null,
    unit: overrides.unit,
    value: overrides.value,
  };
}

function makeSleepWindowCandidate(
  overrides: Partial<WearableSleepWindowCandidate> & Pick<
    WearableSleepWindowCandidate,
    "candidateId" | "date" | "durationMinutes" | "provider" | "sourceFamily" | "sourceKind" | "nap"
  >,
): WearableSleepWindowCandidate {
  return {
    candidateId: overrides.candidateId,
    dataOrigin: overrides.dataOrigin ?? null,
    date: overrides.date,
    durationMinutes: overrides.durationMinutes,
    endAt: overrides.endAt ?? null,
    externalRef: overrides.externalRef ?? null,
    nap: overrides.nap,
    occurredAt: overrides.occurredAt ?? null,
    paths: overrides.paths ?? [`/virtual/${overrides.candidateId}.jsonl`],
    provider: overrides.provider,
    recordedAt: overrides.recordedAt ?? null,
    recordIds: overrides.recordIds ?? [overrides.candidateId],
    sourceFamily: overrides.sourceFamily,
    sourceKind: overrides.sourceKind,
    startAt: overrides.startAt ?? null,
    title: overrides.title ?? null,
  };
}

test("selection treats Junction whoop_v2 evidence as a direct WHOOP duplicate", () => {
  const directWhoopHrv = makeMetricCandidate({
    candidateId: "whoop:hrv:direct",
    date: "2026-04-12",
    externalRef: makeExternalRef({
      resourceId: "whoop-recovery-1",
      resourceType: "recovery",
      system: "whoop_v2",
    }),
    metric: "hrv",
    occurredAt: "2026-04-12T07:00:00Z",
    provider: "whoop_v2",
    recordedAt: "2026-04-12T07:01:00Z",
    sourceFamily: "event",
    sourceKind: "observation:hrv",
    title: "Direct WHOOP HRV",
    unit: "ms",
    value: 52,
  });
  const junctionWhoopHrv = makeMetricCandidate({
    candidateId: "junction:whoop-v2:hrv",
    dataOrigin: {
      version: 1,
      aggregatorProvider: "junction",
      sourceProviderSlug: "whoop_v2",
    },
    date: "2026-04-12",
    externalRef: makeExternalRef({
      resourceId: "junction-whoop-recovery-1",
      resourceType: "junction-whoop-v2-recovery",
      system: "junction",
    }),
    metric: "hrv",
    occurredAt: "2026-04-12T07:05:00Z",
    provider: "junction",
    recordedAt: "2026-04-12T07:06:00Z",
    sourceFamily: "event",
    sourceKind: "observation:hrv",
    title: "Junction WHOOP HRV",
    unit: "ms",
    value: 52,
  });

  const resolved = resolveMetric(
    "hrv",
    [junctionWhoopHrv, directWhoopHrv],
    { metricFamily: "recovery" },
  );

  assert.equal(resolved.selection.provider, "whoop_v2");
  assert.equal(resolved.selection.title, "Direct WHOOP HRV");
});

test("selection keeps Junction source policy separate from provider identity", () => {
  const directOuraSteps = makeMetricCandidate({
    candidateId: "oura:steps:direct",
    dataOrigin: null,
    date: "2026-04-12",
    externalRef: makeExternalRef({
      resourceId: "oura-steps",
      resourceType: "activity",
      system: "oura",
    }),
    metric: "steps",
    occurredAt: "2026-04-12T08:00:00Z",
    provider: "oura",
    recordedAt: "2026-04-12T08:01:00Z",
    sourceFamily: "event",
    sourceKind: "observation:daily-steps",
    title: "Direct Oura steps",
    unit: "count",
    value: 8200,
  });
  const junctionOuraSteps = makeMetricCandidate({
    candidateId: "junction:oura:steps",
    dataOrigin: {
      version: 1,
      aggregatorProvider: "junction",
      sourceProviderSlug: "oura",
    },
    date: "2026-04-12",
    externalRef: makeExternalRef({
      resourceId: "junction-oura-steps",
      resourceType: "junction-oura-activity",
      system: "junction",
    }),
    metric: "steps",
    occurredAt: "2026-04-12T08:05:00Z",
    provider: "junction",
    recordedAt: "2026-04-12T08:06:00Z",
    sourceFamily: "event",
    sourceKind: "observation:daily-steps",
    title: "Junction Oura steps",
    unit: "count",
    value: 8200,
  });

  const directDuplicate = resolveMetric(
    "steps",
    [junctionOuraSteps, directOuraSteps],
    { metricFamily: "activity" },
  );
  assert.equal(directDuplicate.selection.provider, "oura");
  assert.equal(directDuplicate.selection.title, "Direct Oura steps");

  const weakDirectOuraSteps = makeMetricCandidate({
    candidateId: "oura:steps:weak-direct",
    date: "2026-04-12",
    externalRef: makeExternalRef({
      resourceId: "oura-weak-steps",
      resourceType: null,
      system: "oura",
    }),
    metric: "steps",
    occurredAt: "2026-04-12T08:00:00Z",
    provider: "oura",
    recordedAt: "2026-04-12T08:00:30Z",
    sourceFamily: "derived",
    sourceKind: "legacy-steps",
    title: "Weak direct Oura steps",
    unit: "count",
    value: 8200,
  });
  const strongJunctionOuraSteps = makeMetricCandidate({
    candidateId: "junction:oura:steps:strong",
    dataOrigin: {
      version: 1,
      aggregatorProvider: "junction",
      sourceProviderSlug: "oura",
    },
    date: "2026-04-12",
    externalRef: makeExternalRef({
      resourceId: "junction-oura-strong-steps",
      resourceType: "junction-oura-activity",
      system: "junction",
    }),
    metric: "steps",
    occurredAt: "2026-04-12T08:10:00Z",
    provider: "junction",
    recordedAt: "2026-04-12T08:11:00Z",
    sourceFamily: "sample",
    sourceKind: "steps",
    title: "Strong Junction Oura steps",
    unit: "count",
    value: 8200,
  });
  const adversarialDirectDuplicate = resolveMetric(
    "steps",
    [strongJunctionOuraSteps, weakDirectOuraSteps],
    { metricFamily: "activity" },
  );
  assert.equal(adversarialDirectDuplicate.selection.provider, "oura");
  assert.equal(adversarialDirectDuplicate.selection.title, "Weak direct Oura steps");

  const canonicalizedJunctionOuraSteps = makeMetricCandidate({
    candidateId: "canonicalized-junction:oura:steps",
    dataOrigin: {
      version: 1,
      aggregatorProvider: "junction",
      sourceProviderSlug: "oura",
    },
    date: "2026-04-12",
    externalRef: makeExternalRef({
      resourceId: "canonicalized-junction-oura-steps",
      resourceType: null,
      system: "junction",
    }),
    metric: "steps",
    occurredAt: "2026-04-12T08:00:00Z",
    provider: "oura",
    recordedAt: "2026-04-12T08:00:30Z",
    sourceFamily: "derived",
    sourceKind: "legacy-steps",
    title: "Canonicalized Junction Oura steps",
    unit: "count",
    value: 8200,
  });
  const aggregatorOnlyDuplicate = resolveMetric(
    "steps",
    [strongJunctionOuraSteps, canonicalizedJunctionOuraSteps],
    { metricFamily: "activity" },
  );
  assert.equal(aggregatorOnlyDuplicate.selection.provider, "junction");
  assert.equal(aggregatorOnlyDuplicate.selection.title, "Strong Junction Oura steps");

  const junctionDexcomGlucoseProxy = makeMetricCandidate({
    candidateId: "junction:dexcom:proxy",
    dataOrigin: {
      version: 1,
      aggregatorProvider: "junction",
      sourceProviderSlug: "dexcom-v3",
    },
    date: "2026-04-12",
    externalRef: makeExternalRef({
      resourceId: "junction-dexcom-hrv",
      resourceType: "junction-dexcom-v3-hrv",
      system: "junction",
    }),
    metric: "hrv",
    occurredAt: "2026-04-12T08:05:00Z",
    provider: "junction",
    recordedAt: "2026-04-12T08:06:00Z",
    sourceFamily: "sample",
    sourceKind: "hrv",
    title: "Dexcom via Junction HRV",
    unit: "ms",
    value: 45,
  });
  const unknownHrv = makeMetricCandidate({
    candidateId: "unknown:hrv",
    date: "2026-04-12",
    metric: "hrv",
    occurredAt: "2026-04-12T08:00:00Z",
    provider: "unknown",
    recordedAt: "2026-04-12T08:00:30Z",
    sourceFamily: "sample",
    sourceKind: "hrv",
    title: "Unknown HRV",
    unit: "ms",
    value: 45,
  });
  const unsupportedSource = resolveMetric(
    "hrv",
    [unknownHrv, junctionDexcomGlucoseProxy],
    { metricFamily: "recovery" },
  );
  assert.equal(unsupportedSource.selection.provider, "junction");
  assert.equal(unsupportedSource.selection.title, "Dexcom via Junction HRV");

  const junctionOuraSleepWindow = makeSleepWindowCandidate({
    candidateId: "junction:oura:sleep",
    date: "2026-04-12",
    dataOrigin: {
      version: 1,
      aggregatorProvider: "junction",
      sourceProviderSlug: "oura",
    },
    durationMinutes: 470,
    endAt: "2026-04-13T06:00:00Z",
    nap: false,
    occurredAt: "2026-04-12T22:00:00Z",
    provider: "junction",
    recordedAt: "2026-04-13T06:10:00Z",
    sourceFamily: "event",
    sourceKind: "sleep_session",
    startAt: "2026-04-12T22:00:00Z",
    title: "Junction Oura sleep",
  });
  const directOuraSleepWindow = makeSleepWindowCandidate({
    candidateId: "oura:sleep:direct",
    date: "2026-04-12",
    durationMinutes: 470,
    endAt: "2026-04-13T06:00:00Z",
    nap: false,
    occurredAt: "2026-04-12T22:00:00Z",
    provider: "oura",
    recordedAt: "2026-04-13T06:01:00Z",
    sourceFamily: "event",
    sourceKind: "sleep_session",
    startAt: "2026-04-12T22:00:00Z",
    title: "Direct Oura sleep",
  });
  const sleepWindow = resolveSleepWindowSelection([junctionOuraSleepWindow, directOuraSleepWindow]);
  assert.equal(sleepWindow.selection?.provider, "oura");
  assert.equal(sleepWindow.selection?.title, "Direct Oura sleep");
});
