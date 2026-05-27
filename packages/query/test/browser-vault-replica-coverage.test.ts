import assert from "node:assert/strict";

import { test } from "vitest";

import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  parseBrowserVaultReplica,
  type BrowserVaultReplica,
} from "../src/browser.ts";
import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { buildMetricProjection, type MetricPoint } from "../src/index.ts";
import { createVaultReadModel } from "../src/model.ts";

type CreateReplicaInput = Omit<Parameters<typeof createBrowserVaultReplica>[0], "metricPoints">;

async function createBrowserVaultReplicaFromVault(input: CreateReplicaInput) {
  return createBrowserVaultReplica({
    ...input,
    metricPoints: buildMetricProjection(input.vault).metricPoints,
  });
}

test("browser vault query clients parse final metric-key replicas and filter metrics", () => {
  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(createReplicaFixture()));

  assert.equal(client.metrics.latestRow({ metricKey: "steps" })?.value, 920);
  assert.deepEqual(client.metrics.series({ metricKey: "steps" }).map((row) => row.date), ["2026-04-19", "2026-04-20"]);
  assert.deepEqual(client.metrics.seriesMany([{ metricKey: "steps" }, { metricKey: "sleep-score" }]).map((series) => series.at(-1)?.value), [920, 91]);
  assert.equal(client.metricSelections.get("steps")?.value, 920);
  assert.equal(client.metricSelections.get("dailyStepCount")?.value, 920);
  assert.equal(client.metrics.latestRow({ metricKey: "dailyStepCount" })?.value, 920);
  assert.equal(client.metricGoals.progress({ goalId: "goal_rhr" }).length, 1);
  assert.equal(client.metricGoals.progress({ metricKey: "rhr" }).length, 1);
  assert.deepEqual(client.search("steady", { families: ["experiment"] }).map((row) => row.entityId), ["exp_browser"]);
});

test("browser vault replica parsing requires final goal progress rows", () => {
  const replica = { ...createReplicaFixture() } as Record<string, unknown>;
  delete replica.metricGoalProgressRows;

  assert.throws(
    () => parseBrowserVaultReplica(replica),
    /Browser vault replica\.metricGoalProgressRows must be an array/u,
  );
});

test("browser vault replica creation emits metric-key rows from wearable and vault evidence", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "f".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createCanonicalEntity("sample", "sample_steps", { attributes: { externalRef: { resourceId: "steps-1", resourceType: "summary", system: "garmin" }, recordedAt: "2026-04-20T07:00:00.000Z", value: 920 }, date: "2026-04-20", stream: "steps", title: "Daily steps" }),
        createCanonicalEntity("sample", "sample_spo2", { attributes: { externalRef: { resourceId: "spo2-1", resourceType: "summary", system: "oura" }, recordedAt: "2026-04-20T07:20:00.000Z", unit: "%", value: 97.5 }, date: "2026-04-20", stream: "spo2", title: "Blood oxygen" }),
        createCanonicalEntity("event", "evt_measurement", { attributes: { measurements: [{ metric: "body-weight", unit: "lb", value: 180 }], source: "manual" }, kind: "measurement", occurredAt: "2026-04-20T07:30:00.000Z", title: "Body check" }),
        createCanonicalEntity("event", "evt_test", { attributes: { collectedAt: "2026-04-20T08:00:00.000Z", labName: "Function Health", results: [{ biomarkerSlug: "apob", unit: "mg/dL", value: 87 }] }, kind: "test", occurredAt: "2026-04-20T08:00:00.000Z", title: "Blood panel" }),
      ],
      metadata: { title: "Metric browser vault" },
      vaultRoot: "browser://coverage",
    }),
  });

  assert.equal(replica.metricRows.some((row) => row.metricKey === "steps"), true);
  assert.equal(replica.metricRows.some((row) => row.metricKey === "spo2" && row.value === 97.5), true);
  assert.equal(replica.metricRows.some((row) => row.metricKey === "body-weight"), true);
  assert.equal(replica.metricSelectionRows.some((row) => row.metricKey === "apob" && row.value === 87), true);
  assert.equal(Object.hasOwn(replica, "metricDayRows"), false);
});

