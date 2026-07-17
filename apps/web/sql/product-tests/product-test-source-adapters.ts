import { createHash } from "node:crypto";

import { parseHTML } from "linkedom";

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

interface CinnamonProductDetails {
  name: string;
  packageSize: string;
  reportDate: string;
}

const FDA_CINNAMON_PRODUCT_DETAILS: Record<string, CinnamonProductDetails> = {
  "fda_cinnamon_alert_2024_03:la_fiesta": cinnamonDetails("La Fiesta Cinnamon Ground", "", "2024-03-06"),
  "fda_cinnamon_alert_2024_03:marcum": cinnamonDetails("Marcum Ground Cinnamon", "1.5 oz", "2024-03-06"),
  "fda_cinnamon_alert_2024_03:mk": cinnamonDetails("MK Ground Cinnamon", "", "2024-03-06"),
  "fda_cinnamon_alert_2024_03:swad": cinnamonDetails("Swad Cinnamon Powder", "3.5 oz", "2024-03-06"),
  "fda_cinnamon_alert_2024_03:supreme_tradition": cinnamonDetails("Supreme Tradition Ground Cinnamon", "2.25 oz", "2024-03-06"),
  "fda_cinnamon_alert_2024_03:el_chilar": cinnamonDetails("El Chilar Ground Cinnamon / Canela Molida", "", "2024-03-06"),
  "fda_cinnamon_alert_2024_07_25:el_servidor": cinnamonDetails("El Servidor Ground Cinnamon", "", "2024-07-25"),
  "fda_cinnamon_alert_2024_07:lucky_foods_brand": cinnamonDetails("Lucky Foods 100% Natural Cinnamon Powder", "40 g", "2025-12-10"),
  "fda_cinnamon_alert_2024_07:venzu_traders": cinnamonDetails("Venzu Traders Cinnamon Powder", "", "2025-11-07"),
  "fda_cinnamon_alert_2024_07:devi": cinnamonDetails("DEVI Ground Cinnamon / Dalchini Powder", "", "2025-10-30"),
  "fda_cinnamon_alert_2024_07:bailifeng": cinnamonDetails("BaiLiFeng Dried Cinnamon Powder", "", "2025-10-30"),
  "fda_cinnamon_alert_2024_07:roshni": cinnamonDetails("Roshni Ground Cinnamon Powder", "", "2025-10-10"),
  "fda_cinnamon_alert_2024_07:haetae_ht": cinnamonDetails("HAETAE Cinnamon Powder", "8 oz", "2025-10-10"),
  "fda_cinnamon_alert_2024_07:durra": cinnamonDetails("Durra Ground Cinnamon", "100 g", "2025-10-08"),
  "fda_cinnamon_alert_2024_07:wise_wife": cinnamonDetails("Wise Wife Ground Cinnamon", "", "2025-10-08"),
  "fda_cinnamon_alert_2024_07:jiva_organics": cinnamonDetails("Jiva Organics Ground Cinnamon", "", "2025-09-12"),
  "fda_cinnamon_alert_2024_07:super_brand": cinnamonDetails("Super Brand Cinnamon Powder", "4 oz", "2024-11-01"),
  "fda_cinnamon_alert_2024_07:asli": cinnamonDetails("Asli Cinnamon Powder", "7 oz", "2024-08-30"),
  "fda_cinnamon_alert_2024_07:el_chilar": cinnamonDetails("El Chilar Ground Cinnamon"),
  "fda_cinnamon_alert_2024_07:marcum": cinnamonDetails("Marcum Ground Cinnamon", "1.5 oz"),
  "fda_cinnamon_alert_2024_07:swad": cinnamonDetails("SWAD Ground Cinnamon"),
  "fda_cinnamon_alert_2024_07:supreme_tradition": cinnamonDetails("Supreme Tradition Ground Cinnamon", "2.25 oz"),
  "fda_cinnamon_alert_2024_07:compania_indillor_orientale": cinnamonDetails("Compania Indillor Orientale Ground Cinnamon"),
  "fda_cinnamon_alert_2024_07:alb_flavor": cinnamonDetails("ALB Flavor Ground Cinnamon"),
  "fda_cinnamon_alert_2024_07:shahzada": cinnamonDetails("Shahzada Cinnamon Powder", "7 oz"),
  "fda_cinnamon_alert_2024_07:spice_class": cinnamonDetails("Spice Class Ground Cinnamon"),
  "fda_cinnamon_alert_2024_07:la_frontera": cinnamonDetails("La Frontera Ground Cinnamon"),
};

