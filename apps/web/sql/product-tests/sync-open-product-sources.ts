import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const PRODUCT_TEST_HEADERS = [
  "id",
  "food_id",
  "supplement_id",
  "source_key",
  "source_result_id",
  "source_name",
  "source_url",
  "source_report_title",
  "report_date",
  "tested_product_name",
  "tested_product_brand",
  "tested_product_upc",
  "tested_source_product_id",
  "match_method",
  "contaminant_key",
  "contaminant_name",
  "result_operator",
  "result_value",
  "result_unit",
  "result_basis",
  "normalized_value",
  "normalized_unit",
  "normalized_basis",
  "lab_name",
  "test_method",
] as const;

type ProductTestRow = Record<(typeof PRODUCT_TEST_HEADERS)[number], string>;
type JsonRecord = Record<string, unknown>;

const OUTPUT_DIR = new URL("./open-data/", import.meta.url);
const PRODUCT_TESTS_CSV = new URL(
  "./open-data/open_product_sources_product_tests.csv",
  import.meta.url,
);

const NYC_SOURCE = {
  key: "nyc_dohmh_consumer_products",
  name: "NYC Department of Health and Mental Hygiene",
  datasetUrl:
    "https://data.cityofnewyork.us/Health/Metal-Content-of-Consumer-Products-Tested-by-the-N/da9u-wz3r",
  apiUrl: "https://data.cityofnewyork.us/resource/da9u-wz3r.json?$limit=50000",
  reportTitle:
    "Metal Content of Consumer Products Tested by the NYC Health Department",
};

const KING_COUNTY_SOURCE = {
  key: "king_county_consumer_products",
  name: "Public Health - Seattle & King County and Hazardous Waste Management Program",
  datasetUrl:
    "https://data.kingcounty.gov/Health-Wellness/Lead-Content-of-Consumer-Products-tested-in-King-C/i6sy-ckp7",
  apiUrl:
    "https://data.kingcounty.gov/resource/i6sy-ckp7.json?$select=:id,year_tested,program,data_source,product_type,product_name,brand_name,manufacturer,made_in_country,test_method,qualifier,lead_concentration_ppm&$limit=50000",
  reportTitle:
    "Lead Content of Consumer Products tested in King County, Washington",
};

const PURE_EARTH_SOURCE = {
  key: "pure_earth_rms_2024",
  name: "Pure Earth",
  datasetUrl: "https://zenodo.org/records/10444602",
  downloadUrl:
    "https://zenodo.org/records/10444602/files/RMS%20XRF%20dataset%20%2820240106%29.xlsx?download=1",
  reportTitle: "Rapid Market Screening dataset",
  reportDate: "2024-01-05",
};

const CONTAMINANT_NAMES: Record<string, string> = {
  arsenic: "Arsenic",
  cadmium: "Cadmium",
  chromium: "Chromium",
  lead: "Lead",
  mercury: "Mercury",
};

async function main(): Promise<void> {
  const tests: ProductTestRow[] = [];

  const nycRows = await fetchJsonArray(NYC_SOURCE.apiUrl);
  addNycRows(nycRows, tests);

  const kingCountyRows = await fetchJsonArray(KING_COUNTY_SOURCE.apiUrl);
  addKingCountyRows(kingCountyRows, tests);

  const pureEarthRows = await fetchPureEarthRows();
  addPureEarthRows(pureEarthRows, tests);

  ensureUnique(tests.map((row) => row.id), "open product source product test id");
  ensureUnique(
    tests.map((row) =>
      [row.source_key, row.source_result_id, row.contaminant_key].join("\t"),
    ),
    "open product source test natural key",
  );

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeCsv(PRODUCT_TESTS_CSV, PRODUCT_TEST_HEADERS, tests);

  const counts = countBy(tests, (row) => row.source_key);
  console.log(`Wrote ${tests.length} product test rows.`);
  for (const [source, count] of Object.entries(counts).sort()) {
    console.log(`${source}: ${count}`);
  }
}

