import assert from "node:assert/strict";

import { test } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { createVaultReadModel } from "../src/model.ts";
import { summarizeWearableDay, summarizeWearableSleep } from "../src/wearables.ts";

type ExternalRefInput = {
  facet?: string;
  resourceId: string;
  resourceType: string;
  system: string;
};

function makeEntity(
  overrides: Partial<CanonicalEntity> & Pick<CanonicalEntity, "entityId" | "family" | "kind" | "recordClass">,
): CanonicalEntity {
  return {
    attributes: overrides.attributes ?? {},
    body: overrides.body ?? null,
    date: overrides.date ?? null,
    entityId: overrides.entityId,
    experimentSlug: overrides.experimentSlug ?? null,
    family: overrides.family,
    frontmatter: overrides.frontmatter ?? null,
    kind: overrides.kind,
    links: overrides.links ?? [],
    lookupIds: overrides.lookupIds ?? [overrides.entityId],
    occurredAt: overrides.occurredAt ?? null,
    path: overrides.path ?? `ledger/events/${overrides.entityId}.jsonl`,
    primaryLookupId: overrides.primaryLookupId ?? overrides.entityId,
    recordClass: overrides.recordClass,
    relatedIds: overrides.relatedIds ?? [],
    status: overrides.status ?? null,
    stream: overrides.stream ?? null,
    tags: overrides.tags ?? [],
    title: overrides.title ?? null,
  };
}

function makeExternalRef(input: ExternalRefInput) {
  return {
    facet: input.facet ?? null,
    resourceId: input.resourceId,
    resourceType: input.resourceType,
    system: input.system,
    version: null,
  };
}

function makeSleepSession(input: {
  durationMinutes: number;
  endAt: string;
  entityId: string;
  recordedAt: string;
  resourceId: string;
  startAt: string;
  title: string;
}): CanonicalEntity {
  return makeEntity({
    attributes: {
      dayKey: "2026-06-04",
      durationMinutes: input.durationMinutes,
      endAt: input.endAt,
      externalRef: makeExternalRef({
        resourceId: input.resourceId,
        resourceType: "sleep",
        system: "oura",
      }),
      recordedAt: input.recordedAt,
      startAt: input.startAt,
    },
    entityId: input.entityId,
    family: "event",
    kind: "sleep_session",
    occurredAt: input.startAt,
    recordClass: "ledger",
    title: input.title,
  });
}

function makeSleepMetric(input: {
  entityId: string;
  metric: string;
  recordedAt: string;
  resourceId: string;
  value: number;
}): CanonicalEntity {
  return makeEntity({
    attributes: {
      dayKey: "2026-06-04",
      externalRef: makeExternalRef({
        facet: input.metric,
        resourceId: input.resourceId,
        resourceType: "sleep",
        system: "oura",
      }),
      metric: input.metric,
      recordedAt: input.recordedAt,
      unit: input.metric === "average-heart-rate" || input.metric === "lowest-heart-rate"
        ? "bpm"
        : input.metric === "hrv"
          ? "ms"
          : input.metric === "sleep-efficiency" || input.metric === "sleep-score"
            ? "%"
            : "minutes",
      value: input.value,
    },
    entityId: input.entityId,
    family: "event",
    kind: "observation",
    occurredAt: input.recordedAt,
    recordClass: "ledger",
    title: `Oura ${input.metric}`,
  });
}

function makeSleepStageSample(input: {
  dayKey?: string;
  durationMinutes: number;
  entityId: string;
  occurredAt: string;
  recordedAt: string;
  resourceId: string;
  stage: "deep" | "light" | "rem";
}): CanonicalEntity {
  return makeEntity({
    attributes: {
      dayKey: input.dayKey ?? "2026-06-04",
      durationMinutes: input.durationMinutes,
      externalRef: makeExternalRef({
        facet: input.stage,
        resourceId: input.resourceId,
        resourceType: "sleep_stage",
        system: "oura",
      }),
      recordedAt: input.recordedAt,
      stage: input.stage,
    },
    entityId: input.entityId,
    family: "sample",
    kind: "sleep_stage",
    occurredAt: input.occurredAt,
    recordClass: "sample",
    stream: "sleep_stage",
    title: `Oura ${input.stage} sleep`,
  });
}

