import {
  isHostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  decodeHostedWorkspaceSnapshotV2DataKey,
  encodeHostedWorkspaceSnapshotV2DataKey,
  readHostedWorkspaceSnapshotV2DataKeyWrapRootKeyId,
  unwrapHostedWorkspaceSnapshotV2DataKey,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

import type {
  HostedUserCryptoContext,
} from "./hosted-crypto/runtime-user-crypto-context.ts";
import {
  createHostedR2PresignedGetUrl,
  readHostedR2PresignEnvironment,
} from "./r2-presigned-url.ts";
import {
  hostedWorkspaceSnapshotObjectKey,
} from "./storage-paths.ts";

const HOSTED_WORKSPACE_SNAPSHOT_PREPARED_GET_EXPIRES_SECONDS = 5 * 60;
const HOSTED_WORKSPACE_SNAPSHOT_PREPARED_GET_MIN_REMAINING_MS = 5_000;
const HOSTED_WORKSPACE_SNAPSHOT_SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface HostedWorkspaceSnapshotPreparedRestore {
  dataKeyBase64: string;
  encryptedObjectSha256: string;
  expiresAt: string;
  getUrl: string;
}

export async function prepareHostedWorkspaceSnapshotRestore(input: {
  configSource: Readonly<Record<string, string | undefined>>;
  crypto: HostedUserCryptoContext;
  userId: string;
  workspace: HostedWorkspaceState | null;
}): Promise<HostedWorkspaceSnapshotPreparedRestore | null> {
  const ref = input.workspace?.snapshotRef ?? null;
  if (!isHostedWorkspaceSnapshotV2Ref(ref)) {
    return null;
  }

  await assertHostedWorkspaceSnapshotRestoreRefOwnership({
    ref,
    userId: input.userId,
  });

  const wrappedRootKeyId = readHostedWorkspaceSnapshotV2DataKeyWrapRootKeyId(
    ref.encryption.wrappedDataKey,
  );
  if (wrappedRootKeyId !== ref.encryption.rootKeyId) {
    throw new Error("Hosted workspace snapshot wrapped data key root did not match its ref.");
  }

  const presignEnvironment = readHostedR2PresignEnvironment(input.configSource);
  const dataKeyBase64Promise = (async () => {
    const rootKey = ref.encryption.rootKeyId === input.crypto.rootKeyId
      ? input.crypto.rootKey
      : await input.crypto.resolveKeyById(ref.encryption.rootKeyId);
    if (!rootKey) {
      throw new Error("Hosted workspace snapshot root key is unavailable.");
    }

    const dataKey = await unwrapHostedWorkspaceSnapshotV2DataKey({
      aad: ref.encryption.aad,
      rootKey,
      wrappedDataKey: ref.encryption.wrappedDataKey,
    });
    try {
      return encodeHostedWorkspaceSnapshotV2DataKey(dataKey);
    } finally {
      dataKey.fill(0);
    }
  })();
  const presignedGetPromise = createHostedR2PresignedGetUrl({
    environment: presignEnvironment,
    expiresSeconds: HOSTED_WORKSPACE_SNAPSHOT_PREPARED_GET_EXPIRES_SECONDS,
    key: ref.objectKey,
  });
  const [dataKeyBase64, presignedGet] = await Promise.all([
    dataKeyBase64Promise,
    presignedGetPromise,
  ]);

  return {
    dataKeyBase64,
    encryptedObjectSha256: ref.archive.encryptedObjectSha256,
    expiresAt: presignedGet.expiresAt,
    getUrl: presignedGet.url,
  };
}

export function parseHostedWorkspaceSnapshotPreparedRestore(
  value: unknown,
  label = "Hosted workspace snapshot prepared restore",
): HostedWorkspaceSnapshotPreparedRestore {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  const record = value as Record<string, unknown>;
  const dataKeyBase64 = requirePreparedRestoreString(
    record.dataKeyBase64,
    `${label}.dataKeyBase64`,
  );
  const decodedDataKey = decodeHostedWorkspaceSnapshotV2DataKey(dataKeyBase64);
  decodedDataKey.fill(0);

  const encryptedObjectSha256 = requirePreparedRestoreString(
    record.encryptedObjectSha256,
    `${label}.encryptedObjectSha256`,
  );
  if (!HOSTED_WORKSPACE_SNAPSHOT_SHA256_PATTERN.test(encryptedObjectSha256)) {
    throw new TypeError(`${label}.encryptedObjectSha256 must be a lowercase SHA-256 hex digest.`);
  }

  const expiresAt = requirePreparedRestoreString(
    record.expiresAt,
    `${label}.expiresAt`,
  );
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    throw new TypeError(`${label}.expiresAt must be a valid ISO date string.`);
  }

  const getUrlText = requirePreparedRestoreString(record.getUrl, `${label}.getUrl`);
  const getUrl = new URL(getUrlText);
  if (
    (getUrl.protocol !== "https:" && getUrl.protocol !== "http:")
    || getUrl.username.length > 0
    || getUrl.password.length > 0
    || getUrl.hash.length > 0
  ) {
    throw new TypeError(`${label}.getUrl must be an HTTP(S) URL without credentials or a fragment.`);
  }

  return {
    dataKeyBase64,
    encryptedObjectSha256,
    expiresAt: new Date(expiresAtMs).toISOString(),
    getUrl: getUrl.href,
  };
}

export function requireHostedWorkspaceSnapshotPreparedRestoreForRef(input: {
  prepared: HostedWorkspaceSnapshotPreparedRestore;
  ref: HostedWorkspaceSnapshotV2Ref;
}): HostedWorkspaceSnapshotPreparedRestore & { expiresAtMs: number } {
  const prepared = parseHostedWorkspaceSnapshotPreparedRestore(input.prepared);
  if (prepared.encryptedObjectSha256 !== input.ref.archive.encryptedObjectSha256) {
    throw new Error("Hosted workspace snapshot prepared restore did not match the selected snapshot.");
  }

  const expiresAtMs = Date.parse(prepared.expiresAt);
  if (expiresAtMs <= Date.now() + HOSTED_WORKSPACE_SNAPSHOT_PREPARED_GET_MIN_REMAINING_MS) {
    throw new Error("Hosted workspace snapshot prepared restore URL is expired or too close to expiry.");
  }

  return {
    ...prepared,
    expiresAtMs,
  };
}

async function assertHostedWorkspaceSnapshotRestoreRefOwnership(input: {
  ref: HostedWorkspaceSnapshotV2Ref;
  userId: string;
}): Promise<void> {
  const expectedObjectKey = await hostedWorkspaceSnapshotObjectKey({
    snapshotId: input.ref.snapshotId,
    userId: input.userId,
  });
  if (
    input.ref.userId !== input.userId
    || input.ref.encryption.aad.userId !== input.userId
    || input.ref.encryption.aad.snapshotId !== input.ref.snapshotId
    || input.ref.encryption.aad.objectKey !== input.ref.objectKey
    || input.ref.objectKey !== expectedObjectKey
  ) {
    throw new Error("Hosted workspace snapshot restore ref is outside the bound user namespace.");
  }
}

function requirePreparedRestoreString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}
