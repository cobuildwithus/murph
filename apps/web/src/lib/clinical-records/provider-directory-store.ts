import "server-only";

import directoryArtifact from "./provider-directory.v1.json";
import {
  normalizeClinicalProviderDirectoryEntryId,
  parseClinicalProviderDirectory,
  searchClinicalProviderDirectorySnapshot,
  type ClinicalProviderDirectory,
  type ClinicalProviderDirectoryEntry,
  type ClinicalProviderSearchResult,
} from "./provider-directory";

let clinicalProviderDirectory: ClinicalProviderDirectory | null = null;

export function readClinicalProviderDirectory(): ClinicalProviderDirectory {
  clinicalProviderDirectory ??= parseClinicalProviderDirectory(directoryArtifact);
  return clinicalProviderDirectory;
}

export function resolveClinicalProviderDirectoryEntry(
  entryId: string,
): ClinicalProviderDirectoryEntry | null {
  const normalizedId = normalizeClinicalProviderDirectoryEntryId(entryId);
  if (!normalizedId) return null;
  return readClinicalProviderDirectory().entries.find((entry) => entry.id === normalizedId) ?? null;
}

export function searchClinicalProviderDirectory(input: {
  city?: string | null;
  query?: string | null;
  state?: string | null;
}): {
  directoryVersion: string;
  providers: ClinicalProviderSearchResult[];
} {
  return searchClinicalProviderDirectorySnapshot(readClinicalProviderDirectory(), input);
}
