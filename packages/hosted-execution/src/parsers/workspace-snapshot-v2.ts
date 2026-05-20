import {
  HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
  HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  type HostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2ArchiveMetadata,
  type HostedWorkspaceSnapshotV2Compression,
  type HostedWorkspaceSnapshotV2EncryptionMetadata,
  type HostedWorkspaceSnapshotV2Ref,
} from "../workspace-snapshot-v2.ts";
import {
  requireNumber,
  requireObject,
  requireString,
} from "./assertions.ts";

const HOSTED_WORKSPACE_SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const HOSTED_WORKSPACE_SNAPSHOT_OBJECT_KEY_PATTERN =
  /^users\/[a-z0-9][a-z0-9_-]{3,63}\/workspace-snapshots\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.snapshot\.enc$/u;

export function parseHostedWorkspaceSnapshotV2Ref(
  value: unknown,
  label = "Hosted workspace snapshot v2 ref",
): HostedWorkspaceSnapshotV2Ref {
  const record = requireObject(value, label);
  const schema = requireString(record.schema, `${label}.schema`);
  if (schema !== HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA) {
    throw new TypeError(`${label}.schema must be ${HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA}.`);
  }

  const userId = requireString(record.userId, `${label}.userId`);
  const upload = requireString(record.upload, `${label}.upload`);
  if (upload !== HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND) {
    throw new TypeError(`${label}.upload must be ${HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND}.`);
  }
  const snapshotId = requireHostedWorkspaceSnapshotId(record.snapshotId, `${label}.snapshotId`);
  const objectKey = requireHostedWorkspaceSnapshotObjectKey(
    record.objectKey,
    snapshotId,
    `${label}.objectKey`,
  );
  const createdAt = requireCanonicalIsoTimestampString(record.createdAt, `${label}.createdAt`);
  const archive = parseHostedWorkspaceSnapshotV2Archive(
    record.archive,
    `${label}.archive`,
  );
  const encryption = parseHostedWorkspaceSnapshotV2Encryption(
    record.encryption,
    `${label}.encryption`,
  );

  requireMatchingString(encryption.aad.userId, userId, `${label}.encryption.aad.userId`);
  requireMatchingString(encryption.aad.objectKey, objectKey, `${label}.encryption.aad.objectKey`);
  requireMatchingString(encryption.aad.snapshotId, snapshotId, `${label}.encryption.aad.snapshotId`);

  return {
    archive,
    createdAt,
    encryption,
    objectKey,
    schema,
    snapshotId,
    upload,
    userId,
  };
}

function parseHostedWorkspaceSnapshotV2Archive(
  value: unknown,
  label: string,
): HostedWorkspaceSnapshotV2ArchiveMetadata {
  const record = requireObject(value, label);
  const format = requireString(record.format, `${label}.format`);
  if (format !== "tar") {
    throw new TypeError(`${label}.format must be tar.`);
  }

  return {
    compression: parseHostedWorkspaceSnapshotV2Compression(
      record.compression,
      `${label}.compression`,
    ),
    encryptedByteSize: requirePositiveSafeInteger(
      record.encryptedByteSize,
      `${label}.encryptedByteSize`,
    ),
    encryptedObjectSha256: requireSha256HexString(
      record.encryptedObjectSha256,
      `${label}.encryptedObjectSha256`,
    ),
    fileCount: requireNonNegativeSafeInteger(record.fileCount, `${label}.fileCount`),
    format,
    plaintextArchiveSha256: requireSha256HexString(
      record.plaintextArchiveSha256,
      `${label}.plaintextArchiveSha256`,
    ),
    totalPlainBytes: requireNonNegativeSafeInteger(record.totalPlainBytes, `${label}.totalPlainBytes`),
  };
}

function parseHostedWorkspaceSnapshotV2Compression(
  value: unknown,
  label: string,
): HostedWorkspaceSnapshotV2Compression {
  const compression = requireString(value, label);
  if (compression !== HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION) {
    throw new TypeError(`${label} must be ${HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION}.`);
  }
  return compression;
}

function parseHostedWorkspaceSnapshotV2Encryption(
  value: unknown,
  label: string,
): HostedWorkspaceSnapshotV2EncryptionMetadata {
  const record = requireObject(value, label);
  const scheme = requireString(record.scheme, `${label}.scheme`);
  if (scheme !== HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME) {
    throw new TypeError(`${label}.scheme must be ${HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME}.`);
  }

  return {
    aad: parseHostedWorkspaceSnapshotV2Aad(record.aad, `${label}.aad`),
    ivBase64: requireHostedWorkspaceSnapshotIv(record.ivBase64, `${label}.ivBase64`),
    rootKeyId: requireString(record.rootKeyId, `${label}.rootKeyId`),
    scheme,
    wrappedDataKey: requireString(record.wrappedDataKey, `${label}.wrappedDataKey`),
  };
}

function parseHostedWorkspaceSnapshotV2Aad(
  value: unknown,
  label: string,
): HostedWorkspaceSnapshotV2Aad {
  const record = requireObject(value, label);
  const purpose = requireString(record.purpose, `${label}.purpose`);
  const schema = requireString(record.schema, `${label}.schema`);

  if (purpose !== HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE) {
    throw new TypeError(`${label}.purpose must be ${HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE}.`);
  }
  if (schema !== HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA) {
    throw new TypeError(`${label}.schema must be ${HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA}.`);
  }

  return {
    objectKey: requireString(record.objectKey, `${label}.objectKey`),
    purpose,
    schema,
    snapshotId: requireHostedWorkspaceSnapshotId(record.snapshotId, `${label}.snapshotId`),
    userId: requireString(record.userId, `${label}.userId`),
  };
}

function requireHostedWorkspaceSnapshotId(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (!HOSTED_WORKSPACE_SNAPSHOT_ID_PATTERN.test(text)) {
    throw new TypeError(`${label} must be a valid hosted workspace snapshot id.`);
  }
  return text;
}

function requireHostedWorkspaceSnapshotObjectKey(
  value: unknown,
  snapshotId: string,
  label: string,
): string {
  const text = requireString(value, label);
  const match = HOSTED_WORKSPACE_SNAPSHOT_OBJECT_KEY_PATTERN.exec(text);
  if (!match) {
    throw new TypeError(`${label} must be a user-scoped hosted workspace snapshot object key.`);
  }
  if (match[1] !== snapshotId) {
    throw new TypeError(`${label} must contain the hosted workspace snapshot id.`);
  }
  return text;
}

function requireHostedWorkspaceSnapshotIv(value: unknown, label: string): string {
  const text = requireString(value, label);
  const bytes = decodeBase64Url(text);
  if (bytes.byteLength !== 12) {
    throw new TypeError(`${label} must decode to 12 bytes.`);
  }
  return text;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new TypeError("Hosted workspace snapshot base64url value is invalid.");
  }
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function requireCanonicalIsoTimestampString(value: unknown, label: string): string {
  const text = requireString(value, label);
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== text) {
    throw new TypeError(`${label} must be a valid ISO-8601 timestamp in canonical UTC form.`);
  }

  return text;
}

function requireNonNegativeSafeInteger(value: unknown, label: string): number {
  const parsed = requireNumber(value, label);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return parsed;
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  const parsed = requireNumber(value, label);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return parsed;
}

function requireSha256HexString(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(text)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 hex digest.`);
  }
  return text;
}

function requireMatchingString(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new TypeError(`${label} must match the top-level hosted workspace snapshot ref.`);
  }
}
