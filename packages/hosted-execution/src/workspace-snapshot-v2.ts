export const HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA =
  "murph.hosted-workspace-snapshot.v2" as const;
export const HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA =
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA;
export const HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND =
  "direct-r2-presigned-put" as const;
export const HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME =
  "murph.hosted-workspace-snapshot-single-object.v1" as const;
export const HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME =
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME;
export const HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE = "workspace-snapshot" as const;
export const HOSTED_WORKSPACE_SNAPSHOT_V2_DATA_KEY_WRAP_SCHEMA =
  "murph.hosted-workspace-snapshot-data-key-wrap.v1" as const;
export const HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION = "zstd" as const;
export const HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES =
  128 * 1024 * 1024;
export const HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES =
  512 * 1024 * 1024;
export const HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES =
  512 * 1024 * 1024;

const HOSTED_WORKSPACE_SNAPSHOT_V2_DATA_KEY_WRAP_SALT = new TextEncoder().encode(
  "murph.hosted-workspace-snapshot-data-key-wrap.v1",
);

export type HostedWorkspaceSnapshotV2Compression = typeof HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION;

export interface HostedWorkspaceSnapshotV2ArchiveMetadata {
  compression: HostedWorkspaceSnapshotV2Compression;
  encryptedByteSize: number;
  encryptedObjectSha256: string;
  fileCount: number;
  format: "tar";
  plaintextArchiveSha256: string;
  totalPlainBytes: number;
}

export interface HostedWorkspaceSnapshotV2Aad {
  objectKey: string;
  purpose: typeof HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE;
  schema: typeof HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA;
  snapshotId: string;
  userId: string;
}

export interface HostedWorkspaceSnapshotV2EncryptionMetadata {
  aad: HostedWorkspaceSnapshotV2Aad;
  ivBase64: string;
  rootKeyId: string;
  scheme: typeof HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME;
  wrappedDataKey: string;
}

export interface HostedWorkspaceSnapshotV2Ref {
  archive: HostedWorkspaceSnapshotV2ArchiveMetadata;
  createdAt: string;
  encryption: HostedWorkspaceSnapshotV2EncryptionMetadata;
  objectKey: string;
  schema: typeof HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA;
  snapshotId: string;
  upload: typeof HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND;
  userId: string;
}

export interface HostedWorkspaceSnapshotV2DataKeyWrap {
  alg: "AES-256-GCM-HKDF-SHA256";
  ciphertext: string;
  iv: string;
  rootKeyId: string;
  schema: typeof HOSTED_WORKSPACE_SNAPSHOT_V2_DATA_KEY_WRAP_SCHEMA;
}

export function buildHostedWorkspaceSnapshotV2Aad(input: {
  objectKey: string;
  snapshotId: string;
  userId: string;
}): HostedWorkspaceSnapshotV2Aad {
  return {
    objectKey: input.objectKey,
    purpose: HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE,
    schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
    snapshotId: input.snapshotId,
    userId: input.userId,
  };
}

export function readHostedWorkspaceSnapshotV2SnapshotId(
  ref: HostedWorkspaceSnapshotV2Ref,
): string {
  return ref.snapshotId;
}

export function createHostedWorkspaceSnapshotV2DataKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function encodeHostedWorkspaceSnapshotV2DataKey(dataKey: Uint8Array): string {
  if (dataKey.byteLength !== 32) {
    throw new TypeError("Hosted workspace snapshot data key must be 32 bytes.");
  }
  return encodeBase64Url(dataKey);
}

export function decodeHostedWorkspaceSnapshotV2DataKey(value: string): Uint8Array {
  const bytes = decodeBase64Url(value);
  if (bytes.byteLength !== 32) {
    throw new TypeError("Hosted workspace snapshot data key must be 32 bytes.");
  }
  return bytes;
}