export type FdaCinnamonSourceKey =
  | "fda_cinnamon_alert_2024_03"
  | "fda_cinnamon_alert_2024_07_25"
  | "fda_cinnamon_alert_2024_07";

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

export function parseFdaCinnamonAlertHtml(
  html: string,
  sourceKey: FdaCinnamonSourceKey,
): AdapterOutput {
  const source = productTestCatalog(sourceKey);
  const { document } = parseHTML(html);
  const table = document.querySelector("table");
  if (!table) {
    throw new Error(`${sourceKey} page has no product table`);
  }
  const headers = [...table.querySelectorAll("thead th")]
    .map((header) => headerKey(header.textContent));
  const layout = cinnamonTableLayout(sourceKey);
  if (headers.join("|") !== layout.expectedHeaders.join("|")) {
    throw new Error(`${sourceKey} product table headers changed`);
  }

  const tests: ProductTestRow[] = [];
  const skipped: Record<string, number> = {};
  const tableRows = [...table.querySelectorAll("tbody tr")];
  for (const tableRow of tableRows) {
    const cells = [...tableRow.querySelectorAll(":scope > td")];
    if (cells.length !== 6) {
      incrementDiagnostic(skipped, "unexpected_table_shape");
      continue;
    }

    const brand = cellLines(cells[layout.brandCellIndex])
      .filter((line) => !/^(?:recall|announcement|annoucement)$/iu.test(line))
      .join(" ")
      .replace(/\brecall\s+ann?ou?n?cement\b/giu, "")
      .replace(/\s+/gu, " ")
      .trim();
    if (!brand) {
      incrementDiagnostic(skipped, "missing_product_identity");
      continue;
    }
    const resultValues = cellLines(cells[4]).flatMap((line) =>
      [...line.matchAll(/(?:^|\s|and\s)(\d+(?:\.\d+)?)(?=$|\s)/giu)]
        .map((match) => match[1] ?? "")
        .filter(Boolean)
    );
    if (resultValues.length === 0) {
      incrementDiagnostic(skipped, "missing_result");
      continue;
    }

    const lotLines = cellLines(cells[layout.lotCellIndex]);
    const identifiers = cinnamonIdentifiers(lotLines, resultValues.length);
    if (!identifiers.aligned) {
      incrementDiagnostic(skipped, "ambiguous_identifier_alignment");
    }
    const productDetails = cinnamonProductDetails(sourceKey, brand);
    const packageSize = productDetails.packageSize;
    const productName = productDetails.name;
    const reportDate = productDetails.reportDate;

    for (const [resultIndex, rawValue] of resultValues.entries()) {
      const identity = identifiers.values[resultIndex] ?? emptyCinnamonIdentifier();
      const value = normalizeNumericText(rawValue);
      const sourceResultId = `${slug(brand)}:${shortHash([
        brand,
        identity.upcRaw,
        identity.lot,
        identity.bestBy,
        String(resultIndex + 1),
      ])}`;
      const testedProductUpc = validGtin(identity.upcRaw) ? digits(identity.upcRaw) : "";
      const testedSourceProductId = testedProductUpc
        ? `gtin:${testedProductUpc}`
        : `brand:${shortHash([brand, productName])}`;
      tests.push(productTestRow({
        id: `${source.sourceKey}:${sourceResultId}:lead`,
        sourceKey: source.sourceKey,
        sourceResultId,
        sourceName: source.authority,
        sourceUrl: source.canonicalUrl,
        sourceReportTitle: source.title,
        reportDate,
        testedProductName: productName,
        testedProductBrand: brand,
        testedProductUpc,
        testedProductUpcRaw: identity.upcRaw,
        testedSourceProductId,
        evidenceType: "regulatory_laboratory",
        samplingContext: "targeted_surveillance",
        testedLotCode: identity.lot,
        testedBestBy: identity.bestBy,
        testedPackageSize: packageSize,
        contaminantKey: "lead",
        contaminantName: "Lead",
        resultOperator: "eq",
        resultValue: value,
        resultUnit: "ppm",
        resultBasis: "product_mass",
        normalizedValue: value,
        normalizedUnit: "ppm",
        normalizedBasis: "product_mass",
        testMethod: "",
      }));
    }
  }

  return { rows: tests, skipped };
}

