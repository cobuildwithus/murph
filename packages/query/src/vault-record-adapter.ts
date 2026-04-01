import path from "node:path";

import {
  linkTargetIds,
  normalizeUniqueStringArray,
  relatedToLinks,
  type CanonicalEntity,
  type CanonicalEntityLink,
  type CanonicalEntityFamily,
  type CanonicalRecordClass,
} from "./canonical-entities.ts";

// VaultRecord remains the public compatibility view for existing query callers.
// CanonicalEntity is the authoritative generic read-model shape.
export type VaultRecordType = CanonicalEntityFamily;
export type VaultRecordsByFamily = Partial<Record<VaultRecordType, VaultRecord[]>>;

export interface VaultRecord {
  displayId: string;
  primaryLookupId: string;
  lookupIds: string[];
  recordType: VaultRecordType;
  recordClass: CanonicalRecordClass;
  sourcePath: string;
  sourceFile: string;
  occurredAt: string | null;
  date: string | null;
  kind: string | null;
  status?: string | null;
  stream: string | null;
  experimentSlug: string | null;
  title: string | null;
  tags: string[];
  data: Record<string, unknown>;
  body: string | null;
  frontmatter: Record<string, unknown> | null;
  links: CanonicalEntityLink[];
  relatedIds?: string[];
}

export function relatedIdsToLinks(
  ...groups: readonly unknown[]
): CanonicalEntityLink[] {
  return relatedToLinks(groups.flatMap((group) => normalizeUniqueStringArray(group)));
}

export function vaultRecordToCanonicalEntity(
  record: VaultRecord,
): CanonicalEntity {
  return {
    entityId: record.displayId,
    primaryLookupId: record.primaryLookupId,
    lookupIds: [...record.lookupIds],
    family: record.recordType,
    recordClass: record.recordClass,
    kind: record.kind ?? "",
    status: record.status ?? null,
    occurredAt: record.occurredAt,
    date: record.date,
    path: record.sourcePath,
    title: record.title,
    body: record.body,
    attributes: record.data,
    frontmatter: record.frontmatter,
    links: record.links,
    relatedIds: record.relatedIds ?? [],
    stream: record.stream,
    experimentSlug: record.experimentSlug,
    tags: [...record.tags],
  };
}

export function canonicalEntityToVaultRecord(
  entity: CanonicalEntity,
  vaultRoot: string,
  sourceFileOverride?: string,
): VaultRecord {
  return {
    displayId: entity.entityId,
    primaryLookupId: entity.primaryLookupId,
    lookupIds: entity.lookupIds,
    recordType: entity.family,
    recordClass: entity.recordClass,
    sourcePath: entity.path,
    sourceFile: sourceFileOverride ?? path.join(vaultRoot, ...entity.path.split("/")),
    occurredAt: entity.occurredAt,
    date: entity.date,
    // Preserve legacy null semantics so older query helpers still trigger
    // record-type fallbacks after the canonical-entity ownership shift.
    kind: entity.kind || null,
    status: entity.status,
    stream: entity.stream,
    experimentSlug: entity.experimentSlug,
    title: entity.title,
    tags: entity.tags,
    data: entity.attributes,
    body: entity.body,
    frontmatter: entity.frontmatter,
    links: entity.links,
    relatedIds: entity.relatedIds,
  };
}

export function recordRelationTargetIds(
  record: Pick<VaultRecord, "links" | "relatedIds" | "lookupIds">,
): string[] {
  return record.links.length > 0
    ? linkTargetIds(record.links)
    : record.relatedIds && record.relatedIds.length > 0
      ? record.relatedIds
      : record.lookupIds;
}