function addNycRows(
  rows: JsonRecord[],
  tests: ProductTestRow[],
): void {
  const eligibleTypes = new Set([
    "Dietary Supplement/Medications/Remedy",
    "Food Other",
    "Food-Candy",
    "Food-Spice",
  ]);

  for (const row of rows) {
    const productType = readString(row, "product_type");
    if (!eligibleTypes.has(productType)) {
      continue;
    }

    const metal = readString(row, "metal");
    const contaminantKey = contaminantKeyFromName(metal);
    if (!contaminantKey) {
      continue;
    }

    const rowId = readString(row, "row_id");
    const productName = cleanPublicSourceText(
      cleanUnknown(readString(row, "product_name")),
    );
    const manufacturer = cleanPublicSourceText(
      cleanUnknown(readString(row, "manufacturer")),
    );
    const units = normalizeUnit(readString(row, "units"));
    const concentration = readString(row, "concentration");
    const collectionDate = readString(row, "collection_date").slice(0, 10);
    const result = nycResult(concentration);
    const normalizedResult = hasNumericComparableResult(result)
      ? normalizedResultForUnit(result.value, units)
      : null;
    tests.push(
      productTestRow({
        id: `${NYC_SOURCE.key}:${rowId}:${contaminantKey}`,
        sourceKey: NYC_SOURCE.key,
        sourceResultId: rowId,
        sourceName: NYC_SOURCE.name,
        sourceUrl: `${NYC_SOURCE.datasetUrl}?row_id=${encodeURIComponent(rowId)}`,
        sourceReportTitle: NYC_SOURCE.reportTitle,
        reportDate: collectionDate,
        testedProductName: productName,
        testedProductBrand: manufacturer,
        testedSourceProductId: rowId,
        contaminantKey,
        contaminantName: CONTAMINANT_NAMES[contaminantKey] ?? metal,
        resultOperator: result.operator,
        resultValue: result.value,
        resultUnit: units,
        resultBasis: resultBasisForUnit(units),
        normalizedValue: normalizedResult?.value ?? "",
        normalizedUnit: normalizedResult?.unit ?? "",
        normalizedBasis: normalizedResult?.basis ?? "",
        testMethod: "Laboratory",
      }),
    );
  }
}

function addKingCountyRows(
  rows: JsonRecord[],
  tests: ProductTestRow[],
): void {
  const eligibleTypes = new Set([
    "Candy",
    "Dietary Supplement/Medications",
    "Food",
    "Seasoning",
  ]);

  for (const row of rows) {
    const productType = readString(row, "product_type");
    if (!eligibleTypes.has(productType)) {
      continue;
    }

    const sourceRowId = readString(row, ":id");
    const productName = cleanPublicSourceText(
      cleanUnknown(readString(row, "product_name")),
    );
    const brand = cleanPublicSourceText(
      cleanUnknown(readString(row, "brand_name"))
        || cleanUnknown(readString(row, "manufacturer")),
    );
    const concentration = readString(row, "lead_concentration_ppm");
    if (!isNonNegativeNumber(concentration)) {
      continue;
    }
    const result = kingCountyResult(readString(row, "qualifier"), concentration);
    const normalizedResult = hasNumericComparableResult(result)
      ? normalizedResultForUnit(result.value, "ppm")
      : null;

    tests.push(
      productTestRow({
        id: `${KING_COUNTY_SOURCE.key}:${sourceRowId}:lead`,
        sourceKey: KING_COUNTY_SOURCE.key,
        sourceResultId: sourceRowId,
        sourceName: KING_COUNTY_SOURCE.name,
        sourceUrl: KING_COUNTY_SOURCE.datasetUrl,
        sourceReportTitle: KING_COUNTY_SOURCE.reportTitle,
        reportDate: "",
        testedProductName: productName,
        testedProductBrand: brand,
        testedSourceProductId: sourceRowId,
        contaminantKey: "lead",
        contaminantName: "Lead",
        resultOperator: result.operator,
        resultValue: result.value,
        resultUnit: "ppm",
        resultBasis: "product_mass",
        normalizedValue: normalizedResult?.value ?? "",
        normalizedUnit: normalizedResult?.unit ?? "",
        normalizedBasis: normalizedResult?.basis ?? "",
        testMethod: readString(row, "test_method"),
      }),
    );
  }
}