export function parseFdaWanaBanaWarningLetterHtml(html: string): AdapterOutput {
  const source = productTestCatalog("fda_wanabana_warning_letter_2024");
  const text = normalizedText(parseHTML(html).document.body.textContent);
  const requiredMeasurements = [
    /2\.18 parts per million \(ppm\) lead was detected in FDA Sample 1234871/iu,
    /6\.43 ppm lead was detected in MDH Sample FC2400004901/iu,
    /2\.16\s*-\s*3\.19 ppm lead was detected in NCDA&CS Samples FDC0222755\s*-\s*FDC0222760/iu,
    /1\.44 ppm lead was detected in PDA Sample F2300877-1/iu,
    /FDA Samples 1085090 and 1085091/iu,
    /lead, at 5,110 ppm and 2,270 ppm/iu,
    /chromium, at 1,201 ppm and 531 ppm/iu,
  ];
  for (const measurement of requiredMeasurements) {
    if (!measurement.test(text)) {
      throw new Error(`FDA WanaBana warning-letter measurement structure changed: ${measurement.source}`);
    }
  }

  const observations = [
    wanaBanaObservation("fda-1234871", "1234871", "WanaBana Apple Cinnamon Fruit Puree", "WanaBana", "lead", "Lead", "eq", "2.18", ""),
    wanaBanaObservation("mdh-FC2400004901", "FC2400004901", "WanaBana Apple Cinnamon Fruit Puree", "WanaBana", "lead", "Lead", "eq", "6.43", ""),
    wanaBanaObservation("ncdacs-FDC0222755-FDC0222760", "FDC0222755-FDC0222760", "WanaBana Apple Cinnamon Fruit Puree", "WanaBana", "lead", "Lead", "range", "2.16", "3.19"),
    wanaBanaObservation("pda-F2300877-1", "F2300877-1", "Weis Cinnamon Apple Sauce", "Weis", "lead", "Lead", "eq", "1.44", ""),
    wanaBanaObservation("fda-1085090-lead", "1085090", "Negasmart Cinnamon Powder Received by Austrofood", "Negasmart", "lead", "Lead", "eq", "5110", ""),
    wanaBanaObservation("fda-1085090-total-chromium", "1085090", "Negasmart Cinnamon Powder Received by Austrofood", "Negasmart", "total_chromium", "Total Chromium", "eq", "1201", ""),
    wanaBanaObservation("fda-1085091-lead", "1085091", "Negasmart Cinnamon Powder Received by Austrofood", "Negasmart", "lead", "Lead", "eq", "2270", ""),
    wanaBanaObservation("fda-1085091-total-chromium", "1085091", "Negasmart Cinnamon Powder Received by Austrofood", "Negasmart", "total_chromium", "Total Chromium", "eq", "531", ""),
  ];

  return {
    rows: observations.map((observation) => productTestRow({
      id: `${source.sourceKey}:${observation.sourceResultId}:${observation.contaminantKey}`,
      sourceKey: source.sourceKey,
      sourceResultId: observation.sourceResultId,
      sourceName: source.authority,
      sourceUrl: source.canonicalUrl,
      sourceReportTitle: source.title,
      reportDate: "2024-08-09",
      testedProductName: observation.productName,
      testedProductBrand: observation.brand,
      testedSourceProductId: `name:${shortHash([observation.brand, observation.productName])}`,
      evidenceType: "regulatory_laboratory",
      samplingContext: "outbreak_investigation",
      sourceSampleId: observation.sampleId,
      sourceSampleCount: observation.sampleCount,
      contaminantKey: observation.contaminantKey,
      contaminantName: observation.contaminantName,
      resultOperator: observation.operator,
      resultValue: observation.value,
      resultUpperValue: observation.upperValue,
      resultUnit: "ppm",
      resultBasis: "product_mass",
      normalizedValue: observation.value,
      normalizedUpperValue: observation.upperValue,
      normalizedUnit: "ppm",
      normalizedBasis: "product_mass",
      testMethod: "",
    })),
    skipped: {},
  };
}

