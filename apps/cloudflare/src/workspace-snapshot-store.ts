import {
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE,
  type HostedWorkspaceSnapshotV2Aad,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

export const HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE = "application/octet-stream";
export const HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA =
  "murph.hosted-workspace-snapshot-upload.v1";

export interface WorkspaceSnapshotR2ObjectLike {
  arrayBuffer?(): Promise<ArrayBuffer>;
  body?: ReadableStream<Uint8Array>;
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
  schema: typeof HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA;
  snapshotId: string;
  userId: string;
  workspaceVersion: string;
}

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

  return {
    attemptId: requireString(record.attemptId, `${label}.attemptId`),
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
    schema,
    snapshotId: requireString(record.snapshotId, `${label}.snapshotId`),
    userId: requireString(record.userId, `${label}.userId`),
    workspaceVersion: requireString(record.workspaceVersion, `${label}.workspaceVersion`),
  };
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
