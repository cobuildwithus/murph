const FINAL_STATUSES = new Set(["amended", "appended", "corrected", "final"]);

export type ClinicalDocumentParentEligibility = { action: "eligible" } | { action: "retract" | "hold"; reason: string };

/** Shared deterministic import and enrichment policy; attachment readability is a separate concern. */
export function clinicalDocumentParentEligibility(resource: {
  resourceType: string; status?: unknown; docStatus?: unknown;
}): ClinicalDocumentParentEligibility {
  const status = normalizeStatus(resource.status);
  if (resource.resourceType === "DiagnosticReport") {
    if (status === "cancelled" || status === "entered-in-error") return { action: "retract", reason: `FHIR DiagnosticReport status ${status}` };
    return status && FINAL_STATUSES.has(status) ? { action: "eligible" }
      : { action: "hold", reason: "diagnostic report status is not importable" };
  }
  if (resource.resourceType === "DocumentReference") {
    const docStatus = normalizeStatus(resource.docStatus);
    if (status === "entered-in-error" || status === "superseded") return { action: "retract", reason: `FHIR DocumentReference status ${status}` };
    if (docStatus === "entered-in-error") return { action: "retract", reason: "FHIR DocumentReference docStatus entered-in-error" };
    if (status !== "current") return { action: "hold", reason: "document reference status is not importable" };
    return docStatus === undefined || FINAL_STATUSES.has(docStatus) ? { action: "eligible" }
      : { action: "hold", reason: "document reference docStatus is not importable" };
  }
  return { action: "hold", reason: "unsupported clinical document parent" };
}

function normalizeStatus(value: unknown): string | undefined {
  if (typeof value === "string") return value.length ? value.toLowerCase() : undefined;
  return typeof value === "number" || typeof value === "boolean" ? String(value).toLowerCase() : undefined;
}
