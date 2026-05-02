import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  QUERY_DB_RELATIVE_PATH,
  openSqliteRuntimeDatabase,
} from "@murphai/runtime-state/node";
import { test } from "vitest";

import {
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
  parseBrowserVaultReplica,
} from "../src/browser.ts";
import { rebuildQueryProjection } from "../src/index.ts";

type CanonicalEntity = Parameters<typeof createVaultReadModel>[0]["entities"][number];

test("browser-vault metric points project manual measurements and blood-test results through one primitive", async () => {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-05-02T12:00:00.000Z",
    sourceBundleHash: "f".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEvent("evt_measurement", "measurement", {
          occurredAt: "2026-05-02T09:30:00.000Z",
          title: "Morning body check",
          attributes: {
            measurements: [
              { metric: "body weight", value: 180, unit: "lb" },
              { metric: "body_fat_pct", value: 14.8, unit: "percent" },
              { metric: "glucose", value: 88, unit: "mg_dL" },
            ],
            source: "manual",
          },
        }),
        createEvent("evt_body_measurement", "body_measurement", {
          occurredAt: "2026-04-29T07:30:00.000Z",
          title: "Legacy body check",
          attributes: {
            measurements: [
              { type: "weight", value: 181, unit: "lb" },
            ],
            source: "manual",
          },
        }),
        createEvent("evt_blood_panel", "test", {
          occurredAt: "2026-05-01T10:00:00.000Z",
          title: "Function Health panel",
          attributes: {
            collectedAt: "2026-05-02T08:15:00.000Z",
            fastingStatus: "fasting",
            labName: "Function Health",
            reportedAt: "2026-05-02T18:00:00.000Z",
            resultStatus: "normal",
            results: [
              {
                analyte: "Apolipoprotein B",
                biomarkerSlug: "apob",
                flag: "normal",
                referenceRange: { text: "<90" },
                unit: "mg/dL",
                value: 87,
              },
              {
                analyte: "Glucose",
                biomarkerSlug: "glucose",
                flag: "normal",
                unit: "mg/dL",
                value: 82,
              },
              {
                analyte: "hs-CRP",
                comparator: "<",
                slug: "hs-crp",
                unit: "mg/L",
                value: 0.3,
              },
              {
                analyte: "Unreviewed private panel note",
                unit: "score",
                value: 5,
              },
            ],
            source: "manual",
            testCategory: "blood",
            testName: "functional_health_panel",
          },
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));

  const bodyWeight = client.metricSelections.get("body-weight");
  assert.ok(bodyWeight);
  assert.equal(bodyWeight.unit, "kg");
  assert.equal(Number(bodyWeight.value.toFixed(1)), 81.6);
  assert.equal(bodyWeight.sourceLabel, "Manual");
  assert.equal(bodyWeight.recordIds[0], "evt_measurement");

  const bodyFat = client.metricSelections.get("body-fat-percentage");
  assert.ok(bodyFat);
  assert.equal(bodyFat.valueLabel, "14.8");
  assert.equal(bodyFat.unit, "percent");

  const apob = client.metricSelections.get("apob");
  assert.ok(apob);
  assert.equal(apob.value, 87);
  assert.equal(apob.unit, "mg/dL");
  assert.equal(apob.sourceLabel, "Function Health");
  assert.equal(apob.recordIds[0], "evt_blood_panel");

  const glucose = client.metricSelections.getByBiomarker("biomarker:blood-glucose");
  assert.ok(glucose);
  assert.equal(glucose.metricKey, "glucose");
  assert.equal(glucose.value, 82);
  assert.equal(glucose.sourceLabel, "Function Health");
  assert.equal(glucose.warnings.some((warning) => warning.code === "MIXED_SOURCES"), true);

  const crp = client.metricSelections.get("hs-crp");
  assert.ok(crp);
  assert.equal(crp.valueLabel, "<0.3");
  assert.equal(crp.unit, "mg/L");
  assert.equal(client.metricSelections.get("unreviewed-private-panel-note"), null);

  assert.equal(client.metricPoints.series({ metricKey: "body-weight" }).length, 2);
  assert.equal(client.metricPoints.latest({ metricKey: "apob" })?.sourceKind, "test-result");
});

test("browser-vault metric points keep observation inputs while selecting the higher-priority stale reading", async () => {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-05-02T12:00:00.000Z",
    sourceBundleHash: "f".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEvent("evt_weight_measurement", "measurement", {
          occurredAt: "2026-03-01T07:30:00.000Z",
          title: "Old body check",
          attributes: {
            measurements: [
              { metric: "body_weight", value: 180, unit: "lb" },
            ],
            source: "manual",
          },
        }),
        createEvent("evt_weight_observation", "observation", {
          occurredAt: "2026-03-01T07:30:00.000Z",
          title: "Observation body check",
          attributes: {
            metric: "bodyWeight",
            source: "manual",
            unit: "lb",
            value: 181,
          },
        }),
        createEvent("evt_old_weight", "measurement", {
          occurredAt: "2024-01-01T07:30:00.000Z",
          title: "Old body check outside browser-vault lookback",
          attributes: {
            measurements: [
              { metric: "body_weight", value: 190, unit: "lb" },
            ],
            source: "manual",
          },
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));

  const bodyWeightPoints = client.metricPoints.series({ metricKey: "body-weight" });
  assert.equal(bodyWeightPoints.some((point) => point.sourceKind === "measurement"), true);
  assert.equal(bodyWeightPoints.some((point) => point.sourceKind === "compat-observation"), true);
  assert.equal(bodyWeightPoints.some((point) => point.recordIds.includes("evt_old_weight")), false);

  const bodyWeight = client.metricSelections.get("body-weight");
  assert.ok(bodyWeight);
  assert.equal(bodyWeight.status, "stale");
  assert.equal(bodyWeight.unit, "kg");
  assert.equal(Number(bodyWeight.value.toFixed(1)), 81.6);
  assert.equal(
    bodyWeightPoints.find((point) => point.id === bodyWeight.pointIds[0])?.sourceKind,
    "measurement",
  );
  assert.equal(bodyWeight.warnings.some((warning) => warning.code === "SOURCE_STALE"), true);
  assert.equal(bodyWeight.warnings.some((warning) => warning.code === "MIXED_SOURCES"), true);
});

