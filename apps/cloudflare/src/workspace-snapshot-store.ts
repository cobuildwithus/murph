import {
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE,
  type HostedWorkspaceSnapshotV2Aad,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import type {
  HostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/bundles";
import {
  isHostedWorkspaceSnapshotV2Ref,
  parseHostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/parsers";

export const HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE = "application/octet-stream";
export const HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA =
  "murph.hosted-workspace-snapshot-upload.v1";
export const HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA =
  "murph.hosted-workspace-snapshot-orphan.v1";
export const HOSTED_WORKSPACE_SNAPSHOT_HANDOFF_HEARTBEAT_STALE_MS = 10_000;

export interface WorkspaceSnapshotR2ObjectLike {
  arrayBuffer?(): Promise<ArrayBuffer>;
  body?: ReadableStream<Uint8Array>;
  checksums?: {
    sha256?: ArrayBuffer | string | Uint8Array;
  };
  customMetadata?: Record<string, string>;
  key?: string;
  size?: number;
}

export interface WorkspaceSnapshotR2BucketLike {
  delete?(key: string): Promise<void>;
  get?(key: string): Promise<WorkspaceSnapshotR2ObjectLike | null>;
  head?(key: string): Promise<WorkspaceSnapshotR2ObjectLike | null>;
}

export interface HostedWorkspaceSnapshotUploadSession {
  attemptId: string;
  checkpointHandoffCompletedAt?: string;
  checkpointHandoffHeartbeatAt?: string;
  createdAt: string;
  encryption: {
    aad: HostedWorkspaceSnapshotV2Aad;
    ivBase64: string;
    rootKeyId: string;
    scheme: typeof HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME;
    wrappedDataKey: string;
  };
  expectedWorkspaceVersion: string;
  expiresAt: string;
  leaseGeneration: string;
  objectKey: string;
  r2PutDrainUntil?: string;
  r2PutExpiresAt?: string;
  replacedSnapshotRef?: NonNullable<HostedExecutionSnapshotRef>;
  schema: typeof HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA;
  snapshotId: string;
  userId: string;
  workspaceVersion: string;
}

export interface HostedWorkspaceSnapshotV2OrphanCandidate {
  createdAt: string;
  kind?: "workspace_snapshot_v2";
  objectKey: string;
  schema: typeof HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA;
  snapshotId: string;
  userId: string;
}

export interface HostedWorkspaceSnapshotLegacyOrphanCandidate {
  createdAt: string;
  kind: "legacy_workspace_snapshot";
  schema: typeof HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA;
  snapshotId: string;
  snapshotRef: HostedExecutionSnapshotRef;
  userId: string;
}

export type HostedWorkspaceSnapshotOrphanCandidate =
  | HostedWorkspaceSnapshotLegacyOrphanCandidate
  | HostedWorkspaceSnapshotV2OrphanCandidate;

export function parseHostedWorkspaceSnapshotUploadSession(
  value: unknown,
  label = "Hosted workspace snapshot upload session",
): HostedWorkspaceSnapshotUploadSession {
  const record = requireObject(value, label);
  const schema = requireString(record.schema, `${label}.schema`);
  if (schema !== HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA) {
    throw new TypeError(`${label}.schema must be ${HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA}.`);
  }
  const encryption = requireObject(record.encryption, `${label}.encryption`);
  const scheme = requireString(encryption.scheme, `${label}.encryption.scheme`);
  if (scheme !== HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME) {
    throw new TypeError(`${label}.encryption.scheme must be ${HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME}.`);
  }

  let replacedSnapshotRef: NonNullable<HostedExecutionSnapshotRef> | null = null;
  if (record.replacedSnapshotRef !== undefined && record.replacedSnapshotRef !== null) {
    const parsedReplacedSnapshotRef = parseHostedExecutionSnapshotRef(
      record.replacedSnapshotRef,
      `${label}.replacedSnapshotRef`,
    );
    if (parsedReplacedSnapshotRef === null) {
      throw new TypeError(`${label}.replacedSnapshotRef must be a hosted execution snapshot ref.`);
    }
    replacedSnapshotRef = parsedReplacedSnapshotRef;
  }
  const r2PutExpiresAt = record.r2PutExpiresAt === undefined
    ? null
    : requireIsoString(record.r2PutExpiresAt, `${label}.r2PutExpiresAt`);
  const r2PutDrainUntil = record.r2PutDrainUntil === undefined
    ? null
    : requireIsoString(record.r2PutDrainUntil, `${label}.r2PutDrainUntil`);
  const checkpointHandoffCompletedAt = record.checkpointHandoffCompletedAt === undefined
    ? null
    : requireIsoString(
        record.checkpointHandoffCompletedAt,
        `${label}.checkpointHandoffCompletedAt`,
      );
  const checkpointHandoffHeartbeatAt = record.checkpointHandoffHeartbeatAt === undefined
    ? null
    : requireIsoString(
        record.checkpointHandoffHeartbeatAt,
        `${label}.checkpointHandoffHeartbeatAt`,
      );
  if ((r2PutExpiresAt === null) !== (r2PutDrainUntil === null)) {
    throw new TypeError(
      `${label}.r2PutExpiresAt and ${label}.r2PutDrainUntil must be recorded together.`,
    );
  }
  if (
    r2PutExpiresAt !== null
    && r2PutDrainUntil !== null
    && Date.parse(r2PutDrainUntil) < Date.parse(r2PutExpiresAt)
  ) {
    throw new TypeError(`${label}.r2PutDrainUntil must not precede the PUT expiry.`);
  }

  return {
    attemptId: requireString(record.attemptId, `${label}.attemptId`),
    ...(checkpointHandoffCompletedAt === null
      ? {}
      : { checkpointHandoffCompletedAt }),
    ...(checkpointHandoffHeartbeatAt === null
      ? {}
      : { checkpointHandoffHeartbeatAt }),
    createdAt: requireIsoString(record.createdAt, `${label}.createdAt`),
    encryption: {
      aad: parseHostedWorkspaceSnapshotAad(encryption.aad, `${label}.encryption.aad`),
      ivBase64: requireString(encryption.ivBase64, `${label}.encryption.ivBase64`),
      rootKeyId: requireString(encryption.rootKeyId, `${label}.encryption.rootKeyId`),
      scheme,
      wrappedDataKey: requireString(encryption.wrappedDataKey, `${label}.encryption.wrappedDataKey`),
    },
    expectedWorkspaceVersion: requireString(record.expectedWorkspaceVersion, `${label}.expectedWorkspaceVersion`),
    expiresAt: requireIsoString(record.expiresAt, `${label}.expiresAt`),
    leaseGeneration: requireString(record.leaseGeneration, `${label}.leaseGeneration`),
    objectKey: requireString(record.objectKey, `${label}.objectKey`),
    ...(r2PutExpiresAt === null ? {} : { r2PutExpiresAt }),
    ...(r2PutDrainUntil === null ? {} : { r2PutDrainUntil }),
    ...(replacedSnapshotRef ? { replacedSnapshotRef } : {}),
    schema,
    snapshotId: requireString(record.snapshotId, `${label}.snapshotId`),
    userId: requireString(record.userId, `${label}.userId`),
    workspaceVersion: requireString(record.workspaceVersion, `${label}.workspaceVersion`),
  };
}

export function parseHostedWorkspaceSnapshotOrphanCandidate(
  value: unknown,
  label = "Hosted workspace snapshot orphan candidate",
): HostedWorkspaceSnapshotOrphanCandidate {
  const record = requireObject(value, label);
  const schema = requireString(record.schema, `${label}.schema`);
  if (schema !== HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA) {
    throw new TypeError(`${label}.schema must be ${HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA}.`);
  }

  const kind = record.kind === undefined
    ? "workspace_snapshot_v2"
    : requireString(record.kind, `${label}.kind`);
  if (kind === "workspace_snapshot_v2") {
    return {
      createdAt: requireIsoString(record.createdAt, `${label}.createdAt`),
      ...(record.kind === undefined ? {} : { kind }),
      objectKey: requireString(record.objectKey, `${label}.objectKey`),
      schema,
      snapshotId: requireString(record.snapshotId, `${label}.snapshotId`),
      userId: requireString(record.userId, `${label}.userId`),
    };
  }
  if (kind === "legacy_workspace_snapshot") {
    const snapshotRef = parseHostedExecutionSnapshotRef(
      record.snapshotRef,
      `${label}.snapshotRef`,
    );
    if (!snapshotRef || isHostedWorkspaceSnapshotV2Ref(snapshotRef)) {
      throw new TypeError(`${label}.snapshotRef must be a legacy hosted execution snapshot ref.`);
    }
    return {
      createdAt: requireIsoString(record.createdAt, `${label}.createdAt`),
      kind,
      schema,
      snapshotId: requireString(record.snapshotId, `${label}.snapshotId`),
      snapshotRef,
      userId: requireString(record.userId, `${label}.userId`),
    };
  }
  throw new TypeError(`${label}.kind must be workspace_snapshot_v2 or legacy_workspace_snapshot.`);
}

export function buildHostedWorkspaceSnapshotRefFromUploadSession(input: {
  archive: unknown;
  createdAt: string;
  session: HostedWorkspaceSnapshotUploadSession;
}): Record<string, unknown> {
  return {
    archive: input.archive,
    createdAt: input.createdAt,
    encryption: input.session.encryption,
    objectKey: input.session.objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
    snapshotId: input.session.snapshotId,
    upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
    userId: input.session.userId,
  };
}

export function encodeHostedWorkspaceSnapshotSha256Base64(sha256Hex: string): string {
  if (!/^[a-f0-9]{64}$/u.test(sha256Hex)) {
    throw new TypeError("Hosted workspace snapshot SHA-256 digest must be lowercase hex.");
  }
  return btoa(String.fromCharCode(...hexToBytes(sha256Hex)));
}

export function readHostedWorkspaceSnapshotSha256ChecksumHex(
  value: ArrayBuffer | string | Uint8Array | undefined,
): string | null {
  try {
    if (value === undefined) {
      return null;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^[a-f0-9]{64}$/u.test(trimmed)) {
        return trimmed;
      }
      return bytesToHex(decodeBase64(trimmed));
    }
    return bytesToHex(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
  } catch {
    return null;
  }
}

function parseHostedWorkspaceSnapshotAad(
  value: unknown,
  label: string,
): HostedWorkspaceSnapshotV2Aad {
  const record = requireObject(value, label);
  const purpose = requireString(record.purpose, `${label}.purpose`);
  const schema = requireString(record.schema, `${label}.schema`);
  if (purpose !== HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE) {
    throw new TypeError(`${label}.purpose must be ${HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE}.`);
  }
  if (schema !== HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA) {
    throw new TypeError(`${label}.schema must be ${HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA}.`);
  }

  return {
    objectKey: requireString(record.objectKey, `${label}.objectKey`),
    purpose,
    schema,
    snapshotId: requireString(record.snapshotId, `${label}.snapshotId`),
    userId: requireString(record.userId, `${label}.userId`),
  };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function requireIsoString(value: unknown, label: string): string {
  const text = requireString(value, label);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== text) {
    throw new TypeError(`${label} must be a canonical ISO timestamp.`);
  }
  return text;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytes.byteLength !== 32) {
    throw new TypeError("Hosted workspace snapshot SHA-256 checksum must decode to 32 bytes.");
  }
  return bytes;
}
