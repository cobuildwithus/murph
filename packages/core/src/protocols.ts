import { createHash } from "node:crypto";

import {
  CONTRACT_SCHEMA_VERSION,
  FRONTMATTER_DOC_TYPES,
  ID_PREFIXES,
  PROTOCOL_STATUSES,
  protocolFrontmatterSchema,
  type ProtocolFrontmatter as ContractProtocolFrontmatter,
  type ProtocolRef as ContractProtocolRef,
  VAULT_LAYOUT,
} from "@murphai/contracts";

import { VaultError } from "./errors.ts";
import { parseFrontmatterDocument } from "./frontmatter.ts";
import { generateRecordId } from "./ids.ts";
import { createMarkdownRegistryApi } from "./registry/api.ts";
import {
  buildMarkdownBody,
  normalizeId,
  normalizeSelectorSlug,
  normalizeUpsertSelectorSlug,
  optionalEnum,
  requireString,
  section,
  stripUndefined,
} from "./bank/shared.ts";

import type { FrontmatterObject } from "./types.ts";

export const PROTOCOL_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.protocolFrontmatter;
export const PROTOCOL_DOC_TYPE = FRONTMATTER_DOC_TYPES.protocol;
export const PROTOCOL_ID_PREFIX = ID_PREFIXES.protocol;
export const PROTOCOLS_DIRECTORY = VAULT_LAYOUT.protocolsDirectory;

const PROTOCOL_SYSTEM_FIELDS = new Set([
  "schemaVersion",
  "docType",
  "protocolId",
  "slug",
  "title",
]);

export type ProtocolRef = ContractProtocolRef;

export interface ProtocolEffectiveSpec {
  doseSignature: string;
  modality?: string;
  activitySessionEvidence?: ContractProtocolFrontmatter["effectiveSpec"]["activitySessionEvidence"];
  frequency?: {
    sessionsPerDay?: number;
    sessionsPerWeek?: number;
  };
  durationMinutes?: {
    min?: number;
    max?: number;
    target?: number;
  };
  temperatureC?: {
    min?: number;
    max?: number;
    target?: number;
  };
  targetSessions?: number;
  minimumUsefulSessions?: number;
  instructions?: string[];
  stopConditions?: string[];
  notes?: string[];
}

export interface ProtocolLineage {
  sourceKind: "health_commons_protocol" | "protocol";
  parentProtocolRef?: ProtocolRef;
  notes?: string[];
}

export interface ProtocolDiffEntry {
  path: string;
  op: "add" | "remove" | "replace";
  before?: unknown;
  after?: unknown;
  reason?: string;
}

export interface ProtocolPersonalization {
  target?: string;
  constraints?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  rationale?: string[];
  notes?: string[];
}

export type ProtocolFrontmatter = ContractProtocolFrontmatter;

export interface ProtocolDocument {
  attributes: ProtocolFrontmatter;
  body: string;
  markdown: string;
  relativePath: string;
}

export interface ProtocolRecord {
  entity: ProtocolFrontmatter;
  document: ProtocolDocument;
}

export interface UpsertProtocolInput {
  vaultRoot: string;
  protocolId?: string;
  slug?: string;
  allowSlugRename?: boolean;
  title?: string;
  frontmatter?: FrontmatterObject;
  body?: string;
}

export interface UpsertProtocolResult {
  created: boolean;
  auditPath: string;
  record: ProtocolRecord;
}

export interface ReadProtocolInput {
  vaultRoot: string;
  protocolId?: string;
  slug?: string;
}

