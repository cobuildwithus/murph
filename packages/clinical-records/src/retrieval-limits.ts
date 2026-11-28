export const CLINICAL_RECEIPT_PROTOCOL = "query-slices-receipts-v3" as const;
export const clinicalRetrievalProtocols = ["query-slices-v2", CLINICAL_RECEIPT_PROTOCOL] as const;
export type ClinicalRetrievalProtocol = typeof clinicalRetrievalProtocols[number];

export const CLINICAL_FHIR_MAX_RETRIEVAL_SLICES = 80;

// Lifetime searches may run up to the Oracle gateway deadline. Leave room for
// token renewal, reading the body and settling the page before its callback expires.
export const ORACLE_LIFETIME_SEARCH_TIMEOUT_MS = 65_000;
export const ORACLE_LIFETIME_PAGE_CALLBACK_MS = ORACLE_LIFETIME_SEARCH_TIMEOUT_MS + 35_000;

export function isOracleLifetimeSearch(sourceSystem: string, slice: { coverage: string; resourceType: string }): boolean {
  return sourceSystem === "cerner-fhir" && slice.coverage === "whole-family" && slice.resourceType !== "Patient";
}
