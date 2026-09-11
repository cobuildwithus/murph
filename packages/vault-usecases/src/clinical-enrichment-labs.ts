import type { ClinicalDocumentExtractionPayload } from "@murphai/clinical-records";
import { resolveLabResultMetricDefinition } from "@murphai/health-metrics";

// This adapter accepts only specimen relationships it can prove. The metric
// catalog owns aliases but does not yet declare specimen compatibility; new
// catalog entries therefore do not automatically gain publication authority.
const serumOrPlasmaMetrics = new Set([
  "glucose", "albumin", "creatinine", "blood-urea-nitrogen", "egfr", "egfr-ckd-epi",
  "apob", "ldl-c", "hdl-c", "triglycerides", "total-cholesterol", "non-hdl-cholesterol",
  "alt", "ast", "ggt", "alkaline-phosphatase", "hs-crp", "ferritin", "thyroid-stimulating-hormone",
]);
const wholeBloodMetrics = new Set([
  "hba1c", "hemoglobin", "hematocrit", "red-blood-cell-count", "white-blood-cell-count", "platelet-count",
  "mean-corpuscular-hemoglobin", "mean-corpuscular-hemoglobin-concentration", "mean-corpuscular-volume",
  "red-cell-distribution-width", "lymphocyte-percentage",
]);
const urineMetrics = new Set(["urine-protein", "urine-albumin-random-without-creatinine"]);

function supportsSpecimen(metric: string, specimen: string): boolean {
  if (specimen === "urine") return urineMetrics.has(metric);
  if (specimen === "serum" || specimen === "plasma" || specimen === "serum/plasma") return serumOrPlasmaMetrics.has(metric);
  if (specimen === "whole blood") return wholeBloodMetrics.has(metric) || serumOrPlasmaMetrics.has(metric);
  return specimen === "blood" && (serumOrPlasmaMetrics.has(metric) || wholeBloodMetrics.has(metric));
}

/** Holds the whole source-backed proposal before any catalog label fallback can publish a wrong specimen. */
export function clinicalEnrichmentLabHoldReason(payload: ClinicalDocumentExtractionPayload): string | null {
  if (payload.kind !== "test") return null;
  const specimen = payload.specimenType?.trim().toLowerCase().replace(/\s+/gu, " ") ?? "";
  for (const result of payload.results ?? []) {
    // Keep this precedence identical to the test-result metric projection.
    const identity = result.biomarkerSlug ?? result.slug ?? result.analyte;
    const definition = resolveLabResultMetricDefinition(identity);
    const labelDefinition = resolveLabResultMetricDefinition(result.analyte);
    if (!definition || !supportsSpecimen(definition.key, specimen)
      || (labelDefinition && labelDefinition.key !== definition.key)) {
      return `Laboratory identity/specimen remains unresolved: ${result.analyte.slice(0, 120)} (${payload.specimenType ?? "specimen not supplied"}).`;
    }
  }
  return null;
}