export function parseFdaWanaBanaInvestigationHtml(html: string): AdapterOutput {
  const source = productTestCatalog("fda_wanabana_investigation_2023");
  const text = normalizedText(parseHTML(html).document.body.textContent);
  if (!/WanaBana Cinnamon Apple Puree product yielded 0\.590 and 0\.566 ppm/iu.test(text)) {
    throw new Error("FDA WanaBana investigation chromium result structure changed");
  }

  return {
    rows: ["0.590", "0.566"].map((rawValue, index) => {
      const value = normalizeNumericText(rawValue);
      const sourceResultId = `finished-product-total-chromium-${index + 1}`;
      return productTestRow({
        id: `${source.sourceKey}:${sourceResultId}:total_chromium`,
        sourceKey: source.sourceKey,
        sourceResultId,
        sourceName: source.authority,
        sourceUrl: source.canonicalUrl,
        sourceReportTitle: source.title,
        reportDate: "2024-01-05",
        testedProductName: "WanaBana Cinnamon Apple Puree",
        testedProductBrand: "WanaBana",
        testedSourceProductId: `name:${shortHash(["WanaBana", "WanaBana Cinnamon Apple Puree"])}`,
        evidenceType: "regulatory_laboratory",
        samplingContext: "outbreak_investigation",
        contaminantKey: "total_chromium",
        contaminantName: "Total Chromium",
        resultOperator: "eq",
        resultValue: value,
        resultUnit: "ppm",
        resultBasis: "product_mass",
        normalizedValue: value,
        normalizedUnit: "ppm",
        normalizedBasis: "product_mass",
        testMethod: "",
      });
    }),
    skipped: {},
  };
}

export function parseNyAgHollePdfText(text: string): AdapterOutput {
  const source = productTestCatalog("ny_ag_holle_baby_food_2022");
  const sampleMetadata = new Map<string, {
    sampleId: string;
    collectedOn: string;
  }>();
  for (const match of text.matchAll(
    /^([HA][1-9][CZV])\s+(2112258-\d{2})\s+Biota\s+Sample\s+(\d{2}\/\d{2}\/\d{4})\s+\d{2}\/\d{2}\/\d{4}\s*$/gmu,
  )) {
    const sampleId = match[1] ?? "";
    const labId = match[2] ?? "";
    sampleMetadata.set(labId, {
      sampleId,
      collectedOn: isoDateFromUsDate(match[3] ?? ""),
    });
  }
  if (sampleMetadata.size !== 18) {
    throw new Error(`NY AG Holle report expected 18 sample records, found ${sampleMetadata.size}`);
  }

  const tests: ProductTestRow[] = [];
  const skipped: Record<string, number> = {};
  const resultPattern = /^(2112258-\d{2})\s+(As|Cd|Hg|Pb)\s+Biota\s+AR\s+(≤\s*)?(\d+(?:\.\d+)?)\s*(J|U)?\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+µg\/kg\s+/gmu;
  for (const match of text.matchAll(resultPattern)) {
    const labId = match[1] ?? "";
    const analyte = match[2] ?? "";
    const sample = sampleMetadata.get(labId);
    if (!sample) {
      incrementDiagnostic(skipped, "result_without_sample_metadata");
      continue;
    }
    const product = holleProductForSample(sample.sampleId);
    const contaminantKey = holleContaminantKey(analyte);
    const value = normalizeNumericText(match[4] ?? "");
    const normalizedValue = normalizeNumericText(String(Number(value) / 1000));
    const qualifier = match[5] ?? "";
    const resultOperator = match[3] || qualifier === "U" ? "lte" : "eq";
    const rawUpc = product.pouchUpcRaw;
    const sourceResultId = `${labId}:${contaminantKey}`;
    tests.push(productTestRow({
      id: `${source.sourceKey}:${sourceResultId}:${contaminantKey}`,
      sourceKey: source.sourceKey,
      sourceResultId,
      sourceName: source.authority,
      sourceUrl: source.canonicalUrl,
      sourceReportTitle: source.title,
      reportDate: "2022-02-02",
      testedProductName: product.name,
      testedProductBrand: "Holle",
      testedProductUpc: validGtin(rawUpc) ? digits(rawUpc) : "",
      testedProductUpcRaw: rawUpc,
      testedSourceProductId: product.key,
      evidenceType: "regulatory_laboratory",
      samplingContext: "regulatory_market_sampling",
      sourceSampleId: `${sample.sampleId}/${labId}`,
      collectedOn: sample.collectedOn,
      testedOn: contaminantKey === "arsenic" ? "2022-01-28" : "2021-12-29",
      contaminantKey,
      contaminantName: CONTAMINANT_NAMES[contaminantKey] ?? analyte,
      resultOperator,
      resultValue: value,
      resultUnit: "ug/kg",
      resultBasis: "product_mass",
      normalizedValue,
      normalizedUnit: "ppm",
      normalizedBasis: "product_mass",
      resultQualifier: qualifier,
      detectionLimitValue: normalizeNumericText(match[6] ?? ""),
      detectionLimitUnit: "ug/kg",
      reportingLimitValue: normalizeNumericText(match[7] ?? ""),
      reportingLimitUnit: "ug/kg",
      labName: "Brooks Applied Labs",
      testMethod: "AOAC 2015.01, Modified (ICP-QQQ-MS)",
    }));
  }
  if (tests.length !== 72) {
    throw new Error(`NY AG Holle report expected 72 product results, found ${tests.length}`);
  }

  return { rows: tests, skipped };
}

