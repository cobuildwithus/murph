import { createHash } from "node:crypto";

import {
  incrementDiagnostic,
  productTestRow,
  type AdapterOutput,
  type JsonRecord,
  type ProductTestRow,
} from "./product-test-catalog-types";
import {
  productTestCatalog,
  SYNC_MANAGED_PRODUCT_TEST_ADAPTER_KEYS,
} from "./product-test-source-registry";

const CONTAMINANT_NAMES: Record<string, string> = {
  arsenic: "Arsenic",
  cadmium: "Cadmium",
  chromium: "Chromium",
  lead: "Lead",
  mercury: "Mercury",
};

const NYC_ELIGIBLE_PRODUCT_TYPES = new Set([
  "Dietary Supplement/Medications/Remedy",
  "Food Other",
  "Food-Candy",
  "Food-Spice",
]);

const KING_COUNTY_ELIGIBLE_PRODUCT_TYPES = new Set([
  "Candy",
  "Dietary Supplement/Medications",
  "Food",
  "Seasoning",
]);

const PURE_EARTH_FOOD_CATEGORIES = new Set(["1", "7", "10", "11"]);

export function adaptNycRows(rows: JsonRecord[]): AdapterOutput {
  const source = productTestCatalog("nyc_dohmh_consumer_products");
  const tests: ProductTestRow[] = [];
  const skipped: Record<string, number> = {};

  for (const row of rows) {
    const productType = readString(row, "product_type");
    if (!NYC_ELIGIBLE_PRODUCT_TYPES.has(productType)) {
      incrementDiagnostic(skipped, "ineligible_product_type");
      continue;
    }

    const metal = readString(row, "metal");
    const contaminantKey = contaminantKeyFromName(metal);
    if (!contaminantKey) {
      incrementDiagnostic(skipped, "unsupported_contaminant");
      continue;
    }

    const rowId = readString(row, "row_id");
    if (!rowId) {
      incrementDiagnostic(skipped, "missing_source_row_id");
      continue;
    }
    const productName = cleanPublicSourceText(
      cleanUnknown(readString(row, "product_name")),
    );
    const manufacturer = cleanPublicSourceText(
      cleanUnknown(readString(row, "manufacturer")),
    );
    if (!productName && !manufacturer) {
      incrementDiagnostic(skipped, "missing_product_identity");
      continue;
    }
    const units = normalizeUnit(readString(row, "units"));
    const concentration = readString(row, "concentration");
    const collectionDate = readString(row, "collection_date").slice(0, 10);
    const result = nycResult(concentration);
    const normalizedResult = hasNumericComparableResult(result)
      ? normalizedResultForUnit(result.value, units)
      : null;
    tests.push(
      productTestRow({
        id: `${source.sourceKey}:${rowId}:${contaminantKey}`,
        sourceKey: source.sourceKey,
        sourceResultId: rowId,
        sourceName: source.authority,
        sourceUrl: `${source.canonicalUrl}?row_id=${encodeURIComponent(rowId)}`,
        sourceReportTitle: source.title,
        reportDate: collectionDate,
        testedProductName: productName,
        testedProductBrand: manufacturer,
        testedSourceProductId: rowId,
        evidenceType: "regulatory_laboratory",
        samplingContext: "regulatory_surveillance",
        sourceSampleId: rowId,
        collectedOn: collectionDate,
        contaminantKey,
        contaminantName: CONTAMINANT_NAMES[contaminantKey] ?? metal,
        resultOperator: result.operator,
        resultValue: result.value,
        resultUnit: units,
        resultBasis: resultBasisForUnit(units),
        normalizedValue: normalizedResult?.value ?? "",
        normalizedUnit: normalizedResult?.unit ?? "",
        normalizedBasis: normalizedResult?.basis ?? "",
        testMethod: readString(row, "analysis_type"),
      }),
    );
  }

  return { rows: tests, skipped };
}

export function assertSyncManagedSourcesPresent(
  rows: readonly ProductTestRow[],
): void {
  const presentSourceKeys = new Set(rows.map((row) => row.source_key));
  const missingSourceKeys = SYNC_MANAGED_PRODUCT_TEST_ADAPTER_KEYS.filter(
    (sourceKey) => !presentSourceKeys.has(sourceKey),
  );
  if (missingSourceKeys.length > 0) {
    throw new Error(
      `Product-test sync produced zero rows for managed sources: ${missingSourceKeys.join(", ")}`,
    );
  }
}

