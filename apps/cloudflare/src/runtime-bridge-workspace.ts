import { Buffer } from "node:buffer";
import path from "node:path";

import {
  createHostedAssistantChannelTypingDependencies,
  executeHostedMailboxEvent,
  importHostedVaultSyncMailboxItem,
  normalizeHostedAssistantRuntimeConfig,
  type HostedAssistantRuntimeConfig,
  type HostedRuntimePlatform,
  type HostedWorkspaceRuntimeJobOptions,
} from "@murphai/assistant-runtime";
import {
  parseHostedExecutionWake,
  type HostedExecutionBundleRef,
  type HostedExecutionConversationMessageWake,
  type HostedExecutionRunnerSharePack,
  type HostedExecutionSystemWake,
  type HostedExecutionVaultSyncImportWake,
  type HostedExecutionWake,
  type HostedWorkspaceCheckpointRequest,
  type HostedWorkspaceRunRequest,
} from "@murphai/hosted-execution";
import {
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  resolveHostedEmailSelfAddresses,
} from "@murphai/hosted-execution/hosted-email";
import {
  normalizeHostedEmailConversationCapture,
  normalizeHostedLinqConversationCapture,
  normalizeHostedTelegramConversationCapture,
  type LinqAttachmentDownloadDriver,
  type TelegramAttachmentDownloadDriver,
} from "@murphai/inboxd/connectors/hosted-conversation";
import {
  createParsedInboxPipeline,
  openInboxRuntime,
} from "@murphai/inboxd";
import { createConfiguredParserRegistry } from "@murphai/parsers";
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
const DEFAULT_HOSTED_LINQ_ATTACHMENT_CDN_BASE_URL = "https://cdn.linqapp.com";
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
type HostedRuntimeBridgeExecutionContext =
  Parameters<typeof executeHostedMailboxEvent>[0]["executionContext"];

export interface HostedWorkspaceRuntimeBridgeOptionsInput {
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease?: HostedRuntimeBridgeReadCurrentLease;
  readEncryptionEnvironment?: () => HostedMailboxEncryptionEnvironment;
  request: HostedWorkspaceRunRequest;
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
      readEncryptionEnvironment: input.readEncryptionEnvironment ?? readHostedMailboxEncryptionEnvironment,
      runtime,
      vaultRoot,
    }),
    platform: input.platform,
    vaultRoot,
  };
}

export function createHostedRuntimeBridgeLeaseFromWorkspaceRequest(
  request: HostedWorkspaceRunRequest,
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
  return async (item) => importHostedWorkspaceBridgeMailboxItem({
    ...input,
    item,
  });
}

