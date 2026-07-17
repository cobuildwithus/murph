export const EPIC_BETA_RESOURCE_TYPES = Object.freeze([
  "Patient",
  "Observation",
  "DiagnosticReport",
] as const);

export type EpicBetaResourceType = typeof EPIC_BETA_RESOURCE_TYPES[number];

type EpicBetaOperation = "read" | "search";
type SmartPermissionVersion = "v1" | "v2";

const EPIC_BETA_OPERATION_BY_RESOURCE: Readonly<Record<EpicBetaResourceType, EpicBetaOperation>> =
  Object.freeze({
    DiagnosticReport: "search",
    Observation: "search",
    Patient: "read",
  });

export function buildEpicBetaSmartResourceScope(input: {
  permissionVersion: SmartPermissionVersion;
  resourceType: string;
}): string {
  const resourceType = requireEpicBetaResourceType(input.resourceType);
  const operation = EPIC_BETA_OPERATION_BY_RESOURCE[resourceType];
  const permission = input.permissionVersion === "v1"
    ? "read"
    : operation === "read"
      ? "r"
      : "s";
  return `patient/${resourceType}.${permission}`;
}

export function readGrantedEpicBetaResourceTypes(
  scopes: readonly string[],
  candidateResourceTypes: readonly string[] = EPIC_BETA_RESOURCE_TYPES,
): EpicBetaResourceType[] {
  const candidates = candidateResourceTypes.filter(isEpicBetaResourceType);
  return candidates.filter((resourceType) =>
    scopes.some((scope) => scopeGrantsEpicBetaOperation(scope, resourceType))
  );
}

export function buildEpicBetaRetrievalQueryFingerprintInput(input: {
  pageCount: string;
  resourceType: string;
}): string {
  const resourceType = requireEpicBetaResourceType(input.resourceType);
  if (resourceType === "Patient") {
    return "epic-fhir-r4:Patient:read-by-launch-patient:v1";
  }
  if (resourceType === "Observation") {
    return `epic-fhir-r4:Observation:search:patient:category=laboratory:_count=${input.pageCount}:v1`;
  }
  return `epic-fhir-r4:DiagnosticReport:search:patient:_count=${input.pageCount}:v1`;
}

export function buildEpicBetaInitialFhirPageUrl(input: {
  fhirBaseUrl: string;
  pageCount: string;
  patientId: string;
  resourceType: string;
}): URL {
  const resourceType = requireEpicBetaResourceType(input.resourceType);
  const base = input.fhirBaseUrl.replace(/\/+$/u, "");
  if (resourceType === "Patient") {
    return new URL(`${base}/Patient/${encodeURIComponent(input.patientId)}`);
  }
  const url = new URL(`${base}/${resourceType}`);
  url.searchParams.set("patient", input.patientId);
  if (resourceType === "Observation") {
    url.searchParams.set("category", "laboratory");
  }
  url.searchParams.set("_count", input.pageCount);
  return url;
}

export function isEpicBetaResourceType(value: string): value is EpicBetaResourceType {
  return (EPIC_BETA_RESOURCE_TYPES as readonly string[]).includes(value);
}

function requireEpicBetaResourceType(value: string): EpicBetaResourceType {
  if (!isEpicBetaResourceType(value)) {
    throw new TypeError(`FHIR resource type ${value} is outside the Epic beta acquisition policy.`);
  }
  return value;
}

function scopeGrantsEpicBetaOperation(
  scope: string,
  resourceType: EpicBetaResourceType,
): boolean {
  const match = /^patient\/([A-Z][A-Za-z0-9]+|\*)\.([a-z]+)$/u.exec(scope);
  if (!match || (match[1] !== "*" && match[1] !== resourceType)) return false;
  const permission = match[2] ?? "";
  if (permission === "read") return true;
  if (!/^c?r?u?d?s?$/u.test(permission)) return false;
  const operation = EPIC_BETA_OPERATION_BY_RESOURCE[resourceType];
  return operation === "read" ? permission.includes("r") : permission.includes("s");
}
