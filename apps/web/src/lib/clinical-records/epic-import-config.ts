import "server-only";

import { clinicalRecordsError } from "./errors";
import { EPIC_AUTOMATIC_RESOURCE_TYPES, isEpicAutomaticQuery } from "./epic-policy";
import type { ClinicalProviderDirectoryEntry } from "./provider-directory";

/** Default-empty feature flag: only explicitly provisioned organizations may use the broad app. */
export function epicHospitalApprovedImportsEnabled(providerId: string): boolean {
  return (process.env.EPIC_SMART_HOSPITAL_APPROVED_PROVIDER_IDS ?? "")
    .split(",").map((id) => id.trim()).filter(Boolean).includes(providerId);
}

export function epicImportQueryEnabled(providerId: string, queryScopeId: string): boolean {
  return isEpicAutomaticQuery(queryScopeId) || epicHospitalApprovedImportsEnabled(providerId);
}

export function readEpicImportConfiguration(provider: ClinicalProviderDirectoryEntry): {
  clientId: string;
  hospitalApprovedImports: boolean;
  resourceTypes: readonly string[];
} {
  const hospitalApprovedImports = epicHospitalApprovedImportsEnabled(provider.id);
  const automaticClientId = process.env[provider.clientIdEnvironmentKey]?.trim();
  const approvedKey = provider.clientIdEnvironmentKey === "EPIC_SMART_CLIENT_ID"
    ? "EPIC_SMART_HOSPITAL_APPROVED_CLIENT_ID"
    : "EPIC_SMART_HOSPITAL_APPROVED_NON_PRODUCTION_CLIENT_ID";
  const clientId = hospitalApprovedImports ? process.env[approvedKey]?.trim() : automaticClientId;
  if (!clientId || clientId.length > 512 || (hospitalApprovedImports && clientId === automaticClientId)) {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_PROVIDER_NOT_CONFIGURED",
      httpStatus: 503,
      retryable: true,
      message: "The selected Clinical Records provider is not configured yet.",
    });
  }
  return {
    clientId,
    hospitalApprovedImports,
    resourceTypes: hospitalApprovedImports ? provider.resourceTypes
      : provider.resourceTypes.filter((type) => EPIC_AUTOMATIC_RESOURCE_TYPES.includes(type)),
  };
}