export async function wrapHostedWorkspaceSnapshotV2DataKey(input: {
  aad: HostedWorkspaceSnapshotV2Aad;
  dataKey: Uint8Array;
  rootKey: Uint8Array;
  rootKeyId: string;
}): Promise<string> {
  if (input.dataKey.byteLength !== 32) {
    throw new TypeError("Hosted workspace snapshot data key must be 32 bytes.");
  }
  if (input.rootKey.byteLength !== 32) {
    throw new TypeError("Hosted workspace snapshot root key must be 32 bytes.");
  }

  const cryptoKey = await importWorkspaceSnapshotWrapKey(input.rootKey, input.rootKeyId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    {
      additionalData: toArrayBuffer(serializeHostedWorkspaceSnapshotV2Aad(input.aad)),
      iv: toArrayBuffer(iv),
      name: "AES-GCM",
    },
    cryptoKey,
    toArrayBuffer(input.dataKey),
  ));
  const wrap: HostedWorkspaceSnapshotV2DataKeyWrap = {
    alg: "AES-256-GCM-HKDF-SHA256",
    ciphertext: encodeBase64Url(ciphertext),
    iv: encodeBase64Url(iv),
    rootKeyId: input.rootKeyId,
    schema: HOSTED_WORKSPACE_SNAPSHOT_V2_DATA_KEY_WRAP_SCHEMA,
  };

  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(wrap)));
}

export async function unwrapHostedWorkspaceSnapshotV2DataKey(input: {
  aad: HostedWorkspaceSnapshotV2Aad;
  rootKey: Uint8Array;
  wrappedDataKey: string;
}): Promise<Uint8Array> {
  if (input.rootKey.byteLength !== 32) {
    throw new TypeError("Hosted workspace snapshot root key must be 32 bytes.");
  }
  const wrap = parseHostedWorkspaceSnapshotV2DataKeyWrap(input.wrappedDataKey);
  const cryptoKey = await importWorkspaceSnapshotWrapKey(input.rootKey, wrap.rootKeyId);
  const dataKey = new Uint8Array(await crypto.subtle.decrypt(
    {
      additionalData: toArrayBuffer(serializeHostedWorkspaceSnapshotV2Aad(input.aad)),
      iv: toArrayBuffer(decodeBase64Url(wrap.iv)),
      name: "AES-GCM",
    },
    cryptoKey,
    toArrayBuffer(decodeBase64Url(wrap.ciphertext)),
  ));
  if (dataKey.byteLength !== 32) {
    throw new TypeError("Hosted workspace snapshot data key must be 32 bytes.");
  }

  return dataKey;
}

export function readHostedWorkspaceSnapshotV2DataKeyWrapRootKeyId(
  wrappedDataKey: string,
): string {
  return parseHostedWorkspaceSnapshotV2DataKeyWrap(wrappedDataKey).rootKeyId;
}

export function serializeHostedWorkspaceSnapshotV2Aad(
  aad: HostedWorkspaceSnapshotV2Aad,
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    objectKey: aad.objectKey,
    purpose: aad.purpose,
    schema: aad.schema,
    snapshotId: aad.snapshotId,
    userId: aad.userId,
  }));
}

function parseHostedWorkspaceSnapshotV2DataKeyWrap(
  value: string,
): HostedWorkspaceSnapshotV2DataKeyWrap {
  const text = new TextDecoder().decode(decodeBase64Url(value));
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Hosted workspace snapshot data key wrap must be an object.");
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema !== HOSTED_WORKSPACE_SNAPSHOT_V2_DATA_KEY_WRAP_SCHEMA) {
    throw new TypeError(
      `Hosted workspace snapshot data key wrap schema must be ${HOSTED_WORKSPACE_SNAPSHOT_V2_DATA_KEY_WRAP_SCHEMA}.`,
    );
  }
  if (record.alg !== "AES-256-GCM-HKDF-SHA256") {
    throw new TypeError("Hosted workspace snapshot data key wrap alg must be AES-256-GCM-HKDF-SHA256.");
  }

  return {
    alg: "AES-256-GCM-HKDF-SHA256",
    ciphertext: requireString(record.ciphertext, "Hosted workspace snapshot data key wrap ciphertext"),
    iv: requireString(record.iv, "Hosted workspace snapshot data key wrap iv"),
    rootKeyId: requireString(record.rootKeyId, "Hosted workspace snapshot data key wrap rootKeyId"),
    schema: HOSTED_WORKSPACE_SNAPSHOT_V2_DATA_KEY_WRAP_SCHEMA,
  };
}

async function importWorkspaceSnapshotWrapKey(
  rootKey: Uint8Array,
  rootKeyId: string,
): Promise<CryptoKey> {
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rootKey),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      hash: "SHA-256",
      info: new TextEncoder().encode(rootKeyId),
      name: "HKDF",
      salt: toArrayBuffer(HOSTED_WORKSPACE_SNAPSHOT_V2_DATA_KEY_WRAP_SALT),
    },
    hkdfKey,
    256,
  );

  return crypto.subtle.importKey("raw", derived, "AES-GCM", false, ["decrypt", "encrypt"]);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