export function adaptKingCountyRows(rows: JsonRecord[]): AdapterOutput {
  const source = productTestCatalog("king_county_consumer_products");
  const tests: ProductTestRow[] = [];
  const skipped: Record<string, number> = {};

  for (const row of rows) {
    const productType = readString(row, "product_type");
    if (!KING_COUNTY_ELIGIBLE_PRODUCT_TYPES.has(productType)) {
      incrementDiagnostic(skipped, "ineligible_product_type");
      continue;
    }

    const sourceRowId = readString(row, ":id");
    if (!sourceRowId) {
      incrementDiagnostic(skipped, "missing_source_row_id");
      continue;
    }
    const productName = cleanPublicSourceText(
      cleanUnknown(readString(row, "product_name")),
    );
    const brand = cleanPublicSourceText(
      cleanUnknown(readString(row, "brand_name"))
        || cleanUnknown(readString(row, "manufacturer")),
    );
    const concentration = readString(row, "lead_concentration_ppm");
    if (!isNonNegativeNumber(concentration)) {
      incrementDiagnostic(skipped, "invalid_concentration");
      continue;
    }
    if (!productName && !brand) {
      incrementDiagnostic(skipped, "missing_product_identity");
      continue;
    }
    const qualifier = readString(row, "qualifier");
    const result = kingCountyResult(qualifier, concentration);
    const normalizedResult = hasNumericComparableResult(result)
      ? normalizedResultForUnit(result.value, "ppm")
      : null;

    tests.push(
      productTestRow({
        id: `${source.sourceKey}:${sourceRowId}:lead`,
        sourceKey: source.sourceKey,
        sourceResultId: sourceRowId,
        sourceName: source.authority,
        sourceUrl: source.canonicalUrl,
        sourceReportTitle: source.title,
        reportDate: "",
        testedProductName: productName,
        testedProductBrand: brand,
        testedSourceProductId: sourceRowId,
        evidenceType: "regulatory_laboratory",
        samplingContext: "regulatory_surveillance",
        sourceSampleId: sourceRowId,
        contaminantKey: "lead",
        contaminantName: "Lead",
        resultOperator: result.operator,
        resultValue: result.value,
        resultUnit: "ppm",
        resultBasis: "product_mass",
        normalizedValue: normalizedResult?.value ?? "",
        normalizedUnit: normalizedResult?.unit ?? "",
        normalizedBasis: normalizedResult?.basis ?? "",
        resultQualifier: qualifier,
        testMethod: readString(row, "test_method"),
      }),
    );
  }

  return { rows: tests, skipped };
}

export function adaptPureEarthRows(rows: JsonRecord[]): AdapterOutput {
  const source = productTestCatalog("pure_earth_rms_2024");
  const tests: ProductTestRow[] = [];
  const skipped: Record<string, number> = {};
  const seenSourceRowIds = new Set<string>();

  for (const row of rows) {
    const category = readString(row, "Sample type category");
    if (!PURE_EARTH_FOOD_CATEGORIES.has(category)) {
      incrementDiagnostic(skipped, "ineligible_product_type");
      continue;
    }

    const sourceRowId = pureEarthSourceRowId(row);
    if (seenSourceRowIds.has(sourceRowId)) {
      incrementDiagnostic(skipped, "duplicate_source_row");
      continue;
    }
    seenSourceRowIds.add(sourceRowId);
    const productName = cleanPublicSourceText(
      cleanUnknown(readString(row, "Sample description")),
    );
    if (!productName) {
      incrementDiagnostic(skipped, "missing_product_identity");
      continue;
    }
    const rawReading = readString(row, "Highest XRF reading");
    if (!isNonNegativeNumber(rawReading)) {
      incrementDiagnostic(skipped, "invalid_concentration");
      continue;
    }
    const reading = normalizeNumericText(rawReading);
    const normalizedResult = normalizedResultForUnit(reading, "ppm");

    tests.push(
      productTestRow({
        id: `${source.sourceKey}:${sourceRowId}:lead`,
        sourceKey: source.sourceKey,
        sourceResultId: sourceRowId,
        sourceName: source.authority,
        sourceUrl: source.canonicalUrl,
        sourceReportTitle: source.title,
        reportDate: "2024-01-05",
        testedProductName: productName,
        testedProductBrand: "",
        testedSourceProductId: sourceRowId,
        evidenceType: "xrf_screening",
        samplingContext: "market_screening",
        sourceSampleId: readString(row, "Item ID"),
        contaminantKey: "lead",
        contaminantName: "Lead",
        resultOperator: "eq",
        resultValue: reading,
        resultUnit: "ppm",
        resultBasis: "product_mass",
        normalizedValue: normalizedResult.value,
        normalizedUnit: normalizedResult.unit,
        normalizedBasis: normalizedResult.basis,
        testMethod: "XRF screening",
      }),
    );
  }

  return { rows: tests, skipped };
}

