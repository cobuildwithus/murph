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
  decryptHostedMailboxPayloadCiphertext,
  createHostedMailboxEncryptionEnvironmentFromIngressRoot,
  readHostedMailboxEncryptionEnvironment,
  type HostedMailboxEncryptionEnvironment,
} from "./hosted-mailbox-encryption.ts";
import {
  readHostedExecutionWorkerEnvironment,
} from "./hosted-execution-worker-env.ts";
import {
  fetchHostedWorkerRuntimeRoots,
  type HostedWorkerCryptoEnv,
} from "./hosted-crypto/runtime-crypto-context.ts";
import {
  readHostedWebCallbackSigningEnvironment,
} from "./web-callback-auth.ts";

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
  readEncryptionEnvironment?: (
    input: { userId: string },
  ) => HostedMailboxEncryptionEnvironment | Promise<HostedMailboxEncryptionEnvironment>;
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
    ?? createHostedMailboxEncryptionEnvironmentReader({ runtime });

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

function createHostedMailboxEncryptionEnvironmentReader(input: {
  runtime: Pick<HostedRuntimeBridgeNormalizedRuntime, "platformEnv">;
}): (readerInput: { userId: string }) => Promise<HostedMailboxEncryptionEnvironment> {
  const environmentsByUserId = new Map<string, Promise<HostedMailboxEncryptionEnvironment>>();
  return ({ userId }) => {
    const existing = environmentsByUserId.get(userId);
    if (existing) {
      return existing;
    }
    const created = readHostedMailboxEncryptionEnvironmentFromRuntime({
      platformEnv: input.runtime.platformEnv,
      userId,
    });
    environmentsByUserId.set(userId, created);
    return created;
  };
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

async function readHostedMailboxEncryptionEnvironmentFromRuntime(input: {
  platformEnv: Readonly<Record<string, string>>;
  userId: string;
}): Promise<HostedMailboxEncryptionEnvironment> {
  if (Object.keys(input.platformEnv).length === 0) {
    return readHostedMailboxEncryptionEnvironment();
  }
  const workerEnv = readHostedExecutionWorkerEnvironment(input.platformEnv);
  const roots = await fetchHostedWorkerRuntimeRoots({
    baseUrl: workerEnv.hostedWebBaseUrl,
    callbackSigning: readHostedWebCallbackSigningEnvironment(input.platformEnv),
    cryptoEnv: {
      HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION:
        workerEnv.hostedCryptoAuthoritySignKeyVersion,
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
        workerEnv.hostedCryptoAuthoritySignPublicKeyPem,
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
        workerEnv.hostedCryptoCloudflareAutomationKeyId,
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK:
        workerEnv.hostedCryptoCloudflareAutomationPrivateJwk,
      HOSTED_CRYPTO_ENV: workerEnv.hostedCryptoEnv,
    } satisfies HostedWorkerCryptoEnv,
    timeoutMs: workerEnv.webControlTimeoutMs,
    userId: input.userId,
  });
  return createHostedMailboxEncryptionEnvironmentFromIngressRoot({
    rootKey: roots.ingress.rootKey,
    rootKeyId: roots.ingress.envelope.rootKeyId,
  });
}

function createHostedWorkspaceBridgeMailboxImporter(input: {
  readEncryptionEnvironment: (
    input: { userId: string },
  ) => HostedMailboxEncryptionEnvironment | Promise<HostedMailboxEncryptionEnvironment>;
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
          environment: await input.readEncryptionEnvironment({
            userId: decodeInput.itemRef.userId,
          }),
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
  readEncryptionEnvironment: (
    input: { userId: string },
  ) => HostedMailboxEncryptionEnvironment | Promise<HostedMailboxEncryptionEnvironment>;
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
    environment: await input.readEncryptionEnvironment({
      userId: input.item.item.userId,
    }),
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

function resolveWorkspaceOperatorHomeRoot(vaultRoot: string): string {
  return path.join(path.dirname(vaultRoot), `${path.basename(vaultRoot)}-operator-home`);
}

function normalizeVaultRoot(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : process.env.VAULT ?? process.cwd();
}
