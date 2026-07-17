import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  adaptKingCountyRows,
  adaptNycRows,
  adaptPureEarthRows,
  assertSyncManagedSourcesPresent,
  parseFdaCinnamonAlertHtml,
  parseFdaHealthFraudHtml,
  parseFdaWanaBanaInvestigationHtml,
  parseFdaWanaBanaWarningLetterHtml,
  parseNyAgHollePdfText,
  parseXlsxSheet,
} from "./product-test-source-adapters";
import {
  PRODUCT_TEST_HEADERS,
  type AdapterOutput,
  type JsonRecord,
} from "./product-test-catalog-types";
import {
  buildProductTestSourceCountManifest,
  PRODUCT_TEST_SOURCE_COUNT_MANIFEST_FILENAME,
} from "./product-test-source-count-manifest";
import {
  EXTERNALLY_MANAGED_PRODUCT_TEST_ADAPTER_KEYS,
  productTestCatalog,
  SYNC_MANAGED_PRODUCT_TEST_ADAPTER_KEYS,
  type ExternallyManagedProductTestAdapterKey,
  type SyncManagedProductTestAdapterKey,
} from "./product-test-source-registry";

const OUTPUT_DIR = new URL(
  "../../../../.product-tests-work/seed-data/open-product-sources/",
  import.meta.url,
);
const PRODUCT_TESTS_CSV = new URL("open_product_sources_product_tests.csv", OUTPUT_DIR);
const SOURCE_COUNTS_TSV = new URL(
  PRODUCT_TEST_SOURCE_COUNT_MANIFEST_FILENAME,
  OUTPUT_DIR,
);

const NYC_API_URL =
  "https://data.cityofnewyork.us/resource/da9u-wz3r.json?$limit=50000";
const KING_COUNTY_API_URL =
  "https://data.kingcounty.gov/resource/i6sy-ckp7.json?$select=:id,year_tested,program,data_source,product_type,product_name,brand_name,manufacturer,made_in_country,test_method,qualifier,lead_concentration_ppm&$limit=50000";
const PURE_EARTH_DOWNLOAD_URL =
  "https://zenodo.org/records/10444602/files/RMS%20XRF%20dataset%20%2820240106%29.xlsx?download=1";

export const EXTERNAL_SOURCE_EXEMPTIONS = {
  plasticlist_bay_area_2024:
    "Managed by the existing PlasticList-specific importer.",
} satisfies Record<ExternallyManagedProductTestAdapterKey, string>;

const SYNC_ADAPTER_DISPATCH = {
  nyc_dohmh_consumer_products: async () =>
    adaptNycRows(await fetchJsonArray(NYC_API_URL)),
  king_county_consumer_products: async () =>
    adaptKingCountyRows(await fetchJsonArray(KING_COUNTY_API_URL)),
  pure_earth_rms_2024: async () => adaptPureEarthRows(await fetchPureEarthRows()),
  fda_cinnamon_alert_2024_03: async () => {
    const source = productTestCatalog("fda_cinnamon_alert_2024_03");
    return parseFdaCinnamonAlertHtml(
      await fetchText(source.canonicalUrl),
      "fda_cinnamon_alert_2024_03",
    );
  },
  fda_cinnamon_alert_2024_07_25: async () => {
    const source = productTestCatalog("fda_cinnamon_alert_2024_07_25");
    return parseFdaCinnamonAlertHtml(
      await fetchText(source.canonicalUrl),
      "fda_cinnamon_alert_2024_07_25",
    );
  },
  fda_cinnamon_alert_2024_07: async () => {
    const source = productTestCatalog("fda_cinnamon_alert_2024_07");
    return parseFdaCinnamonAlertHtml(
      await fetchText(source.canonicalUrl),
      "fda_cinnamon_alert_2024_07",
    );
  },
  fda_wanabana_warning_letter_2024: async () => {
    const source = productTestCatalog("fda_wanabana_warning_letter_2024");
    return parseFdaWanaBanaWarningLetterHtml(await fetchText(source.canonicalUrl));
  },
  fda_wanabana_investigation_2023: async () => {
    const source = productTestCatalog("fda_wanabana_investigation_2023");
    return parseFdaWanaBanaInvestigationHtml(await fetchText(source.canonicalUrl));
  },
  ny_ag_holle_baby_food_2022: async () => {
    const source = productTestCatalog("ny_ag_holle_baby_food_2022");
    return parseNyAgHollePdfText(await fetchPdfText(source.canonicalUrl));
  },
  fda_health_fraud_products: async () => {
    const source = productTestCatalog("fda_health_fraud_products");
    return parseFdaHealthFraudHtml(await fetchText(source.canonicalUrl), "2024-01-01");
  },
} satisfies Record<SyncManagedProductTestAdapterKey, () => Promise<AdapterOutput>>;

