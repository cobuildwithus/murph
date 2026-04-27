import { Buffer } from "node:buffer";
import path from "node:path";

import {
  createHostedConversationMailboxImportItem,
  enqueueHostedSystemMailboxItem,
  normalizeHostedAssistantRuntimeConfig,
  type HostedAssistantRuntimeConfig,
  type HostedWorkspaceRuntimeJobOptions,
} from "@murphai/assistant-runtime";
import {
  parseHostedExecutionWake,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedExecutionSystemWake,
  HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedExecutionBundleRef,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceInvocationRequest,
} from "@murphai/hosted-execution/runtime-control";
import {
  sha256HostedBundleHex,
  snapshotHostedExecutionContext,
} from "@murphai/runtime-state/node";

import {
  snapshotHostedRuntimeBridgeWorkspaceBundle,
  type HostedRuntimeBridgeCheckpointLease,
} from "./runtime-bridge-checkpoint.ts";
import {
  readHostedMailboxEncryptionEnvironment,
  type HostedMailboxEncryptionEnvironment,
} from "./hosted-mailbox-encryption.ts";

const AES_GCM_ALGORITHM = "AES-GCM";
const HKDF_HASH = "SHA-256";
const GCM_IV_BYTES = 12;
const GCM_AUTH_TAG_BYTES = 16;
const HOSTED_MAILBOX_ENCRYPTION_KEY_BYTES = 32;
const HOSTED_MAILBOX_SCOPE_SALT = new TextEncoder().encode("murph.hosted.device-sync.secret.v1");
const ENCRYPTED_SECRET_PREFIX = "hbds";
const HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD = "hosted-mailbox-inline-payload";
const HOSTED_MAILBOX_REF_PAYLOAD_FIELD = "hosted-mailbox-ref-payload";
const BASE64URL_CANONICAL_PATTERN = /^[A-Za-z0-9_-]*$/u;

type HostedWorkspaceRuntimeBridgeImportItem =
  HostedWorkspaceRuntimeJobOptions["importItem"];
type HostedWorkspaceRuntimeBridgeImportItemInput =
  Parameters<HostedWorkspaceRuntimeBridgeImportItem>[0];
type HostedRuntimeBridgeReadCurrentLease = () =>
  | HostedRuntimeBridgeCheckpointLease
  | null
  | Promise<HostedRuntimeBridgeCheckpointLease | null>;
type HostedRuntimeBridgeNormalizedRuntime = Pick<
  ReturnType<typeof normalizeHostedAssistantRuntimeConfig>,
  "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
>;

export interface HostedWorkspaceRuntimeBridgeOptionsInput {
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease?: HostedRuntimeBridgeReadCurrentLease;
  readEncryptionEnvironment?: () => HostedMailboxEncryptionEnvironment;
  request: HostedWorkspaceInvocationRequest;
  runtime: HostedAssistantRuntimeConfig;
  vaultRoot?: string | null;
}

export function createHostedWorkspaceRuntimeBridgeJobOptions(
  input: HostedWorkspaceRuntimeBridgeOptionsInput,
): HostedWorkspaceRuntimeJobOptions {
  const vaultRoot = normalizeVaultRoot(input.vaultRoot);
  const readCurrentLease = input.readCurrentLease
    ?? (() => createHostedRuntimeBridgeLeaseFromWorkspaceRequest(input.request));
  const runtime = normalizeHostedAssistantRuntimeConfig(input.runtime, input.platform);
  const readEncryptionEnvironment = input.readEncryptionEnvironment
    ?? createHostedMailboxEncryptionEnvironmentReader({
      allowAmbientFallback: isAmbientHostedRuntimeEnvelope(input.runtime),
      platformEnv: runtime.platformEnv,
    });

  return {
    createCheckpointSnapshot: async (checkpointInput) => ({
      snapshotRef: await createHostedWorkspaceBridgeCheckpointSnapshot({
        platform: input.platform,
        readCurrentLease,
        request: {
          attemptId: input.request.attemptId,
          expectedWorkspaceVersion: input.request.workspaceVersion,
          leaseGeneration: input.request.leaseGeneration,
          nextWakeAt: Object.hasOwn(checkpointInput, "nextWakeAt")
            ? checkpointInput.nextWakeAt ?? null
            : null,
          nextWakeReason: Object.hasOwn(checkpointInput, "nextWakeReason")
            ? checkpointInput.nextWakeReason ?? null
            : null,
          reason: checkpointInput.reason,
          redactedStatus: checkpointInput.redactedStatus ?? null,
          snapshotRef: null,
        },
        userId: input.request.userId,
        vaultRoot,
      }),
    }),
    importItem: createHostedWorkspaceBridgeMailboxImporter({
      readEncryptionEnvironment,
      runtime,
      vaultRoot,
    }),
    platform: input.platform,
    vaultRoot,
  };
}

function createHostedMailboxEncryptionEnvironmentReader(
  input: {
    allowAmbientFallback: boolean;
    platformEnv: Readonly<Record<string, string>>;
  },
): () => HostedMailboxEncryptionEnvironment {
  return () => {
    if (input.platformEnv.HOSTED_WAKE_ENCRYPTION_KEY || !input.allowAmbientFallback) {
      return readHostedMailboxEncryptionEnvironment(input.platformEnv);
    }

    return readHostedMailboxEncryptionEnvironment();
  };
}

