import {
  parsePublicClinicalProviderDirectory,
  type ClinicalProviderDirectory as PublicDirectory,
  type ClinicalProviderDirectoryEntry as PublicEntry,
} from "@murphai/clinical-records/provider-directory";
import { EPIC_ACQUISITION_POLICY, EPIC_ACQUISITION_POLICY_ID, EPIC_BETA_REQUESTED_BASE_SCOPES, EPIC_BETA_RESOURCE_TYPES } from "./epic-policy";

export * from "@murphai/clinical-records/provider-directory";

export interface ClinicalProviderDirectoryEntry extends PublicEntry {
  requestedBaseScopes: readonly string[];
  resourceTypes: readonly string[];
}

export type ClinicalProviderDirectory = PublicDirectory<ClinicalProviderDirectoryEntry>;

export function parseClinicalProviderDirectory(value: unknown): ClinicalProviderDirectory {
  if (!value || typeof value !== "object" || !("policies" in value)
    || !Array.isArray(value.policies) || value.policies.length !== 1) {
    throw new RangeError("Clinical provider directory must contain exactly one owned policy.");
  }
  if (JSON.stringify(value.policies[0]) !== JSON.stringify(EPIC_ACQUISITION_POLICY)) {
    throw new TypeError("Clinical provider directory policy must exactly match the owned Epic policy.");
  }
  const directory = parsePublicClinicalProviderDirectory(value);
  return { ...directory, entries: directory.entries.map(entry => {
    if (entry.policyId !== EPIC_ACQUISITION_POLICY_ID) {
      throw new TypeError("Clinical provider directory entry references an unknown policy.");
    }
    return { ...entry, requestedBaseScopes: EPIC_BETA_REQUESTED_BASE_SCOPES, resourceTypes: EPIC_BETA_RESOURCE_TYPES };
  }) };
}
