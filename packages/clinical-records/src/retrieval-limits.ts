export const CLINICAL_RECEIPT_PROTOCOL = "query-slices-receipts-v3" as const;
export const clinicalRetrievalProtocols = ["query-slices-v2", CLINICAL_RECEIPT_PROTOCOL] as const;
export type ClinicalRetrievalProtocol = typeof clinicalRetrievalProtocols[number];

export const CLINICAL_FHIR_MAX_RETRIEVAL_SLICES = 80;