function isAmbientHostedRuntimeEnvelope(runtime: HostedAssistantRuntimeConfig): boolean {
  return runtime.commitTimeoutMs === undefined
    && runtime.forwardedEnv === undefined
    && runtime.platformEnv === undefined
    && runtime.resolvedConfig === undefined
    && runtime.userEnv === undefined;
}

export function createHostedRuntimeBridgeLeaseFromWorkspaceRequest(
  request: HostedWorkspaceInvocationRequest,
): HostedRuntimeBridgeCheckpointLease {
  return {
    attemptId: request.attemptId,
    leaseGeneration: request.leaseGeneration,
    userId: request.userId,
    workspaceVersion: request.workspaceVersion,
  };
}

async function createHostedWorkspaceBridgeCheckpointSnapshot(input: {
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease: HostedRuntimeBridgeReadCurrentLease;
  request: HostedWorkspaceCheckpointRequest;
  userId: string;
  vaultRoot: string;
}): Promise<HostedExecutionBundleRef> {
  return await snapshotHostedRuntimeBridgeWorkspaceBundle({
    readCurrentLease: input.readCurrentLease,
    request: input.request,
    snapshotWorkspace: async () => {
      const snapshot = await snapshotHostedExecutionContext({
        artifactSink: async (artifact) => {
          await input.platform.artifactStore.put({
            bytes: artifact.bytes,
            sha256: artifact.ref.sha256,
          });
        },
        operatorHomeRoot: resolveWorkspaceOperatorHomeRoot(input.vaultRoot),
        vaultRoot: input.vaultRoot,
      });

      return snapshot.bundle;
    },
    userId: input.userId,
    writeBundle: async ({ bundle }) => {
      const hash = sha256HostedBundleHex(bundle);
      await input.platform.artifactStore.put({
        bytes: bundle,
        sha256: hash,
      });

      return {
        hash,
        key: `cloudflare-workspace-snapshots/${hash}.bundle`,
        size: bundle.byteLength,
        updatedAt: new Date().toISOString(),
      };
    },
  });
}

function createHostedWorkspaceBridgeMailboxImporter(input: {
  readEncryptionEnvironment: () => HostedMailboxEncryptionEnvironment;
  runtime: {
    forwardedEnv: Readonly<Record<string, string>>;
    platform: HostedWorkspaceRuntimeJobOptions["platform"];
    platformEnv: Readonly<Record<string, string>>;
  } & Pick<HostedRuntimeBridgeNormalizedRuntime, "commitTimeoutMs" | "resolvedConfig" | "userEnv">;
  vaultRoot: string;
}): HostedWorkspaceRuntimeBridgeImportItem {
  const importConversationItem = createHostedConversationMailboxImportItem({
    decodePayload: {
      decode: async (decodeInput) => {
        const decodedPayload = await decryptHostedMailboxPayloadCiphertext({
          ciphertext: decodeInput.payloadCiphertext,
          environment: input.readEncryptionEnvironment(),
          userId: decodeInput.itemRef.userId,
        });
        const wake = parseHostedExecutionWake(decodedPayload);
        if (wake.kind !== "conversation.message") {
          return {
            reasonCode: "payload.decode_mismatch",
            retryable: false,
            status: "blocked",
          };
        }

        return {
          status: "decoded",
          wake,
        };
      },
    },
    runtime: input.runtime,
    vaultRoot: input.vaultRoot,
  });

  return async (item) => importHostedWorkspaceBridgeMailboxItem({
    ...input,
    importConversationItem,
    item,
  });
}

async function importHostedWorkspaceBridgeMailboxItem(input: {
  importConversationItem: (item: HostedWorkspaceRuntimeBridgeImportItemInput) =>
    ReturnType<HostedWorkspaceRuntimeBridgeImportItem>;
  item: HostedWorkspaceRuntimeBridgeImportItemInput;
  readEncryptionEnvironment: () => HostedMailboxEncryptionEnvironment;
  runtime: {
    forwardedEnv: Readonly<Record<string, string>>;
    platform: HostedWorkspaceRuntimeJobOptions["platform"];
    platformEnv: Readonly<Record<string, string>>;
  } & Pick<HostedRuntimeBridgeNormalizedRuntime, "commitTimeoutMs" | "resolvedConfig" | "userEnv">;
  vaultRoot: string;
}): ReturnType<HostedWorkspaceRuntimeBridgeImportItem> {
  if (
    input.item.route.action === "import-conversation-message"
    && input.item.item.kind === "conversation.message"
  ) {
    return await input.importConversationItem(input.item);
  }

  if (
    input.item.route.action === "import-conversation-message"
    || input.item.item.kind === "conversation.message"
  ) {
    return {
      reasonCode: "cloudflare_bridge.unhandled_mailbox_route",
      status: "deferred",
    };
  }

  const decodedPayload = await decryptHostedMailboxPayloadCiphertext({
    ciphertext: input.item.payload.payloadCiphertext,
    environment: input.readEncryptionEnvironment(),
    userId: input.item.item.userId,
  });
  const wake = parseHostedExecutionWake(decodedPayload);

  if (!decodedSystemWakeMatchesMailboxItem(wake, input.item)) {
    return {
      reasonCode: "payload.decode_mismatch",
      retryable: false,
      status: "blocked",
    };
  }

  return await enqueueHostedSystemMailboxItem({
    item: input.item,
    vaultRoot: input.vaultRoot,
    wake,
  });
}