test("daily sleep summary anchors metrics to the selected overnight sleep session instead of same-day nap", () => {
  const longSleepResourceId = "z-overnight-sleep";
  const napResourceId = "a-afternoon-nap";
  const vault = createVaultReadModel({
    entities: [
      makeSleepSession({
        durationMinutes: 502,
        endAt: "2026-06-04T06:41:00Z",
        entityId: "evt_oura_sleep_long",
        recordedAt: "2026-06-04T06:45:00Z",
        resourceId: longSleepResourceId,
        startAt: "2026-06-03T22:18:00Z",
        title: "Oura sleep",
      }),
      makeSleepSession({
        durationMinutes: 33,
        endAt: "2026-06-04T15:01:00Z",
        entityId: "evt_oura_sleep_nap",
        recordedAt: "2026-06-04T15:02:00Z",
        resourceId: napResourceId,
        startAt: "2026-06-04T14:28:00Z",
        title: "Oura nap",
      }),
      makeSleepMetric({
        entityId: "evt_oura_long_total",
        metric: "sleep-total-minutes",
        recordedAt: "2026-06-04T06:45:00Z",
        resourceId: longSleepResourceId,
        value: 450,
      }),
      makeSleepMetric({
        entityId: "evt_oura_long_deep",
        metric: "sleep-deep-minutes",
        recordedAt: "2026-06-04T06:45:00Z",
        resourceId: longSleepResourceId,
        value: 57,
      }),
      makeSleepMetric({
        entityId: "evt_oura_long_rem",
        metric: "sleep-rem-minutes",
        recordedAt: "2026-06-04T06:45:00Z",
        resourceId: longSleepResourceId,
        value: 83.5,
      }),
      makeSleepMetric({
        entityId: "evt_oura_long_light",
        metric: "sleep-light-minutes",
        recordedAt: "2026-06-04T06:45:00Z",
        resourceId: longSleepResourceId,
        value: 309.5,
      }),
      makeSleepMetric({
        entityId: "evt_oura_long_efficiency",
        metric: "sleep-efficiency",
        recordedAt: "2026-06-04T06:45:00Z",
        resourceId: longSleepResourceId,
        value: 90,
      }),
      makeSleepMetric({
        entityId: "evt_oura_long_hrv",
        metric: "hrv",
        recordedAt: "2026-06-04T06:45:00Z",
        resourceId: longSleepResourceId,
        value: 55,
      }),
      makeSleepMetric({
        entityId: "evt_oura_long_lowest_hr",
        metric: "lowest-heart-rate",
        recordedAt: "2026-06-04T06:45:00Z",
        resourceId: longSleepResourceId,
        value: 50,
      }),
      makeSleepMetric({
        entityId: "evt_oura_nap_total",
        metric: "sleep-total-minutes",
        recordedAt: "2026-06-04T15:02:00Z",
        resourceId: napResourceId,
        value: 20.5,
      }),
      makeSleepMetric({
        entityId: "evt_oura_nap_deep",
        metric: "sleep-deep-minutes",
        recordedAt: "2026-06-04T15:02:00Z",
        resourceId: napResourceId,
        value: 0,
      }),
      makeSleepMetric({
        entityId: "evt_oura_nap_rem",
        metric: "sleep-rem-minutes",
        recordedAt: "2026-06-04T15:02:00Z",
        resourceId: napResourceId,
        value: 0,
      }),
      makeSleepMetric({
        entityId: "evt_oura_nap_light",
        metric: "sleep-light-minutes",
        recordedAt: "2026-06-04T15:02:00Z",
        resourceId: napResourceId,
        value: 20.5,
      }),
      makeSleepMetric({
        entityId: "evt_oura_nap_efficiency",
        metric: "sleep-efficiency",
        recordedAt: "2026-06-04T15:02:00Z",
        resourceId: napResourceId,
        value: 62,
      }),
      makeSleepMetric({
        entityId: "evt_oura_nap_average_hr",
        metric: "average-heart-rate",
        recordedAt: "2026-06-04T15:02:00Z",
        resourceId: napResourceId,
        value: 64,
      }),
      makeSleepMetric({
        entityId: "evt_oura_nap_sleep_score",
        metric: "sleep-score",
        recordedAt: "2026-06-04T15:02:00Z",
        resourceId: napResourceId,
        value: 42,
      }),
      makeEntity({
        attributes: {
          dayKey: "2026-06-04",
          externalRef: makeExternalRef({
            facet: "sleep-score",
            resourceId: "daily-sleep-2026-06-04",
            resourceType: "daily-sleep",
            system: "oura",
          }),
          metric: "sleep-score",
          recordedAt: "2026-06-04T06:45:00Z",
          unit: "%",
          value: 86,
        },
        entityId: "evt_oura_daily_sleep_score",
        family: "event",
        kind: "observation",
        occurredAt: "2026-06-04T06:45:00Z",
        recordClass: "ledger",
        title: "Oura sleep score",
      }),
    ],
    metadata: null,
    vaultRoot: "/virtual/wearables-sleep-anchor",
  });

  const [night] = summarizeWearableSleep(vault, { date: "2026-06-04" });
  const day = summarizeWearableDay(vault, "2026-06-04");

  assert.equal(night?.sleepStartAt, "2026-06-03T22:18:00Z");
  assert.equal(night?.sleepEndAt, "2026-06-04T06:41:00Z");
  assert.equal(night?.sessionMinutes.selection.value, 502);
  assert.equal(night?.totalSleepMinutes.selection.value, 450);
  assert.equal(night?.deepMinutes.selection.value, 57);
  assert.equal(night?.remMinutes.selection.value, 83.5);
  assert.equal(night?.lightMinutes.selection.value, 309.5);
  assert.equal(night?.sleepEfficiency.selection.value, 90);
  assert.equal(night?.hrv.selection.value, 55);
  assert.equal(night?.lowestHeartRate.selection.value, 50);
  assert.equal(night?.averageHeartRate.selection.value, null);
  assert.equal(night?.sleepScore.selection.value, 86);
  assert.deepEqual(night?.sleepScore.candidates.map((candidate) => candidate.recordIds[0]), ["evt_oura_daily_sleep_score"]);
  assert.deepEqual(night?.totalSleepMinutes.selection.recordIds, ["evt_oura_long_total"]);
  assert.deepEqual(night?.deepMinutes.candidates.map((candidate) => candidate.recordIds[0]), ["evt_oura_long_deep"]);
  assert.equal(day?.sleep?.totalSleepMinutes.selection.value, 450);
});

