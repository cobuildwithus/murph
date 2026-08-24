import assert from "node:assert/strict";

import { test } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { buildJournalView } from "../src/journal-view.ts";
import type { MetricPoint } from "../src/metrics/index.ts";
import { createVaultReadModel } from "../src/read-model.ts";

test("Journal groups canonical records into human events without copying source data", () => {
  const tennis = event("tennis", "activity_session", "2026-08-20T18:00:00.000Z", {
    activityType: "tennis",
    durationMinutes: 74,
    source: "device",
    timeZone: "America/New_York",
  }, "Tennis");
  const quality = event("tennis_quality", "note", "2026-08-20T19:30:00.000Z", {
    note: "Played well.",
    noteType: "journal-outcome",
    source: "manual",
  }, "Played well", [{ targetId: tennis.entityId, type: "related_to" }]);
  const pain = event("tennis_pain", "note", "2026-08-20T19:31:00.000Z", {
    note: "Elbow feels sore.",
    noteType: "journal-outcome",
    source: "manual",
  }, "Elbow feels sore", [{ targetId: tennis.entityId, type: "related_to" }]);
  const sleep = event("sleep", "sleep_session", "2026-08-20T07:00:00.000Z", {
    durationMinutes: 420,
    source: "device",
  }, "Sleep");
  const bloodTest = event("blood", "test", "2026-08-20T09:00:00.000Z", {
    source: "import",
    testName: "Blood panel",
  }, "Blood panel");
  const oldJournalDay = entity("journal", "journal_day", {
    date: "2026-08-20",
    kind: "journal_day",
    title: "Legacy daily journal",
  });
  const view = buildJournalView(createVaultReadModel({
    entities: [tennis, quality, pain, sleep, bloodTest, oldJournalDay],
    vaultRoot: "test://journal-view",
  }), [
    metric("sleep-score", "2026-08-20", 61, "score"),
    metric("hrv-rmssd", "2026-08-20", 42, "ms"),
  ], { asOf: "2026-08-21T12:00:00.000Z" });

  assert.equal(view.days.length, 1);
  assert.equal(view.eventCount, 3);
  assert.equal(view.recordCount, 7);
  const events = view.days[0]?.events ?? [];
  const sleepEvent = events.find((entry) => entry.kind === "sleep");
  const activityEvent = events.find((entry) => entry.kind === "activity");
  const testEvent = events.find((entry) => entry.kind === "test");
  assert.deepEqual(sleepEvent?.records.map((record) => record.label).sort(), [
    "HRV",
    "Sleep",
    "Sleep score",
  ]);
  assert.deepEqual(activityEvent?.records.map((record) => record.id).sort(), [
    "tennis",
    "tennis_pain",
    "tennis_quality",
  ]);
  assert.equal(activityEvent?.occurredAt, "2026-08-20T18:00:00.000Z");
  assert.equal(activityEvent?.timeZone, "America/New_York");
  assert.equal(testEvent?.title, "Blood panel");
  assert.equal(events.some((entry) => entry.id.includes("journal_day")), false);
});

test("Journal remains useful with notes only and keeps independent facts separate", () => {
  const view = buildJournalView(createVaultReadModel({
    entities: [
      event("sauna", "note", "2026-08-20T18:00:00.000Z", {
        note: "Sauna at 90 C for 20 minutes.",
        noteType: "journal-factor",
        source: "manual",
      }, "Sauna"),
      event("dinner", "note", "2026-08-20T21:00:00.000Z", {
        note: "Late dinner.",
        noteType: "journal-factor",
        source: "manual",
      }, "Late dinner"),
    ],
    vaultRoot: "test://journal-notes-only",
  }), [], { asOf: "2026-08-20" });

  assert.equal(view.eventCount, 2);
  assert.deepEqual(
    view.days[0]?.events.map((entry) => entry.title),
    ["Late dinner", "Sauna"],
  );
});

function event(
  id: string,
  kind: string,
  occurredAt: string,
  attributes: Record<string, unknown>,
  title: string,
  links: CanonicalEntity["links"] = [],
): CanonicalEntity {
  return entity("event", id, {
    attributes,
    date: occurredAt.slice(0, 10),
    kind,
    links,
    occurredAt,
    title,
  });
}

function metric(metricKey: string, date: string, value: number, unit: string): MetricPoint {
  return {
    biomarkerKey: null,
    canonicalUnit: unit,
    canonicalValue: value,
    comparator: null,
    confidence: "high",
    context: {},
    effectiveDate: date,
    grain: "day",
    id: `metric_${metricKey}_${date}`,
    metricKey,
    observedAt: `${date}T07:00:00.000Z`,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: "oura",
      rawRefs: [],
      sourceLabel: "Oura",
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: "murph.metric-point.v1",
    source: {
      family: "derived",
      kind: "wearable-summary",
      path: "",
      recordId: `record:${metricKey}:${date}`,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit,
    value,
  };
}

function entity(
  family: CanonicalEntity["family"],
  id: string,
  overrides: Partial<CanonicalEntity>,
): CanonicalEntity {
  return {
    attributes: {},
    body: null,
    date: null,
    entityId: id,
    experimentSlug: null,
    family,
    frontmatter: null,
    kind: family,
    links: [],
    lookupIds: [id],
    occurredAt: null,
    path: `${family}/${id}.jsonl`,
    primaryLookupId: id,
    recordClass: family === "sample" ? "sample" : "ledger",
    relatedIds: [],
    status: null,
    stream: null,
    tags: [],
    title: null,
    ...overrides,
  };
}