function decodedSystemWakeMatchesMailboxItem(
  wake: HostedExecutionWake,
  item: HostedWorkspaceRuntimeBridgeImportItemInput,
): wake is HostedExecutionSystemWake {
  return wake.kind !== "conversation.message"
    && wake.userId === item.item.userId
    && wake.occurredAt === item.item.occurredAt
    && wake.eventId === item.item.dedupeKey
    && wake.kind === item.item.kind;
}

async function decryptHostedMailboxPayloadCiphertext(input: {
  ciphertext: string;
  environment: HostedMailboxEncryptionEnvironment;
  userId: string;
}): Promise<unknown> {
  const fields = [
    HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD,
    HOSTED_MAILBOX_REF_PAYLOAD_FIELD,
  ] as const;
  let lastError: unknown = null;

  for (const field of fields) {
    try {
      const plaintext = await decryptHostedMailboxCiphertext({
        ...input,
        field,
      });
      return parseJsonValue(plaintext, "Hosted mailbox payload ciphertext");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new TypeError("Hosted mailbox payload ciphertext is invalid.");
}

async function decryptHostedMailboxCiphertext(input: {
  ciphertext: string;
  environment: HostedMailboxEncryptionEnvironment;
  field: string;
  userId: string;
}): Promise<string> {
  const [prefix, payloadKeyVersion, ivText, tagText, ciphertextText] = input.ciphertext.split(":");

  if (
    prefix !== ENCRYPTED_SECRET_PREFIX
    || !payloadKeyVersion
    || !ivText
    || !tagText
    || ciphertextText === undefined
  ) {
    throw new TypeError("Encrypted hosted mailbox payload is malformed.");
  }

  const key = input.environment.keysByVersion[payloadKeyVersion];

  if (!key) {
    throw new TypeError(
      `Encrypted hosted mailbox payload references unknown key version ${payloadKeyVersion}.`,
    );
  }

  const scopedKey = await deriveHostedMailboxScopeKey(
    key,
    `hosted-mailbox-payload:${input.field}`,
  );
  const iv = decodeStrictBase64Url(ivText, "Encrypted hosted mailbox payload is malformed.");
  const authTag = decodeStrictBase64Url(tagText, "Encrypted hosted mailbox payload is malformed.");
  const ciphertext = decodeStrictBase64Url(
    ciphertextText,
    "Encrypted hosted mailbox payload is malformed.",
  );

  if (iv.byteLength !== GCM_IV_BYTES || authTag.byteLength !== GCM_AUTH_TAG_BYTES) {
    throw new TypeError("Encrypted hosted mailbox payload is malformed.");
  }

  const keyHandle = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(scopedKey),
    AES_GCM_ALGORITHM,
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      additionalData: toArrayBuffer(buildHostedMailboxFieldAad({
        field: input.field,
        userId: input.userId,
      })),
      iv: toArrayBuffer(iv),
      name: AES_GCM_ALGORITHM,
      tagLength: GCM_AUTH_TAG_BYTES * 8,
    },
    keyHandle,
    toArrayBuffer(concatBytes(ciphertext, authTag)),
  );

  return new TextDecoder().decode(plaintext);
}

async function deriveHostedMailboxScopeKey(rootKey: Uint8Array, scope: string): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rootKey),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      hash: HKDF_HASH,
      info: toArrayBuffer(new TextEncoder().encode(scope)),
      name: "HKDF",
      salt: toArrayBuffer(HOSTED_MAILBOX_SCOPE_SALT),
    },
    keyMaterial,
    HOSTED_MAILBOX_ENCRYPTION_KEY_BYTES * 8,
  );

  return new Uint8Array(derivedBits);
}

function buildHostedMailboxFieldAad(input: {
  field: string;
  userId: string;
}): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    field: input.field,
    memberId: input.userId,
    purpose: "hosted-mailbox-payload",
  }));
}

function parseJsonValue(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new TypeError(
      `${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function decodeStrictBase64Url(value: string, errorMessage: string): Uint8Array {
  if (!BASE64URL_CANONICAL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new TypeError(errorMessage);
  }

  const decoded = Buffer.from(value, "base64url");

  if (decoded.toString("base64url") !== value) {
    throw new TypeError(errorMessage);
  }

  return Uint8Array.from(decoded);
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left, 0);
  joined.set(right, left.byteLength);
  return joined;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function resolveWorkspaceOperatorHomeRoot(vaultRoot: string): string {
  return path.join(path.dirname(vaultRoot), `${path.basename(vaultRoot)}-operator-home`);
}

function normalizeVaultRoot(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : process.env.VAULT ?? process.cwd();
}
