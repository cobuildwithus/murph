import assert from "node:assert/strict";

import { test } from "vitest";

import {
  resolveLabBiomarkerContext,
} from "../app/(dashboard)/biomarkers/results/[metricKey]/lab-biomarker-context";

test("lab biomarker context merges page-authored and reviewed fallback ranges", () => {
  const chloride = resolveLabBiomarkerContext("chloride");
  assert.equal(chloride.fallbackRanges.length, 1);
  assert.deepEqual(chloride.fallbackRanges[0], {
    applicability: "For published adult comparison on serum results from adults age 18 or older when the saved result uses this exact unit and has no range; this comparator is not the reporting laboratory's range, and source-laboratory flags and per-result ranges remain authoritative.",
    eligibleSpecimenKinds: ["serum"],
    label: "Mayo Clinic Laboratories adult serum reference interval",
    lowerBound: { inclusive: true, value: 98 },
    unit: "mmol/L",
    upperBound: { inclusive: true, value: 107 },
  });

  const calculatedLdl = resolveLabBiomarkerContext("ldl-calculated");
  assert.equal(calculatedLdl.fallbackRanges.length, 1);
  assert.deepEqual(calculatedLdl.fallbackRanges[0], {
    applicability: calculatedLdl.fallbackRanges[0]?.applicability,
    eligibleSpecimenKinds: ["serum"],
    label: "Published adult calculated LDL-C comparator",
    unit: "mg/dL",
    upperBound: { inclusive: false, value: 100 },
  });
  assert.match(
    calculatedLdl.fallbackRanges[0]?.applicability ?? "",
    /not the reporting laboratory's range/iu,
  );

  const ironBindingCapacity = resolveLabBiomarkerContext(
    "total-iron-binding-capacity",
  );
  assert.deepEqual(
    ironBindingCapacity.fallbackRanges.map((range) => range.unit),
    ["mcg/dL", "mcg/dL (calc)"],
  );

  const vitaminD = resolveLabBiomarkerContext("vitamin-d");
  assert.deepEqual(
    vitaminD.fallbackRanges.map((range) => range.unit),
    ["ng/mL", "nmol/L"],
  );
});

test("context-heavy biomarkers stay neutral when the current resolver cannot prove applicability", () => {
  assert.deepEqual(
    resolveLabBiomarkerContext("poc-troponin-i").fallbackRanges,
    [],
  );
  assert.deepEqual(
    resolveLabBiomarkerContext("hba1c").fallbackRanges,
    [],
  );
  assert.deepEqual(
    resolveLabBiomarkerContext("free-testosterone").fallbackRanges,
    [],
  );
});
