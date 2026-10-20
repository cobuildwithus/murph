import assert from "node:assert/strict";

import { test } from "vitest";

import {
  BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
  createBrowserVaultInteractiveQueryClient,
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
  parseBrowserVaultReplica,
  selectBrowserVaultExperimentResults,
  splitBrowserVaultReplica,
} from "../src/browser.ts";
import {
  buildMetricProjection,
  selectMetricGoalProgress,
  selectMetricValue,
} from "../src/index.ts";

type CanonicalEntity = Parameters<
  typeof createVaultReadModel
>[0]["entities"][number];

test("combined shard clients preserve deep immutability and lab identity validation", async () => {
  const vault = createVaultReadModel({
    entities: [createLabTest("evt_albumin", "2026-06-01T08:00:00.000Z", [{
      analyte: "Albumin",
      biomarkerSlug: "albumin",
      referenceRange: { high: 5, low: 3.5 },
      unit: "g/dL",
      value: 4.2,
    }])],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const shards = await splitBrowserVaultReplica(await createBrowserVaultReplica({
    generatedAt: "2026-07-16T12:00:00.000Z",
    metricPoints: buildMetricProjection(vault).metricPoints,
    sourceBundleHash: "8".repeat(64),
    vault,
  }));
  // A shallow-frozen input must not prevent freezing its nested lab fields.
  Object.freeze(shards.labs.labResultRows);
  const client = createBrowserVaultInteractiveQueryClient(shards.core, shards.metrics, shards.labs);
  const row = client.labResults.list()[0];
  assert.ok(row?.referenceRange);
  assert.equal(Object.isFrozen(client.replica), true);
  const entity = client.replica.entities[0];
  assert.ok(entity);
  assert.equal(Object.isFrozen(entity.attributes), true);
  assert.equal(Object.isFrozen(client.replica.labResultRows), true);
  assert.equal(Object.isFrozen(row), true);
  assert.equal(Object.isFrozen(row.referenceRange), true);
  const referenceRange = row.referenceRange;
  assert.throws(() => { referenceRange.high = 99; }, TypeError);
  assert.equal(client.labResults.list()[0]?.referenceRange?.high, 5);
  assert.throws(() => createBrowserVaultInteractiveQueryClient(shards.core, shards.metrics, {
    ...shards.labs,
    identity: { ...shards.labs.identity, sourceBundleHash: "9".repeat(64) },
  }), /labs shard identity must match the core shard identity/u);
});

test("browser vault projects all live lab history without widening the wearable lookback", async () => {
  const vault = createVaultReadModel({
    entities: [
      createEvent("evt_old_rhr", "observation", "2020-01-01T07:00:00.000Z", {
        metric: "resting-heart-rate",
        source: "manual",
        unit: "bpm",
        value: 61,
      }),
      createLabTest("evt_hba1c_2020", "2020-02-01T08:00:00.000Z", [
        {
          analyte: "Hemoglobin A1c",
          biomarkerSlug: "hba1c",
          flag: "normal",
          referenceRange: { high: 5.6, low: 4, text: "4.0-5.6" },
          unit: "%",
          value: 5.4,
        },
      ]),
      createLabTest("evt_hba1c_2023", "2023-03-01T08:00:00.000Z", [
        {
          analyte: "Hemoglobin A1c",
          biomarkerSlug: "hba1c",
          unit: "percent",
          value: 5.6,
        },
      ]),
      createLabTest("evt_hba1c_2025", "2025-04-01T08:00:00.000Z", [
        {
          analyte: "Hemoglobin A1c",
          biomarkerSlug: "hba1c",
          comparator: "<",
          unit: "percent",
          value: 5.7,
        },
      ]),
      createLabTest("evt_hba1c_2026", "2026-06-01T08:00:00.000Z", [
        {
          analyte: "Hemoglobin A1c",
          biomarkerSlug: "hba1c",
          unit: "mmol/mol",
          value: 38,
        },
      ]),
      createLabTest("evt_qualitative_2021", "2021-05-01T08:00:00.000Z", [
        {
          analyte: "Hepatitis B surface antigen",
          flag: "normal",
          note: "Private clinician note that must not enter the replica",
          referenceRange: { text: "Negative" },
          textValue: "Negative",
        },
      ]),
      createLabTest("evt_custom_2022", "2022-05-01T08:00:00.000Z", [
        {
          analyte: "Novel Marker",
          unit: "score",
          value: 1,
        },
      ]),
      createLabTest("evt_custom_2026", "2026-05-01T08:00:00.000Z", [
        {
          analyte: "Novel Marker",
          unit: "score",
          value: 2,
        },
      ]),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-07-16T12:00:00.000Z",
    metricPoints: buildMetricProjection(vault).metricPoints,
    sourceBundleHash: "f".repeat(64),
    vault,
  });
  assert.ok(BROWSER_VAULT_REPLICA_CURRENT_GENERATION >= 15);
  assert.equal(replica.generation, BROWSER_VAULT_REPLICA_CURRENT_GENERATION);
  const client = createBrowserVaultQueryClient(
    parseBrowserVaultReplica(replica),
  );

  assert.equal(replica.labResultRows.length, 7);
  assert.deepEqual(
    client.metrics.series({ metricKey: "resting-heart-rate" }),
    [],
  );
  assert.deepEqual(client.metrics.series({ metricKey: "hba1c" }), []);

  const oldestHba1c = client.labResults.list({ metricKey: "HbA1c" })[0];
  assert.ok(oldestHba1c);
  assert.equal(oldestHba1c.date, "2020-02-01");
  assert.equal(oldestHba1c.value, 5.4);
  assert.equal(oldestHba1c.unit, "%");
  assert.equal(oldestHba1c.normalizedValue, 5.4);
  assert.equal(oldestHba1c.normalizedUnit, "percent");
  assert.equal(oldestHba1c.specimenKind, "serum");
  assert.deepEqual(oldestHba1c.referenceRange, {
    high: 5.6,
    low: 4,
    text: "4.0-5.6",
  });
  assert.equal(oldestHba1c.labName, "Example Lab");

  const qualitative = client.labResults.list({
    metricKey: "hepatitis-b-surface-antigen",
  })[0];
  assert.ok(qualitative);
  assert.equal(qualitative.value, null);
  assert.equal(qualitative.textValue, "Negative");
  assert.equal(qualitative.normalizedValue, null);
  assert.equal(qualitative.normalizedUnit, null);

  const serializedRows = JSON.stringify(replica.labResultRows);
  assert.doesNotMatch(serializedRows, /Private clinician note/u);
  assert.doesNotMatch(
    serializedRows,
    /rawRefs|externalRef|labPanelId|ledger\/events|sourceRecordId|resultIndex|specimenType|testCategory|testName/u,
  );
});

test("lab result projection exposes only an allowlisted fallback specimen kind", async () => {
  const vault = createVaultReadModel({
    entities: [
      createLabTest(
        "evt_serum",
        "2026-01-01T08:00:00.000Z",
        [
          {
            analyte: "Chloride",
            unit: "mmol/L",
            value: 101,
          },
        ],
        "serum",
      ),
      createLabTest(
        "evt_plasma",
        "2026-02-01T08:00:00.000Z",
        [
          {
            analyte: "Chloride",
            unit: "mmol/L",
            value: 102,
          },
        ],
        "plasma",
      ),
      createLabTest(
        "evt_whole_blood",
        "2026-02-15T08:00:00.000Z",
        [
          {
            analyte: "White blood cells",
            unit: "10^3/uL",
            value: 3,
          },
        ],
        "whole_blood",
      ),
      createLabTest(
        "evt_urine",
        "2026-03-01T08:00:00.000Z",
        [
          {
            analyte: "Chloride",
            unit: "mmol/L",
            value: 103,
          },
        ],
        "urine",
      ),
      createLabTest(
        "evt_missing",
        "2026-04-01T08:00:00.000Z",
        [
          {
            analyte: "Chloride",
            unit: "mmol/L",
            value: 104,
          },
        ],
        null,
      ),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-07-22T12:00:00.000Z",
    metricPoints: buildMetricProjection(vault).metricPoints,
    sourceBundleHash: "7".repeat(64),
    vault,
  });

  assert.deepEqual(
    replica.labResultRows.map((row) => row.specimenKind),
    ["serum", "plasma", "whole_blood", null, null],
  );
  assert.doesNotMatch(
    JSON.stringify(replica.labResultRows),
    /specimenType|testCategory/u,
  );

  const client = createBrowserVaultQueryClient(
    parseBrowserVaultReplica(replica),
  );
  assert.equal(client.labResults.list({ metricKey: "white-blood-cell-count" })[0]?.specimenKind, "whole_blood");
});

test("lab-only aliases preserve manual metric selection and goal authority", async () => {
  const vault = createVaultReadModel({
    entities: [
      createEvent(
        "evt_manual_testosterone",
        "measurement",
        "2026-02-01T08:00:00.000Z",
        {
          measurements: [{ metric: "testosterone", unit: "ng/dL", value: 500 }],
          source: "manual",
        },
      ),
      createMetricSample(
        "smp_manual_testosterone",
        "2026-02-02T08:00:00.000Z",
        {
          dayKey: "2026-02-02",
          metric: "testosterone",
          quality: "raw",
          recordedAt: "2026-02-02T08:00:00.000Z",
          source: "manual",
          unit: "ng/dL",
          value: 525,
        },
      ),
      createLabTest("evt_testosterone_2024", "2024-03-01T08:00:00.000Z", [
        { analyte: "Testosterone", unit: "ng/dL", value: 480 },
      ]),
      createLabTest("evt_testosterone_2025", "2025-03-01T08:00:00.000Z", [
        { analyte: "Testosterone total", unit: "ng/dL", value: 510 },
      ]),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const points = buildMetricProjection(vault).metricPoints;
  const manualPoints = points.filter(
    (point) => point.metricKey === "testosterone",
  );
  const labPoints = points.filter(
    (point) => point.metricKey === "total-testosterone",
  );

  assert.deepEqual(manualPoints.map((point) => point.source.kind).sort(), [
    "measurement",
    "metric-sample",
  ]);
  assert.equal(labPoints.length, 2);
  assert.equal(
    labPoints.every((point) => point.source.kind === "test-result"),
    true,
  );

  const selection = selectMetricValue({
    metricKey: "testosterone",
    now: "2026-02-03T00:00:00.000Z",
    points,
  });
  assert.equal(selection.status, "ready");
  assert.equal(selection.value, 525);
  assert.equal(selection.point?.source.kind, "metric-sample");

  const goal = selectMetricGoalProgress({
    goalId: "goal_testosterone",
    now: "2026-02-03T00:00:00.000Z",
    points,
    target: {
      comparator: ">=",
      evaluation: { kind: "selected-value" },
      kind: "metric",
      metricKey: "testosterone",
      targetId: "target_testosterone",
      unit: "ng/dL",
      value: 500,
    },
  });
  assert.equal(goal.status, "met");
  assert.equal(goal.currentValue, 525);

  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-02-03T00:00:00.000Z",
    metricPoints: points,
    sourceBundleHash: "a".repeat(64),
    vault,
  });
  assert.equal(replica.generation, BROWSER_VAULT_REPLICA_CURRENT_GENERATION);
  const client = createBrowserVaultQueryClient(
    parseBrowserVaultReplica(replica),
  );
  assert.equal(client.labResults.list({ metricKey: "total-testosterone" }).length, 2);
});

test("expanded lab definitions stay at the test-result boundary", () => {
  const vault = createVaultReadModel({
    entities: [
      createLabTest("evt_egfr_lab", "2025-03-01T08:00:00.000Z", [
        { analyte: "Estimated GFR CKD-EPI", unit: "mL/min/1.73m^2", value: 89 },
      ]),
      createEvent(
        "evt_egfr_manual",
        "measurement",
        "2026-02-01T08:00:00.000Z",
        {
          measurements: [
            { metric: "egfr-ckd-epi", unit: "mL/min/1.73m^2", value: 80 },
          ],
          source: "manual",
        },
      ),
      createMetricSample("smp_egfr_manual", "2026-02-02T08:00:00.000Z", {
        dayKey: "2026-02-02",
        metric: "egfr-ckd-epi",
        quality: "raw",
        recordedAt: "2026-02-02T08:00:00.000Z",
        source: "manual",
        unit: "mL/min/1.73m^2",
        value: 82,
      }),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const points = buildMetricProjection(vault).metricPoints.filter(
    (point) => point.metricKey === "egfr-ckd-epi",
  );
  const labPoint = points.find((point) => point.source.kind === "test-result");
  const manualPoints = points.filter(
    (point) =>
      point.source.kind === "measurement" ||
      point.source.kind === "metric-sample",
  );

  assert.equal(labPoint?.canonicalUnit, "mL/min/1.73m^2");
  assert.equal(labPoint?.canonicalValue, 89);
  assert.equal(manualPoints.length, 2);
  assert.equal(
    manualPoints.every((point) => point.canonicalUnit === null),
    true,
  );
  assert.equal(
    manualPoints.every((point) => point.canonicalValue === null),
    true,
  );

  const selection = selectMetricValue({
    metricKey: "egfr-ckd-epi",
    now: "2026-02-03T00:00:00.000Z",
    points,
  });
  assert.equal(selection.status, "ready");
  assert.equal(selection.value, 82);
  assert.equal(selection.unit, "mL/min/1.73m^2");
  assert.equal(selection.point?.source.kind, "metric-sample");

  const goal = selectMetricGoalProgress({
    goalId: "goal_egfr_manual",
    now: "2026-02-03T00:00:00.000Z",
    points,
    target: {
      comparator: ">=",
      evaluation: { kind: "selected-value" },
      kind: "metric",
      metricKey: "egfr-ckd-epi",
      targetId: "target_egfr_manual",
      unit: "mL/min/1.73m^2",
      value: 81,
    },
  });
  assert.equal(goal.status, "met");
  assert.equal(goal.currentValue, 82);
});

test("lab projection ignores test-result points whose collapsed live event is absent", async () => {
  const liveTest = createLabTest("evt_live", "2026-01-01T08:00:00.000Z", [
    {
      analyte: "Hemoglobin A1c",
      biomarkerSlug: "hba1c",
      unit: "percent",
      value: 5.5,
    },
  ]);
  const removedTest = createLabTest("evt_removed", "2025-01-01T08:00:00.000Z", [
    {
      analyte: "Hemoglobin A1c",
      biomarkerSlug: "hba1c",
      unit: "percent",
      value: 9.9,
    },
  ]);
  const liveVault = createVaultReadModel({
    entities: [liveTest],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const pointVault = createVaultReadModel({
    entities: [liveTest, removedTest],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-07-16T12:00:00.000Z",
    metricPoints: buildMetricProjection(pointVault).metricPoints,
    sourceBundleHash: "d".repeat(64),
    vault: liveVault,
  });

  assert.deepEqual(
    replica.labResultRows.map((row) => row.value),
    [5.5],
  );
});

test("lab projection keeps every analyte from one multi-result panel joined by result index", async () => {
  const vault = createVaultReadModel({
    entities: [
      createLabTest("evt_panel", "2026-02-01T08:00:00.000Z", [
        {
          analyte: "Hemoglobin A1c",
          biomarkerSlug: "hba1c",
          referenceRange: { high: 5.6, low: 4 },
          unit: "percent",
          value: 5.5,
        },
        {
          analyte: "Apolipoprotein B",
          biomarkerSlug: "apob",
          flag: "high",
          referenceRange: { high: 90 },
          unit: "mg/dL",
          value: 94,
        },
      ]),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-07-16T12:00:00.000Z",
    metricPoints: buildMetricProjection(vault).metricPoints,
    sourceBundleHash: "b".repeat(64),
    vault,
  });

  assert.deepEqual(
    replica.labResultRows
      .map((row) => ({
        analyte: row.analyte,
        flag: row.flag,
        metricKey: row.metricKey,
        referenceRange: row.referenceRange,
        value: row.value,
      }))
      .sort((left, right) => left.metricKey.localeCompare(right.metricKey)),
    [
      {
        analyte: "Apolipoprotein B",
        flag: "high",
        metricKey: "apob",
        referenceRange: { high: 90 },
        value: 94,
      },
      {
        analyte: "Hemoglobin A1c",
        flag: null,
        metricKey: "hba1c",
        referenceRange: { high: 5.6, low: 4 },
        value: 5.5,
      },
    ],
  );
});

test("browser vault parser defaults a missing additive lab collection and rejects malformed values", async () => {
  const vault = createVaultReadModel({
    entities: [
      createLabTest("evt_parser", "2026-06-01T08:00:00.000Z", [
        {
          analyte: "Hemoglobin A1c",
          biomarkerSlug: "hba1c",
          unit: "percent",
          value: 5.5,
        },
      ]),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-07-16T12:00:00.000Z",
    metricPoints: buildMetricProjection(vault).metricPoints,
    sourceBundleHash: "c".repeat(64),
    vault,
  });
  const { labResultRows: _labResultRows, ...legacyReplica } = replica;

  assert.deepEqual(parseBrowserVaultReplica(legacyReplica).labResultRows, []);
  assert.throws(
    () => parseBrowserVaultReplica({ ...legacyReplica, labResultRows: null }),
    /labResultRows must be an array/u,
  );
  const row = replica.labResultRows[0];
  assert.ok(row);
  assert.throws(
    () =>
      parseBrowserVaultReplica({
        ...legacyReplica,
        labResultRows: [
          { ...row, rowSchema: "murph.browser-vault.lab-result-row.wrong" },
        ],
      }),
    /rowSchema must be murph\.browser-vault\.lab-result-row\.v1/u,
  );
  assert.throws(
    () =>
      parseBrowserVaultReplica({
        ...legacyReplica,
        labResultRows: [{ ...row, textValue: null, value: null }],
      }),
    /must include a numeric value or textValue/u,
  );
  assert.throws(
    () =>
      parseBrowserVaultReplica({
        ...legacyReplica,
        labResultRows: [{ ...row, referenceRange: {} }],
      }),
    /referenceRange must include low, high, or text/u,
  );
  assert.throws(
    () =>
      parseBrowserVaultReplica({
        ...legacyReplica,
        labResultRows: [{ ...row, normalizedUnit: null }],
      }),
    /normalizedValue and normalizedUnit must be provided together/u,
  );
  assert.throws(
    () =>
      parseBrowserVaultReplica({
        ...legacyReplica,
        labResultRows: [{ ...row, specimenKind: "urine" }],
      }),
    /specimenKind must be plasma, serum, whole_blood, or null/u,
  );
});

function createLabTest(
  entityId: string,
  collectedAt: string,
  results: readonly Record<string, unknown>[],
  specimenType: string | null = "serum",
): CanonicalEntity {
  return createEvent(entityId, "test", collectedAt, {
    collectedAt,
    dataOrigin: { importedAt: "2026-01-01T00:00:00.000Z" },
    externalRef: {
      resourceId: `external-${entityId}`,
      system: "example-provider",
    },
    fastingStatus: "fasting",
    labName: "Example Lab",
    labPanelId: `external-panel-${entityId}`,
    rawRefs: [`raw-${entityId}`],
    reportedAt: addOneDay(collectedAt),
    results,
    source: "import",
    ...(specimenType === null ? {} : { specimenType }),
    testCategory: "blood",
    testName: "blood_panel",
  });
}

function createExperiment(
  entityId: string,
  experimentSlug: string,
  analysisPlan: Record<string, unknown>,
): CanonicalEntity {
  return {
    attributes: {},
    body: null,
    date: "2026-01-01",
    entityId,
    experimentSlug,
    family: "experiment",
    frontmatter: { analysisPlan, status: "active" },
    kind: "experiment",
    links: [],
    lookupIds: [entityId, experimentSlug],
    occurredAt: "2026-01-01T00:00:00.000Z",
    path: `bank/experiments/${experimentSlug}.md`,
    primaryLookupId: entityId,
    recordClass: "bank",
    relatedIds: [],
    status: "active",
    stream: null,
    tags: [],
    title: "BUN alias experiment",
  } satisfies CanonicalEntity;
}

function createEvent(
  entityId: string,
  kind: string,
  occurredAt: string,
  attributes: Record<string, unknown>,
): CanonicalEntity {
  return {
    attributes,
    body: null,
    date: occurredAt.slice(0, 10),
    entityId,
    experimentSlug: null,
    family: "event",
    frontmatter: null,
    kind,
    links: [],
    lookupIds: [entityId],
    occurredAt,
    path: `ledger/events/${occurredAt.slice(0, 4)}/${occurredAt.slice(
      0,
      7,
    )}.jsonl`,
    primaryLookupId: entityId,
    recordClass: "ledger",
    relatedIds: [],
    status: null,
    stream: null,
    tags: [],
    title: kind === "test" ? "Blood panel" : "Observation",
  } satisfies CanonicalEntity;
}

function createMetricSample(
  entityId: string,
  recordedAt: string,
  attributes: Record<string, unknown>,
): CanonicalEntity {
  return {
    attributes,
    body: null,
    date: recordedAt.slice(0, 10),
    entityId,
    experimentSlug: null,
    family: "sample",
    frontmatter: null,
    kind: "metric_sample",
    links: [],
    lookupIds: [entityId],
    occurredAt: recordedAt,
    path: `ledger/metric-samples/${String(
      attributes.metric ?? "metric",
    )}/2026/2026-02.jsonl`,
    primaryLookupId: entityId,
    recordClass: "sample",
    relatedIds: [],
    status: typeof attributes.quality === "string" ? attributes.quality : null,
    stream: typeof attributes.metric === "string" ? attributes.metric : null,
    tags: [],
    title: "Metric sample",
  } satisfies CanonicalEntity;
}

function addOneDay(value: string): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}
