import "server-only";

import { createHash } from "node:crypto";
import { getPrisma } from "../prisma";
import { epicPortalAccessRank } from "./epic-import-config";
import { countedSourceFilter } from "./source-state";
import directoryArtifact from "@murphai/clinical-records/provider-directory.v2.json";
import {
  normalizeClinicalProviderDirectoryEntryId,
  parseClinicalProviderDirectory,
  searchClinicalProviderDirectorySnapshot,
  type ClinicalProviderDirectory,
  type ClinicalProviderDirectoryEntry,
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
  providerId?: string;
  city?: string | null;
  query?: string | null;
  state?: string | null;
}, memberId?: string) {
  const directory = readClinicalProviderDirectory();
  const selected = input.providerId ? resolveClinicalProviderDirectoryEntry(input.providerId) : null;
  if (input.providerId && !selected) return { directoryVersion: directory.version, providers: [] };
  const scope = selected ? { ...directory, entries: directory.entries.filter(entry => entry.fhirBaseUrl === selected.fhirBaseUrl) } : directory;
  const result = searchClinicalProviderDirectorySnapshot(scope, { ...input, query: selected?.brandName ?? input.query,
    grouped: memberId !== undefined, accessRank: epicPortalAccessRank });
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
