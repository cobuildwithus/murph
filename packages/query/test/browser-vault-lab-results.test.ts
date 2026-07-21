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

  const custom = measured.find((entry) => entry.metricKey === "novel-marker");
  assert.ok(custom);
  assert.equal(custom.displayName, "Novel Marker");
  assert.equal(custom.healthArea.id, "other");
  assert.deepEqual(
    selectBrowserVaultLabBiomarkerDetail(client, "novel-marker")?.chartSeries.map((point) => point.value),
    [1, 2],
  );

  const qualitative = selectBrowserVaultLabBiomarkerDetail(client, "hepatitis-b-surface-antigen");
  assert.ok(qualitative);
  assert.deepEqual(qualitative.chartSeries, []);
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

test("lab detail normalizes result values and text-only numeric ranges without mutating source rows", async () => {
  const vault = createVaultReadModel({
    entities: [
      createLabTest("evt_albumin_structured", "2026-01-01T08:00:00.000Z", [{
        analyte: "Albumin",
        biomarkerSlug: "albumin",
        referenceRange: { high: 50, low: 34 },
        unit: "g/L",
        value: 40,
      }]),
      createLabTest("evt_albumin_limit", "2026-01-15T08:00:00.000Z", [{
        analyte: "Albumin",
        biomarkerSlug: "albumin",
        referenceRange: { text: "<= 50 g/L" },
        unit: "g/L",
        value: 45,
      }]),
      createLabTest("evt_albumin_gdl", "2026-02-17T08:00:00.000Z", [{
        analyte: "Albumin",
        biomarkerSlug: "albumin",
        unit: "g/dL",
        value: 5.1,
      }]),
      createLabTest("evt_albumin_gl", "2026-04-23T08:00:00.000Z", [{
        analyte: "Albumin",
        biomarkerSlug: "albumin",
        referenceRange: { text: "34 - 50" },
        unit: "g/L",
        value: 49,
      }]),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-07-20T12:00:00.000Z",
    metricPoints: buildMetricProjection(vault).metricPoints,
    sourceBundleHash: "7".repeat(64),
    vault,
  });
  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));
  const detail = selectBrowserVaultLabBiomarkerDetail(client, "albumin");

  assert.ok(detail);
  assert.equal(detail.comparableUnit, "g/dL");
  assert.deepEqual(detail.chartSeries.map((point) => point.value), [4, 4.5, 5.1, 4.9]);
  assert.deepEqual(detail.rows[0]?.normalizedReferenceRange, { high: 5, low: 3.4 });
  assert.deepEqual(detail.rows[1]?.normalizedReferenceRange, {
    high: 5,
    highComparator: "<=",
  });
  assert.equal(detail.latest.normalizedValue, 4.9);
  assert.equal(detail.latest.normalizedUnit, "g/dL");
  assert.deepEqual(detail.latest.normalizedReferenceRange, { high: 5, low: 3.4 });

  const sourceLatest = client.labResults.list({ metricKey: "albumin" }).at(-1);
  assert.ok(sourceLatest);
  assert.equal(sourceLatest.value, 49);
  assert.equal(sourceLatest.unit, "g/L");
  assert.deepEqual(sourceLatest.referenceRange, { text: "34 - 50" });
});