function validateProtocolFrontmatter(
  value: unknown,
  relativePath: string,
): ProtocolFrontmatter {
  const parsed = protocolFrontmatterSchema.safeParse(value);

  if (!parsed.success) {
    throw new VaultError(
      "VAULT_INVALID_PROTOCOL",
      `Protocol frontmatter for "${relativePath}" has an unexpected shape.`,
      {
        relativePath,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    );
  }

  return parsed.data;
}

function frontmatterString(value: FrontmatterObject | undefined, fieldName: string): string | undefined {
  const candidate = value?.[fieldName];
  return typeof candidate === "string" ? candidate : undefined;
}

function assertOptionalLiteralField(
  frontmatter: FrontmatterObject | undefined,
  fieldName: "schemaVersion" | "docType",
  expected: string,
): void {
  const value = frontmatter?.[fieldName];

  if (value === undefined) {
    return;
  }

  if (value !== expected) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be ${expected}.`);
  }
}

function normalizeInputProtocolId(input: UpsertProtocolInput): string | undefined {
  const explicitId = normalizeId(input.protocolId, "protocolId", PROTOCOL_ID_PREFIX);
  const frontmatterId = normalizeId(
    frontmatterString(input.frontmatter, "protocolId"),
    "frontmatter.protocolId",
    PROTOCOL_ID_PREFIX,
  );

  if (explicitId && frontmatterId && explicitId !== frontmatterId) {
    throw new VaultError(
      "VAULT_PROTOCOL_CONFLICT",
      "protocolId and frontmatter.protocolId resolve to different records.",
    );
  }

  return explicitId ?? frontmatterId;
}

function normalizeInputSlug(input: UpsertProtocolInput): string | undefined {
  const explicitSlug = normalizeSelectorSlug(input.slug);
  const frontmatterSlug = normalizeSelectorSlug(frontmatterString(input.frontmatter, "slug"));

  if (explicitSlug && frontmatterSlug && explicitSlug !== frontmatterSlug) {
    throw new VaultError(
      "VAULT_PROTOCOL_CONFLICT",
      "slug and frontmatter.slug resolve to different records.",
    );
  }

  return explicitSlug ?? frontmatterSlug;
}

function protocolFrontmatterPatch(frontmatter: FrontmatterObject | undefined): FrontmatterObject {
  if (!frontmatter) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(frontmatter).filter(
      ([key, value]) => !PROTOCOL_SYSTEM_FIELDS.has(key) && value !== undefined,
    ),
  ) as FrontmatterObject;
}

function cloneFrontmatter(value: ProtocolFrontmatter): FrontmatterObject {
  return JSON.parse(JSON.stringify(value)) as FrontmatterObject;
}

function buildBody(title: string): string {
  return buildMarkdownBody(
    title,
    "Protocol-specific details are stored in frontmatter.",
    [
      section("Notes", "- none"),
    ],
  );
}

function sha256StableJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value), "utf8").digest("hex")}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableSortValue(value)) ?? "undefined";
}

function stableSortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSortValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableSortValue(entry)]),
    );
  }

  return value;
}

function omitProtocolDerivedHashes<
  T extends {
    effectiveSpecHash?: unknown;
    protocolRevisionId?: unknown;
  },
>(attributes: T): FrontmatterObject {
  const {
    effectiveSpecHash: _effectiveSpecHash,
    protocolRevisionId: _protocolRevisionId,
    ...attributesWithoutDerivedHashes
  } = attributes;

  return stripUndefined(attributesWithoutDerivedHashes as FrontmatterObject);
}

function deriveProtocolHashes(
  attributesWithoutDerivedHashes: FrontmatterObject,
  body: string,
): Pick<ProtocolFrontmatter, "effectiveSpecHash" | "protocolRevisionId"> {
  const effectiveSpecHash = sha256StableJson(attributesWithoutDerivedHashes.effectiveSpec);
  const protocolRevisionId = sha256StableJson({
    body,
    frontmatter: {
      ...attributesWithoutDerivedHashes,
      effectiveSpecHash,
    },
  });

  return {
    effectiveSpecHash,
    protocolRevisionId,
  };
}

function assertProtocolDerivedHashes(
  entity: ProtocolFrontmatter,
  body: string,
  relativePath: string,
): void {
  const expectedHashes = deriveProtocolHashes(
    omitProtocolDerivedHashes(entity),
    body,
  );

  if (entity.effectiveSpecHash !== expectedHashes.effectiveSpecHash) {
    throw new VaultError(
      "VAULT_INVALID_PROTOCOL",
      `Protocol frontmatter for "${relativePath}" has a stale effectiveSpecHash.`,
      {
        relativePath,
        field: "effectiveSpecHash",
      },
    );
  }

  if (entity.protocolRevisionId !== expectedHashes.protocolRevisionId) {
    throw new VaultError(
      "VAULT_INVALID_PROTOCOL",
      `Protocol frontmatter for "${relativePath}" has a stale protocolRevisionId.`,
      {
        relativePath,
        field: "protocolRevisionId",
      },
    );
  }
}

function parseProtocolRecord(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): ProtocolRecord {
  const parsed = parseFrontmatterDocument(markdown);
  const entity = validateProtocolFrontmatter(attributes, relativePath);
  assertProtocolDerivedHashes(entity, parsed.body, relativePath);

  return {
    entity,
    document: {
      attributes: entity,
      body: parsed.body,
      markdown,
      relativePath,
    },
  };
}

const protocolRegistryApi = createMarkdownRegistryApi<ProtocolRecord>({
  directory: PROTOCOLS_DIRECTORY,
  recordFromParts: parseProtocolRecord,
  isExpectedRecord: (record) =>
    record.entity.docType === PROTOCOL_DOC_TYPE &&
    record.entity.schemaVersion === PROTOCOL_SCHEMA_VERSION,
  invalidCode: "VAULT_INVALID_PROTOCOL",
  invalidMessage: "Protocol registry document has an unexpected shape.",
  sortRecords: (records) =>
    records.sort(
      (left, right) =>
        left.entity.title.localeCompare(right.entity.title) ||
        left.entity.slug.localeCompare(right.entity.slug) ||
        left.entity.protocolId.localeCompare(right.entity.protocolId),
    ),
  getRecordId: (record) => record.entity.protocolId,
  getRecordSlug: (record) => record.entity.slug,
  getRecordRelativePath: (record) => record.document.relativePath,
  conflictCode: "VAULT_PROTOCOL_CONFLICT",
  conflictMessage: "Protocol id and slug resolve to different records.",
  readMissingCode: "VAULT_PROTOCOL_MISSING",
  readMissingMessage: "Protocol was not found.",
  createRecordId: () => generateRecordId(PROTOCOL_ID_PREFIX),
  operationType: "protocol_upsert",
  summary: (recordId) => `Upsert protocol ${recordId}`,
  audit: {
    action: "protocol_upsert",
    commandName: "core.upsertProtocol",
    summary: (_created, recordId) => `Upserted protocol ${recordId}.`,
  },
});

export async function upsertProtocol(
  input: UpsertProtocolInput,
): Promise<UpsertProtocolResult> {
  assertOptionalLiteralField(input.frontmatter, "schemaVersion", PROTOCOL_SCHEMA_VERSION);
  assertOptionalLiteralField(input.frontmatter, "docType", PROTOCOL_DOC_TYPE);

  const normalizedProtocolId = normalizeInputProtocolId(input);
  const requestedSlug = normalizeInputSlug(input);
  const existingRecord = await protocolRegistryApi.resolveExistingRecord({
    vaultRoot: input.vaultRoot,
    recordId: normalizedProtocolId,
    slug: requestedSlug,
  });
  const title = requireString(
    input.title ?? frontmatterString(input.frontmatter, "title") ?? existingRecord?.entity.title,
    "title",
    160,
  );
  const frontmatterPatch = protocolFrontmatterPatch(input.frontmatter);
  const status =
    optionalEnum(input.frontmatter?.status, PROTOCOL_STATUSES, "status") ??
    existingRecord?.entity.status ??
    "available";

  return protocolRegistryApi.upsertRecord({
    vaultRoot: input.vaultRoot,
    existingRecord,
    recordId: normalizedProtocolId,
    requestedSlug,
    defaultSlug: normalizeUpsertSelectorSlug(undefined, title) ?? "",
    allowSlugUpdate: input.allowSlugRename === true,
    buildDocument: (target) => {
      const body = input.body ?? existingRecord?.document.body ?? buildBody(title);
      const attributesWithoutDerivedHashes = omitProtocolDerivedHashes(
        stripUndefined({
          ...existingRecord?.entity,
          ...frontmatterPatch,
          schemaVersion: PROTOCOL_SCHEMA_VERSION,
          docType: PROTOCOL_DOC_TYPE,
          protocolId: target.recordId,
          slug: target.slug,
          title,
          status,
        }),
      );
      const derivedHashes = deriveProtocolHashes(attributesWithoutDerivedHashes, body);
      const attributes = validateProtocolFrontmatter(
        stripUndefined({
          ...attributesWithoutDerivedHashes,
          ...derivedHashes,
        }),
        target.relativePath,
      );

      return {
        attributes: cloneFrontmatter(attributes),
        body,
      };
    },
  });
}

export async function listProtocols(vaultRoot: string): Promise<ProtocolRecord[]> {
  return protocolRegistryApi.listRecords(vaultRoot);
}

export async function readProtocol({
  vaultRoot,
  protocolId,
  slug,
}: ReadProtocolInput): Promise<ProtocolRecord> {
  return protocolRegistryApi.readRecord({
    vaultRoot,
    recordId: normalizeId(protocolId, "protocolId", PROTOCOL_ID_PREFIX),
    slug: normalizeSelectorSlug(slug),
  });
}
