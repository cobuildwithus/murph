import {
  isHostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedWorkspaceSnapshotV2FingerprintSha256,
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

const HOSTED_WORKSPACE_SNAPSHOT_PREPARED_GET_EXPIRES_SECONDS = 60 * 60;
const HOSTED_WORKSPACE_SNAPSHOT_PREPARED_GET_MIN_REMAINING_MS = 5_000;
const HOSTED_WORKSPACE_SNAPSHOT_SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const HOSTED_R2_PRESIGNED_AMZ_DATE_PATTERN =
  /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u;

export interface HostedWorkspaceSnapshotPreparedRestore {
  dataKey: string;
  getUrl: string;
  snapshotFingerprint: string;
}

type HostedWorkspaceSnapshotPreparationStepResult<T> =
  | { ok: true; value: T }
  | { error: unknown; ok: false };

export async function prepareHostedWorkspaceSnapshotRestore(input: {
  configSource: Readonly<Record<string, string | undefined>>;
  crypto: HostedUserCryptoContext;
  onPreparationUnavailable?: (error: unknown) => void;
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

  // Historical-root lookup and data-key unwrap are best-effort: a 404 or a
  // transient control-plane failure here must not clear the runner write fence
  // for a workspace that the container can warm-restore from its clean
  // checkpoint marker without ever touching R2 or the unwrap endpoint. Cold
  // restores still fail closed because the runner's fenced restore path will
  // re-attempt the same control-plane reads.
  const dataKeyPromise = (async (): Promise<
    HostedWorkspaceSnapshotPreparationStepResult<string>
  > => {
    try {
      const rootKey = ref.encryption.rootKeyId === input.crypto.rootKeyId
        ? input.crypto.rootKey
        : await input.crypto.resolveKeyById(ref.encryption.rootKeyId);
      if (!rootKey) {
        return {
          error: new Error("Hosted workspace snapshot root key is unavailable."),
          ok: false,
        };
      }

      const dataKey = await unwrapHostedWorkspaceSnapshotV2DataKey({
        aad: ref.encryption.aad,
        rootKey,
        wrappedDataKey: ref.encryption.wrappedDataKey,
      });
      try {
        return { ok: true, value: encodeHostedWorkspaceSnapshotV2DataKey(dataKey) };
      } finally {
        dataKey.fill(0);
      }
    } catch (error) {
      return { error, ok: false };
    }
  })();
  const presignedGetPromise = (async (): Promise<
    HostedWorkspaceSnapshotPreparationStepResult<string>
  > => {
    try {
      const presignEnvironment = readHostedR2PresignEnvironment(input.configSource);
      const presignedGet = await createHostedR2PresignedGetUrl({
        environment: presignEnvironment,
        expiresSeconds: HOSTED_WORKSPACE_SNAPSHOT_PREPARED_GET_EXPIRES_SECONDS,
        key: ref.objectKey,
      });

      return { ok: true, value: presignedGet.url };
    } catch (error) {
      return { error, ok: false };
    }
  })();
  const [dataKey, presignedGet] = await Promise.all([
    dataKeyPromise,
    presignedGetPromise,
  ]);
  if (!dataKey.ok) {
    input.onPreparationUnavailable?.(dataKey.error);
    return null;
  }
  if (!presignedGet.ok) {
    input.onPreparationUnavailable?.(presignedGet.error);
    return null;
  }

  return {
    dataKey: dataKey.value,
    getUrl: presignedGet.value,
    snapshotFingerprint: buildHostedWorkspaceSnapshotV2FingerprintSha256(ref),
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
  const dataKey = requirePreparedRestoreString(
    record.dataKey,
    `${label}.dataKey`,
  );
  const decodedDataKey = decodeHostedWorkspaceSnapshotV2DataKey(dataKey);
  decodedDataKey.fill(0);

  const snapshotFingerprint = requirePreparedRestoreString(
    record.snapshotFingerprint,
    `${label}.snapshotFingerprint`,
  );
  if (!HOSTED_WORKSPACE_SNAPSHOT_SHA256_PATTERN.test(snapshotFingerprint)) {
    throw new TypeError(`${label}.snapshotFingerprint must be a lowercase SHA-256 hex digest.`);
  }

  const getUrlText = requirePreparedRestoreString(record.getUrl, `${label}.getUrl`);
  let getUrl: URL;
  try {
    getUrl = new URL(getUrlText);
  } catch {
    throw new TypeError(`${label}.getUrl must be a valid URL.`);
  }
  if (
    (getUrl.protocol !== "https:" && getUrl.protocol !== "http:")
    || getUrl.username.length > 0
    || getUrl.password.length > 0
    || getUrl.hash.length > 0
  ) {
    throw new TypeError(`${label}.getUrl must be an HTTP(S) URL without credentials or a fragment.`);
  }
  readHostedR2PresignedGetUrlExpiresAtMs(getUrl, label);

  return {
    dataKey,
    getUrl: getUrl.href,
    snapshotFingerprint,
  };
}

export function requireHostedWorkspaceSnapshotPreparedRestoreForRef(input: {
  prepared: HostedWorkspaceSnapshotPreparedRestore;
  ref: HostedWorkspaceSnapshotV2Ref;
}): HostedWorkspaceSnapshotPreparedRestore & { expiresAtMs: number } {
  const prepared = parseHostedWorkspaceSnapshotPreparedRestore(input.prepared);
  if (prepared.snapshotFingerprint !== buildHostedWorkspaceSnapshotV2FingerprintSha256(input.ref)) {
    throw new Error("Hosted workspace snapshot prepared restore did not match the selected snapshot.");
  }

  const expiresAtMs = readHostedR2PresignedGetUrlExpiresAtMs(
    new URL(prepared.getUrl),
    "Hosted workspace snapshot prepared restore",
  );
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

function readHostedR2PresignedGetUrlExpiresAtMs(
  getUrl: URL,
  label: string,
): number {
  const amzDate = getUrl.searchParams.get("X-Amz-Date");
  const expires = getUrl.searchParams.get("X-Amz-Expires");
  const dateMatch = amzDate?.match(HOSTED_R2_PRESIGNED_AMZ_DATE_PATTERN) ?? null;
  if (!dateMatch) {
    throw new TypeError(`${label}.getUrl must include a valid X-Amz-Date query parameter.`);
  }
  if (!expires || !/^\d+$/u.test(expires)) {
    throw new TypeError(`${label}.getUrl must include a valid X-Amz-Expires query parameter.`);
  }

  const expiresSeconds = Number.parseInt(expires, 10);
  if (!Number.isSafeInteger(expiresSeconds) || expiresSeconds <= 0) {
    throw new TypeError(`${label}.getUrl X-Amz-Expires must be a positive safe integer.`);
  }

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
  ] = dateMatch;
  const issuedAtMs = Date.UTC(
    Number.parseInt(yearText ?? "", 10),
    Number.parseInt(monthText ?? "", 10) - 1,
    Number.parseInt(dayText ?? "", 10),
    Number.parseInt(hourText ?? "", 10),
    Number.parseInt(minuteText ?? "", 10),
    Number.parseInt(secondText ?? "", 10),
  );
  if (!Number.isFinite(issuedAtMs) || formatHostedR2AmzDate(issuedAtMs) !== amzDate) {
    throw new TypeError(`${label}.getUrl must include a valid X-Amz-Date query parameter.`);
  }

  return issuedAtMs + expiresSeconds * 1000;
}

function formatHostedR2AmzDate(timestampMs: number): string {
  return new Date(timestampMs).toISOString()
    .replace(/[:-]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
}

function requirePreparedRestoreString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}