async function importHostedWorkspaceBridgeMailboxItem(input: {
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
    input.item.route.action === "import-vault-sync"
    && input.item.item.kind === "vault.sync.import"
  ) {
    const decodedPayload = await decryptHostedMailboxPayloadCiphertext({
      ciphertext: input.item.payload.payloadCiphertext,
      environment: input.readEncryptionEnvironment(),
      userId: input.item.item.userId,
    });
    const wake = parseHostedExecutionWake(decodedPayload);

    if (!decodedVaultSyncWakeMatchesMailboxItem(wake, input.item)) {
      return {
        reasonCode: "payload.decode_mismatch",
        retryable: false,
        status: "blocked",
      };
    }

    return await importHostedVaultSyncMailboxItem({
      item: input.item,
      platform: input.runtime.platform,
      vaultRoot: input.vaultRoot,
      wake,
    });
  }

  if (
    input.item.route.action !== "import-conversation-message"
    && input.item.route.action !== "apply-member-activation"
    && input.item.route.action !== "apply-member-channels-update"
    && input.item.route.action !== "dispatch-assistant-notification"
    && input.item.route.action !== "run-device-sync-wake"
    && input.item.route.action !== "import-vault-share"
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

  if (
    input.item.route.action !== "import-conversation-message"
    && input.item.item.kind !== "conversation.message"
  ) {
    if (!decodedSystemWakeMatchesMailboxItem(wake, input.item)) {
      return {
        reasonCode: "payload.decode_mismatch",
        retryable: false,
        status: "blocked",
      };
    }

    return await executeHostedSystemWakeFromMailbox({
      item: input.item,
      runtime: input.runtime,
      vaultRoot: input.vaultRoot,
      wake,
    });
  }

  if (!decodedWakeMatchesMailboxItem(wake, input.item)) {
    return {
      reasonCode: "payload.decode_mismatch",
      retryable: false,
      status: "blocked",
    };
  }

  const imported = await importHostedConversationMessageWakeIntoLocalInbox({
    runtime: input.runtime,
    vaultRoot: input.vaultRoot,
    wake,
  });

  if (imported.capture.deduped) {
    return {
      reasonCode: "capture.deduped",
      status: "skipped",
    };
  }

  return {
    status: "imported",
  };
}

async function executeHostedSystemWakeFromMailbox(input: {
  item: HostedWorkspaceRuntimeBridgeImportItemInput;
  runtime: HostedRuntimeBridgeNormalizedRuntime;
  vaultRoot: string;
  wake: HostedExecutionSystemWake;
}): ReturnType<HostedWorkspaceRuntimeBridgeImportItem> {
  const sharePack = await fetchHostedSharePackForWake({
    platform: input.runtime.platform,
    requestId: input.item.payload.requestId,
    wake: input.wake,
  });
  if (input.wake.kind === "vault.share.accepted" && !sharePack) {
    return {
      reasonCode: "share.port_missing",
      status: "deferred",
    };
  }
  const executionContext: HostedRuntimeBridgeExecutionContext = {
    hosted: {
      channelTypingDependencies: createHostedAssistantChannelTypingDependencies({
        forwardedEnv: input.runtime.forwardedEnv,
        platformEnv: input.runtime.platformEnv,
        runtimeEnv: buildHostedRuntimeEnv(input.runtime),
      }),
      memberId: input.wake.userId,
      userEnvKeys: Object.keys(input.runtime.userEnv),
    },
  };

  await executeHostedMailboxEvent({
    executionContext,
    runtime: input.runtime,
    runtimeEnv: buildHostedRuntimeEnv(input.runtime),
    sharePack,
    vaultRoot: input.vaultRoot,
    wake: input.wake,
  });

  return {
    status: "imported",
  };
}

async function fetchHostedSharePackForWake(input: {
  platform: HostedRuntimePlatform;
  requestId: string | null;
  wake: HostedExecutionSystemWake;
}): Promise<HostedExecutionRunnerSharePack | null> {
  if (input.wake.kind !== "vault.share.accepted") {
    return null;
  }

  if (!input.platform.sharePort) {
    return null;
  }

  const response = await input.platform.sharePort.fetchPayload({
    ownerUserId: input.wake.share.ownerUserId,
    requestId: input.requestId ?? input.wake.eventId,
    shareId: input.wake.share.shareId,
  });

  return response.payload;
}

async function importHostedConversationMessageWakeIntoLocalInbox(input: {
  runtime: {
    forwardedEnv: Readonly<Record<string, string>>;
    platform: HostedWorkspaceRuntimeJobOptions["platform"];
    platformEnv: Readonly<Record<string, string>>;
  };
  vaultRoot: string;
  wake: HostedExecutionConversationMessageWake;
}) {
  const capture = await normalizeHostedConversationMessageWake(input);
  const runtime = await openInboxRuntime({
    vaultRoot: input.vaultRoot,
  });
  let pipeline: Awaited<ReturnType<typeof createParsedInboxPipeline>> | null = null;

  try {
    const configured = await createConfiguredParserRegistry({
      vaultRoot: input.vaultRoot,
    });
    pipeline = await createParsedInboxPipeline({
      ffmpeg: configured.ffmpeg,
      registry: configured.registry,
      runtime,
      vaultRoot: input.vaultRoot,
    });

    return {
      capture: await pipeline.processCapture(capture),
    };
  } finally {
    if (pipeline) {
      pipeline.close();
    } else {
      runtime.close();
    }
  }
}

async function normalizeHostedConversationMessageWake(input: {
  runtime: {
    forwardedEnv: Readonly<Record<string, string>>;
    platform: HostedWorkspaceRuntimeJobOptions["platform"];
    platformEnv: Readonly<Record<string, string>>;
  };
  wake: HostedExecutionConversationMessageWake;
}) {
  if (isHostedLinqConversationMessageWake(input.wake)) {
    return await normalizeHostedLinqConversationCapture({
      accountId: input.wake.message.phoneLookupKey,
      attachmentDownloadTimeoutMs: 15_000,
      downloadDriver: createHostedLinqAttachmentDownloadDriver(),
      linqMessage: input.wake.message.linqMessage,
      occurredAt: input.wake.occurredAt,
    });
  }

  if (isHostedTelegramConversationMessageWake(input.wake)) {
    return await normalizeHostedTelegramConversationCapture({
      accountId: "bot",
      downloadDriver: createHostedTelegramAttachmentDownloadDriver(
        buildHostedRuntimeEnv(input.runtime),
      ),
      externalId: input.wake.eventId,
      message: input.wake.message.telegramMessage,
      occurredAt: input.wake.occurredAt,
      receivedAt: input.wake.occurredAt,
    });
  }

  if (isHostedEmailConversationMessageWake(input.wake)) {
    const bytes = await input.runtime.platform.effectsPort.readRawEmailMessage(
      input.wake.message.rawMessageKey,
    );

    if (!bytes) {
      throw new HostedMailboxRawEmailMissingError();
    }

    return await normalizeHostedEmailConversationCapture({
      accountAddress: input.wake.message.identityId,
      accountId: input.wake.message.identityId,
      rawMessage: bytes,
      selfAddresses: resolveHostedEmailSelfAddresses({
        extra: [input.wake.message.selfAddress],
        senderIdentity: input.wake.message.identityId,
      }),
      source: "email",
      threadTarget: null,
    });
  }

  throw new TypeError("Unsupported hosted conversation message wake kind.");
}

class HostedMailboxRawEmailMissingError extends Error {
  readonly code = "email-raw-message-missing";

  constructor() {
    super("Hosted mailbox raw email payload is missing.");
    this.name = "HostedMailboxRawEmailMissingError";
  }
}

function decodedWakeMatchesMailboxItem(
  wake: ReturnType<typeof parseHostedExecutionWake>,
  item: HostedWorkspaceRuntimeBridgeImportItemInput,
): wake is HostedExecutionConversationMessageWake {
  return wake.kind === "conversation.message"
    && wake.userId === item.item.userId
    && wake.occurredAt === item.item.occurredAt
    && wake.eventId === item.item.dedupeKey;
}

function decodedVaultSyncWakeMatchesMailboxItem(
  wake: ReturnType<typeof parseHostedExecutionWake>,
  item: HostedWorkspaceRuntimeBridgeImportItemInput,
): wake is HostedExecutionVaultSyncImportWake {
  return wake.kind === "vault.sync.import"
    && wake.userId === item.item.userId
    && wake.occurredAt === item.item.occurredAt
    && wake.eventId === item.item.dedupeKey;
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

function createHostedLinqAttachmentDownloadDriver(): LinqAttachmentDownloadDriver | null {
  if (typeof globalThis.fetch !== "function") {
    return null;
  }

  return {
    downloadUrl: async (url, signal) => {
      const normalizedUrl = normalizeHostedLinqAttachmentUrl(url);
      if (!normalizedUrl) {
        return null;
      }

      const response = await globalThis.fetch(normalizedUrl, {
        method: "GET",
        signal,
      });

      if (!response.ok) {
        throw new Error(`Hosted Linq attachment download failed with HTTP ${response.status}.`);
      }

      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

function normalizeHostedLinqAttachmentUrl(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);
    const attachmentCdnBaseUrl = normalizeHostedUrl(
      process.env.LINQ_ATTACHMENT_CDN_BASE_URL,
      DEFAULT_HOSTED_LINQ_ATTACHMENT_CDN_BASE_URL,
    );

    if (!attachmentCdnBaseUrl) {
      return null;
    }

    const allowedBaseUrl = new URL(attachmentCdnBaseUrl);
    if (url.protocol !== "https:" || url.hostname !== allowedBaseUrl.hostname) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function createHostedTelegramAttachmentDownloadDriver(
  env: Readonly<Record<string, string | undefined>>,
): TelegramAttachmentDownloadDriver | null {
  const token = normalizeOptionalString(env.TELEGRAM_BOT_TOKEN);
  if (!token || typeof globalThis.fetch !== "function") {
    return null;
  }

  const apiBaseUrl = normalizeHostedUrl(env.TELEGRAM_API_BASE_URL, "https://api.telegram.org");
  const fileBaseUrl = normalizeHostedUrl(env.TELEGRAM_FILE_BASE_URL, "https://api.telegram.org/file");
  if (!apiBaseUrl || !fileBaseUrl) {
    return null;
  }

  return {
    downloadFile: async (filePath, signal) => {
      const response = await globalThis.fetch(
        `${fileBaseUrl}/bot${token}/${filePath.replace(/^\/+/u, "")}`,
        {
          method: "GET",
          signal,
        },
      );

      if (!response.ok) {
        throw new Error(`Hosted Telegram attachment download failed with HTTP ${response.status}.`);
      }

      return new Uint8Array(await response.arrayBuffer());
    },
    getFile: async (fileId, signal) => {
      const url = new URL(`${apiBaseUrl}/bot${token}/getFile`);
      url.searchParams.set("file_id", fileId);
      const response = await globalThis.fetch(url, {
        method: "GET",
        signal,
      });

      if (!response.ok) {
        throw new Error(`Hosted Telegram API request failed with HTTP ${response.status}.`);
      }

      const payload = await response.json();
      return parseHostedTelegramApiResult(payload);
    },
  };
}

function parseHostedTelegramApiResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted Telegram API response must be an object.");
  }

  const record = value as {
    description?: unknown;
    error_code?: unknown;
    ok?: unknown;
    result?: unknown;
  };
  if (record.ok !== true || record.result === undefined) {
    throw new Error(typeof record.description === "string"
      ? record.description
      : "Hosted Telegram API request returned an invalid response.");
  }

  if (!record.result || typeof record.result !== "object" || Array.isArray(record.result)) {
    throw new TypeError("Hosted Telegram API result must be an object.");
  }

  const result = record.result as Record<string, unknown>;
  if (typeof result.file_id !== "string") {
    throw new TypeError("Hosted Telegram API result.file_id must be a string.");
  }

  return {
    ...result,
    file_id: result.file_id,
    ...(typeof result.file_path === "string" ? { file_path: result.file_path } : {}),
    ...(typeof result.file_size === "number" ? { file_size: result.file_size } : {}),
    ...(typeof result.file_unique_id === "string"
      ? { file_unique_id: result.file_unique_id }
      : {}),
  };
}

function buildHostedRuntimeEnv(input: {
  forwardedEnv: Readonly<Record<string, string>>;
  platformEnv: Readonly<Record<string, string>>;
}): Record<string, string> {
  return {
    ...input.forwardedEnv,
    ...input.platformEnv,
  };
}

function normalizeHostedUrl(value: string | undefined, fallback: string): string | null {
  try {
    return new URL((value?.trim() || fallback).replace(/\/+$/u, "")).toString().replace(/\/+$/u, "");
  } catch {
    return null;
  }
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
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
