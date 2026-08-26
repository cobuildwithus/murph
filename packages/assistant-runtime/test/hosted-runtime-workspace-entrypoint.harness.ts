import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, appendFile, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

import {
  addCaptureWithLookup,
  CURRENT_VAULT_FORMAT_VERSION,
  HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
  buildIntegrationEvidencePart,
  buildIntegrationIngestRecord,
  findCaptureByLookup,
  initializeVault,
  patchAutomation,
  readHabitatAspect,
  readJsonlRecords,
  repairVault,
  runCanonicalWrite,
  showAutomation,
  upsertAutomation,
  validateVault,
} from "@murphai/core";
import {
  openInboxRuntime,
  persistCanonicalInboxCapture,
  rebuildRuntimeFromVault,
} from "@murphai/inboxd";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionEnvironmentInterviewCompletedWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionRuntimeControlWake,
  deriveHostedExecutionErrorCode,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
} from "@murphai/hosted-execution/env";
import {
  HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
} from "@murphai/hosted-execution/orchestration-control";
import {
  VAULT_LAYOUT,
} from "@murphai/contracts";
import {
  appendAssistantTranscriptEntries,
  createAssistantOutboxIntent,
  ensureAutomaticMealCloseoutAutomation,
  getAssistantCronStatus,
  listAssistantTranscriptEntries,
  MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION_ID,
  listAssistantOutboxIntents,
  markAssistantOutboxIntentSentById,
  readAssistantContextSnapshotState,
  refreshAssistantContextSnapshotBestEffort,
  recordHostedMailboxAssistantInputItem,
  saveAssistantOutboxIntent,
  saveAssistantSession,
  type AssistantHostedImageGenerationLauncher,
  type RunAssistantAutomationPassInput,
} from "@murphai/assistant-engine";
import type {
  HostedCodexAssistantProcessPreparation,
  HostedCodexAssistantProcessPreparationInput,
} from "@murphai/assistant-engine/assistant-runtime";
import {
  parseAssistantSessionRecord,
} from "@murphai/operator-config/assistant-cli-contracts";
import type {
  AssistantProviderUsageDraft,
} from "@murphai/assistant-engine/assistant-ask";
import {
  readAssistantInputEvent,
  shouldGroupAdjacentAssistantInputCandidates,
  updateAssistantInputAttachmentEvidence,
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
  writeAssistantAutoReplyReplyTerminalEvidence,
} from "@murphai/assistant-engine/assistant-automation";
import {
  saveAssistantAutomationState,
  updateAssistantAutomationState,
} from "@murphai/assistant-engine/assistant-state";
import {
  resolveAssistantStatePaths,
  sha256HostedBundleHex,
  createHostedPortableWorkspaceManifestFromBundle,
  listPendingAssistantRuntimeIssueRecords,
  restoreHostedBundleRoots,
  restoreHostedExecutionContext,
  snapshotHostedPortableWorkspaceDelta,
  snapshotHostedAssistantRuntimeHotState,
  snapshotHostedBundleRoots,
  writePendingAssistantRuntimeIssueRecord,
  writeHostedBundleTextFile,
} from "@murphai/runtime-state/node";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
  readHostedRuntimeFailurePhaseCode,
  type HostedMailboxFetchRequest,
  type HostedMailboxFetchResponse,
  type HostedMailboxItem,
  type HostedMailboxPayloadFetchRequest,
  type HostedMailboxPayloadFetchResponse,
  type HostedRuntimeRedactedJson,
  type HostedRuntimeLatencyTraceRequest,
  type HostedRuntimeLogRequest,
  type HostedRuntimeAssistantConfigurationControlRequest,
  type HostedRuntimeAssistantConfigurationSnapshot,
  type HostedRuntimeAssistantConfigurationToolResponse,
  type HostedWorkspaceCheckpointRequest,
  type HostedWorkspaceCheckpointResponse,
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceInvocationRequest,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  ASSISTANT_USAGE_SCHEMA,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import {
  HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT,
  type HostedExecutionAssistantAskRequestedWake,
  type HostedBrowserVaultReplicaRef,
  type HostedExecutionBundleRef,
} from "@murphai/hosted-execution/contracts";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  buildHostedExecutionLayeredSnapshotRef,
  buildHostedExecutionWorkingSnapshotRef,
  isHostedWorkspaceSnapshotV2Ref,
  readHostedExecutionSnapshotBaseRef,
} from "@murphai/hosted-execution/parsers";
import { describe, expect, type Mock, test, vi } from "vitest";

type HasCompleteAssistantAutoReplyDeliveryTerminalEvidence = (
  input: {
    captureId?: string | null;
    inputId: string;
    vault: string;
  },
) => Promise<boolean>;

type RefreshHostedBrowserVaultReplicaFromRuntime =
  typeof import("../src/hosted-runtime/browser-vault-replica.ts")["refreshHostedBrowserVaultReplicaFromRuntime"];
type CollectHostedAssistantDeliverySideEffects =
  typeof import("../src/hosted-runtime/callbacks.ts")["collectHostedAssistantDeliverySideEffects"];
type PrepareHostedAssistantDeliveryEffectsForDispatch =
  typeof import("../src/hosted-runtime/callbacks.ts")["prepareHostedAssistantDeliveryEffectsForDispatch"];
type DrainHostedPreparedAssistantDeliveries =
  typeof import("../src/hosted-runtime/callbacks.ts")["drainHostedPreparedAssistantDeliveries"];

type HostedWorkspaceEntrypointMockName =
  | "cancelPendingWarmCodexPreinitialization"
  | "collectHostedAssistantDeliverySideEffects"
  | "createHostedWorkspaceSnapshotCheckpointRequestBuilder"
  | "drainHostedPreparedAssistantDeliveries"
  | "enqueueHostedPendingAssistantInputId"
  | "executeConsentedReadOnlyAssistantAsk"
  | "executeReadOnlyAssistantAsk"
  | "hasCompleteAssistantAutoReplyDeliveryTerminalEvidence"
  | "maintainAssistantAutoReplyRouteState"
  | "prepareHostedAssistantDeliveryEffectsForDispatch"
  | "prepareHostedCodexAssistantProcess"
  | "prepareHostedCodexRuntimeEnvironment"
  | "refreshHostedBrowserVaultReplicaFromRuntime"
  | "runAssistantAutomationPass"
  | "runHostedIdleCheckpointMaintenance"
  | "snapshotHostedPortableWorkspaceDelta"
  | "summarizeWearableSleepRuntime";

type HostedWorkspaceEntrypointMocks = {
  actualCollectHostedAssistantDeliverySideEffects:
    | CollectHostedAssistantDeliverySideEffects
    | null;
  actualDrainHostedPreparedAssistantDeliveries:
    | DrainHostedPreparedAssistantDeliveries
    | null;
  actualEnqueueHostedPendingAssistantInputId:
    | ((input: { inputId: string; vaultRoot: string }) => Promise<string[]>)
    | null;
  actualHasCompleteAssistantAutoReplyDeliveryTerminalEvidence:
    | HasCompleteAssistantAutoReplyDeliveryTerminalEvidence
    | null;
  actualPrepareHostedAssistantDeliveryEffectsForDispatch:
    | PrepareHostedAssistantDeliveryEffectsForDispatch
    | null;
  actualRefreshHostedBrowserVaultReplicaFromRuntime:
    | RefreshHostedBrowserVaultReplicaFromRuntime
    | null;
} & Record<HostedWorkspaceEntrypointMockName, Mock>;

const mocks: HostedWorkspaceEntrypointMocks = vi.hoisted(() => ({
  actualCollectHostedAssistantDeliverySideEffects:
    null as CollectHostedAssistantDeliverySideEffects | null,
  actualDrainHostedPreparedAssistantDeliveries:
    null as DrainHostedPreparedAssistantDeliveries | null,
  actualEnqueueHostedPendingAssistantInputId: null as null | ((input: {
    inputId: string;
    vaultRoot: string;
  }) => Promise<string[]>),
  actualHasCompleteAssistantAutoReplyDeliveryTerminalEvidence:
    null as HasCompleteAssistantAutoReplyDeliveryTerminalEvidence | null,
  actualRefreshHostedBrowserVaultReplicaFromRuntime:
    null as RefreshHostedBrowserVaultReplicaFromRuntime | null,
  actualPrepareHostedAssistantDeliveryEffectsForDispatch:
    null as PrepareHostedAssistantDeliveryEffectsForDispatch | null,
  collectHostedAssistantDeliverySideEffects:
    vi.fn<CollectHostedAssistantDeliverySideEffects>(),
  createHostedWorkspaceSnapshotCheckpointRequestBuilder: vi.fn(),
  drainHostedPreparedAssistantDeliveries:
    vi.fn<DrainHostedPreparedAssistantDeliveries>(),
  enqueueHostedPendingAssistantInputId: vi.fn(),
  executeConsentedReadOnlyAssistantAsk: vi.fn(),
  executeReadOnlyAssistantAsk: vi.fn(),
  hasCompleteAssistantAutoReplyDeliveryTerminalEvidence:
    vi.fn<HasCompleteAssistantAutoReplyDeliveryTerminalEvidence>(),
  maintainAssistantAutoReplyRouteState: vi.fn(async () => ({
    changed: false,
    trusted: true,
  })),
  prepareHostedCodexAssistantProcess: vi.fn<
    (
      input: HostedCodexAssistantProcessPreparationInput,
    ) => Promise<HostedCodexAssistantProcessPreparation | null>
  >(async () => null),
  prepareHostedCodexRuntimeEnvironment: vi.fn(),
  prepareHostedAssistantDeliveryEffectsForDispatch:
    vi.fn<PrepareHostedAssistantDeliveryEffectsForDispatch>(),
  refreshHostedBrowserVaultReplicaFromRuntime: vi.fn(),
  runAssistantAutomationPass: vi.fn(),
  runHostedIdleCheckpointMaintenance: vi.fn(),
  summarizeWearableSleepRuntime: vi.fn(),
  snapshotHostedPortableWorkspaceDelta: vi.fn(),
  cancelPendingWarmCodexPreinitialization: vi.fn(async () => undefined),
}));

