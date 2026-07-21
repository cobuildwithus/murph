import assert from "node:assert/strict";

import { test } from "vitest";

import {
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
  parseBrowserVaultReplica,
  selectBrowserVaultLabBiomarkerDetail,
  selectBrowserVaultMeasuredBiomarkers,
} from "../src/browser.ts";
import { buildMetricProjection } from "../src/index.ts";

type CanonicalEntity = Parameters<typeof createVaultReadModel>[0]["entities"][number];

test("browser vault projects all live lab history without widening the wearable lookback", async () => {
  const vault = createVaultReadModel({
    entities: [
      createEvent("evt_old_rhr", "observation", "2020-01-01T07:00:00.000Z", {
        metric: "resting-heart-rate",
        source: "manual",
        unit: "bpm",
        value: 61,
      }),
      createLabTest("evt_hba1c_2020", "2020-02-01T08:00:00.000Z", [{
        analyte: "Hemoglobin A1c",
        biomarkerSlug: "hba1c",
        flag: "normal",
        referenceRange: { high: 5.6, low: 4, text: "4.0-5.6" },
        unit: "%",
        value: 5.4,
      }]),
      createLabTest("evt_hba1c_2023", "2023-03-01T08:00:00.000Z", [{
        analyte: "Hemoglobin A1c",
        biomarkerSlug: "hba1c",
        unit: "percent",
        value: 5.6,
      }]),
      createLabTest("evt_hba1c_2025", "2025-04-01T08:00:00.000Z", [{
        analyte: "Hemoglobin A1c",
        biomarkerSlug: "hba1c",
        comparator: "<",
        unit: "percent",
        value: 5.7,
      }]),
      createLabTest("evt_hba1c_2026", "2026-06-01T08:00:00.000Z", [{
        analyte: "Hemoglobin A1c",
        biomarkerSlug: "hba1c",
        unit: "mmol/mol",
        value: 38,
      }]),
      createLabTest("evt_qualitative_2021", "2021-05-01T08:00:00.000Z", [{
        analyte: "Hepatitis B surface antigen",
        flag: "normal",
        note: "Private clinician note that must not enter the replica",
        referenceRange: { text: "Negative" },
        textValue: "Negative",
      }]),
      createLabTest("evt_custom_2022", "2022-05-01T08:00:00.000Z", [{
        analyte: "Novel Marker",
        unit: "score",
        value: 1,
      }]),
      createLabTest("evt_custom_2026", "2026-05-01T08:00:00.000Z", [{
        analyte: "Novel Marker",
        unit: "score",
        value: 2,
      }]),
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
  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));

  assert.equal(replica.labResultRows.length, 7);
  assert.deepEqual(client.metrics.series({ metricKey: "resting-heart-rate" }), []);
  assert.deepEqual(client.metrics.series({ metricKey: "hba1c" }).map((row) => row.date), ["2026-06-01"]);

  const oldestHba1c = client.labResults.list({ metricKey: "HbA1c" })[0];
  assert.ok(oldestHba1c);
  assert.equal(oldestHba1c.date, "2020-02-01");
  assert.equal(oldestHba1c.value, 5.4);
  assert.equal(oldestHba1c.unit, "%");
  assert.equal(oldestHba1c.normalizedValue, 5.4);
  assert.equal(oldestHba1c.normalizedUnit, "percent");
  assert.deepEqual(oldestHba1c.referenceRange, { high: 5.6, low: 4, text: "4.0-5.6" });
  assert.equal(oldestHba1c.labName, "Example Lab");

  const qualitative = client.labResults.list({ metricKey: "hepatitis-b-surface-antigen" })[0];
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

test("lab result selectors group measured biomarkers and chart only comparable exact values", async () => {
  const vault = createVaultReadModel({
    entities: [
      createLabTest("evt_hba1c_2020", "2020-02-01T08:00:00.000Z", [{
        analyte: "Hemoglobin A1c",
        biomarkerSlug: "hba1c",
        unit: "%",
        value: 5.4,
      }]),
      createLabTest("evt_hba1c_2023", "2023-03-01T08:00:00.000Z", [{
        analyte: "Hemoglobin A1c",
        biomarkerSlug: "hba1c",
        unit: "percent",
        value: 5.6,
      }]),
      createLabTest("evt_hba1c_2025", "2025-04-01T08:00:00.000Z", [{
        analyte: "Hemoglobin A1c",
        biomarkerSlug: "hba1c",
        comparator: "<",
        unit: "percent",
        value: 5.7,
      }]),
      createLabTest("evt_hba1c_2026", "2026-06-01T08:00:00.000Z", [{
        analyte: "Hemoglobin A1c",
        biomarkerSlug: "hba1c",
        unit: "mmol/mol",
        value: 38,
      }]),
      createLabTest("evt_custom_2022", "2022-05-01T08:00:00.000Z", [{
        analyte: "Novel Marker",
        unit: "score",
        value: 1,
      }]),
      createLabTest("evt_custom_2026", "2026-05-01T08:00:00.000Z", [{
        analyte: "Novel Marker",
        unit: "score",
        value: 2,
      }]),
      createLabTest("evt_qualitative_2021", "2021-05-01T08:00:00.000Z", [{
        analyte: "Hepatitis B surface antigen",
        textValue: "Negative",
      }]),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-07-16T12:00:00.000Z",
    metricPoints: buildMetricProjection(vault).metricPoints,
    sourceBundleHash: "e".repeat(64),
    vault,
  });
  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));

  const measured = selectBrowserVaultMeasuredBiomarkers(client);
  const hba1c = measured.find((entry) => entry.metricKey === "hba1c");
  assert.ok(hba1c);
  assert.equal(hba1c.displayName, "HbA1c");
  assert.equal(hba1c.healthArea.id, "blood-sugar");
  assert.equal(hba1c.firstDate, "2020-02-01");
  assert.equal(hba1c.lastDate, "2026-06-01");
  assert.equal(hba1c.resultCount, 4);

  const detail = selectBrowserVaultLabBiomarkerDetail(client, "HbA1c");
  assert.ok(detail);
  assert.equal(detail.comparableUnit, "percent");
  assert.equal(detail.latest.value, 38);
  assert.equal(detail.latestComparable?.value, 5.6);
  assert.equal(detail.previousComparable?.value, 5.4);
  assert.equal(detail.hasIncompatibleHistory, true);
  assert.deepEqual(detail.chartSeries.map((point) => point.value), [5.4, 5.6]);

  assert.equal(measured.some((entry) => entry.metricKey === "novel-marker"), false);
  assert.deepEqual(
    selectBrowserVaultLabBiomarkerDetail(client, "novel-marker")?.chartSeries.map((point) => point.value),
    [1, 2],
  );

  const qualitative = selectBrowserVaultLabBiomarkerDetail(client, "hepatitis-b-surface-antigen");
  assert.ok(qualitative);
  assert.deepEqual(qualitative.chartSeries, []);
  assert.equal(replica.labResultRows.length, 7);
  assert.deepEqual(
    client.labResults.list({ from: "2023-01-01", metricKey: "hba1c", to: "2025-12-31" })
      .map((row) => row.date),
    ["2023-03-01", "2025-04-01"],
  );
  assert.deepEqual(
    client.labResults.list({ biomarkerKey: "biomarker:hba1c" }).map((row) => row.date),
    ["2020-02-01", "2023-03-01", "2025-04-01", "2026-06-01"],
  );
  assert.deepEqual(client.labResults.list({ biomarkerKey: "biomarker:missing" }), []);
});

test("lab aliases collapse while nearby measurements remain distinct", async () => {
  const vault = createVaultReadModel({
    entities: [
      createLabTest("evt_aliases_2024", "2024-03-01T08:00:00.000Z", [
        { analyte: "BUN", unit: "mg/dL", value: 14 },
        { analyte: "TSH", unit: "uIU/mL", value: 2.5 },
        { analyte: "MCH", unit: "pg", value: 30 },
        { analyte: "MCHC", unit: "g/dL", value: 33 },
        { analyte: "BUN/Creatinine Ratio", value: 12 },
        { analyte: "HbA1c NGSP", unit: "%", value: 5.1 },
        { analyte: "Estimated GFR", unit: "mL/min/1.73m^2", value: 92 },
        { analyte: "GFR MDRD Af Amer", unit: "mL/min/1.73m^2", value: 105 },
        { analyte: "GFR MDRD Non Af Amer", unit: "mL/min/1.73m^2", value: 97 },
      ]),
      createLabTest("evt_aliases_2025", "2025-03-01T08:00:00.000Z", [
        { analyte: "Blood Urea Nitrogen", unit: "mg/dL", value: 15 },
        { analyte: "Thyroid Stimulating Hormone", unit: "mIU/L", value: 3.1 },
        { analyte: "Mean Corpuscular Hemoglobin", unit: "pg", value: 31 },
        { analyte: "Mean Corpuscular Hemoglobin Concentration", unit: "g/dL", value: 34 },
        { analyte: "HbA1c SI", unit: "mmol/mol", value: 32 },
      ]),
      createLabTest("evt_urea_2026", "2026-03-01T08:00:00.000Z", [
        { analyte: "Urea Nitrogen", unit: "mmol/L", value: 5 },
      ]),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-07-16T12:00:00.000Z",
    metricPoints: buildMetricProjection(vault).metricPoints,
    sourceBundleHash: "7".repeat(64),
    vault,
  });
  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));
  const measured = selectBrowserVaultMeasuredBiomarkers(client);

  assert.deepEqual(measured.map((entry) => entry.metricKey).sort(), [
    "blood-urea-nitrogen",
    "bun-creatinine-ratio",
    "egfr",
    "gfr-mdrd-af-amer",
    "gfr-mdrd-non-af-amer",
    "hba1c",
    "mean-corpuscular-hemoglobin",
    "mean-corpuscular-hemoglobin-concentration",
    "thyroid-stimulating-hormone",
  ]);

  const bun = selectBrowserVaultLabBiomarkerDetail(client, "BUN");
  assert.ok(bun);
  assert.equal(bun.displayName, "Blood urea nitrogen");
  assert.equal(bun.rows.length, 3);
  assert.equal(bun.comparableUnit, "mg/dL");
  assert.deepEqual(bun.chartSeries.map((point) => point.value), [14, 15, 14.0056]);

  const tsh = selectBrowserVaultLabBiomarkerDetail(client, "TSH");
  assert.ok(tsh);
  assert.equal(tsh.rows.length, 2);
  assert.equal(tsh.comparableUnit, "mIU/L");
  assert.deepEqual(tsh.chartSeries.map((point) => point.value), [2.5, 3.1]);

  assert.equal(selectBrowserVaultLabBiomarkerDetail(client, "MCH")?.rows.length, 2);
  assert.equal(selectBrowserVaultLabBiomarkerDetail(client, "MCHC")?.rows.length, 2);
  assert.equal(selectBrowserVaultLabBiomarkerDetail(client, "BUN/Creatinine Ratio")?.rows.length, 1);
  assert.equal(selectBrowserVaultLabBiomarkerDetail(client, "Estimated GFR")?.rows.length, 1);
  assert.equal(selectBrowserVaultLabBiomarkerDetail(client, "GFR MDRD Af Amer")?.rows.length, 1);
  assert.equal(selectBrowserVaultLabBiomarkerDetail(client, "GFR MDRD Non Af Amer")?.rows.length, 1);
  const hba1c = selectBrowserVaultLabBiomarkerDetail(client, "HbA1c");
  assert.equal(hba1c?.rows.length, 2);
  assert.equal(hba1c?.hasIncompatibleHistory, true);
});

test("the measured index excludes unclassified lab-record fields without deleting their rows", async () => {
  const vault = createVaultReadModel({
    entities: [
      createLabTest("evt_mixed_record", "2026-03-01T08:00:00.000Z", [
        { analyte: "Hemoglobin", unit: "g/dL", value: 15 },
        { analyte: "ECG axis", unit: "degrees", value: 70 },
        { analyte: "Urine color", textValue: "Clear" },
        { analyte: "Screening result", textValue: "Negative" },
        { analyte: "Report sequence", value: 12345 },
      ]),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-07-16T12:00:00.000Z",
    metricPoints: buildMetricProjection(vault).metricPoints,
    sourceBundleHash: "8".repeat(64),
    vault,
  });
  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));

  assert.equal(replica.labResultRows.length, 5);
  assert.deepEqual(
    selectBrowserVaultMeasuredBiomarkers(client).map((entry) => entry.metricKey),
    ["hemoglobin"],
  );
  assert.equal(client.labResults.list({ metricKey: "ecg-axis" }).length, 1);
  assert.equal(client.labResults.list({ metricKey: "urine-color" }).length, 1);
  assert.equal(selectBrowserVaultLabBiomarkerDetail(client, "report-sequence")?.rows.length, 1);
});