function addPureEarthRows(
  rows: JsonRecord[],
  tests: ProductTestRow[],
): void {
  const foodCategories = new Set(["1", "7", "10", "11"]);
  const seenSourceRowIds = new Set<string>();

  for (const row of rows) {
    const category = readString(row, "Sample type category");
    if (!foodCategories.has(category)) {
      continue;
    }

    const sourceRowId = pureEarthSourceRowId(row);
    if (seenSourceRowIds.has(sourceRowId)) {
      continue;
    }
    seenSourceRowIds.add(sourceRowId);
    const productName = cleanPublicSourceText(
      cleanUnknown(readString(row, "Sample description")),
    );
    const rawReading = readString(row, "Highest XRF reading");
    if (!isNonNegativeNumber(rawReading)) {
      continue;
    }
    const reading = normalizeNumericText(rawReading);
    const normalizedResult = normalizedResultForUnit(reading, "ppm");

    tests.push(
      productTestRow({
        id: `${PURE_EARTH_SOURCE.key}:${sourceRowId}:lead`,
        sourceKey: PURE_EARTH_SOURCE.key,
        sourceResultId: sourceRowId,
        sourceName: PURE_EARTH_SOURCE.name,
        sourceUrl: PURE_EARTH_SOURCE.datasetUrl,
        sourceReportTitle: PURE_EARTH_SOURCE.reportTitle,
        reportDate: PURE_EARTH_SOURCE.reportDate,
        testedProductName: productName,
        testedProductBrand: "",
        testedSourceProductId: sourceRowId,
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
}

async function fetchJsonArray(url: string): Promise<JsonRecord[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(`Expected JSON array from ${url}`);
  }

  return data.filter(isRecord);
}

async function fetchPureEarthRows(): Promise<JsonRecord[]> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-pure-earth-rms-"));
  try {
    const xlsxPath = path.join(tempRoot, "pure-earth-rms.xlsx");
    const response = await fetch(PURE_EARTH_SOURCE.downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch Pure Earth RMS workbook: ${response.status}`);
    }
    await writeFile(xlsxPath, Buffer.from(await response.arrayBuffer()));
    const sharedStringsXml = execFileSync(
      "unzip",
      ["-p", xlsxPath, "xl/sharedStrings.xml"],
      { encoding: "utf8" },
    );
    const sheetXml = execFileSync(
      "unzip",
      ["-p", xlsxPath, "xl/worksheets/sheet1.xml"],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );
    return parseXlsxSheet(sharedStringsXml, sheetXml);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function parseXlsxSheet(sharedStringsXml: string, sheetXml: string): JsonRecord[] {
  const sharedStrings = [...sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/gu)]
    .map((match) =>
      [...(match[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/gu)]
        .map((textMatch) => decodeXml(textMatch[1] ?? ""))
        .join(""),
    );

  const rows = [...sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gu)]
    .map((match) => parseXlsxRow(match[1] ?? "", sharedStrings));
  const headers = rows[0];
  const dataRows = rows.slice(1);
  if (!headers) {
    throw new Error("Pure Earth RMS workbook has no header row");
  }

  return dataRows.map((row) => {
    const entries: Array<[string, string]> = headers.map((header, index) => [
      header,
      row[index] ?? "",
    ]);
    return Object.fromEntries(entries);
  });
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
    row[index] = type === "s"
      ? sharedStrings[Number(rawValue)] ?? ""
      : decodeXml(rawValue);
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

function productTestRow(input: {
  id: string;
  sourceKey: string;
  sourceResultId: string;
  sourceName: string;
  sourceUrl: string;
  sourceReportTitle: string;
  reportDate: string;
  testedProductName: string;
  testedProductBrand: string;
  testedSourceProductId: string;
  contaminantKey: string;
  contaminantName: string;
  resultOperator: string;
  resultValue: string;
  resultUnit: string;
  resultBasis: string;
  normalizedValue: string;
  normalizedUnit: string;
  normalizedBasis: string;
  testMethod: string;
}): ProductTestRow {
  return {
    id: input.id,
    food_id: "",
    supplement_id: "",
    source_key: input.sourceKey,
    source_result_id: input.sourceResultId,
    source_name: input.sourceName,
    source_url: input.sourceUrl,
    source_report_title: input.sourceReportTitle,
    report_date: input.reportDate,
    tested_product_name: input.testedProductName,
    tested_product_brand: input.testedProductBrand,
    tested_product_upc: "",
    tested_source_product_id: input.testedSourceProductId,
    match_method: "source_only",
    contaminant_key: input.contaminantKey,
    contaminant_name: input.contaminantName,
    result_operator: input.resultOperator,
    result_value: input.resultValue,
    result_unit: input.resultUnit,
    result_basis: input.resultBasis,
    normalized_value: input.normalizedValue,
    normalized_unit: input.normalizedUnit,
    normalized_basis: input.normalizedBasis,
    lab_name: "",
    test_method: input.testMethod,
  };
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

function hasNumericComparableResult(result: {
  operator: string;
  value: string;
}): boolean {
  return result.value !== ""
    && (result.operator === "eq"
      || result.operator === "lt"
      || result.operator === "lte");
}

function pureEarthSourceRowId(row: JsonRecord): string {
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
    "Highest XRF reading",
    "Number of measurements",
  ].map((field) => readString(row, field));
  const hash = createHash("sha256")
    .update(stableFields.join("\u001f"))
    .digest("hex")
    .slice(0, 12);

  return `${itemId}:${hash}`;
}

function contaminantKeyFromName(name: string): string | null {
  const key = name.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return key in CONTAMINANT_NAMES ? key : null;
}

function normalizeUnit(unit: string): string {
  const normalized = unit.trim().toLowerCase();
  if (normalized === "mg/kg-dry") {
    return "mg/kg-dry";
  }
  return normalized;
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

function normalizedResultForUnit(
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
  return /^unknown(?: or not stated)?$|^not available$|^n\/?a$/iu.test(value)
    ? ""
    : value;
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

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeNumber(value: string): boolean {
  return /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value);
}

async function writeCsv<const Header extends readonly string[]>(
  url: URL,
  headers: Header,
  rows: Array<Record<Header[number], string>>,
): Promise<void> {
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((header) => csvCell(row[header])).join(","),
    ),
    "",
  ];
  await writeFile(url, lines.join("\n"));
}

function csvCell(value: string): string {
  return /[",\n\r]/u.test(value)
    ? `"${value.replace(/"/gu, "\"\"")}"`
    : value;
}

function ensureUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const countKey = key(value);
    counts[countKey] = (counts[countKey] ?? 0) + 1;
  }
  return counts;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