export function parseFdaHealthFraudHtml(
  html: string,
  cutoff = "2024-01-01",
): AdapterOutput {
  const source = productTestCatalog("fda_health_fraud_products");
  const { document } = parseHTML(html);
  const table = document.querySelector('table[summary="Fraudulent Products Table"]');
  if (!table) {
    throw new Error("FDA Health Fraud Product Database table is missing");
  }
  const headers = [...table.querySelectorAll("thead th")]
    .map((header) => normalizedText(header.textContent).replace(/1$/u, ""));
  const expectedHeaders = [
    "Date", "Product", "Firm", "Firm Address", "Source/URL(s)", "Subject",
    "Action", "Program Area(s)", "Additional Outcome",
  ];
  if (headers.join("|") !== expectedHeaders.join("|")) {
    throw new Error("FDA Health Fraud Product Database headers changed");
  }

  const tests: ProductTestRow[] = [];
  const skipped: Record<string, number> = {};
  const actionOccurrences = new Map<string, number>();
  for (const tableRow of table.querySelectorAll("tbody tr")) {
    const cells = [...tableRow.querySelectorAll(":scope > td")];
    if (cells.length !== 9) {
      incrementDiagnostic(skipped, "unexpected_table_shape");
      continue;
    }
    const reportDate = isoDateFromUsDate(normalizedText(cells[0]?.textContent ?? ""));
    if (!reportDate || reportDate < cutoff) {
      incrementDiagnostic(skipped, "before_cutoff");
      continue;
    }
    const programAreas = normalizedText(cells[7]?.textContent ?? "")
      .split(/[,;]/u)
      .map((value) => value.trim().toLowerCase());
    if (!programAreas.includes("foods")) {
      incrementDiagnostic(skipped, "outside_foods_program");
      continue;
    }
    const productName = cleanPublicSourceText(normalizedText(cells[1]?.textContent ?? ""));
    if (!productName || /^n\/?a$/iu.test(productName)) {
      incrementDiagnostic(skipped, "missing_product_identity");
      continue;
    }
    const subject = normalizedText(cells[5]?.textContent ?? "");
    const analytes = parseHealthFraudAnalytes(subject);
    if (!analytes) {
      incrementDiagnostic(skipped, "ambiguous_or_non_laboratory_subject");
      continue;
    }
    const actionLink = cells[6]?.querySelector("a[href]");
    const actionHref = actionLink?.getAttribute("href") ?? "";
    if (!actionHref) {
      incrementDiagnostic(skipped, "missing_action_url");
      continue;
    }
    const actionUrl = new URL(actionHref, "https://www.fda.gov").href;
    const actionOccurrence = (actionOccurrences.get(actionUrl) ?? 0) + 1;
    actionOccurrences.set(actionUrl, actionOccurrence);
    const eventId = actionOccurrence === 1
      ? shortHash([actionUrl])
      : shortHash([actionUrl, String(actionOccurrence)]);
    const sourceProductId = `name:${shortHash([productName])}`;
    for (const analyte of analytes) {
      tests.push(productTestRow({
        id: `${source.sourceKey}:${eventId}:${analyte.key}`,
        sourceKey: source.sourceKey,
        sourceResultId: eventId,
        sourceName: source.authority,
        sourceUrl: actionUrl,
        sourceReportTitle: source.title,
        reportDate,
        testedProductName: productName,
        testedProductBrand: "",
        testedSourceProductId: sourceProductId,
        evidenceType: "regulatory_finding",
        samplingContext: "targeted_investigation",
        contaminantKey: analyte.key,
        contaminantName: analyte.name,
        resultOperator: "detected",
        resultValue: "",
        resultUnit: "presence",
        resultBasis: "product_sample",
        normalizedValue: "",
        normalizedUnit: "",
        normalizedBasis: "",
        testMethod: "",
      }));
    }
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

function cinnamonDetails(
  name: string,
  packageSize = "",
  reportDate = "2024-07-30",
): CinnamonProductDetails {
  return { name, packageSize, reportDate };
}

function cinnamonTableLayout(sourceKey: FdaCinnamonSourceKey): {
  brandCellIndex: number;
  expectedHeaders: string[];
  lotCellIndex: number;
} {
  if (sourceKey === "fda_cinnamon_alert_2024_03") {
    return {
      brandCellIndex: 2,
      expectedHeaders: [
        "distributor",
        "retailers",
        "brandnamess",
        "lotscodes",
        "leadconcentrationppm",
        "productimage",
      ],
      lotCellIndex: 3,
    };
  }
  if (sourceKey === "fda_cinnamon_alert_2024_07_25") {
    return {
      brandCellIndex: 2,
      expectedHeaders: [
        "distributor",
        "retailers",
        "brandnames",
        "lotcodes",
        "leadconcentrationppm",
        "productimage",
      ],
      lotCellIndex: 3,
    };
  }
  return {
    brandCellIndex: 3,
    expectedHeaders: [
      "distributor",
      "retailers",
      "lotcodesproductexpiration",
      "brandnames",
      "leadconcentrationppm",
      "productimage",
    ],
    lotCellIndex: 2,
  };
}

function cinnamonProductDetails(
  sourceKey: FdaCinnamonSourceKey,
  brand: string,
): CinnamonProductDetails {
  return FDA_CINNAMON_PRODUCT_DETAILS[`${sourceKey}:${slug(brand)}`] ?? {
    name: `${brand} Ground Cinnamon`,
    packageSize: "",
    reportDate: sourceKey === "fda_cinnamon_alert_2024_03"
      ? "2024-03-06"
      : sourceKey === "fda_cinnamon_alert_2024_07_25"
        ? "2024-07-25"
        : "2025-12-10",
  };
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function normalizedText(value: string): string {
  return value.replace(/\u00a0/gu, " ").replace(/\s+/gu, " ").trim();
}

function headerKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function cellLines(cell: Element | undefined): string[] {
  if (!cell) {
    return [];
  }
  const clone = cell.cloneNode(true);
  if (clone.nodeType !== 1) {
    return [];
  }
  const element = clone as Element;
  const document = cell.ownerDocument;
  for (const breakElement of element.querySelectorAll("br")) {
    breakElement.replaceWith(document.createTextNode("\n"));
  }
  for (const blockElement of element.querySelectorAll("p,div,li")) {
    blockElement.append(document.createTextNode("\n"));
  }
  return element.textContent
    .replace(/\u00a0/gu, " ")
    .split(/\n+/u)
    .map(normalizedText)
    .filter(Boolean);
}

interface CinnamonIdentifier {
  upcRaw: string;
  lot: string;
  bestBy: string;
}

function emptyCinnamonIdentifier(): CinnamonIdentifier {
  return { upcRaw: "", lot: "", bestBy: "" };
}

function cinnamonIdentifiers(
  rawLines: string[],
  resultCount: number,
): { aligned: boolean; values: CinnamonIdentifier[] } {
  let upcRaw = "";
  for (const [index, line] of rawLines.entries()) {
    const inline = line.match(/UPC\s*(?:Code)?\s*:\s*([0-9 ]{8,25})/iu)?.[1]?.trim();
    if (inline) {
      upcRaw = inline;
      break;
    }
    if (/^UPC\s*(?:Code)?\s*:\s*$/iu.test(line)) {
      const next = rawLines[index + 1] ?? "";
      if (/^[0-9 ]{8,25}$/u.test(next)) {
        upcRaw = next.trim();
        break;
      }
    }
  }
  const withoutUpc: string[] = [];
  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index] ?? "";
    if (/^UPC\s*(?:Code)?\s*:?[0-9 ]*$/iu.test(line)) {
      if (!/[0-9]/u.test(line)) {
        index += 1;
      }
      continue;
    }
    if (/^(?:Best\s*(?:By|Before)(?:\s*date)?|Batch\s*No\.?)\s*:\s*$/iu.test(line)) {
      const next = rawLines[index + 1] ?? "";
      withoutUpc.push(`${line} ${next}`.trim());
      index += 1;
      continue;
    }
    withoutUpc.push(line);
  }

  const parsed = withoutUpc
    .map((line) => parseCinnamonIdentifierLine(line, upcRaw))
    .filter((value) => value.lot || value.bestBy);
  if (resultCount === 1 && parsed.length > 1) {
    const lots = [...new Set(parsed.map((value) => value.lot).filter(Boolean))];
    const bestByValues = [...new Set(parsed.map((value) => value.bestBy).filter(Boolean))];
    if (lots.length <= 1 && bestByValues.length <= 1) {
      return {
        aligned: true,
        values: [{
          upcRaw,
          lot: lots[0] ?? "",
          bestBy: bestByValues[0] ?? "",
        }],
      };
    }
  }
  if (parsed.length === resultCount) {
    return { aligned: true, values: parsed };
  }
  if (parsed.length === 1) {
    return {
      aligned: true,
      values: Array.from({ length: resultCount }, () => parsed[0] ?? emptyCinnamonIdentifier()),
    };
  }
  if (parsed.length === 0) {
    return {
      aligned: true,
      values: Array.from({ length: resultCount }, () => ({ ...emptyCinnamonIdentifier(), upcRaw })),
    };
  }
  return {
    aligned: false,
    values: Array.from({ length: resultCount }, () => ({ ...emptyCinnamonIdentifier(), upcRaw })),
  };
}

function parseCinnamonIdentifierLine(line: string, upcRaw: string): CinnamonIdentifier {
  const withoutLocation = line.replace(/\s+\([^)]*(?:California|Connecticut|Maryland|Missouri|New York|Virginia)[^)]*\)\s*$/iu, "").trim();
  if (/^(?:None|No codes?|\((?:California|Connecticut|Maryland|Missouri|New York|Virginia)\))$/iu.test(withoutLocation)) {
    return { upcRaw, lot: "", bestBy: "" };
  }
  const lotAndBest = withoutLocation.match(/^(.+?),\s*Best\s*(?:By|Before)(?:\s*date)?\s*:?\s*(.+)$/iu);
  if (lotAndBest) {
    return { upcRaw, lot: cleanLotLabel(lotAndBest[1] ?? ""), bestBy: normalizedText(lotAndBest[2] ?? "") };
  }
  const bestThenLot = withoutLocation.match(/^Best\s*(?:By|Before)(?:\s*date)?\s*:\s*([^\-]+)\s+-\s+(.+)$/iu);
  if (bestThenLot) {
    return { upcRaw, lot: normalizedText(bestThenLot[2] ?? ""), bestBy: normalizedText(bestThenLot[1] ?? "") };
  }
  const bestOnly = withoutLocation.match(/^(?:Best\s*(?:By|Before)(?:\s*date)?|EXP)\s*:\s*(.+)$/iu);
  if (bestOnly) {
    const value = normalizedText(bestOnly[1] ?? "").replace(/^Best\s*Before\s*:\s*/iu, "");
    const dateAndLot = value.match(/^((?:\d{2}\/\d{2}\/\d{2}|\d{4}-\d{2}-\d{2}|[A-Za-z]+\s+\d{4}))\s+(.+)$/u);
    return dateAndLot
      ? { upcRaw, lot: normalizedText(dateAndLot[2] ?? ""), bestBy: normalizedText(dateAndLot[1] ?? "") }
      : { upcRaw, lot: "", bestBy: value };
  }
  const expAndLot = withoutLocation.match(/^Exp and Lot\s*:\s*(\S+\s+\S+)\s+(.+)$/iu);
  if (expAndLot) {
    return { upcRaw, lot: normalizedText(expAndLot[2] ?? ""), bestBy: normalizedText(expAndLot[1] ?? "") };
  }
  const dateAndLot = withoutLocation.match(/^((?:\d{2}\/\d{2}\/\d{2}|\d{4}-\d{2}-\d{2}|[A-Za-z]+\s+\d{4}))\s+(.+)$/u);
  if (dateAndLot) {
    return { upcRaw, lot: normalizedText(dateAndLot[2] ?? ""), bestBy: normalizedText(dateAndLot[1] ?? "") };
  }
  return { upcRaw, lot: cleanLotLabel(withoutLocation), bestBy: "" };
}

