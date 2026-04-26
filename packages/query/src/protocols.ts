import {
  type EffectiveProtocolSnapshot,
  type CommonsProtocolRef,
  VAULT_LAYOUT,
} from "@murphai/contracts";

import type { CanonicalEntity } from "./canonical-entities.ts";
import {
  getProtocol,
  listProtocols,
  type ProtocolFilter,
  type VaultReadModel,
} from "./read-model.ts";

export const PROTOCOL_DOC_TYPE = "protocol";
export const PROTOCOL_FAMILY = "protocol";
export const PROTOCOL_DIRECTORY = VAULT_LAYOUT.protocolsDirectory;

type Sha256Digest = `sha256:${string}`;

export interface ProtocolRef {
  protocolId: string;
  protocolRevisionId: Sha256Digest;
  effectiveSpecHash: Sha256Digest;
}

export interface ProtocolEffectiveSpec {
  doseSignature: string;
  modality?: string;
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

export interface ProtocolFrontmatter {
  schemaVersion: string;
  docType: typeof PROTOCOL_DOC_TYPE;
  protocolId: string;
  slug: string;
  title: string;
  status: string;
  commonsProtocolRef: CommonsProtocolRef;
  effectiveSpec: ProtocolEffectiveSpec;
  effectiveSpecHash: Sha256Digest;
  protocolRevisionId: Sha256Digest;
}

export interface ProtocolSummary {
  id: string;
  slug: string | null;
  title: string;
  status: string | null;
  commonsProtocolRef: CommonsProtocolRef | null;
  effectiveSpec: ProtocolEffectiveSpec | null;
  effectiveSpecHash: string | null;
  protocolRevisionId: string | null;
  updatedAt: string | null;
  path: string;
  tags: string[];
  summary: string | null;
}

export interface ExperimentProtocolProjectionFields {
  commonsProtocolRef: CommonsProtocolRef | null;
  protocolRef: ProtocolRef | null;
  effectiveProtocolSnapshot: EffectiveProtocolSnapshot | null;
}

export function isProtocolEntity(entity: CanonicalEntity): boolean {
  return (
    entity.family === PROTOCOL_FAMILY ||
    entity.kind === PROTOCOL_DOC_TYPE ||
    entity.attributes.docType === PROTOCOL_DOC_TYPE
  );
}

export function summarizeProtocol(entity: CanonicalEntity): ProtocolSummary {
  if (!isProtocolEntity(entity)) {
    throw new TypeError(`Expected protocol entity, received "${entity.family}".`);
  }
  const frontmatter = readProtocolFrontmatter(entity.attributes);

  return {
    id: entity.entityId,
    slug: frontmatter.slug,
    title: frontmatter.title,
    status: frontmatter.status,
    commonsProtocolRef: frontmatter.commonsProtocolRef,
    effectiveSpec: frontmatter.effectiveSpec,
    effectiveSpecHash: frontmatter.effectiveSpecHash,
    protocolRevisionId: frontmatter.protocolRevisionId,
    updatedAt: entity.occurredAt,
    path: entity.path,
    tags: entity.tags.slice(),
    summary: summarizeText(entity.body),
  };
}

export function listProtocolSummaries(
  vault: VaultReadModel,
  filters: ProtocolFilter = {},
): ProtocolSummary[] {
  return listProtocols(vault, filters).map(summarizeProtocol);
}

export function getProtocolSummary(
  vault: VaultReadModel,
  idOrSlug: string,
): ProtocolSummary | null {
  const entity = getProtocol(vault, idOrSlug);
  return entity ? summarizeProtocol(entity) : null;
}

export function readExperimentProtocolProjectionFields(
  attributes: Record<string, unknown>,
): ExperimentProtocolProjectionFields {
  return {
    commonsProtocolRef: readObjectOrNull<CommonsProtocolRef>(attributes.commonsProtocolRef),
    protocolRef: readObjectOrNull<ProtocolRef>(attributes.protocolRef),
    effectiveProtocolSnapshot: readObjectOrNull<EffectiveProtocolSnapshot>(attributes.effectiveProtocolSnapshot),
  };
}

function readObjectOrNull<TValue extends object>(value: unknown): TValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as TValue : null;
}

export function readProtocolFrontmatter(
  attributes: Record<string, unknown>,
): ProtocolFrontmatter {
  const commonsProtocolRef = readObjectOrNull<CommonsProtocolRef>(attributes.commonsProtocolRef);
  const effectiveSpec = readObjectOrNull<ProtocolEffectiveSpec>(attributes.effectiveSpec);
  if (
    attributes.docType !== PROTOCOL_DOC_TYPE ||
    typeof attributes.protocolId !== "string" ||
    typeof attributes.slug !== "string" ||
    typeof attributes.title !== "string" ||
    typeof attributes.status !== "string" ||
    !commonsProtocolRef ||
    !effectiveSpec ||
    typeof attributes.effectiveSpecHash !== "string" ||
    typeof attributes.protocolRevisionId !== "string"
  ) {
    throw new TypeError("Protocol frontmatter is invalid.");
  }

  return {
    schemaVersion: typeof attributes.schemaVersion === "string" ? attributes.schemaVersion : "",
    docType: PROTOCOL_DOC_TYPE,
    protocolId: attributes.protocolId,
    slug: attributes.slug,
    title: attributes.title,
    status: attributes.status,
    commonsProtocolRef,
    effectiveSpec,
    effectiveSpecHash: attributes.effectiveSpecHash as Sha256Digest,
    protocolRevisionId: attributes.protocolRevisionId as Sha256Digest,
  };
}

function summarizeText(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !/^#{1,6}\s+/u.test(line))
    .map((line) => line.replace(/^[-*+]\s+/u, "").trim())
    .filter((line) => line.length > 0)
    .join(" ");

  if (!normalized) {
    return null;
  }

  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}...`;
}