test("browser vault replica excludes dense provider observations but keeps display-grade facts", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "f".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createCanonicalEntity("event", "evt_raw_device_point", {
          attributes: {
            metric: "heart-rate",
            source: "device",
            unit: "bpm",
            value: 72,
          },
          kind: "observation",
          title: "Raw heart-rate point",
        }),
        createCanonicalEntity("event", "evt_raw_import_point", {
          attributes: {
            metric: "resting-heart-rate",
            source: "import",
            unit: "bpm",
            value: 59,
          },
          kind: "observation",
          title: "Raw imported resting heart-rate point",
        }),
        createCanonicalEntity("event", "evt_display_device_fact", {
          attributes: {
            metric: "readiness-score",
            queryVisibility: "default",
            source: "device",
            unit: "score",
            value: 8,
          },
          kind: "observation",
          title: "Readiness fact",
        }),
      ],
      metadata: { title: "Browser dense observation vault" },
      vaultRoot: "browser://dense-observations",
    }),
  });

  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));
  const observationSearchRows = client.search("observation");

  assert.equal(client.entities.get("evt_raw_device_point"), null);
  assert.equal(client.entities.get("evt_raw_import_point"), null);
  assert.equal(client.entities.get("evt_display_device_fact")?.id, "evt_display_device_fact");
  assert.equal(observationSearchRows.some((row) => row.entityId === "evt_raw_device_point"), false);
  assert.equal(observationSearchRows.some((row) => row.entityId === "evt_raw_import_point"), false);
  assert.equal(observationSearchRows.some((row) => row.entityId === "evt_display_device_fact"), true);
  assert.equal(replica.timelineRows.some((row) => row.id === "evt_raw_device_point"), false);
  assert.equal(replica.timelineRows.some((row) => row.id === "evt_raw_import_point"), false);
  assert.equal(replica.timelineRows.some((row) => row.id === "evt_display_device_fact"), true);
});

test("browser vault replica creation uses supplied metric points with a sparse vault", async () => {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-04-20T12:00:00.000Z",
    metricPoints: [
      createMetricPoint({
        biomarkerKey: "biomarker:apob",
        metricKey: "apob",
        recordId: "evt_projection_test",
        sourceKind: "test-result",
        value: 87,
        unit: "mg/dL",
      }),
    ],
    sourceBundleHash: "f".repeat(64),
    vault: createVaultReadModel({
      entities: [],
      metadata: { title: "Sparse browser vault" },
      vaultRoot: "browser://sparse",
    }),
  });

  assert.equal(replica.entities.length, 0);
  assert.deepEqual(replica.metricRows.map((row) => [row.metricKey, row.value, row.unit]), [
    ["apob", 87, "mg/dL"],
  ]);
  assert.equal(replica.metricSelectionRows.some((row) => row.metricKey === "apob" && row.value === 87), true);
});