test("query projection rebuild stores event-backed metric points in the projection table", async () => {
  const vaultRoot = await createMetricPointProjectionVault();

  try {
    const rebuilt = await rebuildQueryProjection(vaultRoot);
    assert.equal(rebuilt.schemaVersion, "murph.query-projection.v2");

    const database = openSqliteRuntimeDatabase(path.join(vaultRoot, QUERY_DB_RELATIVE_PATH), {
      create: false,
      readOnly: true,
    });

    try {
      const rows = database.prepare(`
        SELECT
          metric_key AS metricKey,
          biomarker_key AS biomarkerKey,
          unit,
          value,
          value_label AS valueLabel,
          source_kind AS sourceKind,
          record_ids_json AS recordIdsJson
        FROM query_metric_points
        ORDER BY metric_key ASC
      `).all() as Array<{
        biomarkerKey: string | null;
        metricKey: string;
        recordIdsJson: string;
        sourceKind: string;
        unit: string;
        value: number;
        valueLabel: string;
      }>;

      assert.deepEqual(rows.map((row) => row.metricKey), ["apob", "body-weight"]);
      assert.equal(rows.find((row) => row.metricKey === "body-weight")?.unit, "kg");
      assert.equal(
        Number(rows.find((row) => row.metricKey === "body-weight")?.value.toFixed(1)),
        81.6,
      );
      assert.equal(rows.find((row) => row.metricKey === "apob")?.biomarkerKey, "biomarker:apob");
      assert.equal(rows.find((row) => row.metricKey === "apob")?.sourceKind, "test-result");
      assert.deepEqual(
        JSON.parse(rows.find((row) => row.metricKey === "apob")?.recordIdsJson ?? "[]"),
        ["evt_projection_test"],
      );
    } finally {
      database.close();
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

function createEvent(
  entityId: string,
  kind: string,
  overrides: Partial<CanonicalEntity> = {},
): CanonicalEntity {
  const occurredAt = overrides.occurredAt ?? "2026-05-01T00:00:00.000Z";
  const date = overrides.date ?? occurredAt.slice(0, 10);

  return {
    attributes: overrides.attributes ?? {},
    body: overrides.body ?? null,
    date,
    entityId,
    experimentSlug: overrides.experimentSlug ?? null,
    family: "event",
    frontmatter: overrides.frontmatter ?? null,
    kind,
    links: overrides.links ?? [],
    lookupIds: overrides.lookupIds ?? [entityId],
    occurredAt,
    path: overrides.path ?? `ledger/events/2026/2026-05.jsonl`,
    primaryLookupId: overrides.primaryLookupId ?? entityId,
    recordClass: "ledger",
    relatedIds: overrides.relatedIds ?? [],
    status: overrides.status ?? null,
    stream: null,
    tags: overrides.tags ?? [],
    title: overrides.title ?? kind,
  } satisfies CanonicalEntity;
}

async function createMetricPointProjectionVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-metric-points-"));
  const eventsDir = path.join(vaultRoot, "ledger/events/2026");

  await mkdir(eventsDir, { recursive: true });
  await writeFile(
    path.join(vaultRoot, "vault.json"),
    JSON.stringify(
      {
        formatVersion: 1,
        vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
        title: "Metric points test vault",
        timezone: "America/New_York",
        createdAt: "2026-05-01T00:00:00.000Z",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(eventsDir, "2026-05.jsonl"),
    [
      JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_projection_measurement",
        kind: "measurement",
        occurredAt: "2026-05-01T07:30:00.000Z",
        recordedAt: "2026-05-01T07:31:00.000Z",
        dayKey: "2026-05-01",
        source: "manual",
        title: "Morning body check",
        measurements: [
          { metric: "body weight", value: 180, unit: "lb" },
        ],
      }),
      JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_projection_test",
        kind: "test",
        occurredAt: "2026-05-02T08:00:00.000Z",
        recordedAt: "2026-05-02T18:00:00.000Z",
        dayKey: "2026-05-02",
        source: "manual",
        title: "Blood panel",
        labName: "Function Health",
        collectedAt: "2026-05-02T08:15:00.000Z",
        results: [
          {
            analyte: "Apolipoprotein B",
            biomarkerSlug: "apob",
            unit: "mg/dL",
            value: 87,
          },
        ],
      }),
      "",
    ].join("\n"),
  );

  return vaultRoot;
}
