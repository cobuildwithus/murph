import "server-only";
import type { LocationCell } from "./directory-geography";

import { createHash } from "node:crypto";
import { getPrisma } from "../prisma";
import { epicPortalAccessRank } from "./epic-import-config";
import { oracleSearchEnabled } from "./oracle-integration";
import { countedSourceFilter } from "./source-state";
import directoryArtifact from "./provider-directory.v2.json";
import {
  normalizeClinicalProviderDirectoryEntryId,
  parseClinicalProviderDirectory,
  searchClinicalProviderDirectorySnapshot,
  type ClinicalProviderDirectory,
  type ClinicalProviderDirectoryEntry,
  type ClinicalProviderSourceSystem,
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

export async function searchClinicalProviderDirectory(input: {
  city?: string | null;
  includeDistance?: boolean;
  near?: LocationCell;
  query?: string | null;
  state?: string | null;
}, memberId?: string, readerSources: readonly ClinicalProviderSourceSystem[] = ["epic-fhir"]) {
  const directory = readClinicalProviderDirectory();
  const sourceSystems = readerSources.filter((source) => source !== "cerner-fhir" || oracleSearchEnabled());
  // Loaded on the first search, so routes that only resolve an entry never parse the ZIP table.
  const { postalCentroid } = await import("./postal-centroids");
  const result = searchClinicalProviderDirectorySnapshot(directory, {
    ...input, postalCentroid, grouped: memberId !== undefined, accessRank: epicPortalAccessRank, sourceSystems,
  });
  if (memberId === undefined || !result.providers.length) return result;
  const hashes = result.providers.map(provider => {
    const entry = resolveClinicalProviderDirectoryEntry(provider.id)!;
    return createHash("sha256").update(entry.fhirBaseUrl).digest("hex");
  });
  const connections = await getPrisma().clinicalRecordConnection.findMany({
    where: { ...countedSourceFilter(memberId), fhirBaseHash: { in: hashes } },
    select: { fhirBaseHash: true, displayName: true },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 100,
  });
  result.providers.forEach((provider, index) => {
    const match = connections.find(connection => connection.fhirBaseHash === hashes[index]);
    if (match) provider.possiblyIncludedThrough = match.displayName;
  });
  return result;
}
