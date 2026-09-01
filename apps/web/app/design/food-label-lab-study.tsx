import type { PublicProductDetail } from "@murphai/contracts";

import { FoodLabelLab } from "@/src/components/food-label-lab/food-label-lab";

const CHOBANI = createFood({
  productRef: "food_design_chobani",
  name: "Plain Nonfat",
  brand: "Chobani",
  upc: "818290012108",
  servingGrams: 150,
  calories: 53,
  protein: 9.3,
  sugars: 2.7,
  fat: 0,
  testCount: 57,
  analytes: ["Lead", "Cadmium", "Arsenic", "Mercury", "Glyphosate", "Aflatoxin M1"],
});

const STRAUS = createFood({
  productRef: "food_design_straus",
  name: "Whole Milk",
  brand: "Straus",
  upc: "074305110403",
  servingGrams: 170,
  calories: 106,
  protein: 10,
  sugars: 3.5,
  fat: 5.9,
  testCount: 57,
  analytes: ["Lead", "Cadmium", "Arsenic", "Mercury"],
});

const FAGE = createFood({
  productRef: "food_design_fage",
  name: "Total 5%",
  brand: "Fage",
  upc: "689544080110",
  servingGrams: 170,
  calories: 93,
  protein: 9,
  sugars: 3,
  fat: 5,
  testCount: 1,
  analytes: ["Lead"],
});

export const FOOD_LABEL_DESIGN_PRODUCTS = [CHOBANI, STRAUS, FAGE];

export function FoodLabelLabStudy() {
  return (
    <div className="flex flex-col gap-8" data-design-section="food-label-lab" id="food-label-lab">
      <div data-design-state="comparison" className="overflow-hidden rounded-xl border border-border">
        <FoodLabelLab initialProducts={FOOD_LABEL_DESIGN_PRODUCTS} webMcpEnabled={false} />
      </div>
      <div data-design-state="empty" className="overflow-hidden rounded-xl border border-border">
        <FoodLabelLab webMcpEnabled={false} />
      </div>
    </div>
  );
}

function createFood(input: {
  productRef: string;
  name: string;
  brand: string;
  upc: string;
  servingGrams: number;
  calories: number;
  protein: number;
  sugars: number;
  fat: number;
  testCount: number;
  analytes: string[];
}): PublicProductDetail {
  const observations = input.analytes.map((analyte, index) =>
    createObservation(input, analyte, index),
  );
  return {
    productRef: input.productRef,
    kind: "food",
    name: input.name,
    brand: input.brand,
    upc: input.upc,
    marketStatus: "active",
    serving: {
      description: `${input.servingGrams} g cup`,
      amount: 1,
      unit: "cup",
      grams: input.servingGrams,
    },
    ingredients: {
      structure: "statement_only",
      statement: "Cultured milk.",
      otherStatement: null,
      active: [],
      other: [],
    },
    nutrition: {
      basis: "per_100_g",
      rows: [
        nutritionRow("Calories", input.calories, "kcal"),
        nutritionRow("Protein", input.protein, "g"),
        nutritionRow("Total Sugars", input.sugars, "g"),
        nutritionRow("Total Fat", input.fat, "g"),
      ],
    },
    productTests: {
      status: "known_product_tests",
      total: input.testCount,
      returned: observations.length,
      truncated: input.testCount > observations.length,
      observations,
      alerts: [],
    },
    source: {
      key: "brand_site",
      name: "Official brand label",
      recordId: input.productRef,
      url: "https://example.com/food-label",
      releaseDate: "2026-08-12",
      lastSeenAt: "2026-08-12T12:00:00.000Z",
      importedAt: "2026-08-12T12:00:00.000Z",
    },
    unknowns: [
      unknown("FORMULA_REVISION_NOT_TRACKED", "Formula revision"),
      unknown("TESTED_LOT_NOT_REPORTED", "Current lot"),
      unknown("INGREDIENTS_STATEMENT_ONLY", "Ingredient structure"),
      unknown("TEST_METHOD_NOT_REPORTED", "Test method"),
      unknown("TEST_THRESHOLD_NOT_COMPARABLE", "Screening limit"),
    ],
  };
}

function nutritionRow(name: string, value: number, unit: string) {
  return {
    name,
    amount: { value, unit, display: String(value) },
    dailyValuePercent: null,
    basis: "per_100_g" as const,
  };
}

function createObservation(
  product: Parameters<typeof createFood>[0],
  analyte: string,
  index: number,
): PublicProductDetail["productTests"]["observations"][number] {
  return {
    id: `${product.productRef}_${index}`,
    analyte: { key: analyte.toLowerCase().replace(/\s+/gu, "_"), name: analyte },
    result: {
      operator: index >= 4 ? "not_detected" : "lt",
      value: index >= 4 ? null : 0.5,
      unit: index >= 4 ? "ppb" : "ppb",
      basis: "tested sample",
    },
    normalizedResult: null,
    source: {
      key: "independent_lab",
      name: "Independent lab",
      url: "https://example.com/report",
      reportTitle: "Product test report",
      reportDate: "2026-08-12",
    },
    testedProduct: {
      name: product.name,
      brand: product.brand,
      upc: product.upc,
      sourceProductId: product.productRef,
      matchMethod: "exact_upc",
    },
    sample: {
      evidenceType: "laboratory_measurement",
      samplingContext: "retail_purchase",
      sourceSampleId: `sample_${index % 4}`,
      sampleCount: 1,
      reportedUpc: product.upc,
      lotCode: index < 2 ? `lot_${index}` : null,
      bestBy: null,
      packageSize: `${product.servingGrams} g`,
      collectedOn: "2026-08-01",
      testedOn: "2026-08-05",
      labName: "Independent lab",
      testMethod: null,
    },
    labName: "Independent lab",
    testMethod: null,
    screening: index < 4
      ? {
          comparison: "does_not_exceed",
          threshold: {
            value: 5,
            unit: "ppb",
            basis: "tested sample",
            authority: "Synthetic design threshold",
            name: "Design study limit",
            url: "https://example.com/limit",
          },
        }
      : null,
  };
}

function unknown(
  code: PublicProductDetail["unknowns"][number]["code"],
  title: string,
): PublicProductDetail["unknowns"][number] {
  return { code, title, description: "Synthetic design gap." };
}