vi.mock("../src/hosted-runtime/callbacks.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/hosted-runtime/callbacks.ts")
  >();
  mocks.actualCollectHostedAssistantDeliverySideEffects =
    actual.collectHostedAssistantDeliverySideEffects;
  mocks.actualDrainHostedPreparedAssistantDeliveries =
    actual.drainHostedPreparedAssistantDeliveries;
  mocks.actualPrepareHostedAssistantDeliveryEffectsForDispatch =
    actual.prepareHostedAssistantDeliveryEffectsForDispatch;

  return {
    ...actual,
    collectHostedAssistantDeliverySideEffects:
      mocks.collectHostedAssistantDeliverySideEffects.mockImplementation(
        actual.collectHostedAssistantDeliverySideEffects,
      ),
    drainHostedPreparedAssistantDeliveries:
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementation(
        actual.drainHostedPreparedAssistantDeliveries,
      ),
    prepareHostedAssistantDeliveryEffectsForDispatch:
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockImplementation(
        actual.prepareHostedAssistantDeliveryEffectsForDispatch,
      ),
  };
});

vi.mock("../src/hosted-runtime/pending-input-index.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/hosted-runtime/pending-input-index.ts")
  >();
  mocks.actualEnqueueHostedPendingAssistantInputId =
    actual.enqueueHostedPendingAssistantInputId;

  return {
    ...actual,
    enqueueHostedPendingAssistantInputId:
      mocks.enqueueHostedPendingAssistantInputId.mockImplementation(
        actual.enqueueHostedPendingAssistantInputId,
      ),
  };
});

vi.mock("@murphai/assistant-engine/assistant-ask", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@murphai/assistant-engine/assistant-ask")
  >();

  return {
    ...actual,
    executeConsentedReadOnlyAssistantAsk:
      mocks.executeConsentedReadOnlyAssistantAsk.mockImplementation(
        actual.executeConsentedReadOnlyAssistantAsk,
      ),
    executeReadOnlyAssistantAsk:
      mocks.executeReadOnlyAssistantAsk.mockImplementation(
        actual.executeReadOnlyAssistantAsk,
      ),
  };
});

vi.mock("@murphai/assistant-engine/assistant-automation", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@murphai/assistant-engine/assistant-automation")
  >();
  mocks.actualHasCompleteAssistantAutoReplyDeliveryTerminalEvidence =
    actual.hasCompleteAssistantAutoReplyDeliveryTerminalEvidence;

  return {
    ...actual,
    hasCompleteAssistantAutoReplyDeliveryTerminalEvidence:
      mocks.hasCompleteAssistantAutoReplyDeliveryTerminalEvidence.mockImplementation(
        actual.hasCompleteAssistantAutoReplyDeliveryTerminalEvidence,
      ),
  };
});

vi.mock("@murphai/assistant-engine/assistant-runtime-residue", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@murphai/assistant-engine/assistant-runtime-residue")
  >();
  return {
    ...actual,
    maintainAssistantAutoReplyRouteState:
      mocks.maintainAssistantAutoReplyRouteState,
  };
});

vi.mock("@murphai/assistant-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@murphai/assistant-engine")>();

  return {
    ...actual,
    runAssistantAutomationPass:
      mocks.runAssistantAutomationPass.mockImplementation(
        actual.runAssistantAutomationPass,
      ),
  };
});

vi.mock("@murphai/assistant-engine/assistant-runtime", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@murphai/assistant-engine/assistant-runtime")
  >();

  return {
    ...actual,
    prepareHostedCodexAssistantProcess:
      mocks.prepareHostedCodexAssistantProcess,
  };
});

vi.mock("@murphai/query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@murphai/query")>();

  return {
    ...actual,
    summarizeWearableSleepRuntime:
      mocks.summarizeWearableSleepRuntime.mockImplementation(
        actual.summarizeWearableSleepRuntime,
      ),
  };
});

vi.mock("@murphai/runtime-state/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@murphai/runtime-state/node")>();

  return {
    ...actual,
    snapshotHostedPortableWorkspaceDelta:
      mocks.snapshotHostedPortableWorkspaceDelta.mockImplementation(
        actual.snapshotHostedPortableWorkspaceDelta,
      ),
  };
});

vi.mock("../src/hosted-runtime/browser-vault-replica.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hosted-runtime/browser-vault-replica.ts")>();
  mocks.actualRefreshHostedBrowserVaultReplicaFromRuntime =
    actual.refreshHostedBrowserVaultReplicaFromRuntime;

  return {
    ...actual,
    refreshHostedBrowserVaultReplicaFromRuntime:
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(
        actual.refreshHostedBrowserVaultReplicaFromRuntime,
      ),
  };
});

vi.mock("../src/hosted-runtime/codex-config.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hosted-runtime/codex-config.ts")>();

  return {
    ...actual,
    prepareHostedCodexRuntimeEnvironment:
      mocks.prepareHostedCodexRuntimeEnvironment.mockImplementation(
        actual.prepareHostedCodexRuntimeEnvironment,
      ),
  };
});

vi.mock("../src/hosted-runtime/idle-maintenance.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/hosted-runtime/idle-maintenance.ts")
  >();

  return {
    ...actual,
    runHostedIdleCheckpointMaintenance:
      mocks.runHostedIdleCheckpointMaintenance.mockImplementation(
        actual.runHostedIdleCheckpointMaintenance,
      ),
  };
});

vi.mock("../src/hosted-runtime/workspace-runner.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hosted-runtime/workspace-runner.ts")>();

  return {
    ...actual,
    createHostedWorkspaceSnapshotCheckpointRequestBuilder:
      mocks.createHostedWorkspaceSnapshotCheckpointRequestBuilder.mockImplementation(
        actual.createHostedWorkspaceSnapshotCheckpointRequestBuilder,
      ),
  };
});

