import type {
  CanonicalEntity,
  CanonicalEntityFamily,
  CanonicalEntityLink,
  CanonicalEntityLinkType,
  CanonicalRecordClass,
} from "./canonical-entities.ts";
import type { QueryRecordData } from "./vault-source.ts";

export const BROWSER_VAULT_SNAPSHOT_SCHEMA = "murph.browser-vault-snapshot.v1";

export interface BrowserVaultSnapshot {
  entities: CanonicalEntity[];
  generatedAt: string;
  metadata: QueryRecordData | null;
  schema: typeof BROWSER_VAULT_SNAPSHOT_SCHEMA;
  sourceVersion: string;
}

export function createBrowserVaultSnapshot(input: {
  entities: readonly CanonicalEntity[];
  generatedAt?: string;
  metadata?: QueryRecordData | null;
  sourceVersion: string;
}): BrowserVaultSnapshot {
  return {
    entities: input.entities.map(cloneCanonicalEntity),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    metadata: cloneMetadata(input.metadata ?? null),
    schema: BROWSER_VAULT_SNAPSHOT_SCHEMA,
    sourceVersion: requireString(input.sourceVersion, "Browser vault snapshot sourceVersion"),
  };
}

export function parseBrowserVaultSnapshot(
  value: unknown,
  label = "Browser vault snapshot",
): BrowserVaultSnapshot {
  const record = requireRecord(value, label);
  const schema = requireString(record.schema, `${label}.schema`);

  if (schema !== BROWSER_VAULT_SNAPSHOT_SCHEMA) {
    throw new TypeError(`${label}.schema must be ${BROWSER_VAULT_SNAPSHOT_SCHEMA}.`);
  }

  return {
    entities: requireArray(record.entities, `${label}.entities`).map((entry, index) =>
      parseCanonicalEntity(entry, `${label}.entities[${index}]`)
    ),
    generatedAt: requireString(record.generatedAt, `${label}.generatedAt`),
    metadata: parseMetadata(record.metadata, `${label}.metadata`),
    schema: BROWSER_VAULT_SNAPSHOT_SCHEMA,
    sourceVersion: requireString(record.sourceVersion, `${label}.sourceVersion`),
  };
}

function cloneCanonicalEntity(entity: CanonicalEntity): CanonicalEntity {
  return {
    ...entity,
    attributes: cloneMetadata(entity.attributes) ?? {},
    body: entity.body ?? null,
    date: entity.date ?? null,
    experimentSlug: entity.experimentSlug ?? null,
    frontmatter: cloneMetadata(entity.frontmatter),
    links: entity.links.map((link) => ({ ...link })),
    lookupIds: entity.lookupIds.slice(),
    occurredAt: entity.occurredAt ?? null,
    relatedIds: entity.relatedIds.slice(),
    status: entity.status ?? null,
    stream: entity.stream ?? null,
    tags: entity.tags.slice(),
    title: entity.title ?? null,
  };
}

function parseCanonicalEntity(value: unknown, label: string): CanonicalEntity {
  const record = requireRecord(value, label);

  return {
    entityId: requireString(record.entityId, `${label}.entityId`),
    primaryLookupId: requireString(record.primaryLookupId, `${label}.primaryLookupId`),
    lookupIds: requireStringArray(record.lookupIds, `${label}.lookupIds`),
    family: requireString(record.family, `${label}.family`) as CanonicalEntityFamily,
    recordClass: requireString(record.recordClass, `${label}.recordClass`) as CanonicalRecordClass,
    kind: requireString(record.kind, `${label}.kind`),
    status: readNullableString(record.status, `${label}.status`),
    occurredAt: readNullableString(record.occurredAt, `${label}.occurredAt`),
    date: readNullableString(record.date, `${label}.date`),
    path: requireString(record.path, `${label}.path`),
    title: readNullableString(record.title, `${label}.title`),
    body: readNullableString(record.body, `${label}.body`),
    attributes: parseMetadata(record.attributes, `${label}.attributes`) ?? {},
    frontmatter: parseMetadata(record.frontmatter, `${label}.frontmatter`),
    links: requireArray(record.links, `${label}.links`).map((entry, index) =>
      parseCanonicalEntityLink(entry, `${label}.links[${index}]`)
    ),
    relatedIds: requireStringArray(record.relatedIds, `${label}.relatedIds`),
    stream: readNullableString(record.stream, `${label}.stream`),
    experimentSlug: readNullableString(record.experimentSlug, `${label}.experimentSlug`),
    tags: requireStringArray(record.tags, `${label}.tags`),
  };
}

function parseCanonicalEntityLink(value: unknown, label: string): CanonicalEntityLink {
  const record = requireRecord(value, label);

  return {
    targetId: requireString(record.targetId, `${label}.targetId`),
    type: requireString(record.type, `${label}.type`) as CanonicalEntityLinkType,
  };
}

function parseMetadata(value: unknown, label: string): QueryRecordData | null {
  if (value === null || value === undefined) {
    return null;
  }

  return cloneMetadata(requireRecord(value, label));
}

function cloneMetadata(value: QueryRecordData | null): QueryRecordData | null {
  if (value === null) {
    return null;
  }

  return JSON.parse(JSON.stringify(value)) as QueryRecordData;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireString(value, label);
}

function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry, index) =>
    requireString(entry, `${label}[${index}]`)
  );
}