test("lab detail uses canonical units for conversion-owned and dimensionally universal mixed histories", async () => {
  const vault = createVaultReadModel({
    entities: [
      createLabTest("evt_calcium_si", "2025-01-01T08:00:00.000Z", [{
        analyte: "Calcium",
        unit: "mmol/L",
        value: 2.5,
      }]),
      createLabTest("evt_calcium_us", "2026-01-01T08:00:00.000Z", [{
        analyte: "Calcium",
        unit: "mg/dL",
        value: 10,
      }]),
      createLabTest("evt_protein_si", "2025-02-01T08:00:00.000Z", [{
        analyte: "Total Protein",
        unit: "g/L",
        value: 70,
      }]),
      createLabTest("evt_protein_us", "2026-02-01T08:00:00.000Z", [{
        analyte: "Total Protein",
        unit: "g/dL",
        value: 7,
      }]),
      createLabTest("evt_neutrophils_cells", "2025-03-01T08:00:00.000Z", [{
        analyte: "Neutrophils absolute",
        unit: "cells/uL",
        value: 4_000,
      }]),
      createLabTest("evt_neutrophils_billions", "2026-03-01T08:00:00.000Z", [{
        analyte: "Neutrophils absolute",
        unit: "x10^9/L",
        value: 4,
      }]),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-07-20T12:00:00.000Z",
    metricPoints: buildMetricProjection(vault).metricPoints,
    sourceBundleHash: "5".repeat(64),
    vault,
  });
  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));

  assert.deepEqual(
    selectBrowserVaultLabBiomarkerDetail(client, "calcium")?.chartSeries
      .map(({ unit, value }) => ({ unit, value })),
    [{ unit: "mg/dL", value: 10 }, { unit: "mg/dL", value: 10 }],
  );
  assert.deepEqual(
    selectBrowserVaultLabBiomarkerDetail(client, "total-protein")?.chartSeries
      .map(({ unit, value }) => ({ unit, value })),
    [{ unit: "g/dL", value: 7 }, { unit: "g/dL", value: 7 }],
  );
  assert.deepEqual(
    selectBrowserVaultLabBiomarkerDetail(client, "neutrophils-absolute")?.chartSeries
      .map(({ unit, value }) => ({ unit, value })),
    [{ unit: "10^3/uL", value: 4 }, { unit: "10^3/uL", value: 4 }],
  );
});

test("unitless lab values remain raw and are excluded from normalized presentation", async () => {
  const vault = createVaultReadModel({
    entities: [
      createLabTest("evt_cholesterol_mg", "2024-01-01T08:00:00.000Z", [{
        analyte: "Total Cholesterol",
        unit: "mg/dL",
        value: 201.1,
      }]),
      createLabTest("evt_cholesterol_mmol", "2025-01-01T08:00:00.000Z", [{
        analyte: "Total Cholesterol",
        unit: "mmol/L",
        value: 5.2,
      }]),
      createLabTest("evt_cholesterol_unitless", "2026-01-01T08:00:00.000Z", [{
        analyte: "Total Cholesterol",
        referenceRange: { high: 6, text: "<6 mmol/L" },
        value: 5.2,
      }]),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-07-20T12:00:00.000Z",
    metricPoints: buildMetricProjection(vault).metricPoints,
    sourceBundleHash: "4".repeat(64),
    vault,
  });
  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));
  const detail = selectBrowserVaultLabBiomarkerDetail(client, "total-cholesterol");

  assert.ok(detail);
  assert.equal(detail.latest.value, 5.2);
  assert.equal(detail.latest.unit, null);
  assert.equal(detail.latest.normalizedValue, null);
  assert.equal(detail.latest.normalizedUnit, null);
  assert.equal(detail.latest.normalizedReferenceRange, null);
  assert.deepEqual(detail.latest.referenceRange, { high: 6, text: "<6 mmol/L" });
  assert.equal(detail.latestComparable?.date, "2025-01-01");
  assert.equal(detail.previousComparable?.date, "2024-01-01");
  assert.deepEqual(
    detail.chartSeries.map(({ unit, value }) => ({ unit, value })),
    [
      { unit: "mg/dL", value: 201.1 },
      { unit: "mg/dL", value: 201.084 },
    ],
  );

  const legacyReplica = parseBrowserVaultReplica({
    ...replica,
    labResultRows: replica.labResultRows.map((row) =>
      row.id === detail.latest.id
        ? { ...row, normalizedUnit: "mg/dL", normalizedValue: 5.2 }
        : row
    ),
  });
  const legacyDetail = selectBrowserVaultLabBiomarkerDetail(
    createBrowserVaultQueryClient(legacyReplica),
    "total-cholesterol",
  );
  assert.ok(legacyDetail);
  assert.equal(legacyDetail.latest.unit, null);
  assert.equal(legacyDetail.latest.normalizedValue, null);
  assert.equal(legacyDetail.latest.normalizedUnit, null);
  assert.equal(legacyDetail.latest.normalizedReferenceRange, null);
  assert.deepEqual(legacyDetail.chartSeries, detail.chartSeries);
});

