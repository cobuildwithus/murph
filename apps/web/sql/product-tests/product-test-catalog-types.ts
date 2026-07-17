export const PRODUCT_TEST_HEADERS = [
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
  "tested_product_upc_raw",
  "tested_source_product_id",
  "evidence_type",
  "sampling_context",
  "source_sample_id",
  "source_sample_count",
  "tested_lot_code",
  "tested_best_by",
  "tested_package_size",
  "collected_on",
  "tested_on",
  "match_method",
  "contaminant_key",
  "contaminant_name",
  "result_operator",
  "result_value",
  "result_upper_value",
  "result_unit",
  "result_basis",
  "normalized_value",
  "normalized_upper_value",
  "normalized_unit",
  "normalized_basis",
  "result_qualifier",
  "detection_limit_value",
  "detection_limit_unit",
  "quantification_limit_value",
  "quantification_limit_unit",
  "reporting_limit_value",
  "reporting_limit_unit",
  "uncertainty_value",
  "uncertainty_unit",
  "lab_name",
  "test_method",
] as const;

export type ProductTestHeader = (typeof PRODUCT_TEST_HEADERS)[number];
export type ProductTestRow = Record<ProductTestHeader, string>;
export type JsonRecord = Record<string, unknown>;

export type ProductTestEvidenceType =
  | "laboratory_measurement"
  | "regulatory_laboratory"
  | "regulatory_finding"
  | "xrf_screening"
  | "manufacturer_coa";

export interface ProductTestRowInput {
  id: string;
  sourceKey: string;
  sourceResultId: string;
  sourceName: string;
  sourceUrl: string;
  sourceReportTitle: string;
  reportDate: string;
  testedProductName: string;
  testedProductBrand: string;
  testedProductUpc?: string;
  testedProductUpcRaw?: string;
  testedSourceProductId: string;
  evidenceType: ProductTestEvidenceType;
  samplingContext: string;
  sourceSampleId?: string;
  sourceSampleCount?: string;
  testedLotCode?: string;
  testedBestBy?: string;
  testedPackageSize?: string;
  collectedOn?: string;
  testedOn?: string;
  contaminantKey: string;
  contaminantName: string;
  resultOperator: string;
  resultValue: string;
  resultUpperValue?: string;
  resultUnit: string;
  resultBasis: string;
  normalizedValue: string;
  normalizedUpperValue?: string;
  normalizedUnit: string;
  normalizedBasis: string;
  resultQualifier?: string;
  detectionLimitValue?: string;
  detectionLimitUnit?: string;
  quantificationLimitValue?: string;
  quantificationLimitUnit?: string;
  reportingLimitValue?: string;
  reportingLimitUnit?: string;
  uncertaintyValue?: string;
  uncertaintyUnit?: string;
  labName?: string;
  testMethod: string;
}

export interface AdapterDiagnostics {
  readonly [reason: string]: number;
}

export interface AdapterOutput {
  rows: ProductTestRow[];
  skipped: AdapterDiagnostics;
}

export function productTestRow(input: ProductTestRowInput): ProductTestRow {
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
    tested_product_upc: input.testedProductUpc ?? "",
    tested_product_upc_raw: input.testedProductUpcRaw ?? "",
    tested_source_product_id: input.testedSourceProductId,
    evidence_type: input.evidenceType,
    sampling_context: input.samplingContext,
    source_sample_id: input.sourceSampleId ?? "",
    source_sample_count: input.sourceSampleCount ?? "",
    tested_lot_code: input.testedLotCode ?? "",
    tested_best_by: input.testedBestBy ?? "",
    tested_package_size: input.testedPackageSize ?? "",
    collected_on: input.collectedOn ?? "",
    tested_on: input.testedOn ?? "",
    match_method: "source_only",
    contaminant_key: input.contaminantKey,
    contaminant_name: input.contaminantName,
    result_operator: input.resultOperator,
    result_value: input.resultValue,
    result_upper_value: input.resultUpperValue ?? "",
    result_unit: input.resultUnit,
    result_basis: input.resultBasis,
    normalized_value: input.normalizedValue,
    normalized_upper_value: input.normalizedUpperValue ?? "",
    normalized_unit: input.normalizedUnit,
    normalized_basis: input.normalizedBasis,
    result_qualifier: input.resultQualifier ?? "",
    detection_limit_value: input.detectionLimitValue ?? "",
    detection_limit_unit: input.detectionLimitUnit ?? "",
    quantification_limit_value: input.quantificationLimitValue ?? "",
    quantification_limit_unit: input.quantificationLimitUnit ?? "",
    reporting_limit_value: input.reportingLimitValue ?? "",
    reporting_limit_unit: input.reportingLimitUnit ?? "",
    uncertainty_value: input.uncertaintyValue ?? "",
    uncertainty_unit: input.uncertaintyUnit ?? "",
    lab_name: input.labName ?? "",
    test_method: input.testMethod,
  };
}

export function incrementDiagnostic(
  diagnostics: Record<string, number>,
  reason: string,
): void {
  diagnostics[reason] = (diagnostics[reason] ?? 0) + 1;
}
