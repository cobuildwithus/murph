import assert from "node:assert/strict";

import { test } from "vitest";

import {
  groupLabItemsByHealthArea,
  LAB_HEALTH_AREA_IDS,
  listLabHealthAreas,
  listMetricDefinitions,
  resolveIndexedLabHealthArea,
  resolveLabHealthArea,
} from "../src/index.ts";

test("keeps a stable calm member-facing area order", () => {
  assert.deepEqual(listLabHealthAreas().map((area) => area.id), LAB_HEALTH_AREA_IDS);
  assert.deepEqual(listLabHealthAreas().map((area) => area.label), [
    "Blood sugar",
    "Heart & lipids",
    "Kidneys",
    "Liver",
    "Thyroid",
    "Blood",
    "Hormones",
    "Nutrients & fatty acids",
    "Inflammation & immune",
    "Electrolytes",
    "Muscle & tissue",
    "Environmental exposure",
    "Prostate health",
    "Other",
  ]);
});

test("assigns every cataloged lab metric to a curated area", () => {
  const labDefinitions = listMetricDefinitions().filter((definition) => definition.category === "lab");
  const ungrouped = labDefinitions
    .filter((definition) => resolveLabHealthArea(definition.key).id === "other")
    .map((definition) => definition.key);

  assert.deepEqual(ungrouped, []);
  assert.equal(resolveLabHealthArea("HbA1c").id, "blood-sugar");
  assert.equal(resolveLabHealthArea("biomarker:apolipoprotein-b").id, "heart-lipids");
  assert.equal(resolveLabHealthArea("serum_albumin").id, "liver");
  assert.equal(resolveLabHealthArea("WBC").id, "blood");
});

test("recognizes common normalized lab analyte keys without interpreting values", () => {
  assert.equal(resolveLabHealthArea("fasting_insulin").id, "blood-sugar");
  assert.equal(resolveLabHealthArea("total_cholesterol").id, "heart-lipids");
  assert.equal(resolveLabHealthArea("POC Troponin I").id, "heart-lipids");
  assert.equal(resolveLabHealthArea("blood urea nitrogen").id, "kidneys");
  assert.equal(resolveLabHealthArea("GFR MDRD Af Amer").id, "kidneys");
  assert.equal(resolveLabHealthArea("GFR MDRD Non Af Amer").id, "kidneys");
  assert.equal(resolveLabHealthArea("total bilirubin").id, "liver");
  assert.equal(resolveLabHealthArea("thyroid stimulating hormone").id, "thyroid");
  assert.equal(resolveLabHealthArea("platelet count").id, "blood");
  assert.equal(resolveLabHealthArea("free testosterone").id, "hormones");
  assert.equal(resolveLabHealthArea("vitamin d 25 hydroxy").id, "nutrients");
  assert.equal(resolveLabHealthArea("erythrocyte sedimentation rate").id, "inflammation");
  assert.equal(resolveLabHealthArea("sodium").id, "electrolytes");
  assert.equal(resolveLabHealthArea("OmegaCheck total").id, "nutrients");
  assert.equal(resolveLabHealthArea("Creatine Kinase").id, "muscle-tissue");
  assert.equal(resolveLabHealthArea("Mercury").id, "environmental");
  assert.equal(resolveLabHealthArea("PSA percent free").id, "prostate");
});

test("admits only explicitly classified analytes to the Biomarkers index", () => {
  assert.equal(resolveIndexedLabHealthArea("HbA1c")?.id, "blood-sugar");
  assert.equal(resolveIndexedLabHealthArea("new experimental analyte"), null);
  assert.equal(resolveIndexedLabHealthArea("ECG impression"), null);
  assert.equal(resolveIndexedLabHealthArea("Urine color"), null);
  assert.equal(resolveIndexedLabHealthArea("Screening result"), null);
  assert.equal(resolveIndexedLabHealthArea("Report sequence"), null);

  assert.deepEqual(resolveLabHealthArea("new experimental analyte"), {
    id: "other",
    label: "Other",
  });
  assert.equal(resolveLabHealthArea("").id, "other");
  assert.equal(resolveLabHealthArea("biomarker:unmapped-marker").id, "other");
});

test("groups items in area order and preserves their order within each area", () => {
  const items = [
    { key: "mystery-marker", value: 1 },
    { key: "fasting-insulin", value: 8 },
    { key: "tsh", value: 2.1 },
    { key: "hba1c", value: 5.2 },
  ];

  const groups = groupLabItemsByHealthArea(items, (item) => item.key);

  assert.deepEqual(groups.map((group) => group.area.id), ["blood-sugar", "thyroid", "other"]);
  assert.deepEqual(groups[0]?.items, [items[1], items[3]]);
  assert.deepEqual(groups[1]?.items, [items[2]]);
  assert.deepEqual(groups[2]?.items, [items[0]]);
});