function createReplicaFixture(): BrowserVaultReplica {
  return {
    assistantSummary: { highlights: ["Keep it light."], latestDate: "2026-04-20" },
    entities: [{ attributes: {}, bodyPreview: "steady", date: "2026-04-20", experimentSlug: null, family: "experiment", id: "exp_browser", kind: "experiment_entry", links: [], lookupIds: ["exp_browser"], occurredAt: "2026-04-20T08:00:00.000Z", recordClass: "bank", status: "active", stream: null, tags: ["focus"], title: "Steady experiment" }],
    generatedAt: "2026-04-20T12:00:00.000Z",
    metricGoalProgressRows: [{ currentValue: 41, currentValueLabel: "41", deltaToTarget: 1, goalId: "goal_rhr", metricKey: "resting-heart-rate", selectedPointIds: ["p_rhr"], status: "behind", targetId: "rhr-under-40", targetValueLabel: "<40 bpm", unit: "bpm", warnings: [] }],
    metricRows: [
      metricRow("steps", "2026-04-19", 820, "steps"),
      metricRow("steps", "2026-04-20", 920, "steps"),
      metricRow("sleep-score", "2026-04-20", 91, "score"),
    ],
    metricSelectionRows: [{ biomarkerKey: null, confidence: "high", effectiveDate: "2026-04-20", id: "metric-selection:steps:none", metricKey: "steps", observedAt: "2026-04-20T00:00:00.000Z", pointIds: ["p_steps"], recordIds: ["r_steps"], selectedMetricRowId: "metric-row:p_steps", selectionSchema: "murph.browser-vault.metric-selection.v1", sourceLabel: "Wearable summary", status: "ready", unit: "steps", value: 920, valueLabel: "920", warnings: [] }],
    policy: { bodyPreviewChars: 280, excludedFamilies: [], id: BROWSER_VAULT_REPLICA_POLICY_ID, includedFamilies: [], metricLookbackDays: 365 },
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    searchRows: [{ date: "2026-04-20", entityId: "exp_browser", family: "experiment", id: "exp_browser", kind: "experiment_entry", occurredAt: "2026-04-20T08:00:00.000Z", tags: ["focus"], text: "steady", title: "Steady experiment" }],
    source: { dataVersion: "a".repeat(64), sourceBundleHash: "b".repeat(64) },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
  };
}

function metricRow(metricKey: string, date: string, value: number, unit: string) {
  return { biomarkerKey: null, confidence: "high" as const, context: {}, date, grain: "day" as const, id: `metric-row:${metricKey}:${date}`, metricKey, observedAt: `${date}T00:00:00.000Z`, pointIds: [`p_${metricKey}_${date}`], recordIds: [`r_${metricKey}_${date}`], rowSchema: "murph.browser-vault.metric-row.v1" as const, sourceFamily: "derived", sourceKind: "wearable-summary", sourceLabel: "Wearable summary", statistic: "value" as const, unit, value, valueLabel: String(value) };
}

function createMetricPoint(input: {
  biomarkerKey: string | null;
  metricKey: string;
  recordId: string;
  sourceKind: MetricPoint["source"]["kind"];
  unit: string;
  value: number;
}): MetricPoint {
  return {
    biomarkerKey: input.biomarkerKey,
    canonicalUnit: input.unit,
    canonicalValue: input.value,
    comparator: null,
    confidence: "high",
    context: {},
    effectiveDate: "2026-04-20",
    grain: "day",
    id: `metric-point:${input.metricKey}:2026-04-20`,
    metricKey: input.metricKey,
    observedAt: "2026-04-20T08:00:00.000Z",
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: "Blood panel",
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: "murph.metric-point.v1",
    source: {
      family: "event",
      kind: input.sourceKind,
      path: "ledger/events/2026/2026-04.jsonl",
      recordId: input.recordId,
      resultIndex: 0,
    },
    statistic: "value",
    textValue: null,
    unit: input.unit,
    value: input.value,
  };
}

function createCanonicalEntity(family: CanonicalEntity["family"], entityId: string, overrides: Partial<CanonicalEntity> = {}): CanonicalEntity {
  return {
    attributes: overrides.attributes ?? {},
    body: overrides.body ?? null,
    date: overrides.date ?? "2026-04-20",
    entityId,
    experimentSlug: overrides.experimentSlug ?? null,
    family,
    frontmatter: overrides.frontmatter ?? null,
    kind: overrides.kind ?? `${family}_entry`,
    links: overrides.links ?? [],
    lookupIds: overrides.lookupIds ?? [entityId],
    occurredAt: overrides.occurredAt ?? "2026-04-20T00:00:00.000Z",
    path: overrides.path ?? `history/${family}/${entityId}.md`,
    primaryLookupId: overrides.primaryLookupId ?? entityId,
    recordClass: overrides.recordClass ?? (family === "sample" ? "sample" : family === "event" || family === "journal" ? "ledger" : "bank"),
    relatedIds: overrides.relatedIds ?? [],
    status: overrides.status ?? null,
    stream: overrides.stream ?? null,
    tags: overrides.tags ?? [],
    title: overrides.title ?? entityId,
  } satisfies CanonicalEntity;
}