function cleanLotLabel(value: string): string {
  return normalizedText(value).replace(/^(?:Batch\s*No\.?|B\.NO\.)\s*:\s*/iu, "");
}

function digits(value: string): string {
  return value.replace(/\D/gu, "");
}

function validGtin(value: string): boolean {
  const numeric = digits(value);
  if (![8, 12, 13, 14].includes(numeric.length)) {
    return false;
  }
  const checkDigit = Number(numeric.at(-1));
  let sum = 0;
  for (let index = numeric.length - 2, position = 1; index >= 0; index -= 1, position += 1) {
    const digit = Number(numeric[index]);
    sum += digit * (position % 2 === 1 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === checkDigit;
}

function wanaBanaObservation(
  sourceResultId: string,
  sampleId: string,
  productName: string,
  brand: string,
  contaminantKey: string,
  contaminantName: string,
  operator: string,
  value: string,
  upperValue: string,
) {
  return {
    sourceResultId,
    sampleId,
    productName,
    brand,
    contaminantKey,
    contaminantName,
    operator,
    value,
    upperValue,
    sampleCount: operator === "range" ? "6" : "",
  };
}

function holleProductForSample(sampleId: string): {
  key: string;
  name: string;
  pouchUpcRaw: string;
} {
  const numeric = Number(sampleId[1]);
  if (sampleId.endsWith("C") && numeric >= 1 && numeric <= 3) {
    return { key: "carrot", name: "Carrot Cat Fruit & Veggie Puree", pouchUpcRaw: "260688630210" };
  }
  if (sampleId.endsWith("Z") && numeric >= 4 && numeric <= 6) {
    return { key: "zebra", name: "Zebra Beet Fruit Puree and Veggie Juice", pouchUpcRaw: "260688630074" };
  }
  if (sampleId.endsWith("V") && numeric >= 7 && numeric <= 9) {
    return { key: "veggie", name: "Veggie Bunny Veggie Puree", pouchUpcRaw: "260688630111" };
  }
  throw new Error(`Unknown NY AG Holle sample identity: ${sampleId}`);
}

function holleContaminantKey(analyte: string): string {
  const keys: Record<string, string> = {
    As: "arsenic",
    Cd: "cadmium",
    Hg: "mercury",
    Pb: "lead",
  };
  const key = keys[analyte];
  if (!key) {
    throw new Error(`Unsupported NY AG Holle analyte: ${analyte}`);
  }
  return key;
}

interface HealthFraudAnalyte {
  key: string;
  name: string;
}

function parseHealthFraudAnalytes(subject: string): HealthFraudAnalyte[] | null {
  let clause = "";
  const undeclared = subject.match(/^(?:Contains?\s+)?Undeclared\s+(.+?)\.?$/iu);
  if (undeclared) {
    clause = undeclared[1] ?? "";
  } else {
    const explicitlyContained = subject.match(/^Products?\s+contains?\s+(.+?)\.?$/iu);
    if (!explicitlyContained || /label indicates/iu.test(subject)) {
      return null;
    }
    clause = (explicitlyContained[1] ?? "")
      .replace(/\s+in an amount more than the declared value.*$/iu, "");
  }
  clause = clause.replace(/\s+\(Kratom\)$/iu, "").trim();
  if (!clause || /^(?:adulterated|new drug|public notification)$/iu.test(clause)) {
    return null;
  }

  const normalizedClause = clause
    .replace(/^1,4-dimethylamylamine or DMAA$/iu, "1,4-Dimethylamylamine (DMAA)");
  const protectedClause = normalizedClause.replace(/(\d),(\d)/gu, "$1§$2");
  const parts = protectedClause
    .replace(/,\s+and\s+/giu, ", ")
    .split(/\s+and\s+|,\s+/u)
    .map((value) => value.replace(/§/gu, ",").trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.some((part) => /\bor\b/iu.test(part))) {
    return null;
  }
  return parts.map((name) => ({ key: slug(name), name }));
}

function isoDateFromUsDate(value: string): string {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/u);
  if (!match) {
    return "";
  }
  return `${match[3]}-${match[1]}-${match[2]}`;
}