test("structured lab bounds normalize only when accompanying text is exactly equivalent", async () => {
  const vault = createVaultReadModel({
    entities: [
      createLabTest("evt_exact", "2023-01-01T08:00:00.000Z", [{
        analyte: "Albumin",
        biomarkerSlug: "albumin",
        referenceRange: { high: 50, low: 34, text: "34-50 g/L" },
        unit: "g/L",
        value: 45,
      }]),
      createLabTest("evt_qualified", "2024-01-01T08:00:00.000Z", [{
        analyte: "Albumin",
        biomarkerSlug: "albumin",
        referenceRange: { high: 50, low: 34, text: "34-50 fasting; <60 non-fasting" },
        unit: "g/L",
        value: 46,
      }]),
      createLabTest("evt_conflicting_unit", "2025-01-01T08:00:00.000Z", [{
        analyte: "Albumin",
        biomarkerSlug: "albumin",
        referenceRange: { high: 50, low: 34, text: "3.4-5 g/dL" },
        unit: "g/L",
        value: 47,
      }]),
      createLabTest("evt_conflicting_bound", "2026-01-01T08:00:00.000Z", [{
        analyte: "Albumin",
        biomarkerSlug: "albumin",
        referenceRange: { high: 50, low: 34, text: "35-50 g/L" },
        unit: "g/L",
        value: 48,
      }]),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-07-20T12:00:00.000Z",
    metricPoints: buildMetricProjection(vault).metricPoints,
    sourceBundleHash: "3".repeat(64),
    vault,
  });
  const detail = selectBrowserVaultLabBiomarkerDetail(
    createBrowserVaultQueryClient(parseBrowserVaultReplica(replica)),
    "albumin",
  );

  assert.ok(detail);
  assert.deepEqual(detail.rows.map((row) => row.normalizedReferenceRange), [
    { high: 5, low: 3.4 },
    null,
    null,
    null,
  ]);
  assert.deepEqual(detail.rows.slice(1).map((row) => row.referenceRange?.text), [
    "34-50 fasting; <60 non-fasting",
    "3.4-5 g/dL",
    "35-50 g/L",
  ]);
});

test("lab detail preserves qualitative and incompatible ranges without false conversion", async () => {
  const vault = createVaultReadModel({
    entities: [
      createLabTest("evt_albumin_narrative_range", "2025-03-01T08:00:00.000Z", [{
        analyte: "Albumin",
        biomarkerSlug: "albumin",
        referenceRange: { text: "Expected for adults" },
        unit: "g/L",
        value: 45,
      }]),
      createLabTest("evt_albumin_incompatible_range", "2026-03-01T08:00:00.000Z", [{
        analyte: "Albumin",
        biomarkerSlug: "albumin",
        referenceRange: { text: "34 - 50 mg/dL" },
        unit: "g/L",
        value: 49,
      }]),
      createLabTest("evt_custom_score", "2025-01-01T08:00:00.000Z", [{
        analyte: "Custom marker",
        referenceRange: { text: "Negative" },
        textValue: "Negative",
      }]),
      createLabTest("evt_custom_index", "2026-01-01T08:00:00.000Z", [{
        analyte: "Custom marker",
        referenceRange: { text: "1 - 3 index" },
        unit: "index",
        value: 2,
      }]),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-07-20T12:00:00.000Z",
    metricPoints: buildMetricProjection(vault).metricPoints,
    sourceBundleHash: "6".repeat(64),
    vault,
  });
  const detail = selectBrowserVaultLabBiomarkerDetail(
    createBrowserVaultQueryClient(parseBrowserVaultReplica(replica)),
    "custom-marker",
  );

  assert.ok(detail);
  assert.equal(detail.rows[0]?.normalizedReferenceRange, null);
  assert.deepEqual(detail.rows[0]?.referenceRange, { text: "Negative" });
  assert.deepEqual(detail.rows[1]?.normalizedReferenceRange, { high: 3, low: 1 });

  const albumin = selectBrowserVaultLabBiomarkerDetail(
    createBrowserVaultQueryClient(parseBrowserVaultReplica(replica)),
    "albumin",
  );
  assert.ok(albumin);
  assert.deepEqual(albumin.rows.map((row) => row.normalizedValue), [4.5, 4.9]);
  assert.deepEqual(albumin.rows.map((row) => row.normalizedReferenceRange), [null, null]);
  assert.deepEqual(albumin.rows.map((row) => row.referenceRange), [
    { text: "Expected for adults" },
    { text: "34 - 50 mg/dL" },
  ]);
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
  assert.equal(measured[0]?.displayName, "β?!");
  assert.equal(measured[0]?.healthArea.id, "other");
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