import {
  createCoalescingRuntimeWakeSignal,
  HostedRuntimeCheckpointInterruptedByWakeError,
  HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError,
  HostedWorkspaceRunnerUserMismatchError,
  drainHostedRuntimeDeferredUsageCompletionsBestEffort,
  parseHostedAssistantWorkspaceRuntimeJobInput,
  runHostedWorkspaceRuntimeJobInProcess,
  type HostedWorkspaceRuntimeJobOptions,
  type HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
} from "../src/hosted-runtime.ts";
import {
  runHostedWorkspaceAssistantPhase,
} from "../src/hosted-runtime/workspace-assistant-phase.ts";
import {
  prepareHostedWakeContext,
} from "../src/hosted-runtime/context.ts";
import {
  importHostedConversationMailboxItem,
} from "../src/hosted-runtime/mailbox-conversation-import.ts";
import {
  createHostedWorkspaceRuntimeBridgeJobOptions,
  type HostedWorkspaceSnapshotArchiveBuilder,
} from "../src/hosted-runtime/snapshot-bridge.ts";
import {
  HostedRuntimeBridgeCheckpointLeaseError,
} from "../src/hosted-runtime/checkpoint-bridge.ts";
import {
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES,
  hostedCanonicalWriteReceiptRecoveryStatusFields,
  readHostedCanonicalWriteReceiptRecoveryWake,
} from "../src/hosted-runtime/canonical-write-receipt-log.ts";
import type {
  RuntimeWakeSignal,
} from "../src/hosted-runtime/runtime-wake.ts";
import {
  collectHostedPendingAssistantInputMediaRetentionProtections,
  compactHostedPendingAssistantInputIds,
  enqueueHostedPendingAssistantInputId,
  ensureHostedPendingAssistantInputIndex,
  inspectHostedPendingAssistantInputWakeCandidate,
  readHostedPendingAssistantInputIds,
} from "../src/hosted-runtime/pending-input-index.ts";
import {
  drainHostedRuntimeLogWritesBestEffort,
} from "../src/hosted-runtime/runtime-logs.ts";
import {
  markHostedWorkspaceLiveRuntimeStateDirtyForSnapshotRefBestEffort,
  restoreHostedWorkspaceRuntimeJobWorkspace,
  writeHostedWorkspaceCleanCheckpointMarkerBestEffort,
} from "../src/hosted-runtime/workspace-restore.ts";
import {
  recordHostedMaterializedArtifactPaths,
  resolveHostedMaterializedArtifactStateRelativePath,
} from "../src/hosted-runtime/materialized-artifact-state.ts";
import {
  createHostedAssistantTurnEnvironment,
  normalizeHostedAssistantRuntimeConfig,
} from "../src/hosted-runtime/environment.ts";
import {
  createEmptyHostedMailboxImportState,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
  HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH,
  readHostedMailboxImportState,
  writeHostedMailboxImportState,
  type HostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";
import type {
  HostedMailboxResolvedImportItem,
} from "../src/hosted-runtime/mailbox-import.ts";
import {
  resolveHostedPendingAssistantInputWakeAt,
} from "../src/hosted-runtime/pending-assistant-input.ts";
import {
  createHostedAssistantInputSource,
  selectHostedAssistantInputIds,
} from "../src/hosted-runtime/turn-input.ts";
import {
  readHostedProviderCleanupCheckpoint,
  recordHostedProviderCleanupBeforeCommit,
} from "../src/hosted-runtime/provider-cleanup.ts";
import {
  enqueueHostedSystemMailboxItem,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  readHostedSystemMailboxState,
  updateHostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  createHostedWorkspaceBridgeMailboxImporter,
} from "../src/hosted-runtime/snapshot-bridge-mailbox.ts";
import {
  HostedRuntimeArtifactReadError,
  type HostedRuntimeDeviceSyncPort,
  type HostedRuntimeMailboxPort,
  type HostedRuntimePlatform,
  type RuntimeLivenessPort,
  type HostedRuntimeWorkspacePort,
  type HostedRuntimeWorkspaceSnapshotPort,
} from "../src/hosted-runtime-contracts.ts";
import type {
  HostedAssistantRuntimeResolvedConfig,
  HostedAssistantWorkspaceRuntimeJobInput,
} from "../src/hosted-runtime/models.ts";

const TEST_NOW = "2026-04-27T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_workspace_entrypoint";
const REAL_SET_TIMEOUT = globalThis.setTimeout.bind(globalThis);
const REAL_CLEAR_TIMEOUT = globalThis.clearTimeout.bind(globalThis);
const TEST_HOSTED_CODEX_FORWARDED_ENV = {
  HOSTED_ASSISTANT_MODEL: "gpt-synthetic",
  HOSTED_ASSISTANT_PROVIDER: "openai",
  OPENAI_API_KEY: "test-vercel-key",
} as const;
const HOSTED_CONTAINER_CA_ENV_KEYS = [
  "CODEX_CA_CERTIFICATE",
  "CURL_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "SSL_CERT_FILE",
] as const;
const HOSTED_UNSTABLE_PROCESS_ENV_KEYS = [
  "TEMP",
  "TMP",
  "TMPDIR",
] as const;
const execFileAsync = promisify(execFile);

process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS ??= "0";

function continueRuntimeLiveness(): Awaited<ReturnType<RuntimeLivenessPort["touch"]>> {
  return {
    instruction: { kind: "continue" },
    ok: true,
  };
}

async function readCheckpointConversationWatermark(
  input: HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
  vaultRoot: string,
): Promise<string> {
  if ("state" in input && input.state) {
    return input.state.watermarks.conversation;
  }

  return (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation;
}

async function describeCheckpointConversationWatermarkTransition(
  input: HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
  vaultRoot: string,
): Promise<string> {
  if ("state" in input && input.state && "previousState" in input && input.previousState) {
    return `${input.previousState.watermarks.conversation}->${input.state.watermarks.conversation}`;
  }

  return `idle->${await readCheckpointConversationWatermark(input, vaultRoot)}`;
}

interface CapturedHostedExecutionLog {
  component?: unknown;
  details?: Record<string, unknown>;
  message?: unknown;
  userId?: unknown;
}

function readCapturedHostedExecutionLogs(spy: {
  mock: { calls: unknown[][] };
}): CapturedHostedExecutionLog[] {
  return spy.mock.calls.flatMap(([payload]) => {
    if (typeof payload !== "string") {
      return [];
    }

    try {
      return [JSON.parse(payload) as CapturedHostedExecutionLog];
    } catch {
      return [];
    }
  });
}

function readCapturedRuntimePhaseLogs(input: {
  attemptId: string;
  spy: { mock: { calls: unknown[][] } };
}): Array<CapturedHostedExecutionLog & {
  component: "runtime";
  details: Record<string, unknown>;
  message: string;
  userId: null;
}> {
  return readCapturedHostedExecutionLogs(input.spy)
    .filter((entry): entry is CapturedHostedExecutionLog & {
      component: "runtime";
      details: Record<string, unknown>;
      message: string;
      userId: null;
    } =>
      entry.component === "runtime"
      && entry.message === "Hosted workspace runtime phase boundary."
      && entry.userId === null
      && entry.details?.attemptId === input.attemptId
    );
}



interface OpenAiHttpsProbeResult {
  body?: string;
  caConfigured: boolean;
  code?: string | null;
  message?: string;
  name?: string;
  ok: boolean;
  status?: number;
}

async function createOpenAiProbeCertificateFiles(root: string): Promise<{
  caCertPath: string;
  serverCertPath: string;
  serverKeyPath: string;
}> {
  await mkdir(root, { recursive: true });
  const caConfigPath = path.join(root, "openssl-ca.cnf");
  const serverConfigPath = path.join(root, "openssl-server.cnf");
  const caCertPath = path.join(root, "test-ca.crt");
  const caKeyPath = path.join(root, "test-ca.key");
  const serverCertPath = path.join(root, "api-openai-com.crt");
  const serverKeyPath = path.join(root, "api-openai-com.key");
  const serverCsrPath = path.join(root, "api-openai-com.csr");

  await writeFile(caConfigPath, [
    "[req]",
    "distinguished_name = req_distinguished_name",
    "prompt = no",
    "x509_extensions = v3_ca",
    "",
    "[req_distinguished_name]",
    "CN = Murph Hosted Runtime Test CA",
    "",
    "[v3_ca]",
    "basicConstraints = critical,CA:TRUE",
    "keyUsage = critical,keyCertSign,cRLSign",
    "subjectKeyIdentifier = hash",
    "authorityKeyIdentifier = keyid:always,issuer",
    "",
  ].join("\n"));
  await writeFile(serverConfigPath, [
    "[req]",
    "distinguished_name = req_distinguished_name",
    "req_extensions = v3_req",
    "prompt = no",
    "",
    "[req_distinguished_name]",
    "CN = api.openai.com",
    "",
    "[v3_req]",
    "basicConstraints = CA:FALSE",
    "keyUsage = digitalSignature,keyEncipherment",
    "extendedKeyUsage = serverAuth",
    "subjectAltName = @alt_names",
    "",
    "[alt_names]",
    "DNS.1 = api.openai.com",
    "IP.1 = 127.0.0.1",
    "",
  ].join("\n"));

  await execFileAsync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-sha256",
    "-config",
    caConfigPath,
    "-keyout",
    caKeyPath,
    "-out",
    caCertPath,
  ], { cwd: root });
  await execFileAsync("openssl", [
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-config",
    serverConfigPath,
    "-keyout",
    serverKeyPath,
    "-out",
    serverCsrPath,
  ], { cwd: root });
  await execFileAsync("openssl", [
    "x509",
    "-req",
    "-in",
    serverCsrPath,
    "-CA",
    caCertPath,
    "-CAkey",
    caKeyPath,
    "-CAcreateserial",
    "-out",
    serverCertPath,
    "-days",
    "1",
    "-sha256",
    "-extensions",
    "v3_req",
    "-extfile",
    serverConfigPath,
  ], { cwd: root });

  return {
    caCertPath,
    serverCertPath,
    serverKeyPath,
  };
}

