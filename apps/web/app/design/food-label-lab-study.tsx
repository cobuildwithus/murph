import type { PublicProductDetail } from "@murphai/contracts";

import { FoodBrandVisual } from "@/src/components/food-label-lab/food-brand-visual";
import { FoodLabelLab } from "@/src/components/food-label-lab/food-label-lab";
import { getFoodCategoryAsset } from "@/src/components/food-label-lab/food-label-model";

const CHOBANI = createFood({
  productRef: "food_design_chobani",
  name: "PLAIN NONFAT GREEK YOGURT, PLAIN",
  brand: "CHOBANI",
  upc: "818290012108",
  servingDescription: "1 Container",
  servingGrams: 150,
  calories: 53,
  protein: 9.3,
  sugars: 2.7,
  fat: 0,
  saturatedFat: 0,
  sodium: 47,
  testCount: 57,
  analytes: ["Lead", "Cadmium", "Arsenic", "Mercury", "Glyphosate", "Aflatoxin M1"],
  screening: "none",
});

const STRAUS = createFood({
  productRef: "food_design_straus",
  name: "Organic Plain Whole Milk Greek Yogurt, 32 oz",
  brand: "Straus",
  upc: "074305110403",
  servingDescription: "3/4 cup",
  servingGrams: 170,
  calories: 106,
  protein: 10,
  sugars: 3.5,
  fat: 5.9,
  saturatedFat: 3.5,
  sodium: 41,
  testCount: 57,
  analytes: ["Lead", "Cadmium", "Arsenic", "Mercury"],
  screening: "within",
});

const FAGE = createFood({
  productRef: "food_design_fage",
  name: "Total 5% Plain Greek Yogurt",
  brand: "Fage",
  upc: "689544080110",
  servingDescription: "1 cup",
  servingGrams: 170,
  calories: 93,
  protein: 9,
  sugars: 3,
  fat: 5,
  saturatedFat: 3,
  sodium: 35,
  testCount: 1,
  analytes: ["Lead"],
  screening: "exceeds",
});

export const FOOD_LABEL_DESIGN_PRODUCTS = [CHOBANI, STRAUS, FAGE];

export function FoodBrandVisualStudy() {
  return (
    <div className="flex flex-wrap gap-4" data-design-state="local-fallbacks">
      {FOOD_LABEL_DESIGN_PRODUCTS.map((product) => (
        <div key={product.productRef} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          <FoodBrandVisual
            asset={getFoodCategoryAsset(product)}
            brand={product.brand}
          />
          <span className="text-sm font-medium text-foreground">{product.brand}</span>
        </div>
      ))}
    </div>
  );
}

export function FoodLabelLabStudy() {
  return (
    <div className="flex flex-col gap-8" data-design-section="food-label-lab" id="food-label-lab">
      <div data-design-state="comparison" className="overflow-hidden rounded-xl border border-border">
        <FoodLabelLab initialProducts={FOOD_LABEL_DESIGN_PRODUCTS} webMcpEnabled={false} />
      </div>
      <div data-design-state="single" className="overflow-hidden rounded-xl border border-border">
        <FoodLabelLab initialProducts={[STRAUS]} webMcpEnabled={false} />
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
  servingDescription: string;
  servingGrams: number;
  calories: number;
  protein: number;
  sugars: number;
  fat: number;
  saturatedFat: number;
  sodium: number;
  testCount: number;
  analytes: string[];
  screening: "none" | "within" | "exceeds";
}): PublicProductDetail {
  const observations = input.analytes.map((analyte, index) =>
    createObservation(input, analyte, index),
  );
  const alerts = observations.flatMap((observation) =>
    observation.screening?.comparison === "exceeds"
      ? [{
          analyte: observation.analyte,
          concernLevel: "medium" as const,
          result: observation.result,
          threshold: observation.screening.threshold,
          source: observation.source,
          testedProduct: observation.testedProduct,
        }]
      : [],
  );
  return {
    productRef: input.productRef,
    kind: "food",
    name: input.name,
    brand: input.brand,
    upc: input.upc,
    marketStatus: "active",
    serving: {
      description: input.servingDescription,
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
        nutritionRow("Fatty acids, total saturated", input.saturatedFat, "g"),
        nutritionRow("Sodium, Na", input.sodium, "mg"),
      ],
    },
    productTests: {
      status: "known_product_tests",
      total: input.testCount,
      returned: observations.length,
      truncated: input.testCount > observations.length,
      observations,
      alerts,
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
      unknown("FORMULA_REVISION_NOT_TRACKED", "Formula revision not tracked"),
      unknown("TESTED_LOT_NOT_REPORTED", "Tested lot not reported"),
      unknown("INGREDIENTS_STATEMENT_ONLY", "Ingredient structure unavailable"),
      unknown("TEST_METHOD_NOT_REPORTED", "Test method not reported"),
      ...(input.screening === "none"
        ? [unknown("TEST_THRESHOLD_NOT_COMPARABLE", "Screening threshold unavailable")]
        : []),
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
  const exceeds = product.screening === "exceeds" && index === 0;
  return {
    id: `${product.productRef}_${index}`,
    analyte: { key: analyte.toLowerCase().replace(/\s+/gu, "_"), name: analyte },
    result: {
      operator: exceeds ? "eq" : index >= 4 ? "not_detected" : "lt",
      value: exceeds ? 12 : index >= 4 ? null : 0.5,
      unit: "ppb",
      basis: "product_mass",
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
    screening: product.screening === "none"
      ? null
      : {
          comparison: exceeds ? "exceeds" : "does_not_exceed",
          threshold: {
            value: 5,
            unit: "ppb",
            basis: "product_mass",
            authority: "Synthetic design threshold",
            name: "Design study limit",
            url: "https://example.com/limit",
          },
        },
  };
}

function unknown(
  code: PublicProductDetail["unknowns"][number]["code"],
  title: string,
): PublicProductDetail["unknowns"][number] {
  return { code, title, description: "Synthetic design gap." };
}