export function parseXlsxSheet(sharedStringsXml: string, sheetXml: string): JsonRecord[] {
  const sharedStrings = [...sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/gu)]
    .map((match) =>
      [...(match[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/gu)]
        .map((textMatch) => decodeXml(textMatch[1] ?? ""))
        .join(""),
    );

  const rows = [...sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gu)]
    .map((match) => parseXlsxRow(match[1] ?? "", sharedStrings));
  const headers = rows[0];
  if (!headers) {
    throw new Error("Pure Earth RMS workbook has no header row");
  }

  return rows.slice(1).map((row) => {
    const entries: Array<[string, string]> = headers.map((header, index) => [
      header,
      row[index] ?? "",
    ]);
    return Object.fromEntries(entries);
  });
}

export function pureEarthSourceRowId(row: JsonRecord): string {
  const itemId = readString(row, "Item ID");
  if (!itemId) {
    throw new Error("Pure Earth RMS eligible food row is missing Item ID");
  }

  const stableFields = [
    "Item ID",
    "Sample type category",
    "Sample description",
    "Spice_category",
    "Country",
    "City",
  ].map((field) => readString(row, field));
  return `${itemId}:${shortHash(stableFields)}`;
}

export function normalizedResultForUnit(
  value: string,
  unit: string,
): { value: string; unit: string; basis: string } {
  const basis = resultBasisForUnit(unit);
  if (basis !== "product_mass") {
    return { value, unit, basis };
  }
  if (unit === "ppm" || unit === "mg/kg") {
    return { value: normalizeNumericText(value), unit: "ppm", basis };
  }
  if (unit === "ppb" || unit === "ug/kg" || unit === "ng/g") {
    return {
      value: normalizeNumericText(String(Number(value) / 1000)),
      unit: "ppm",
      basis,
    };
  }
  return { value: normalizeNumericText(value), unit, basis };
}

export function hasNumericComparableResult(result: {
  operator: string;
  value: string;
}): boolean {
  return result.value !== ""
    && (result.operator === "eq" || result.operator === "lt" || result.operator === "lte");
}

function parseXlsxRow(rowXml: string, sharedStrings: string[]): string[] {
  const row: string[] = [];
  for (const cell of rowXml.matchAll(/<c\s+([^>]*)>([\s\S]*?)<\/c>/gu)) {
    const attrs = cell[1] ?? "";
    const body = cell[2] ?? "";
    const ref = attrs.match(/\br="([^"]+)"/u)?.[1] ?? "";
    const type = attrs.match(/\bt="([^"]+)"/u)?.[1] ?? "";
    const rawValue = body.match(/<v>([\s\S]*?)<\/v>/u)?.[1] ?? "";
    const index = columnRefToIndex(ref);
    row[index] = type === "s" ? sharedStrings[Number(rawValue)] ?? "" : decodeXml(rawValue);
  }
  return row;
}

function columnRefToIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/u)?.[0] ?? "";
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return index - 1;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, "\"")
    .replace(/&apos;/gu, "'");
}

function nycResult(concentration: string): { operator: string; value: string } {
  if (concentration === "-1") {
    return { operator: "not_detected", value: "" };
  }
  if (!isNonNegativeNumber(concentration)) {
    throw new Error(`Unsupported NYC concentration: ${concentration}`);
  }
  return { operator: "eq", value: normalizeNumericText(concentration) };
}

function kingCountyResult(
  qualifier: string,
  concentration: string,
): { operator: string; value: string } {
  if (!isNonNegativeNumber(concentration)) {
    throw new Error(`Unsupported King County lead concentration: ${concentration}`);
  }
  return qualifier === "<" || qualifier === "<LOD"
    ? { operator: "lt", value: normalizeNumericText(concentration) }
    : { operator: "eq", value: normalizeNumericText(concentration) };
}

function contaminantKeyFromName(name: string): string | null {
  const key = slug(name);
  return key in CONTAMINANT_NAMES ? key : null;
}

function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase();
}

function resultBasisForUnit(unit: string): string {
  return unit === "ppm"
      || unit === "mg/kg"
      || unit === "ppb"
      || unit === "ug/kg"
      || unit === "ng/g"
      || unit === "mg/kg-dry"
    ? "product_mass"
    : "as_reported";
}

function readString(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function cleanUnknown(value: string): string {
  return /^unknown(?: or not stated)?$|^not available$|^n\/?a$/iu.test(value) ? "" : value;
}

function cleanPublicSourceText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "")
    .replace(/\b\+?\d[\d(). -]{8,}\d\b/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeNumericText(value: string): string {
  return String(Number(value));
}

function isNonNegativeNumber(value: string): boolean {
  return /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value);
}

function shortHash(values: string[]): string {
  return createHash("sha256")
    .update(values.join("\u001f"))
    .digest("hex")
    .slice(0, 12);
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}