test("daily sleep summary derives stage totals from the selected sleep window instead of same-day nap stages", () => {
  const longSleepResourceId = "z-overnight-sleep";
  const napResourceId = "a-afternoon-nap";
  const vault = createVaultReadModel({
    entities: [
      makeSleepSession({
        durationMinutes: 502,
        endAt: "2026-06-04T06:41:00Z",
        entityId: "evt_oura_stage_sleep_long",
        recordedAt: "2026-06-04T06:45:00Z",
        resourceId: longSleepResourceId,
        startAt: "2026-06-03T22:18:00Z",
        title: "Oura sleep",
      }),
      makeSleepSession({
        durationMinutes: 33,
        endAt: "2026-06-04T15:01:00Z",
        entityId: "evt_oura_stage_sleep_nap",
        recordedAt: "2026-06-04T15:02:00Z",
        resourceId: napResourceId,
        startAt: "2026-06-04T14:28:00Z",
        title: "Oura nap",
      }),
      makeSleepStageSample({
        dayKey: "2026-06-03",
        durationMinutes: 309.5,
        entityId: "sample_oura_stage_long_light",
        occurredAt: "2026-06-03T23:40:00Z",
        recordedAt: "2026-06-04T06:45:00Z",
        resourceId: "long-light-stage",
        stage: "light",
      }),
      makeSleepStageSample({
        durationMinutes: 57,
        entityId: "sample_oura_stage_long_deep",
        occurredAt: "2026-06-04T02:00:00Z",
        recordedAt: "2026-06-04T06:45:00Z",
        resourceId: "long-deep-stage",
        stage: "deep",
      }),
      makeSleepStageSample({
        durationMinutes: 83.5,
        entityId: "sample_oura_stage_long_rem",
        occurredAt: "2026-06-04T03:00:00Z",
        recordedAt: "2026-06-04T06:45:00Z",
        resourceId: "long-rem-stage",
        stage: "rem",
      }),
      makeSleepStageSample({
        durationMinutes: 20.5,
        entityId: "sample_oura_stage_nap_light",
        occurredAt: "2026-06-04T14:30:00Z",
        recordedAt: "2026-06-04T15:02:00Z",
        resourceId: "nap-light-stage",
        stage: "light",
      }),
    ],
    metadata: null,
    vaultRoot: "/virtual/wearables-sleep-stage-anchor",
  });

  const [night] = summarizeWearableSleep(vault, { date: "2026-06-04" });

  assert.equal(night?.sleepStartAt, "2026-06-03T22:18:00Z");
  assert.equal(night?.sleepEndAt, "2026-06-04T06:41:00Z");
  assert.equal(night?.lightMinutes.selection.value, 309.5);
  assert.equal(night?.deepMinutes.selection.value, 57);
  assert.equal(night?.remMinutes.selection.value, 83.5);
  assert.equal(night?.totalSleepMinutes.selection.value, 450);
  assert.equal(night?.totalSleepMinutes.selection.sourceKind, "sleep-stage-total");
  assert.deepEqual(night?.lightMinutes.selection.recordIds, ["sample_oura_stage_long_light"]);
});