test("lab projection ignores test-result points whose collapsed live event is absent", async () => {
  const liveTest = createLabTest("evt_live", "2026-01-01T08:00:00.000Z", [{
    analyte: "Hemoglobin A1c",
    biomarkerSlug: "hba1c",
    unit: "percent",
    value: 5.5,
  }]);
  const removedTest = createLabTest("evt_removed", "2025-01-01T08:00:00.000Z", [{
    analyte: "Hemoglobin A1c",
    biomarkerSlug: "hba1c",
    unit: "percent",
    value: 9.9,
  }]);
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

  assert.deepEqual(replica.labResultRows.map((row) => row.value), [5.5]);
});

test("lab projection keeps every analyte from one multi-result panel joined by result index", async () => {
  const vault = createVaultReadModel({
    entities: [createLabTest("evt_panel", "2026-02-01T08:00:00.000Z", [
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
    ])],
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
    replica.labResultRows.map((row) => ({
      analyte: row.analyte,
      flag: row.flag,
      metricKey: row.metricKey,
      referenceRange: row.referenceRange,
      value: row.value,
    })).sort((left, right) => left.metricKey.localeCompare(right.metricKey)),
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

test("custom analyte detail charts the latest comparable unit without hiding other units", async () => {
  const vault = createVaultReadModel({
    entities: [
      createLabTest("evt_custom_score_2024", "2024-02-01T08:00:00.000Z", [{
        analyte: "Dual Unit Marker",
        unit: "score",
        value: 1,
      }]),
      createLabTest("evt_custom_score_2025", "2025-02-01T08:00:00.000Z", [{
        analyte: "Dual Unit Marker",
        unit: "score",
        value: 2,
      }]),
      createLabTest("evt_custom_index_2026", "2026-02-01T08:00:00.000Z", [{
        analyte: "Dual Unit Marker",
        unit: "index",
        value: 3,
      }]),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-07-16T12:00:00.000Z",
    metricPoints: buildMetricProjection(vault).metricPoints,
    sourceBundleHash: "a".repeat(64),
    vault,
  });
  const detail = selectBrowserVaultLabBiomarkerDetail(
    createBrowserVaultQueryClient(parseBrowserVaultReplica(replica)),
    "dual-unit-marker",
  );

  assert.ok(detail);
  assert.equal(detail.comparableUnit, "index");
  assert.equal(detail.hasIncompatibleHistory, true);
  assert.deepEqual(detail.chartSeries.map((point) => point.value), [3]);
  assert.deepEqual(detail.rows.map((row) => row.value), [1, 2, 3]);
});

test("custom analytes with no normalized characters keep a deterministic private route key", async () => {
  const vault = createVaultReadModel({
    entities: [
      createLabTest("evt_custom_unicode", "2026-03-01T08:00:00.000Z", [{
        analyte: "β?!",
        unit: "index",
        value: 1.25,
      }]),
      createEvent("evt_custom_unicode_obs", "observation", "2026-04-01T08:00:00.000Z", {
        metric: "β?!",
        source: "manual",
        unit: "index",
        value: 1.5,
      }),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const createReplica = () => createBrowserVaultReplica({
    generatedAt: "2026-07-16T12:00:00.000Z",
    metricPoints: buildMetricProjection(vault).metricPoints,
    sourceBundleHash: "9".repeat(64),
    vault,
  });
  const first = await createReplica();
  const second = await createReplica();
  const metricKey = first.labResultRows[0]?.metricKey;

  assert.ok(metricKey);
  assert.equal(second.labResultRows[0]?.metricKey, metricKey);
  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(first));
  const measured = selectBrowserVaultMeasuredBiomarkers(client);
  assert.deepEqual(measured, []);
  assert.equal(selectBrowserVaultLabBiomarkerDetail(client, metricKey)?.rows.length, 1);
  // The hashed fallback is one identity across every scalar source: an
  // observation with the same non-normalizable name lands on the same key.
  assert.equal(
    client.metrics.series({ metricKey }).map((row) => row.value).at(-1),
    1.5,
  );
});

test("qualitative rows cannot become comparable through normalized fields alone", async () => {
  const vault = createVaultReadModel({
    entities: [createLabTest("evt_qualitative_guard", "2026-04-01T08:00:00.000Z", [{
      analyte: "Custom Screen",
      textValue: "Negative",
    }])],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-07-16T12:00:00.000Z",
    metricPoints: buildMetricProjection(vault).metricPoints,
    sourceBundleHash: "8".repeat(64),
    vault,
  });
  const qualitative = replica.labResultRows[0];
  assert.ok(qualitative);
  const malformedComparable = {
    ...qualitative,
    normalizedUnit: "index",
    normalizedValue: 1,
  };

  assert.throws(
    () => parseBrowserVaultReplica({
      ...replica,
      labResultRows: [malformedComparable],
    }),
    /normalizedValue requires a numeric value/u,
  );
  const defensiveDetail = selectBrowserVaultLabBiomarkerDetail(
    createBrowserVaultQueryClient({
      ...replica,
      labResultRows: [malformedComparable],
    }),
    qualitative.metricKey,
  );
  assert.ok(defensiveDetail);
  assert.deepEqual(defensiveDetail.chartSeries, []);
});

test("browser vault parser defaults a missing additive lab collection and rejects malformed values", async () => {
  const vault = createVaultReadModel({
    entities: [createLabTest("evt_parser", "2026-06-01T08:00:00.000Z", [{
      analyte: "Hemoglobin A1c",
      biomarkerSlug: "hba1c",
      unit: "percent",
      value: 5.5,
    }])],
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
    () => parseBrowserVaultReplica({
      ...legacyReplica,
      labResultRows: [{ ...row, rowSchema: "murph.browser-vault.lab-result-row.wrong" }],
    }),
    /rowSchema must be murph\.browser-vault\.lab-result-row\.v1/u,
  );
  assert.throws(
    () => parseBrowserVaultReplica({
      ...legacyReplica,
      labResultRows: [{ ...row, textValue: null, value: null }],
    }),
    /must include a numeric value or textValue/u,
  );
  assert.throws(
    () => parseBrowserVaultReplica({
      ...legacyReplica,
      labResultRows: [{ ...row, referenceRange: {} }],
    }),
    /referenceRange must include low, high, or text/u,
  );
  assert.throws(
    () => parseBrowserVaultReplica({
      ...legacyReplica,
      labResultRows: [{ ...row, normalizedUnit: null }],
    }),
    /normalizedValue and normalizedUnit must be provided together/u,
  );
});

function createLabTest(
  entityId: string,
  collectedAt: string,
  results: readonly Record<string, unknown>[],
): CanonicalEntity {
  return createEvent(entityId, "test", collectedAt, {
    collectedAt,
    dataOrigin: { importedAt: "2026-01-01T00:00:00.000Z" },
    externalRef: { resourceId: `external-${entityId}`, system: "example-provider" },
    fastingStatus: "fasting",
    labName: "Example Lab",
    labPanelId: `external-panel-${entityId}`,
    rawRefs: [`raw-${entityId}`],
    reportedAt: addOneDay(collectedAt),
    results,
    source: "import",
    specimenType: "serum",
    testCategory: "blood",
    testName: "blood_panel",
  });
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
    path: `ledger/events/${occurredAt.slice(0, 4)}/${occurredAt.slice(0, 7)}.jsonl`,
    primaryLookupId: entityId,
    recordClass: "ledger",
    relatedIds: [],
    status: null,
    stream: null,
    tags: [],
    title: kind === "test" ? "Blood panel" : "Observation",
  } satisfies CanonicalEntity;
}

function addOneDay(value: string): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}