async function main(): Promise<void> {
  assertCompleteEnabledSourceExecutionPolicy();
  const outputs = await Promise.all(
    SYNC_MANAGED_PRODUCT_TEST_ADAPTER_KEYS.map((sourceKey) =>
      SYNC_ADAPTER_DISPATCH[sourceKey]()
    ),
  );
  const tests = outputs.flatMap((output) => output.rows);

  assertSyncManagedSourcesPresent(tests);

  ensureUnique(tests.map((row) => row.id), "open product source product test id");
  ensureUnique(
    tests.map((row) =>
      [row.source_key, row.source_result_id, row.contaminant_key].join("\t")
    ),
    "open product source test natural key",
  );

  await mkdir(OUTPUT_DIR, { recursive: true });
  await Promise.all([
    writeCsv(PRODUCT_TESTS_CSV, PRODUCT_TEST_HEADERS, tests),
    writeFile(SOURCE_COUNTS_TSV, buildProductTestSourceCountManifest(tests)),
  ]);

  const counts = countBy(tests, (row) => row.source_key);
  console.log(`Wrote ${tests.length} product test rows.`);
  for (const [source, count] of Object.entries(counts).sort()) {
    console.log(`${source}: ${count}`);
  }
  const skipped = combineDiagnostics(outputs);
  for (const [diagnostic, count] of Object.entries(skipped).sort()) {
    console.log(`Skipped ${diagnostic}: ${count}`);
  }
}

function assertCompleteEnabledSourceExecutionPolicy(): void {
  const exemptKeys = Object.keys(EXTERNAL_SOURCE_EXEMPTIONS).sort();
  const expectedExemptKeys = [...EXTERNALLY_MANAGED_PRODUCT_TEST_ADAPTER_KEYS]
    .sort();
  if (exemptKeys.join("|") !== expectedExemptKeys.join("|")) {
    throw new Error("Product-test external-source exemptions are incomplete");
  }
}

async function fetchJsonArray(url: string): Promise<JsonRecord[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch public JSON source: ${response.status}`);
  }
  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Expected public JSON source to return an array");
  }
  return data.filter(isRecord);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch public source page: ${response.status}`);
  }
  return response.text();
}

async function fetchPureEarthRows(): Promise<JsonRecord[]> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-pure-earth-rms-"));
  try {
    const xlsxPath = path.join(tempRoot, "pure-earth-rms.xlsx");
    const response = await fetch(PURE_EARTH_DOWNLOAD_URL);
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

async function fetchPdfText(url: string): Promise<string> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-product-test-pdf-"));
  try {
    const pdfPath = path.join(tempRoot, "source.pdf");
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch public source PDF: ${response.status}`);
    }
    await writeFile(pdfPath, Buffer.from(await response.arrayBuffer()));
    return execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeCsv<const Header extends readonly string[]>(
  url: URL,
  headers: Header,
  rows: Array<Record<Header[number], string>>,
): Promise<void> {
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
    "",
  ];
  await writeFile(url, lines.join("\n"));
}

function csvCell(value: string): string {
  return /[",\n\r]/u.test(value) ? `"${value.replace(/"/gu, "\"\"")}"` : value;
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

function combineDiagnostics(outputs: AdapterOutput[]): Record<string, number> {
  const combined: Record<string, number> = {};
  for (const output of outputs) {
    const sourceKey = output.rows[0]?.source_key ?? "empty_source";
    for (const [reason, count] of Object.entries(output.skipped)) {
      combined[`${sourceKey}.${reason}`] = count;
    }
  }
  return combined;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