async function startOpenAiProbeServer(input: {
  serverCertPath: string;
  serverKeyPath: string;
}): Promise<{
  close: () => Promise<void>;
  port: number;
}> {
  const server = createHttpsServer({
    cert: await readFile(input.serverCertPath),
    key: await readFile(input.serverKeyPath),
  }, (request, response) => {
    if (
      request.method === "POST"
      && request.url === "/v1/responses"
      && request.headers.authorization === "Bearer __cloudflare_injected__"
    ) {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }

    response.writeHead(401, { "content-type": "text/plain" });
    response.end("unexpected probe request");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    port: (address as AddressInfo).port,
  };
}

async function runOpenAiHttpsProbe(input: {
  runtimeEnv: Readonly<Record<string, string>>;
  url: string;
}): Promise<OpenAiHttpsProbeResult> {
  const childEnv: NodeJS.ProcessEnv = {
    ...input.runtimeEnv,
    TARGET_URL: input.url,
  };
  const child = spawn(process.execPath, ["-e", OPENAI_HTTPS_PROBE_SCRIPT], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
  const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
  assert.equal(exitCode, 0, stderr);

  try {
    return JSON.parse(stdout) as OpenAiHttpsProbeResult;
  } catch (error) {
    throw new Error(`OpenAI HTTPS probe did not emit JSON: ${stdout}`, {
      cause: error,
    });
  }
}

const OPENAI_HTTPS_PROBE_SCRIPT = `
const { readFileSync } = require("node:fs");
const https = require("node:https");

const targetUrl = process.env.TARGET_URL;
const caPath = process.env.CODEX_CA_CERTIFICATE || process.env.SSL_CERT_FILE || null;
const caConfigured = Boolean(
  process.env.CODEX_CA_CERTIFICATE
  || process.env.CURL_CA_BUNDLE
  || process.env.NODE_EXTRA_CA_CERTS
  || process.env.REQUESTS_CA_BUNDLE
  || process.env.SSL_CERT_FILE
);
const options = {
  headers: {
    authorization: "Bearer " + (process.env.OPENAI_API_KEY || ""),
    "content-type": "application/json",
  },
  lookup(hostname, lookupOptions, callback) {
    if (lookupOptions && lookupOptions.all) {
      callback(null, [{ address: "127.0.0.1", family: 4 }]);
      return;
    }
    callback(null, "127.0.0.1", 4);
  },
  method: "POST",
  servername: "api.openai.com",
  ...(caPath ? { ca: readFileSync(caPath) } : {}),
};

const request = https.request(targetUrl, options, (response) => {
  const chunks = [];
  response.on("data", (chunk) => chunks.push(chunk));
  response.on("end", () => {
    process.stdout.write(JSON.stringify({
      body: Buffer.concat(chunks).toString("utf8"),
      caConfigured,
      ok: true,
      status: response.statusCode,
    }));
  });
});
request.setTimeout(2_000, () => {
  request.destroy(Object.assign(new Error("OpenAI HTTPS probe timed out."), {
    code: "PROBE_TIMEOUT",
  }));
});
request.on("error", (error) => {
  process.stdout.write(JSON.stringify({
    caConfigured,
    code: error.code || null,
    message: error.message,
    name: error.name,
    ok: false,
  }));
});
request.end(JSON.stringify({
  input: "ping",
  model: "gpt-synthetic",
}));
`;

function createPlatform(input: {
  assistantAskPort?: HostedRuntimePlatform["assistantAskPort"] | null;
  assistantConfigurationToolPort?: HostedRuntimePlatform["assistantConfigurationToolPort"] | null;
  artifactBytesByHash?: ReadonlyMap<string, Uint8Array>;
  artifactGetCalls?: string[];
  artifactLabelsByHash?: ReadonlyMap<string, string>;
  artifactPutCalls?: Array<{ byteLength: number; sha256: string }>;
  browserVaultReplicaPort?: HostedRuntimePlatform["browserVaultReplicaPort"] | null;
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  events?: string[];
  groupToolPort?: HostedRuntimePlatform["groupToolPort"] | null;
  latencyTraceRequests?: HostedRuntimeLatencyTraceRequest[];
  logRequests?: HostedRuntimeLogRequest[];
  issueExportPort?: HostedRuntimePlatform["issueExportPort"] | null;
  mailboxPort: HostedRuntimeMailboxPort | null;
  phoneCalls?: HostedRuntimePlatform["phoneCalls"] | null;
  runtimeLivenessIntervalMs?: number | null;
  runtimeLivenessPort?: RuntimeLivenessPort | null;
  runtimeLivenessRequired?: boolean | null;
  stageSamples?: StageTimingSample[];
  vaultSharePort?: HostedRuntimePlatform["vaultSharePort"] | null;
  workspacePort: HostedRuntimeWorkspacePort | null;
  workspaceSnapshotPort?: HostedRuntimePlatform["workspaceSnapshotPort"] | null;
}): HostedRuntimePlatform {
  const uploadedArtifactBytesByHash = new Map<string, Uint8Array>();
  const defaultAssistantConfigurationToolPort: NonNullable<
    HostedRuntimePlatform["assistantConfigurationToolPort"]
  > = {
    async request(request) {
      const snapshot: HostedRuntimeAssistantConfigurationSnapshot = {
        availableModels: ["gpt-5.6-luna", "gpt-5.6-terra"],
        availableProviders: ["openai", "venice"],
        availableReasoningEfforts: ["low", "medium", "high", "xhigh"],
        configurationAvailable: true,
        dormantSolPreference: false,
        model: "gpt-5.6-terra",
        provider: "openai",
        reasoningEffort: "low",
        solAvailable: false,
      };
      return request.action === "read"
        ? { action: "read", result: { ...snapshot } }
        : {
            action: "update",
            result: {
              ...snapshot,
              appliesAt: "next_turn",
              requiredPlan: null,
              status: "unchanged",
            },
          };
    },
  };
  const assistantConfigurationToolPort:
    HostedRuntimePlatform["assistantConfigurationToolPort"] =
    input.assistantConfigurationToolPort === null
      ? null
      : input.assistantConfigurationToolPort
        ?? defaultAssistantConfigurationToolPort;
  return {
    ...(input.assistantAskPort ? { assistantAskPort: input.assistantAskPort } : {}),
    ...(assistantConfigurationToolPort
      ? { assistantConfigurationToolPort }
      : {}),
    ...(input.browserVaultReplicaPort
      ? { browserVaultReplicaPort: input.browserVaultReplicaPort }
      : {}),
    artifactStore: {
      async get(sha256) {
        return await measureStage(input.stageSamples, "artifact.get", async () => {
          input.artifactGetCalls?.push(sha256);
          input.events?.push(`artifact.get:${readArtifactEventLabel(input.artifactLabelsByHash, sha256)}`);
          return input.artifactBytesByHash?.get(sha256)
            ?? uploadedArtifactBytesByHash.get(sha256)
            ?? null;
        });
      },
      async put(artifact) {
        await measureStage(input.stageSamples, "artifact.put", async () => {
          const storedBytes = new Uint8Array(artifact.bytes.byteLength);
          storedBytes.set(artifact.bytes);
          uploadedArtifactBytesByHash.set(artifact.sha256, storedBytes);
          if (input.artifactBytesByHash instanceof Map) {
            input.artifactBytesByHash.set(artifact.sha256, storedBytes);
          }
          input.artifactPutCalls?.push({
            byteLength: artifact.bytes.byteLength,
            sha256: artifact.sha256,
          });
          input.events?.push(
            `artifact.put:${readArtifactEventLabel(input.artifactLabelsByHash, artifact.sha256)}`,
          );
        });
        return undefined;
      },
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {
        return undefined;
      },
    },
    ...(input.deviceSyncPort ? { deviceSyncPort: input.deviceSyncPort } : {}),
    ...(input.groupToolPort ? { groupToolPort: input.groupToolPort } : {}),
    ...(input.logRequests
      ? {
          logPort: {
            async write(request: HostedRuntimeLogRequest) {
              await measureStage(input.stageSamples, "runtime.log.write", async () => {
                input.logRequests?.push(request);
                for (const entry of request.entries) {
                  input.events?.push(`runtime.log:${entry.eventCode}`);
                }
              });
              return { loggedCount: request.entries.length };
            },
          },
        }
      : {}),
    ...(input.latencyTraceRequests
      ? {
          latencyTracePort: {
            async record(request: HostedRuntimeLatencyTraceRequest) {
              input.latencyTraceRequests?.push(request);
              return {
                matchedCount: 1,
                recorded: true,
                unmatchedCount: 0,
              };
            },
          },
        }
      : {}),
    ...(input.issueExportPort ? { issueExportPort: input.issueExportPort } : {}),
    ...(input.mailboxPort ? { mailboxPort: input.mailboxPort } : {}),
    ...(input.phoneCalls ? { phoneCalls: input.phoneCalls } : {}),
    ...(input.runtimeLivenessIntervalMs
      ? { runtimeLivenessIntervalMs: input.runtimeLivenessIntervalMs }
      : {}),
    ...(input.runtimeLivenessPort ? { runtimeLivenessPort: input.runtimeLivenessPort } : {}),
    ...(input.runtimeLivenessRequired !== undefined
      ? { runtimeLivenessRequired: input.runtimeLivenessRequired }
      : {}),
    ...(input.vaultSharePort ? { vaultSharePort: input.vaultSharePort } : {}),
    ...(input.workspacePort ? { workspacePort: input.workspacePort } : {}),
    ...(input.workspaceSnapshotPort ? { workspaceSnapshotPort: input.workspaceSnapshotPort } : {}),
  };
}

interface StageTimingSample {
  elapsedMs: number;
  stage: string;
}

interface StageTimingSummary {
  count: number;
  elapsedMs: number;
}

async function measureStage<T>(
  samples: StageTimingSample[] | undefined,
  stage: string,
  run: () => Promise<T> | T,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await run();
  } finally {
    samples?.push({
      elapsedMs: Math.max(0, performance.now() - startedAt),
      stage,
    });
  }
}

function summarizeStageTimings(
  samples: readonly StageTimingSample[],
): Record<string, StageTimingSummary> {
  return samples.reduce<Record<string, StageTimingSummary>>((summary, sample) => {
    const existing = summary[sample.stage] ?? {
      count: 0,
      elapsedMs: 0,
    };
    summary[sample.stage] = {
      count: existing.count + 1,
      elapsedMs: existing.elapsedMs + sample.elapsedMs,
    };
    return summary;
  }, {});
}

function readArtifactEventLabel(
  labelsByHash: ReadonlyMap<string, string> | undefined,
  sha256: string,
): string {
  return labelsByHash?.get(sha256) ?? "unlabeled-artifact";
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function listHostedCanonicalWriteReceiptLogArtifacts(
  artifacts: ReadonlyMap<string, Uint8Array>,
): Array<{ entries: unknown[]; sha256: string }> {
  const logs: Array<{ entries: unknown[]; sha256: string }> = [];
  for (const [sha256, bytes] of artifacts) {
    const parsed = parseJsonArtifact(bytes);
    if (
      !isPlainJsonObject(parsed)
      || parsed.schema !== "murph.hosted-canonical-write-receipt-log.v1"
      || !Array.isArray(parsed.entries)
    ) {
      continue;
    }
    logs.push({
      entries: parsed.entries,
      sha256,
    });
  }
  return logs;
}

function parseJsonArtifact(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return null;
  }
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireEventIndex(events: readonly string[], event: string): number {
  const index = events.indexOf(event);
  assert.notEqual(index, -1, `Expected event ${event} among ${events.length} recorded events.`);
  return index;
}

function readConversationImportedSeq(request: HostedMailboxFetchRequest | undefined): string | null {
  return request?.lanes.find((lane) => lane.lane === "conversation")?.importedSeq ?? null;
}

function readConversationImportedSeqs(
  requests: readonly HostedMailboxFetchRequest[],
): string[] {
  return requests.flatMap((request) => {
    const seq = readConversationImportedSeq(request);
    return seq === null ? [] : [seq];
  });
}

function createMailboxImportStateBundle(input: HostedMailboxImportState): {
  bytes: Uint8Array;
  hash: string;
} {
  const bytes = writeMailboxImportStateToBundle(null, input);

  return {
    bytes,
    hash: sha256HostedBundleHex(bytes),
  };
}

async function createVaultSnapshotBundle(input: {
  key: string;
  vaultRoot: string;
}): Promise<{
  bytes: Uint8Array;
  hash: string;
  snapshotRef: HostedExecutionBundleRef;
}> {
  const bytes = await snapshotHostedBundleRoots({
    kind: "vault",
    roots: [
      {
        root: input.vaultRoot,
        rootKey: "vault",
      },
    ],
  });
  if (!bytes) {
    throw new Error("Vault snapshot bundle was not created.");
  }
  const hash = sha256HostedBundleHex(bytes);

  return {
    bytes,
    hash,
    snapshotRef: createBundleRef({
      hash,
      key: input.key,
      size: bytes.byteLength,
    }),
  };
}

function writeMailboxImportStateToBundle(
  bytes: Uint8Array | null,
  input: HostedMailboxImportState,
): Uint8Array {
  return writeHostedBundleTextFile({
    bytes,
    kind: "vault",
    path: HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH,
    root: "vault",
    text: JSON.stringify({
      schema: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
      schemaVersion: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
      value: input,
    }),
  });
}

async function writeMailboxImportStateFile(
  vaultRoot: string,
  input: HostedMailboxImportState,
): Promise<void> {
  const statePath = path.join(vaultRoot, HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH);
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify({
      schema: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
      schemaVersion: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
      value: input,
    }),
  );
}

function createMailboxPort(input: {
  consumedSeqByLane?: HostedMailboxFetchResponse["consumedSeqByLane"];
  events: string[];
  fetchRequests?: HostedMailboxFetchRequest[];
  items: HostedMailboxItem[];
  stageSamples?: StageTimingSample[];
}): HostedRuntimeMailboxPort {
  return {
    async fetch(request: HostedMailboxFetchRequest): Promise<HostedMailboxFetchResponse> {
      return await measureStage(input.stageSamples, "mailbox.fetch", async () => {
        input.events.push("mailbox.fetch");
        input.fetchRequests?.push(request);
        return {
          ...(input.consumedSeqByLane === undefined
            ? {}
            : { consumedSeqByLane: input.consumedSeqByLane }),
          fetchedAt: TEST_NOW,
          items: request.lanes.flatMap((lane) => {
            const importedSeq = BigInt(lane.importedSeq);
            return input.items
              .filter((item) =>
                lane.lane === item.lane && BigInt(item.laneSeq) > importedSeq
              )
              .slice(0, request.limitPerLane);
          }),
          maxSeqByLane: request.lanes.map((lane) => ({
            lane: lane.lane,
            maxSeq: input.items
              .filter((item) => item.lane === lane.lane)
              .reduce((maxSeq, item) =>
                BigInt(item.laneSeq) > BigInt(maxSeq) ? item.laneSeq : maxSeq,
              lane.importedSeq),
          })),
          userId: TEST_USER_ID,
        };
      });
    },
    async fetchPayload(
      request: HostedMailboxPayloadFetchRequest,
    ): Promise<HostedMailboxPayloadFetchResponse> {
      return await measureStage(input.stageSamples, "mailbox.fetchPayload", async () => ({
        fetchedAt: TEST_NOW,
        payload: {
          createdAt: TEST_NOW,
          mailboxItemId: request.mailboxItemId,
          payloadCiphertext: "ciphertext_synthetic_sidecar",
          payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
          userId: TEST_USER_ID,
        },
      }));
    },
  };
}

function createWorkspacePort(input: {
  checkpointRequests: HostedWorkspaceCheckpointRequest[];
  checkpointResponse?: (
    request: HostedWorkspaceCheckpointRequest,
  ) => HostedWorkspaceCheckpointResponse;
  checkpointWorkspace?: (request: HostedWorkspaceCheckpointRequest) => HostedWorkspaceState;
  events: string[];
  stageSamples?: StageTimingSample[];
  workspace: HostedWorkspaceState | null;
}): HostedRuntimeWorkspacePort {
  return {
    async read(): Promise<HostedWorkspaceReadResponse> {
      return await measureStage(input.stageSamples, "workspace.read", async () => {
        input.events.push("workspace.read");
        return {
          fetchedAt: TEST_NOW,
          workspace: input.workspace,
        };
      });
    },
    async checkpoint(request): Promise<HostedWorkspaceCheckpointResponse> {
      return await measureStage(input.stageSamples, "workspace.checkpoint", async () => {
        input.events.push("workspace.checkpoint");
        input.checkpointRequests.push(request);
        if (input.checkpointResponse) {
          return input.checkpointResponse(request);
        }
        return {
          checkpointed: true,
          workspace: input.checkpointWorkspace
            ? input.checkpointWorkspace(request)
            : createWorkspaceState({
                inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
                nextWakeAt: request.nextWakeAt ?? null,
                nextWakeReason: request.nextWakeReason ?? null,
                redactedStatus: request.redactedStatus ?? null,
                snapshotRef: request.snapshotRef,
                version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
              }),
        };
      });
    },
  };
}

function createSaturatedCanonicalReceiptLogArtifacts(): {
  artifactBytesByHash: Map<string, Uint8Array>;
  receiptHash: string;
  receiptLogBytes: Buffer;
  receiptLogHash: string;
} {
  const receiptBytes = Buffer.from(`${JSON.stringify({
    actions: [],
    committedAt: TEST_NOW,
    createdAt: TEST_NOW,
    occurredAt: TEST_NOW,
    operationId: "op_saturated_receipt_log_restore",
    operationType: "hosted_canonical_write_test",
    schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
    summary: "Restore a saturated hosted canonical receipt log.",
    updatedAt: TEST_NOW,
  }, null, 2)}\n`, "utf8");
  const receiptHash = sha256Hex(receiptBytes);
  const receiptLogBytes = Buffer.from(`${JSON.stringify({
    entries: Array.from(
      { length: HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES },
      () => ({
        byteSize: receiptBytes.byteLength,
        sha256: receiptHash,
      }),
    ),
    schema: "murph.hosted-canonical-write-receipt-log.v1",
  }, null, 2)}\n`, "utf8");
  const receiptLogHash = sha256Hex(receiptLogBytes);
  return {
    artifactBytesByHash: new Map<string, Uint8Array>([
      [receiptHash, receiptBytes],
      [receiptLogHash, receiptLogBytes],
    ]),
    receiptHash,
    receiptLogBytes,
    receiptLogHash,
  };
}

function createMailboxItem(overrides: Partial<HostedMailboxItem> = {}): HostedMailboxItem {
  return {
    createdAt: TEST_NOW,
    dedupeKey: `dedupe_${overrides.id ?? "mailbox_item_entrypoint_001"}`,
    expiresAt: null,
    id: "mailbox_item_entrypoint_001",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: "1",
    occurredAt: TEST_NOW,
    payloadBytes: 128,
    payloadInlineCiphertext: "ciphertext_synthetic_inline",
    payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
    ...overrides,
  };
}

async function stageAssistantInputEventForMailboxItem(input: {
  causalSeq?: string;
  channel?: "linq" | "telegram";
  item: HostedMailboxItem;
  lane?: "conversation" | "system";
  sessionId?: string;
  threadId?: string;
  threadIsDirect?: boolean;
  vaultRoot: string;
}): Promise<string> {
  const channel = input.channel ?? "linq";
  const text = "entrypoint hosted mailbox input";
  const threadId = input.threadId ?? "thread_1";
  const staged = await upsertAssistantInputEvent({
    event: {
      content: {
        text,
        transcriptText: text,
        userMessageContent: [
          {
            text,
            type: "text" as const,
          },
        ],
      },
      conversation: {
        accountId: "acct_1",
        actorId: "actor_1",
        actorIsSelf: false,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        source: channel,
        threadId,
        threadIsDirect: input.threadIsDirect ?? true,
      },
      occurredAt: input.item.occurredAt,
      receivedAt: input.item.createdAt,
      replyTarget: {
        channel,
        messageId: `msg_${input.item.id}`,
        threadId,
      },
      ...(channel === "linq" && input.threadIsDirect === false
        ? {
            sourceMetadata: {
              externalThreadRouteAuthorityPresent: true,
              kind: "linq" as const,
              partCount: 1,
              reactionEligible: true,
              replyToMessageId: null,
              service: "imessage",
            },
          }
        : {}),
      sourceRef: {
        ...(input.causalSeq ? { causalSeq: input.causalSeq } : {}),
        dedupeKey: input.item.dedupeKey,
        eventId: input.item.dedupeKey,
        itemId: input.item.id,
        kind: "hosted-mailbox" as const,
        lane: input.lane ?? "conversation",
        laneSeq: input.item.laneSeq,
        payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        payloadSource: input.item.payloadInlineCiphertext ? "inline" as const : "sidecar" as const,
        source: "hosted-mailbox" as const,
        wakeSchema: "murph.hosted-execution-wake.v1",
      },
    },
    vault: input.vaultRoot,
  });

  return staged.inputId;
}

async function stagePendingLinqAssistantInputForMailboxItem(input: {
  causalSeq?: string;
  item: HostedMailboxItem;
  sessionId?: string;
  threadId?: string;
  threadIsDirect?: boolean;
  vaultRoot: string;
}): Promise<string> {
  const inputId = await stageAssistantInputEventForMailboxItem(input);
  await updateAssistantInputProjection({
    inputId,
    projection: {
      status: "pending",
    },
    vault: input.vaultRoot,
  });
  await updateAssistantAutomationState(input.vaultRoot, (state) => ({
    ...state,
    autoReply: [{
      channel: "linq",
      eligibleAfter: null,
      enabledAt: TEST_NOW,
    }],
    updatedAt: TEST_NOW,
  }));
  await enqueueHostedPendingAssistantInputId({
    inputId,
    vaultRoot: input.vaultRoot,
  });
  return inputId;
}

async function stagePendingHostedImageCompletionInputForMailboxItem(input: {
  item: HostedMailboxItem;
  vaultRoot: string;
}): Promise<string> {
  const originAssistantInputId = await stageAssistantInputEventForMailboxItem({
    item: createMailboxItem({
      id: `${input.item.id}_origin`,
      laneSeq: "2",
    }),
    sessionId: "asst_assistant_carry_mask_image_retry",
    threadId: "thread_assistant_carry_mask_image_retry",
    threadIsDirect: false,
    vaultRoot: input.vaultRoot,
  });
  const text = [
    "System note: synthetic trusted hosted image completion.",
    `<hosted_image_result>${JSON.stringify({
      originAssistantInputId,
      originAssistantInputIdExact: true,
      status: "failed",
    })}</hosted_image_result>`,
  ].join("\n");
  const staged = await upsertAssistantInputEvent({
    event: {
      content: {
        text,
        transcriptText: text,
        userMessageContent: [{ text, type: "text" as const }],
      },
      conversation: {
        accountId: "acct_1",
        actorId: null,
        actorIsSelf: false,
        sessionId: "asst_assistant_carry_mask_image_retry",
        source: "linq",
        threadId: "thread_assistant_carry_mask_image_retry",
        threadIsDirect: false,
      },
      occurredAt: input.item.occurredAt,
      receivedAt: input.item.createdAt,
      replyTarget: {
        channel: "linq",
        messageId: `msg_${input.item.id}`,
        threadId: "thread_assistant_carry_mask_image_retry",
      },
      sourceMetadata: {
        externalThreadRouteAuthorityPresent: true,
        kind: "linq" as const,
        partCount: 1,
        reactionEligible: false,
        replyToMessageId: null,
        service: "iMessage",
      },
      sourceRef: {
        dedupeKey: input.item.dedupeKey,
        eventId: input.item.dedupeKey,
        itemId: input.item.id,
        kind: "hosted-mailbox" as const,
        lane: "system" as const,
        laneSeq: "image-completion:assistant-carry-mask-retry",
        payloadSchema: "murph.hosted-image-completion.v1",
        payloadSource: "inline" as const,
        source: "hosted-mailbox" as const,
        wakeSchema: "murph.hosted-image-completion.v1",
      },
    },
    vault: input.vaultRoot,
  });
  await updateAssistantInputProjection({
    inputId: staged.inputId,
    projection: { status: "pending" },
    vault: input.vaultRoot,
  });
  await enqueueHostedPendingAssistantInputId({
    inputId: staged.inputId,
    vaultRoot: input.vaultRoot,
  });
  return staged.inputId;
}

async function writeSyntheticAssistantAutoReplyTerminalEvidence(input: {
  inputId: string;
  vaultRoot: string;
}): Promise<void> {
  const directory = path.join(
    resolveAssistantStatePaths(input.vaultRoot).assistantStateRoot,
    "auto-reply",
    "evidence",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${encodeURIComponent(input.inputId)}.json`),
    `${JSON.stringify({
      captureId: input.inputId,
      groupCaptureIds: [input.inputId],
      groupId: `group_${input.inputId}`,
      groupInputIds: [input.inputId],
      inputId: input.inputId,
      primaryCaptureId: input.inputId,
      primaryInputId: input.inputId,
      providerCleanup: {
        linqMessageIds: [],
        queuedAt: null,
      },
      recordedAt: TEST_NOW,
      schema: "murph.assistant-auto-reply-terminal-evidence.v1",
      terminal: {
        kind: "suppressed",
        reason: "synthetic-entrypoint-test",
      },
    }, null, 2)}\n`,
    "utf8",
  );
}

async function ensureHostedBootstrapMetadataForSystemMailboxTest(
  vaultRoot: string,
): Promise<void> {
  const metadataPath = path.join(vaultRoot, VAULT_LAYOUT.metadata);
  await mkdir(path.dirname(metadataPath), { recursive: true });
  try {
    await stat(metadataPath);
  } catch {
    await writeFile(
      metadataPath,
      `${JSON.stringify({
        createdAt: TEST_NOW,
        formatVersion: CURRENT_VAULT_FORMAT_VERSION,
        timezone: "UTC",
        title: "Synthetic hosted workspace",
        vaultId: `vault_${"0".repeat(26)}`,
      }, null, 2)}\n`,
      "utf8",
    );
  }
}

async function importRuntimeControlSystemMailboxItemForTest(input: {
  item: HostedMailboxItem;
  vaultRoot: string;
}) {
  return await enqueueHostedSystemMailboxItem({
    item: createResolvedRuntimeControlSystemMailboxItem(input.item),
    vaultRoot: input.vaultRoot,
    wake: buildHostedExecutionRuntimeControlWake({
      eventId: input.item.dedupeKey,
      kind: "runtime.manual-requested",
      occurredAt: input.item.occurredAt,
      userId: TEST_USER_ID,
    }),
  });
}

function createAssistantAskRequestedWake(input: {
  eventId: string;
}): HostedExecutionAssistantAskRequestedWake {
  return {
    ask: {
      expiresAt: "2026-04-27T00:10:00.000Z",
      originAssistantInputId: `ain_${"b".repeat(32)}`,
      originSessionId: "session_private",
      question: "What is today's group workout?",
      target: {
        kind: "joined_group",
        membershipId: "membership_synthetic_entrypoint_ask",
        requestedLabel: "100 Club",
      },
    },
    eventId: input.eventId,
    kind: "assistant.ask.requested",
    occurredAt: TEST_NOW,
    userId: TEST_USER_ID,
  };
}

function createConsentedMemberAssistantAskRequestedWake(input: {
  eventId: string;
}): HostedExecutionAssistantAskRequestedWake {
  return {
    ask: {
      expiresAt: "2026-04-27T00:10:00.000Z",
      origin: {
        assistantInputId: `ain_${"c".repeat(32)}`,
        kind: "accepted_input",
        sessionId: "session_group",
      },
      question: "What is this member's shoulder-safe workout?",
      target: {
        grantId: "grant_synthetic_entrypoint_ask",
        kind: "consented_member",
        membershipId: "membership_synthetic_entrypoint_ask",
        permissionDigest: "e".repeat(64),
      },
    },
    eventId: input.eventId,
    kind: "assistant.ask.requested",
    occurredAt: TEST_NOW,
    userId: TEST_USER_ID,
  };
}

function createPrivateCurrentSenderAssistantAskRequestedWake(input: {
  eventId: string;
}): HostedExecutionAssistantAskRequestedWake {
  return {
    ask: {
      expiresAt: "2026-04-27T00:10:00.000Z",
      origin: {
        assistantInputId: `ain_${"d".repeat(32)}`,
        kind: "accepted_input",
        sessionId: "session_group_private_completion",
      },
      question: "What is my shoulder-safe workout?",
      resultDestination: {
        channel: "linq",
        kind: "requester_direct",
      },
      target: {
        groupRuntimeMemberId: "member_group_runtime",
        kind: "current_sender_personal",
        permissionDigest: "f".repeat(64),
      },
    },
    eventId: input.eventId,
    kind: "assistant.ask.requested",
    occurredAt: TEST_NOW,
    userId: TEST_USER_ID,
  };
}

function createResolvedRuntimeControlSystemMailboxItem(
  item: HostedMailboxItem,
): HostedMailboxResolvedImportItem {
  return {
    item,
    payload: {
      payloadCiphertext: "ciphertext",
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      requestId: "request_entrypoint_runtime_control_pending_retry",
      source: "inline",
      status: "resolved",
    },
    route: {
      action: "apply-runtime-control-request",
      advanceProgress: true,
      itemRef: {
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
      },
      state: "route",
    },
  };
}

function createResolvedDeviceSyncSystemMailboxItem(
  item: HostedMailboxItem,
): HostedMailboxResolvedImportItem {
  return {
    item,
    payload: {
      payloadCiphertext: "ciphertext",
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      requestId: "request_entrypoint_device_sync_wake",
      source: "inline",
      status: "resolved",
    },
    route: {
      action: "run-device-sync-wake",
      advanceProgress: true,
      itemRef: {
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
      },
      state: "route",
    },
  };
}

function createDeviceSyncSystemWakeForMailboxItem(
  item: HostedMailboxItem,
): Parameters<typeof enqueueHostedSystemMailboxItem>[0]["wake"] {
  return {
    eventId: item.dedupeKey,
    kind: "device-sync.wake",
    occurredAt: item.occurredAt,
    reason: "reconcile_due",
    userId: item.userId,
  };
}

async function enqueueDeviceSyncSystemMailboxItemForTest(input: {
  item: HostedMailboxItem;
  vaultRoot: string;
}) {
  return await enqueueHostedSystemMailboxItem({
    item: createResolvedDeviceSyncSystemMailboxItem(input.item),
    vaultRoot: input.vaultRoot,
    wake: createDeviceSyncSystemWakeForMailboxItem(input.item),
  });
}

async function enqueueEnvironmentInterviewSystemMailboxItemForTest(input: {
  item: HostedMailboxItem;
  vaultRoot: string;
}) {
  return await enqueueHostedSystemMailboxItem({
    item: {
      item: input.item,
      payload: {
        payloadCiphertext: "ciphertext",
        payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        requestId: "request_entrypoint_environment_interview",
        source: "inline",
        status: "resolved",
      },
      route: {
        action: "run-environment-interview",
        advanceProgress: true,
        itemRef: {
          id: input.item.id,
          kind: input.item.kind,
          lane: input.item.lane,
          laneSeq: input.item.laneSeq,
        },
        state: "route",
      },
    },
    vaultRoot: input.vaultRoot,
    wake: buildHostedExecutionEnvironmentInterviewCompletedWake({
      completedAt: input.item.occurredAt,
      completionId: "550e8400-e29b-41d4-a716-446655440000",
      eventId: input.item.dedupeKey,
      memberId: TEST_USER_ID,
      occurredAt: input.item.occurredAt,
      topics: [{
        answers: [{
          aspectId: "sleep-environment",
          indicatorId: "night_temp_c",
          note: "The bedroom stays near 19 degrees at night.",
          value: 19,
        }],
        topicId: "sleep:0",
      }],
    }),
  });
}

function createResolvedPendingEffectsSystemMailboxItem(
  item: HostedMailboxItem,
): HostedMailboxResolvedImportItem {
  return {
    item,
    payload: {
      payloadCiphertext: "ciphertext",
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      requestId: "request_entrypoint_pending_effects_wake",
      source: "inline",
      status: "resolved",
    },
    route: {
      action: "apply-runtime-control-request",
      advanceProgress: true,
      itemRef: {
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
      },
      state: "route",
    },
  };
}

async function enqueuePendingEffectsSystemMailboxItemForTest(input: {
  effectId: string;
  item: HostedMailboxItem;
  vaultRoot: string;
}) {
  return await enqueueHostedSystemMailboxItem({
    item: createResolvedPendingEffectsSystemMailboxItem(input.item),
    vaultRoot: input.vaultRoot,
    wake: {
      effectId: input.effectId,
      eventId: input.item.dedupeKey,
      kind: "runtime.pending-effects-reconcile-requested",
      occurredAt: input.item.occurredAt,
      userId: input.item.userId,
    },
  });
}

function createResolvedAssistantAskSystemMailboxItem(
  item: HostedMailboxItem,
): HostedMailboxResolvedImportItem {
  return {
    item,
    payload: {
      payloadCiphertext: "ciphertext",
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      requestId: "request_entrypoint_detached_assistant_ask",
      source: "inline",
      status: "resolved",
    },
    route: {
      action: "run-assistant-ask",
      advanceProgress: true,
      itemRef: {
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
      },
      state: "route",
    },
  };
}

function createWorkspaceRunRequest(
  overrides: Partial<HostedWorkspaceInvocationRequest> = {},
): HostedWorkspaceInvocationRequest {
  return {
    attemptId: "attempt_synthetic_workspace_run",
    idleCheckpointDelayMs: 1,
    leaseGeneration: "1",
    userId: TEST_USER_ID,
    workspaceVersion: "0",
    ...overrides,
  };
}

function createWorkspaceRuntimeJobInput(input: {
  commitTimeoutMs?: number | null;
  forwardedEnv?: Readonly<Record<string, string>>;
  platformEnv?: Readonly<Record<string, string>>;
  resolvedConfig?: HostedAssistantRuntimeResolvedConfig;
  request?: Partial<HostedWorkspaceInvocationRequest>;
} = {}): HostedAssistantWorkspaceRuntimeJobInput {
  return {
    request: createWorkspaceRunRequest(input.request),
    runtime: {
      ...(input.commitTimeoutMs === undefined ? {} : { commitTimeoutMs: input.commitTimeoutMs }),
      forwardedEnv: {
        ...TEST_HOSTED_CODEX_FORWARDED_ENV,
        ...(input.forwardedEnv ?? {}),
      },
      ...(input.platformEnv === undefined
        ? {}
        : { platformEnv: input.platformEnv }),
      ...(input.resolvedConfig === undefined ? {} : { resolvedConfig: input.resolvedConfig }),
    },
  };
}

function createWorkspaceState(overrides: Partial<HostedWorkspaceState> = {}): HostedWorkspaceState {
  return {
    checkpointedAt: TEST_NOW,
    createdAt: TEST_NOW,
    inboxMediaRetentionWakeAt: null,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatus: null,
    snapshotRef: null,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
    version: "0",
    ...overrides,
  };
}

function createAssistantUsageRecord(
  overrides: Partial<AssistantUsageRecord> = {},
): AssistantUsageRecord {
  return {
    apiKeyEnv: null,
    attemptCount: 1,
    baseUrl: null,
    cacheWriteTokens: null,
    cachedInputTokens: null,
    credentialSource: "platform",
    featureKey: null,
    gatewayTags: [],
    inputTokens: 10,
    memberId: TEST_USER_ID,
    occurredAt: TEST_NOW,
    outputTokens: 5,
    provider: "codex-cli",
    providerName: "OpenAI",
    providerRequestId: null,
    providerRequestOutcome: "succeeded",
    providerRequestOrdinal: 0,
    rawUsageJson: null,
    rawUsageJsonHash: null,
    reasoningTokens: null,
    reportingUserId: null,
    requestedModel: "gpt-5.6-terra",
    routeId: "primary",
    schema: ASSISTANT_USAGE_SCHEMA,
    servedModel: "gpt-5.6-terra",
    sessionId: "asst_entrypoint_usage",
    stripeMeterSource: "murph",
    surface: null,
    tokenPricingBasis: "standard",
    totalTokens: 15,
    triggerKind: null,
    turnId: "turn_entrypoint_usage",
    turnProfileJson: null,
    usageExtractionSourcePath: null,
    usageExtractionVersion: "codex-usage-v1",
    usageId: "turn_entrypoint_usage.attempt-1",
    ...overrides,
  };
}

function createAssistantProviderUsageDraft(
  overrides: Partial<AssistantProviderUsageDraft> = {},
): AssistantProviderUsageDraft {
  return {
    provider: "codex-cli",
    providerRequestOrdinal: 0,
    providerRequestOutcome: "succeeded",
    usage: {
      apiKeyEnv: null,
      baseUrl: null,
      cacheWriteTokens: null,
      cachedInputTokens: null,
      inputTokens: 10,
      outputTokens: 5,
      providerMetadataJson: null,
      providerName: "OpenAI",
      providerRequestId: null,
      rawUsageJson: null,
      reasoningTokens: null,
      requestedModel: "gpt-synthetic",
      servedModel: "gpt-synthetic",
      tokenPricingBasis: "standard",
      totalTokens: 15,
      turnProfileJson: null,
      usageExtractionSourcePath: "test.detached-assistant-ask",
      usageExtractionVersion: "test-v1",
    },
    ...overrides,
    occurredAt: overrides.occurredAt ?? TEST_NOW,
  };
}

function createDeviceSyncResolvedConfig(): HostedAssistantRuntimeResolvedConfig {
  return {
    channelCapabilities: {
      emailSendReady: false,
      telegramBotConfigured: false,
    },
    deviceSync: {
      providerConfigs: {
        whoop: {
          baseUrl: "https://whoop.example.test",
          clientId: "synthetic-whoop-client",
          clientSecret: "synthetic-whoop-secret",
        },
      },
      publicBaseUrl: "https://device-sync.example.test",
      secret: "synthetic-device-sync-secret",
    },
  };
}

function createSnapshotDeviceSyncPort(input: {
  connectionId: string;
  nextReconcileAt: string;
  onApplyUpdates?: (() => Promise<void> | void) | null;
  onFetchSnapshot?: ((signal: AbortSignal | null) => Promise<void> | void) | null;
}): HostedRuntimeDeviceSyncPort & {
  readonly applyUpdatesCalls: number;
  readonly fetchSnapshotCalls: number;
} {
  let applyUpdatesCalls = 0;
  let fetchSnapshotCalls = 0;
  return {
    async ackDirtyStateProcessed() {
      throw new Error("Device sync dirty ack should not run in this e2e.");
    },
    async applyUpdates(request) {
      applyUpdatesCalls += 1;
      await input.onApplyUpdates?.();
      return {
        appliedAt: request.occurredAt ?? new Date().toISOString(),
        updates: [],
        userId: TEST_USER_ID,
      };
    },
    get applyUpdatesCalls() {
      return applyUpdatesCalls;
    },
    async createConnectLink() {
      throw new Error("Device sync connect link should not run in this e2e.");
    },
    async fetchDirtyStates() {
      return {
        hasMore: false,
        items: [],
        nextWakeAt: null,
        userId: TEST_USER_ID,
      };
    },
    async fetchSnapshot(request) {
      fetchSnapshotCalls += 1;
      await input.onFetchSnapshot?.(request?.signal ?? null);
      return {
        connections: [
          {
            connection: {
              accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
              connectedAt: TEST_NOW,
              createdAt: TEST_NOW,
              displayName: "Synthetic WHOOP",
              externalAccountId: "synthetic-whoop-account",
              id: input.connectionId,
              metadata: {},
              provider: "whoop",
              scopes: ["offline", "read:recovery", "read:sleep", "read:workout"],
              status: "active",
              updatedAt: TEST_NOW,
            },
            credential: {
              kind: "oauth_tokens",
              tokenBundle: {
                accessToken: "synthetic-access-token",
                accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
                keyVersion: "synthetic-key-version",
                refreshToken: "synthetic-refresh-token",
                tokenVersion: 1,
              },
            },
            localState: {
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSyncCompletedAt: null,
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
              lastWebhookAt: null,
              nextReconcileAt: input.nextReconcileAt,
            },
          },
        ],
        generatedAt: TEST_NOW,
        userId: TEST_USER_ID,
      };
    },
    get fetchSnapshotCalls() {
      return fetchSnapshotCalls;
    },
  };
}

function createEmptyDeviceSyncPort(): HostedRuntimeDeviceSyncPort & {
  readonly fetchDirtyStatesCalls: number;
  readonly fetchSnapshotCalls: number;
} {
  let fetchDirtyStatesCalls = 0;
  let fetchSnapshotCalls = 0;
  return {
    async ackDirtyStateProcessed() {
      throw new Error("Device sync dirty ack should not run in this e2e.");
    },
    async applyUpdates(request) {
      assert.deepEqual(request.updates, []);
      return {
        appliedAt: request.occurredAt ?? new Date().toISOString(),
        updates: [],
        userId: TEST_USER_ID,
      };
    },
    async createConnectLink() {
      throw new Error("Device sync connect link should not run in this e2e.");
    },
    async fetchDirtyStates() {
      fetchDirtyStatesCalls += 1;
      return {
        hasMore: false,
        items: [],
        nextWakeAt: null,
        userId: TEST_USER_ID,
      };
    },
    async fetchSnapshot() {
      fetchSnapshotCalls += 1;
      return {
        connections: [],
        generatedAt: TEST_NOW,
        userId: TEST_USER_ID,
      };
    },
    get fetchDirtyStatesCalls() {
      return fetchDirtyStatesCalls;
    },
    get fetchSnapshotCalls() {
      return fetchSnapshotCalls;
    },
  };
}

async function assertPrivateDirectoryMode(directoryPath: string): Promise<void> {
  const directoryMode = (await stat(directoryPath)).mode & 0o777;
  assert.equal(directoryMode, 0o700);
}

function createBundleRef(input: {
  hash: string;
  key: string;
  size: number;
}): HostedExecutionBundleRef {
  return {
    hash: input.hash,
    key: input.key,
    size: input.size,
    updatedAt: TEST_NOW,
  };
}

function createBrowserVaultReplicaRef(replica: unknown): HostedBrowserVaultReplicaRef {
  assert.ok(isPlainJsonObject(replica));
  assert.ok(isPlainJsonObject(replica.source));
  assert.ok(typeof replica.generatedAt === "string");
  assert.ok(typeof replica.generation === "number");
  assert.ok(typeof replica.source.dataVersion === "string");
  assert.ok(typeof replica.source.sourceBundleHash === "string");
  const byteLength = new TextEncoder().encode(JSON.stringify(replica)).byteLength;

  return {
    byteLength,
    dataVersion: replica.source.dataVersion,
    generatedAt: replica.generatedAt,
    generation: replica.generation,
    keyId: `browser-vault-replica:${replica.source.dataVersion.slice(0, 12)}`,
    objectKey: `users/browser-vault-replicas/member-synthetic/${replica.source.dataVersion}.json`,
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:synthetic-root",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash: replica.source.sourceBundleHash,
  };
}

function createWorkspaceSnapshotV2Ref(snapshotId: string): HostedWorkspaceSnapshotV2Ref {
  const objectKey = `users/${TEST_USER_ID}/workspace-snapshots/${snapshotId}.snapshot.enc`;
  return {
    archive: {
      compression: HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
      encryptedByteSize: 1,
      encryptedObjectSha256: "1".repeat(64),
      fileCount: 1,
      format: "tar",
      plaintextArchiveSha256: "2".repeat(64),
      totalPlainBytes: 1,
    },
    createdAt: TEST_NOW,
    encryption: {
      aad: {
        objectKey,
        purpose: HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE,
        schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
        snapshotId,
        userId: TEST_USER_ID,
      },
      ivBase64: "AAAAAAAAAAAAAAAA",
      rootKeyId: "synthetic-root-key",
      scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
      wrappedDataKey: "synthetic-wrapped-data-key",
    },
    objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
    snapshotId,
    upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
    userId: TEST_USER_ID,
  };
}

async function createImageFailureCodexAppServerCommand(input: {
  freshInputText: string;
  newestFreshInputText: string;
  referenceImageRef: string;
  root: string;
}): Promise<string> {
  const commandPath = path.join(
    input.root,
    "synthetic-image-failure-codex.py",
  );
  const acknowledgement =
    "I'm editing that image now. I'll send the result back here when it's ready.";
  const failureExplanation =
    "OpenAI couldn't read the reference image, so the edit didn't complete. I can retry after you confirm, or you can send a different reference.";
  const commandSource = `#!/usr/bin/python3
import json
import sys

thread_id = "00000000-0000-4000-8000-000000001216"
pending_tool_call = None
turn_ordinal = 0

def send(message):
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\\n")
    sys.stdout.flush()

def finish_turn(turn_id, message):
    send({
        "method": "item/completed",
        "params": {
            "completedAtMs": 1,
            "item": {
                "id": "assistant-image-failure-" + str(turn_ordinal),
                "memoryCitation": None,
                "phase": "final_answer",
                "text": message,
                "type": "agentMessage",
            },
            "threadId": thread_id,
            "turnId": turn_id,
        },
    })
    send({
        "method": "turn/completed",
        "params": {
            "threadId": thread_id,
            "turn": {
                "completedAt": 1,
                "durationMs": 1,
                "error": None,
                "id": turn_id,
                "items": [],
                "itemsView": "full",
                "startedAt": 0,
                "status": "completed",
            },
        },
    })

for line in sys.stdin:
    try:
        request = json.loads(line)
    except json.JSONDecodeError:
        sys.exit(1)

    method = request.get("method")
    if method == "initialize":
        send({"id": request.get("id"), "result": {}})
        continue
    if method == "initialized":
        continue
    if method in ("thread/start", "thread/resume"):
        params = request.get("params") or {}
        sandbox = params.get("sandbox")
        if sandbox == "danger-full-access":
            sandbox = {"type": "dangerFullAccess"}
        elif sandbox == "read-only":
            sandbox = {"type": "readOnly"}
        elif sandbox == "workspace-write":
            sandbox = {"type": "workspaceWrite"}
        send({
            "id": request.get("id"),
            "result": {
                "activePermissionProfile": (
                    {"id": params.get("permissions")}
                    if params.get("permissions")
                    else None
                ),
                "approvalPolicy": params.get("approvalPolicy"),
                "cwd": params.get("cwd"),
                "modelProvider": params.get("modelProvider"),
                "runtimeWorkspaceRoots": params.get("runtimeWorkspaceRoots"),
                "sandbox": sandbox,
                "thread": {"id": params.get("threadId", thread_id)},
            },
        })
        continue
    if method == "turn/start":
        turn_ordinal += 1
        if turn_ordinal > 2:
            sys.exit(3)
        turn_id = "turn-image-failure-" + str(turn_ordinal)
        send({"id": request.get("id"), "result": {"turn": {"id": turn_id}}})
        send({
            "method": "turn/started",
            "params": {
                "threadId": thread_id,
                "turn": {
                    "completedAt": None,
                    "durationMs": None,
                    "error": None,
                    "id": turn_id,
                    "items": [],
                    "itemsView": "full",
                    "startedAt": 0,
                    "status": "inProgress",
                },
            },
        })
        params = request.get("params") or {}
        serialized_input = json.dumps(params.get("input", params))
        completion_index = serialized_input.find("The reference image could not be decoded.")
        if completion_index >= 0:
            fresh_index = serialized_input.find(${JSON.stringify(input.freshInputText)})
            newest_fresh_index = serialized_input.find(${JSON.stringify(input.newestFreshInputText)})
            if fresh_index <= completion_index or newest_fresh_index <= fresh_index:
                sys.exit(4)
            finish_turn(turn_id, ${JSON.stringify(failureExplanation)})
            continue
        pending_tool_call = {"id": 1001, "turnId": turn_id}
        send({
            "id": pending_tool_call["id"],
            "method": "item/tool/call",
            "params": {
                "arguments": {
                    "prompt": "Edit image 1 so the subject faces left.",
                    "referenceImageRefs": [${JSON.stringify(input.referenceImageRef)}],
                },
                "callId": "image-failure-call-" + str(turn_ordinal),
                "namespace": "murph",
                "threadId": thread_id,
                "tool": "generate_image",
                "turnId": turn_id,
            },
        })
        continue
    if pending_tool_call and request.get("id") == pending_tool_call["id"]:
        turn_id = pending_tool_call["turnId"]
        pending_tool_call = None
        serialized_result = json.dumps(request)
        message = (
            ${JSON.stringify(acknowledgement)}
            if "image generation started in the background" in serialized_result
            else "Synthetic image tool launch was unavailable."
        )
        finish_turn(turn_id, message)
        continue
    if "id" in request:
        send({"id": request["id"], "result": {}})
`;
  await writeFile(commandPath, commandSource, "utf8");
  await chmod(commandPath, 0o755);
  return commandPath;
}

async function removeTempRoot(root: string): Promise<void> {
  await rm(root, {
    force: true,
    maxRetries: 3,
    recursive: true,
    retryDelay: 50,
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

function withRealTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  describeFailure: () => string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = REAL_SET_TIMEOUT(() => {
      reject(new Error(describeFailure()));
    }, timeoutMs);
    promise.then(
      (value) => {
        REAL_CLEAR_TIMEOUT(timeout);
        resolve(value);
      },
      (error) => {
        REAL_CLEAR_TIMEOUT(timeout);
        reject(error);
      },
    );
  });
}

async function waitForFakeTimerScheduled(describeFailure: () => string): Promise<void> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 5_000) {
    if (vi.getTimerCount() > 0) {
      return;
    }
    await Promise.resolve();
    await new Promise((resolve) => REAL_SET_TIMEOUT(resolve, 5));
  }

  throw new Error(describeFailure());
}

async function waitUntil(assertion: () => void, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for assertion.");
}

export {
  HOSTED_CONTAINER_CA_ENV_KEYS,
  HOSTED_UNSTABLE_PROCESS_ENV_KEYS,
  OPENAI_HTTPS_PROBE_SCRIPT,
  REAL_CLEAR_TIMEOUT,
  REAL_SET_TIMEOUT,
  TEST_HOSTED_CODEX_FORWARDED_ENV,
  TEST_NOW,
  TEST_USER_ID,
  assertPrivateDirectoryMode,
  continueRuntimeLiveness,
  createAssistantAskRequestedWake,
  createAssistantProviderUsageDraft,
  createAssistantUsageRecord,
  createBrowserVaultReplicaRef,
  createBundleRef,
  createConsentedMemberAssistantAskRequestedWake,
  createDeferred,
  createDeviceSyncResolvedConfig,
  createDeviceSyncSystemWakeForMailboxItem,
  createEmptyDeviceSyncPort,
  createImageFailureCodexAppServerCommand,
  createMailboxImportStateBundle,
  createMailboxItem,
  createMailboxPort,
  createOpenAiProbeCertificateFiles,
  createPlatform,
  createPrivateCurrentSenderAssistantAskRequestedWake,
  createResolvedAssistantAskSystemMailboxItem,
  createResolvedDeviceSyncSystemMailboxItem,
  createResolvedPendingEffectsSystemMailboxItem,
  createResolvedRuntimeControlSystemMailboxItem,
  createSaturatedCanonicalReceiptLogArtifacts,
  createSnapshotDeviceSyncPort,
  createVaultSnapshotBundle,
  createWorkspacePort,
  createWorkspaceRunRequest,
  createWorkspaceRuntimeJobInput,
  createWorkspaceSnapshotV2Ref,
  createWorkspaceState,
  describeCheckpointConversationWatermarkTransition,
  enqueueDeviceSyncSystemMailboxItemForTest,
  enqueueEnvironmentInterviewSystemMailboxItemForTest,
  enqueuePendingEffectsSystemMailboxItemForTest,
  ensureHostedBootstrapMetadataForSystemMailboxTest,
  execFileAsync,
  importRuntimeControlSystemMailboxItemForTest,
  isPlainJsonObject,
  listHostedCanonicalWriteReceiptLogArtifacts,
  measureStage,
  mocks,
  parseJsonArtifact,
  readArtifactEventLabel,
  readCapturedHostedExecutionLogs,
  readCapturedRuntimePhaseLogs,
  readCheckpointConversationWatermark,
  readConversationImportedSeq,
  readConversationImportedSeqs,
  removeTempRoot,
  requireEventIndex,
  runOpenAiHttpsProbe,
  sha256Hex,
  stageAssistantInputEventForMailboxItem,
  stagePendingHostedImageCompletionInputForMailboxItem,
  stagePendingLinqAssistantInputForMailboxItem,
  startOpenAiProbeServer,
  summarizeStageTimings,
  waitForFakeTimerScheduled,
  waitUntil,
  withRealTimeout,
  writeMailboxImportStateFile,
  writeMailboxImportStateToBundle,
  writeSyntheticAssistantAutoReplyTerminalEvidence,
};

export type {
  CapturedHostedExecutionLog,
  CollectHostedAssistantDeliverySideEffects,
  DrainHostedPreparedAssistantDeliveries,
  HasCompleteAssistantAutoReplyDeliveryTerminalEvidence,
  OpenAiHttpsProbeResult,
  PrepareHostedAssistantDeliveryEffectsForDispatch,
  RefreshHostedBrowserVaultReplicaFromRuntime,
  StageTimingSample,
  StageTimingSummary,
};
