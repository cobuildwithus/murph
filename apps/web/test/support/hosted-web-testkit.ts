export {
  HostedBillingBrowserDriver,
  type HostedBillingBrowserActor,
  type HostedBillingBrowserApiResult,
  type HostedBillingBrowserDiagnostic,
  type HostedBillingCheckoutStart,
  type HostedFamilyInviteStart,
} from "./hosted-billing-browser-driver";

export {
  issueHostedWebInviteForTest,
  readHostedBillingProjectionForTest,
  readHostedFamilyProjectionForTest,
  seedHostedBillingMemberForTest,
  waitForHostedBillingProjectionForTest,
  waitForHostedFamilyProjectionForTest,
  type HostedBillingMemberSeedForTest,
  type HostedBillingProjectionForTest,
  type HostedBillingRefSeedForTest,
  type HostedBillingStatusForTest,
  type HostedFamilyProjectionForTest,
} from "./hosted-billing-live-testkit";

export {
  cleanupHostedStripeBillingRun,
  HostedStripeBillingLiveError,
  HostedStripeBillingSandbox,
  type HostedStripeCleanupSummary,
  type HostedStripeBillingSandboxInput,
  type HostedStripeCheckoutOwnership,
  type HostedStripeResumeEventTrace,
  type HostedStripeScheduleTruth,
  type HostedStripeSubscriptionFixture,
  type HostedStripeSubscriptionTruth,
} from "./hosted-stripe-billing-live";

export {
  bindHostedActiveLinqHomeChat,
  bindHostedActiveTelegramMember,
  issueHostedAppSessionForTest,
  readHostedDeviceSyncConnectionForTest,
  readHostedLinqFirstContactMemberState,
  readHostedJunctionDeviceSyncReplayDrainStatus,
  seedHostedJunctionDeviceSyncConnection,
  seedHostedJunctionDeviceSyncReplay,
  seedHostedActiveLinqMember,
  seedHostedFamilySponsoredLinqMember,
  seedHostedLinqFirstContactFallbackLines,
  seedHostedActiveMember,
  type HostedAppSessionForTest,
  type HostedAppSessionForTestInput,
  type HostedDeviceSyncConnectionForTest,
  type HostedDeviceSyncConnectionForTestInput,
  type HostedDeviceSyncConnectionSourceForTest,
  type HostedLinqFirstContactMemberState,
  type HostedJunctionDeviceSyncConnectionSeedInput,
  type HostedJunctionDeviceSyncConnectionSeedResult,
  type HostedJunctionDeviceSyncReplayDrainStatus,
  type HostedJunctionDeviceSyncReplayDrainStatusInput,
  type HostedJunctionDeviceSyncReplaySeedInput,
  type HostedJunctionDeviceSyncReplaySeedResult,
} from "./hosted-member-seeds";

import { readdir, readFile } from "node:fs/promises";

import type { HostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/contracts";
import type { HostedExecutionSnapshotRef } from "@murphai/hosted-execution/contracts";
import type { HostedExecutionWake } from "@murphai/hosted-execution/contracts";
import type { HostedAssistantProvider } from "@murphai/hosted-execution/assistant-model";
import {
  parseHostedExecutionWake,
  parseHostedRuntimeLatencyTraceEvent,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRuntimeLatencyPhaseBreakdown,
} from "@murphai/hosted-execution/runtime-control";
import { Client } from "pg";

import { hostedRuntimeLogSubjectKey } from "@/src/lib/hosted-runtime-log/subject-key";
import { createHostedWebSmokeEnvironment } from "../../next-artifacts";
import type { HostedRuntimeTemporalSignalClient } from "../../src/lib/hosted-orchestration/temporal-client";
import type { HostedBillingStatusForTest } from "./hosted-billing-live-testkit";

const hostedRuntimeLogTestMigrationTable = "_murph_e2e_runtime_log_migration";
const hostedRuntimeLogTestMigrationsRoot = new URL(
  "../../prisma/runtime-logs/migrations/",
  import.meta.url,
);
const hostedPrismaModuleSpecifier = new URL("../../src/lib/prisma.ts", import.meta.url).href;
const hostedMailboxStoreModuleSpecifier = new URL(
  "../../src/lib/hosted-mailbox/store.ts",
  import.meta.url,
).href;
const hostedWorkspaceStoreModuleSpecifier = new URL(
  "../../src/lib/hosted-workspace/store.ts",
  import.meta.url,
).href;
const hostedThreadRouteStoreModuleSpecifier = new URL(
  "../../src/lib/hosted-routing/thread-route-store.ts",
  import.meta.url,
).href;
const hostedTemporalClientModuleSpecifier = new URL(
  "../../src/lib/hosted-orchestration/temporal-client.ts",
  import.meta.url,
).href;
const hostedSignalRuntimeModuleSpecifier = new URL(
  "../../src/lib/hosted-orchestration/signal-runtime.ts",
  import.meta.url,
).href;
const hostedAssistantModelPreferenceModuleSpecifier = new URL(
  "../../src/lib/hosted-onboarding/assistant-model-preference.ts",
  import.meta.url,
).href;
const hostedUsageCreditModuleSpecifier = new URL(
  "../../src/lib/hosted-execution/usage-credits.ts",
  import.meta.url,
).href;
const hostedComputerUseServiceModuleSpecifier = new URL(
  "../../src/lib/computer-use/service.ts",
  import.meta.url,
).href;
const hostedComputerUseStoreModuleSpecifier = new URL(
  "../../src/lib/computer-use/store.ts",
  import.meta.url,
).href;
const hostedConsentModuleSpecifier = new URL(
  "../../src/lib/legal/consent.ts",
  import.meta.url,
).href;
const hostedTestingHostOnlyEnv = {
  DOCKER_BUILDKIT: process.env.DOCKER_BUILDKIT,
  DOCKER_CONFIG: process.env.DOCKER_CONFIG,
  DOCKER_DEFAULT_PLATFORM: process.env.DOCKER_DEFAULT_PLATFORM,
};

type HostedTestPrismaClient =
  & HostedTestPrismaFactoryClient
  & HostedActionApprovalForTestPrismaClient
  & HostedPhoneCallForTestPrismaClient
  & HostedUsageLimitForTestPrismaClient
  & HostedUsageCreditForTestPrismaClient
  & HostedComputerUseForTestPrismaClient
  & HostedIngressLatencyForTestPrismaClient
  & HostedRuntimeLatencyAlertForTestPrismaClient
  & HostedLinqWorkspaceIsolationForTestPrismaClient
  & HostedWorkspaceSeedForTestPrismaClient
  & HostedVaultShareForTestPrismaClient
  & HostedUsageDiagnosticsForTestPrismaClient;

interface HostedVaultShareForTestPrismaClient {
  hostedVaultShare: {
    findFirst(args: unknown): Promise<{
      projectionSnapshotCiphertext: string | null;
    } | null>;
  };
}

interface HostedConsentForTestModule {
  recordHostedLaunchRequiredConsent(input: {
    memberId: string;
    prisma: HostedTestPrismaClient;
    scope: "launch.health-data" | "launch.legal";
    source: string;
  }): Promise<unknown>;
}

interface HostedTestPrismaFactoryClient {
  $disconnect(): Promise<void>;
  $transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T>;
  hostedMailboxItem: {
    count(args: unknown): Promise<number>;
    findUniqueOrThrow(args: unknown): Promise<{
      consumedAt: Date | null;
      dedupeKey: string;
      id: string;
      kind: string;
      lane: string;
      laneSeq: bigint;
      occurredAt: Date;
      payloadInlineCiphertext: string | null;
      payloadSchema: string | null;
      userId: string;
    }>;
  };
  hostedMember: {
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<{ id: string }>;
  };
}

interface HostedLinqWorkspaceIsolationForTestPrismaClient {
  hostedMailboxItem: {
    count(args: unknown): Promise<number>;
  };
  hostedMemberRouting: {
    findUnique(args: unknown): Promise<{
      linqChatLookupKey: string | null;
      linqHomeLineAssignedAt: Date | null;
      linqRecipientPhoneLookupKey: string | null;
      pendingLinqChatLookupKey: string | null;
    } | null>;
  };
  hostedThreadContainer: {
    findUnique(args: unknown): Promise<{ memberId: string } | null>;
  };
  hostedWorkspace: {
    findUnique(args: unknown): Promise<{ version: bigint } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

interface HostedIngressLatencyForTestPrismaClient {
  hostedIngressLatencyTrace: {
    findMany(args: unknown): Promise<Array<{
      id: string;
      linqDelivery: {
        acceptedAt: Date;
      } | null;
    }>>;
    findFirst(args: unknown): Promise<{
      id: string;
      linqDelivery: {
        acceptedAt: Date;
      } | null;
    } | null>;
    findUniqueOrThrow(args: unknown): Promise<{
      acceptedAt: Date;
      assistantInputId: string | null;
      assistantInputStagedAt: Date | null;
      mailboxImportDoneAt: Date | null;
      mailboxItemId: string;
      phaseBreakdownJson: unknown;
      providerStartAt: Date | null;
      runnerJobAcceptedAt: Date | null;
      runtimeAttemptId: string | null;
      runtimePhaseStartedAt: Date | null;
      source: string;
      workspaceRestoreDoneAt: Date | null;
    }>;
    update(args: unknown): Promise<{
      acceptedAt: Date;
      id: string;
    }>;
  };
}

interface HostedRuntimeLatencyAlertForTestPrismaClient {
  hostedLinqAlert: {
    findUnique(args: unknown): Promise<{
      lastAttemptedAt: Date | null;
      sentAt: Date | null;
    } | null>;
    update(args: unknown): Promise<{
      lastAttemptedAt: Date | null;
      sentAt: Date | null;
    }>;
  };
}

interface HostedActionApprovalForTestPrismaClient {
  hostedSensitiveActionChallenge: {
    findFirst(
      args: unknown,
    ): Promise<HostedSensitiveActionChallengeForTest | null>;
    update(args: unknown): Promise<HostedSensitiveActionChallengeForTest>;
    updateMany(args: unknown): Promise<HostedBatchPayloadForTest>;
    upsert(args: unknown): Promise<HostedSensitiveActionChallengeForTest>;
  };
}

type HostedSensitiveActionApprovalStatusForTest =
  | "approved"
  | "denied"
  | "pending";

export interface HostedSensitiveActionChallengeForTest {
  actionHash: string | null;
  actionId: string | null;
  approvalKey: string | null;
  approvalStatus: HostedSensitiveActionApprovalStatusForTest | null;
  bindingHash: string;
  consumedAt: Date | null;
  consumedBy: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  expiresAt: Date;
  kind: string;
  memberId: string;
  presentationBody: string | null;
  presentationTitle: string | null;
  returnContactKind: string | null;
  tokenHash: string;
}

interface HostedBatchPayloadForTest {
  count: number;
}

interface HostedPhoneCallForTestPrismaClient {
  hostedPhoneCall: {
    create(args: unknown): Promise<HostedPhoneCallForTest>;
    findUnique(args: unknown): Promise<HostedPhoneCallForTest | null>;
  };
}

export interface HostedPhoneCallForTest {
  analyzedAt: Date | null;
  endedAt: Date | null;
  id: string;
  memberId: string;
  originSessionId: string | null;
  providerCallId: string | null;
  requestKey: string;
  resultEncrypted: string | null;
  resultJson: unknown;
  status: "calling" | "completed" | "ended" | "failed" | "needs_user" | "starting";
}

interface HostedUsageLimitForTestPrismaClient {
  hostedAiUsagePeriod: {
    findUnique(args: unknown): Promise<HostedAiUsagePeriodForTest | null>;
    upsert(args: unknown): Promise<HostedAiUsagePeriodForTest>;
  };
  hostedLinqDelivery: {
    findMany(args: unknown): Promise<HostedLinqDeliveryForTest[]>;
  };
}

interface HostedUsageCreditForTestPrismaClient {
  hostedUsageCreditPurchase: {
    create(args: unknown): Promise<{ id: string }>;
  };
}

export interface HostedAiUsagePeriodForTest {
  blockedAt: Date | null;
  limitUsdMicros: bigint;
  memberId: string;
  periodEnd: Date;
  periodStart: Date;
  spentUsdMicros: bigint;
}

export interface HostedLinqDeliveryForTest {
  acceptedAt: Date | null;
  attemptedAt: Date;
  failedAt: Date | null;
  failureCode: string | null;
  idempotencyKey: string | null;
  sourceRef: string | null;
  status: string;
  template: string | null;
}

interface HostedComputerUseForTestPrismaClient {
  hostedComputerHandoff: {
    findFirst(args: unknown): Promise<HostedComputerHandoffForTestPrismaRow | null>;
  };
  hostedComputerRun: {
    create(args: unknown): Promise<HostedComputerRunForTestPrismaRow>;
    findUnique(args: unknown): Promise<HostedComputerRunForTestPrismaRow | null>;
  };
}

interface HostedComputerRunForTestPrismaRow {
  awaitingReason: string | null;
  completedAt: Date | null;
  expiresAt: Date;
  id: string;
  kernelSessionId: string | null;
  memberId: string;
  metadataJson: unknown;
  pausedAt: Date | null;
  pendingHandoffId: string | null;
  status: string;
  updatedAt: Date;
}

interface HostedComputerHandoffForTestPrismaRow {
  completedAt: Date | null;
  expiresAt: Date;
  id: string;
  memberId: string;
  purpose: string;
  returnContactKind: string | null;
  runId: string;
  status: string;
  suggestedReply: string | null;
  tokenHash: string;
  updatedAt: Date;
}

interface HostedComputerUseStoreForTest {
  claimHandoffForCompletion(input: {
    handoffId: string;
    memberId: string;
  }): Promise<HostedComputerHandoffForTestPrismaRow | null>;
  completeHandoff(input: {
    expectedUpdatedAt?: Date;
    handoffId: string;
    now: Date;
  }): Promise<HostedComputerHandoffForTestPrismaRow>;
  releaseHandoffClaim(input: {
    expectedUpdatedAt?: Date;
    handoffId: string;
  }): Promise<void>;
}

interface HostedComputerUseStoreModule {
  PrismaComputerUseStore: new (prisma: unknown) => HostedComputerUseStoreForTest;
}

interface HostedComputerUseServiceForTest {
  completeHandoff(input: {
    memberId: string;
    token: string;
  }): Promise<{
    returnContactKind: string | null;
    status: string;
    suggestedReply: string | null;
  }>;
}

interface HostedComputerUseServiceModule {
  ComputerUseService: new (input: {
    env: NodeJS.ProcessEnv;
    store: HostedComputerUseStoreForTest;
  }) => HostedComputerUseServiceForTest;
}

export interface HostedComputerRunForTest {
  awaitingReason: string | null;
  checkpointContext: {
    conversationId: string | null;
    recipientKey: string | null;
  } | null;
  completedAt: string | null;
  expiresAt: string;
  id: string;
  kernelSessionId: string | null;
  memberId: string;
  pausedAt: string | null;
  pendingHandoffId: string | null;
  status: string;
  updatedAt: string;
}

export interface HostedComputerHandoffForTest {
  completedAt: string | null;
  expiresAt: string;
  id: string;
  memberId: string;
  purpose: string;
  returnContactKind: string | null;
  runId: string;
  status: string;
  suggestedReply: string | null;
  tokenHash: string;
  updatedAt: string;
}

interface HostedTestPrismaModule {
  createPrismaClient(input: {
    databaseUrl: string;
    poolMax?: number;
  }): HostedTestPrismaClient;
}

interface HostedMailboxAppendForTestStoreModule {
  appendHostedMailboxEnvelopeTx(input: {
    envelope: HostedExecutionWake;
    tx: unknown;
  }): Promise<{
    duplicate: boolean;
    inserted: boolean;
    item: {
      dedupeKey: string;
      id: string;
      laneSeq: bigint | number | string;
    };
  }>;
}

interface HostedWorkspaceSeedForTestPrismaClient {
  $disconnect(): Promise<void>;
}

interface HostedUsageDiagnosticsForTestPrismaClient {
  hostedAiUsage: {
    findMany(input: {
      orderBy: Array<
        | { occurredAt: "asc" }
        | { providerRequestOrdinal: "asc" }
      >;
      take: number;
      where: {
        memberId: string;
      };
    }): Promise<HostedAiUsageForTestPrismaRow[]>;
  };
}

interface HostedWorkspaceSeedForTestStoreModule {
  checkpointHostedWorkspace(input: {
    expectedVersion: string;
    nextWakeAt?: string | null;
    nextWakeReason?: string | null;
    prisma: HostedWorkspaceSeedForTestPrismaClient;
    reason: "import";
    redactedStatusJson?: Record<string, unknown> | null;
    snapshotRef: HostedExecutionSnapshotRef;
    userId: string;
  }): Promise<{
    status: "updated" | "conflict";
    workspace: {
      version: string;
    } | null;
  }>;
  publishLatestBrowserVaultReplicaRef(input: {
    prisma: HostedWorkspaceSeedForTestPrismaClient;
    replicaRef: HostedBrowserVaultReplicaRef;
    userId: string;
  }): Promise<{
    status: "published" | "conflict" | "missing";
    workspace: {
      version: string;
    } | null;
  }>;
  ensureHostedWorkspace(input: {
    prisma: HostedWorkspaceSeedForTestPrismaClient;
    userId: string;
  }): Promise<{
    version: string;
  }>;
}

export interface HostedWebTestkitDeps {
  environment: NodeJS.ProcessEnv;
  hostedMailboxStore: HostedMailboxAppendForTestStoreModule;
  hostedWorkspaceStore: HostedWorkspaceSeedForTestStoreModule;
  prisma: HostedTestPrismaClient;
}

type HostedRuntimeTemporalTestClient = HostedRuntimeTemporalSignalClient & {
  connection?: {
    close(): Promise<void>;
  };
};

export interface HostedWebSignalTestkitDeps extends HostedWebTestkitDeps {
  temporalSignalClient: HostedRuntimeTemporalTestClient | null;
}

interface HostedTemporalClientModule {
  createHostedRuntimeTemporalSignalClient(
    source?: NodeJS.ProcessEnv,
  ): Promise<HostedRuntimeTemporalSignalClient | null>;
}

interface HostedRuntimeSignalModule {
  signalHostedManualRunRuntime(input: {
    client?: HostedRuntimeTemporalSignalClient | null;
    environment?: NodeJS.ProcessEnv;
    prisma?: HostedTestPrismaClient;
    userId: string;
  }): Promise<{
    signalAccepted: true;
    workflowId: string;
  }>;
  signalHostedMailboxAppendRuntime(input: {
    client?: HostedRuntimeTemporalSignalClient | null;
    environment?: NodeJS.ProcessEnv;
    expectedUserId?: string | null;
    mailboxItemId: string;
    prisma?: HostedTestPrismaClient;
  }): Promise<{
    signalAccepted: true;
    workflowId: string;
  }>;
  signalHostedRuntimeRecheckRuntime(input: {
    client?: HostedRuntimeTemporalSignalClient | null;
    environment?: NodeJS.ProcessEnv;
    prisma?: HostedTestPrismaClient;
    userId: string;
  }): Promise<{
    signalAccepted: true;
    workflowId: string;
  }>;
  signalHostedRetentionRuntimeRecheck(input: {
    client?: HostedRuntimeTemporalSignalClient | null;
    environment?: NodeJS.ProcessEnv;
    prisma?: HostedTestPrismaClient;
    userId: string;
  }): Promise<{
    signalAccepted: true;
    workflowId: string;
  }>;
  signalHostedRuntimeWakeRuntime(input: {
    client?: HostedRuntimeTemporalSignalClient | null;
    environment?: NodeJS.ProcessEnv;
    prisma?: HostedTestPrismaClient;
    userId: string;
  }): Promise<{
    signalAccepted: true;
    workflowId: string;
  }>;
}

interface HostedAssistantModelPreferenceModule {
  updateHostedMemberAssistantConfigurationTx(input: {
    memberId: string;
    prisma: unknown;
    provider: HostedAssistantProvider;
  }): Promise<{
    effectiveProviderUpdated: boolean;
    provider: HostedAssistantProvider;
    updated: boolean;
  }>;
}

interface HostedUsageCreditModule {
  grantHostedUsageCreditForPurchaseTx(input: {
    paidAt: Date;
    purchaseId: string;
    tx: unknown;
  }): Promise<HostedUsageCreditGrantForTest>;
}

interface HostedThreadRouteForTestModule {
  readHostedThreadRouteByThreadIdentity(input: {
    channel: "linq" | "telegram";
    prisma: HostedTestPrismaClient;
    threadId: string;
  }): Promise<{
    containerMemberId: string;
    owner: {
      id: string;
    };
  } | null>;
}

export interface HostedThreadRouteForTest {
  containerMemberId: string;
  ownerMemberId: string;
}

export interface HostedMailboxAppendForTestResponse {
  duplicate: boolean;
  inserted: boolean;
  wake: {
    eventId: string;
    id: string;
    seq: string;
  };
}

export interface HostedUsageCreditGrantForTest {
  balanceUsdMicros: bigint;
  entryId: string;
  granted: boolean;
  ledgerVersion: bigint;
}

export interface HostedMailboxItemForTest {
  consumedAt: string | null;
  dedupeKey: string;
  id: string;
  kind: string;
  lane: string;
  laneSeq: string;
}

export interface HostedLinqWorkspaceIsolationStateForTest {
  personal: {
    conversationMailboxCount: number;
    homeChatBound: boolean;
    homeLineAssigned: boolean;
    pendingChatBound: boolean;
    recipientAssigned: boolean;
    workspaceVersion: string | null;
  };
  thread: {
    containerExists: boolean;
    containerMemberId: string;
    conversationMailboxCount: number;
    ownerMemberId: string;
    workspaceVersion: string | null;
  } | null;
}

interface HostedAiUsageForTestPrismaRow {
  allowanceCounted: boolean;
  allowanceCostUsdMicros: bigint | number;
  allowancePricingSnapshotJson: unknown;
  allowancePricingVersion: string | null;
  attemptCount: number;
  cacheWriteTokens: number | null;
  cachedInputTokens: number | null;
  credentialSource: string | null;
  featureKey: string | null;
  inputTokens: number | null;
  occurredAt: Date;
  outputTokens: number | null;
  providerName: string | null;
  providerRequestOrdinal: number;
  reasoningTokens: number | null;
  requestedModel: string | null;
  servedModel: string | null;
  sessionId: string;
  surface: string | null;
  tokenPricingBasis: string;
  totalTokens: number | null;
  triggerKind: string | null;
}

export interface HostedAiUsageForTestRow {
  allowanceCounted: boolean;
  allowanceCostUsdMicros: string;
  allowancePricingSnapshotJson: unknown;
  allowancePricingVersion: string | null;
  attemptCount: number;
  cacheWriteTokens: number | null;
  cachedInputTokens: number | null;
  credentialSource: string | null;
  featureKey: string | null;
  inputTokens: number | null;
  occurredAt: string;
  outputTokens: number | null;
  providerName: string | null;
  providerRequestOrdinal: number;
  reasoningTokens: number | null;
  requestedModel: string | null;
  servedModel: string | null;
  sessionId: string;
  surface: string | null;
  tokenPricingBasis: string;
  totalTokens: number | null;
  triggerKind: string | null;
}

interface HostedRuntimeLogForTestSqlRow extends Record<string, unknown> {
  at: Date | string;
  attemptId: string | null;
  component: string;
  eventCode: string;
  level: string;
  phase: string;
  redactedJson: unknown;
}

export interface HostedRuntimeLogForTestRow {
  at: string;
  attemptId: string | null;
  component: string;
  eventCode: string;
  level: string;
  phase: string;
  redactedJson: Record<string, unknown> | null;
}

export interface HostedIngressLatencyTraceForTest {
  acceptedAt: string;
  assistantInputStagedAt: string;
  mailboxImportDoneAt: string | null;
  phaseBreakdown: HostedRuntimeLatencyPhaseBreakdown | null;
  providerStartAt: string | null;
  runnerJobAcceptedAt: string | null;
  runtimeAttemptId: string | null;
  runtimePhaseStartedAt: string | null;
  workspaceRestoreDoneAt: string | null;
}

export async function appendHostedExecutionWakeForTest(input: {
  environment?: NodeJS.ProcessEnv;
  wake: HostedExecutionWake | unknown;
}): Promise<HostedMailboxAppendForTestResponse> {
  const wake = parseHostedExecutionWake(input.wake);
  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const append = await deps.prisma.$transaction(async (tx) =>
      deps.hostedMailboxStore.appendHostedMailboxEnvelopeTx({
        envelope: wake,
        tx,
      }));
    return {
      duplicate: append.duplicate,
      inserted: append.inserted,
      wake: {
        eventId: append.item.dedupeKey,
        id: append.item.id,
        seq: append.item.laneSeq.toString(),
      },
    };
  });
}

export async function readHostedMailboxItemForTest(input: {
  dedupeKey: string;
  environment?: NodeJS.ProcessEnv;
  userId: string;
}): Promise<HostedMailboxItemForTest> {
  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const item = await deps.prisma.hostedMailboxItem.findUniqueOrThrow({
      select: {
        consumedAt: true,
        dedupeKey: true,
        id: true,
        kind: true,
        lane: true,
        laneSeq: true,
      },
      where: {
        userId_dedupeKey: {
          dedupeKey: input.dedupeKey,
          userId: input.userId,
        },
      },
    });
    return {
      consumedAt: item.consumedAt?.toISOString() ?? null,
      dedupeKey: item.dedupeKey,
      id: item.id,
      kind: item.kind,
      lane: item.lane,
      laneSeq: item.laneSeq.toString(),
    };
  });
}

export async function setLatestHostedLinqReplyLatencyForTest(input: {
  environment?: NodeJS.ProcessEnv;
  latencyMs: number;
  userId: string;
}): Promise<{
  acceptedAt: string;
  deliveryAcceptedAt: string;
  traceId: string;
}> {
  if (!Number.isSafeInteger(input.latencyMs) || input.latencyMs < 0) {
    throw new RangeError("Hosted Linq reply-latency test control requires a non-negative integer.");
  }

  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const deadlineAt = Date.now() + 30_000;
    let trace: Awaited<
      ReturnType<
        HostedIngressLatencyForTestPrismaClient["hostedIngressLatencyTrace"]["findFirst"]
      >
    > = null;
    while (Date.now() < deadlineAt) {
      trace = await deps.prisma.hostedIngressLatencyTrace.findFirst({
        orderBy: {
          acceptedAt: "desc",
        },
        select: {
          id: true,
          linqDelivery: {
            select: {
              acceptedAt: true,
            },
          },
        },
        where: {
          linqDelivery: {
            isNot: null,
          },
          source: "linq",
          userId: input.userId,
        },
      });
      if (trace?.linqDelivery) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!trace?.linqDelivery) {
      throw new Error(
        "Timed out waiting for an accepted Hosted Linq delivery trace.",
      );
    }

    const deliveryAcceptedAt = trace.linqDelivery.acceptedAt;
    const acceptedAt = new Date(deliveryAcceptedAt.getTime() - input.latencyMs);
    await deps.prisma.hostedIngressLatencyTrace.update({
      data: {
        acceptedAt,
      },
      select: {
        acceptedAt: true,
        id: true,
      },
      where: {
        id: trace.id,
      },
    });
    return {
      acceptedAt: acceptedAt.toISOString(),
      deliveryAcceptedAt: deliveryAcceptedAt.toISOString(),
      traceId: trace.id,
    };
  });
}

export async function normalizeHostedLinqLatencyTracesForTest(input: {
  environment?: NodeJS.ProcessEnv;
  userIds: readonly string[];
}): Promise<{ updatedCount: number }> {
  if (input.userIds.length === 0 || input.userIds.some((userId) => !userId.trim())) {
    throw new TypeError(
      "Hosted Linq latency normalization requires non-empty user ids.",
    );
  }

  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const traces = await deps.prisma.hostedIngressLatencyTrace.findMany({
      select: {
        id: true,
        linqDelivery: {
          select: {
            acceptedAt: true,
          },
        },
      },
      where: {
        source: "linq",
        userId: {
          in: [...new Set(input.userIds)],
        },
      },
    });
    const unresolvedAcceptedAt = new Date();
    for (const trace of traces) {
      await deps.prisma.hostedIngressLatencyTrace.update({
        data: {
          acceptedAt: trace.linqDelivery
            ? new Date(trace.linqDelivery.acceptedAt.getTime() - 1_000)
            : unresolvedAcceptedAt,
        },
        select: {
          acceptedAt: true,
          id: true,
        },
        where: {
          id: trace.id,
        },
      });
    }

    return {
      updatedCount: traces.length,
    };
  });
}

export async function ageHostedRuntimeLatencyAlertForTest(input: {
  ageMs: number;
  environment?: NodeJS.ProcessEnv;
}): Promise<{ updated: boolean }> {
  if (!Number.isSafeInteger(input.ageMs) || input.ageMs < 0) {
    throw new RangeError(
      "Hosted runtime latency alert test age requires a non-negative integer.",
    );
  }

  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const monitorId = "hosted-runtime-latency-monitor:v1";
    const state = await deps.prisma.hostedLinqAlert.findUnique({
      select: {
        lastAttemptedAt: true,
        sentAt: true,
      },
      where: {
        id: monitorId,
      },
    });
    if (!state) {
      return { updated: false };
    }

    const agedAt = new Date(Date.now() - input.ageMs);
    await deps.prisma.hostedLinqAlert.update({
      data: {
        lastAttemptedAt: state.lastAttemptedAt ? agedAt : null,
        sentAt: state.sentAt ? agedAt : null,
      },
      select: {
        lastAttemptedAt: true,
        sentAt: true,
      },
      where: {
        id: monitorId,
      },
    });
    return { updated: true };
  });
}

export async function readHostedLinqWorkspaceIsolationStateForTest(input: {
  chatId: string;
  environment?: NodeJS.ProcessEnv;
  memberId: string;
}): Promise<HostedLinqWorkspaceIsolationStateForTest> {
  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const routing = await deps.prisma.hostedMemberRouting.findUnique({
      select: {
        linqChatLookupKey: true,
        linqHomeLineAssignedAt: true,
        linqRecipientPhoneLookupKey: true,
        pendingLinqChatLookupKey: true,
      },
      where: {
        memberId: input.memberId,
      },
    });
    const personalConversationMailboxCount = await deps.prisma.hostedMailboxItem.count({
      where: {
        kind: "conversation.message",
        userId: input.memberId,
      },
    });
    const personalWorkspace = await deps.prisma.hostedWorkspace.findUnique({
      select: {
        version: true,
      },
      where: {
        userId: input.memberId,
      },
    });
    const threadRouteStore = await loadHostedThreadRouteForTestModule();
    const route = await threadRouteStore.readHostedThreadRouteByThreadIdentity({
      channel: "linq",
      prisma: deps.prisma,
      threadId: input.chatId,
    });

    let thread: HostedLinqWorkspaceIsolationStateForTest["thread"] = null;
    if (route) {
      const container = await deps.prisma.hostedThreadContainer.findUnique({
        select: {
          memberId: true,
        },
        where: {
          memberId: route.containerMemberId,
        },
      });
      const conversationMailboxCount = await deps.prisma.hostedMailboxItem.count({
        where: {
          kind: "conversation.message",
          userId: route.containerMemberId,
        },
      });
      const workspace = await deps.prisma.hostedWorkspace.findUnique({
        select: {
          version: true,
        },
        where: {
          userId: route.containerMemberId,
        },
      });
      thread = {
        containerExists: Boolean(container),
        containerMemberId: route.containerMemberId,
        conversationMailboxCount,
        ownerMemberId: route.owner.id,
        workspaceVersion: workspace?.version.toString() ?? null,
      };
    }

    return {
      personal: {
        conversationMailboxCount: personalConversationMailboxCount,
        homeChatBound: Boolean(routing?.linqChatLookupKey),
        homeLineAssigned: Boolean(routing?.linqHomeLineAssignedAt),
        pendingChatBound: Boolean(routing?.pendingLinqChatLookupKey),
        recipientAssigned: Boolean(routing?.linqRecipientPhoneLookupKey),
        workspaceVersion: personalWorkspace?.version.toString() ?? null,
      },
      thread,
    };
  });
}

export async function readHostedThreadRouteForTest(input: {
  channel: "linq" | "telegram";
  environment?: NodeJS.ProcessEnv;
  threadId: string;
}): Promise<HostedThreadRouteForTest | null> {
  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const threadRouteStore = await loadHostedThreadRouteForTestModule();
    const route = await threadRouteStore.readHostedThreadRouteByThreadIdentity({
      channel: input.channel,
      prisma: deps.prisma,
      threadId: input.threadId,
    });
    return route
      ? {
          containerMemberId: route.containerMemberId,
          ownerMemberId: route.owner.id,
        }
      : null;
  });
}

export async function seedHostedWorkspaceCheckpointForTest(input: {
  browserVaultReplicaRef: HostedBrowserVaultReplicaRef;
  environment?: NodeJS.ProcessEnv;
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  redactedStatusJson?: Record<string, unknown> | null;
  snapshotRef: HostedExecutionSnapshotRef;
  userId: string;
}): Promise<{
  status: "updated" | "conflict";
  version: string;
}> {
  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const workspace = await deps.hostedWorkspaceStore.ensureHostedWorkspace({
      prisma: deps.prisma,
      userId: input.userId,
    });
    const checkpoint = await deps.hostedWorkspaceStore.checkpointHostedWorkspace({
      expectedVersion: workspace.version,
      nextWakeAt: input.nextWakeAt ?? null,
      nextWakeReason: input.nextWakeReason ?? null,
      prisma: deps.prisma,
      reason: "import",
      redactedStatusJson: input.redactedStatusJson ?? null,
      snapshotRef: input.snapshotRef,
      userId: input.userId,
    });
    if (checkpoint.workspace) {
      await deps.hostedWorkspaceStore.publishLatestBrowserVaultReplicaRef({
        prisma: deps.prisma,
        replicaRef: input.browserVaultReplicaRef,
        userId: input.userId,
      });
    }

    return {
      status: checkpoint.status,
      version: checkpoint.workspace?.version ?? workspace.version,
    };
  });
}

export async function seedHostedLaunchConsentForTest(input: {
  environment?: NodeJS.ProcessEnv;
  memberId: string;
}): Promise<void> {
  await withHostedWebTestkitDeps(input.environment, async (deps) => {
    const consent = await import(hostedConsentModuleSpecifier) as HostedConsentForTestModule;
    for (const scope of ["launch.legal", "launch.health-data"] as const) {
      await consent.recordHostedLaunchRequiredConsent({
        memberId: input.memberId,
        prisma: deps.prisma,
        scope,
        source: "hosted-local-e2e",
      });
    }
  });
}

export async function readHostedVaultShareProjectionCiphertextForTest(input: {
  destinationMemberId: string;
  environment?: NodeJS.ProcessEnv;
  grantorMemberId: string;
  projectionKind: string;
}): Promise<string | null> {
  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const share = await deps.prisma.hostedVaultShare.findFirst({
      select: { projectionSnapshotCiphertext: true },
      where: {
        destinationMemberId: input.destinationMemberId,
        grantorMemberId: input.grantorMemberId,
        projectionKind: input.projectionKind,
        status: "granted",
      },
    });
    return share?.projectionSnapshotCiphertext ?? null;
  });
}

export async function seedHostedWorkspaceInboxMediaRetentionWakeForTest(input: {
  environment?: NodeJS.ProcessEnv;
  userId: string;
  wakeAt: Date | string;
}): Promise<void> {
  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const result = await deps.prisma.hostedWorkspace.updateMany({
      data: {
        inboxMediaRetentionWakeAt: new Date(input.wakeAt),
      },
      where: {
        userId: input.userId,
      },
    });
    if (result.count !== 1) {
      throw new Error(
        "Hosted-local retention wake seed requires exactly one existing workspace.",
      );
    }
  });
}

export async function updateHostedMemberBillingStatusForTest(input: {
  billingStatus: HostedBillingStatusForTest;
  environment?: NodeJS.ProcessEnv;
  memberId: string;
}): Promise<void> {
  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    await deps.prisma.hostedMember.update({
      data: {
        billingStatus: input.billingStatus,
      },
      where: {
        id: input.memberId,
      },
    });
  });
}

export async function readLatestHostedSensitiveActionChallengeForTest(input: {
  environment?: NodeJS.ProcessEnv;
  memberId: string;
}): Promise<HostedSensitiveActionChallengeForTest | null> {
  return withHostedWebTestkitDeps(input.environment, async (deps) =>
    await deps.prisma.hostedSensitiveActionChallenge.findFirst({
      orderBy: {
        createdAt: "desc",
      },
      where: {
        memberId: input.memberId,
      },
    })
  );
}

export async function approveHostedSensitiveActionChallengeForTest(input: {
  environment?: NodeJS.ProcessEnv;
  tokenHash: string;
}): Promise<HostedSensitiveActionChallengeForTest> {
  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const decidedAt = new Date();
    return await deps.prisma.hostedSensitiveActionChallenge.update({
      data: {
        approvalStatus: "approved",
        consumedAt: null,
        consumedBy: null,
        decidedAt,
        expiresAt: new Date(decidedAt.getTime() + 15 * 60 * 1_000),
      },
      where: {
        tokenHash: input.tokenHash,
      },
    });
  });
}

export async function listHostedAiUsageForTest(input: {
  environment?: NodeJS.ProcessEnv;
  limit?: number;
  memberId: string;
}): Promise<HostedAiUsageForTestRow[]> {
  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const rows = await deps.prisma.hostedAiUsage.findMany({
      orderBy: [
        { providerRequestOrdinal: "asc" },
        { occurredAt: "asc" },
      ],
      take: normalizeHostedTestingLimit(input.limit ?? 500),
      where: {
        memberId: input.memberId,
      },
    });

    return rows.map((row) => ({
      allowanceCounted: row.allowanceCounted,
      allowanceCostUsdMicros: row.allowanceCostUsdMicros.toString(),
      allowancePricingSnapshotJson: row.allowancePricingSnapshotJson,
      allowancePricingVersion: row.allowancePricingVersion,
      attemptCount: row.attemptCount,
      cacheWriteTokens: row.cacheWriteTokens,
      cachedInputTokens: row.cachedInputTokens,
      credentialSource: row.credentialSource,
      featureKey: row.featureKey,
      inputTokens: row.inputTokens,
      occurredAt: row.occurredAt.toISOString(),
      outputTokens: row.outputTokens,
      providerName: row.providerName,
      providerRequestOrdinal: row.providerRequestOrdinal,
      reasoningTokens: row.reasoningTokens,
      requestedModel: row.requestedModel,
      servedModel: row.servedModel,
      sessionId: row.sessionId,
      surface: row.surface,
      tokenPricingBasis: row.tokenPricingBasis,
      totalTokens: row.totalTokens,
      triggerKind: row.triggerKind,
    }));
  });
}

export async function seedHostedPhoneCallForTest(input: {
  brief: {
    allowTransferToUser?: boolean;
    callerName?: string;
    goal: string;
    instructions?: string[];
    shareableFacts?: Record<string, string>;
    successCriteria: string;
    timeZone: string;
    to: {
      label?: string;
      phoneNumber: string;
    };
  };
  environment?: NodeJS.ProcessEnv;
  id: string;
  memberId: string;
  originSessionId: string;
  providerCallId: string;
  requestKey: string;
}): Promise<HostedPhoneCallForTest> {
  return withHostedWebTestkitDeps(input.environment, async (deps) =>
    await deps.prisma.hostedPhoneCall.create({
      data: {
        briefJson: {
          allowTransferToUser: input.brief.allowTransferToUser ?? false,
          goal: input.brief.goal,
          instructions: input.brief.instructions ?? [],
          shareableFacts: input.brief.shareableFacts ?? {},
          successCriteria: input.brief.successCriteria,
          timeZone: input.brief.timeZone,
          to: {
            ...input.brief.to,
          },
          ...(input.brief.callerName
            ? { callerName: input.brief.callerName }
            : {}),
        },
        id: input.id,
        memberId: input.memberId,
        originSessionId: input.originSessionId,
        provider: "retell",
        providerCallId: input.providerCallId,
        requestKey: input.requestKey,
        status: "calling",
      },
    })
  );
}

export async function readHostedPhoneCallForTest(input: {
  environment?: NodeJS.ProcessEnv;
  id: string;
}): Promise<HostedPhoneCallForTest | null> {
  return withHostedWebTestkitDeps(input.environment, async (deps) =>
    await deps.prisma.hostedPhoneCall.findUnique({
      where: {
        id: input.id,
      },
    })
  );
}

export async function seedHostedAiUsageLimitPeriodForTest(input: {
  environment?: NodeJS.ProcessEnv;
  memberId: string;
  periodEnd: Date;
  periodStart: Date;
  remainingUsdMicros?: bigint;
}): Promise<HostedAiUsagePeriodForTest> {
  const limitUsdMicros = 10_000_000n;
  const remainingUsdMicros = input.remainingUsdMicros ?? 0n;
  if (remainingUsdMicros < 0n || remainingUsdMicros > limitUsdMicros) {
    throw new RangeError("Hosted AI usage test balance must be within the period limit.");
  }
  const spentUsdMicros = limitUsdMicros - remainingUsdMicros;
  const blockedAt = remainingUsdMicros === 0n ? input.periodStart : null;
  return withHostedWebTestkitDeps(input.environment, async (deps) =>
    await deps.prisma.hostedAiUsagePeriod.upsert({
      create: {
        billingPlanCode: "launch_monthly",
        blockedAt,
        lastUsageAt: input.periodStart,
        limitUsdMicros,
        memberId: input.memberId,
        periodEnd: input.periodEnd,
        periodStart: input.periodStart,
        spentUsdMicros,
      },
      update: {
        billingPlanCode: "launch_monthly",
        blockedAt,
        lastUsageAt: input.periodStart,
        limitUsdMicros,
        periodEnd: input.periodEnd,
        spentUsdMicros,
      },
      where: {
        memberId_periodStart: {
          memberId: input.memberId,
          periodStart: input.periodStart,
        },
      },
    })
  );
}

export async function readHostedAiUsageLimitPeriodForTest(input: {
  environment?: NodeJS.ProcessEnv;
  memberId: string;
  periodStart: Date;
}): Promise<HostedAiUsagePeriodForTest | null> {
  return withHostedWebTestkitDeps(input.environment, async (deps) =>
    await deps.prisma.hostedAiUsagePeriod.findUnique({
      where: {
        memberId_periodStart: {
          memberId: input.memberId,
          periodStart: input.periodStart,
        },
      },
    })
  );
}

export async function grantHostedUsageCreditForTest(input: {
  effectiveAt?: Date;
  environment?: NodeJS.ProcessEnv;
  memberId: string;
  purchaseId: string;
}): Promise<HostedUsageCreditGrantForTest> {
  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const effectiveAt = input.effectiveAt ?? new Date();
    await deps.prisma.hostedUsageCreditPurchase.create({
      data: {
        beneficiaryMemberId: input.memberId,
        cashAmountMinor: 500,
        cashCurrency: "usd",
        checkoutCancelUrl: "https://example.test/settings?usage=cancelled",
        checkoutExpiresAt: new Date(effectiveAt.getTime() + 30 * 60_000),
        checkoutRequestPolicyVersion: "hosted-usage-credit-checkout-v1",
        checkoutSuccessUrl: "https://example.test/settings?usage=return",
        clientRequestKey: `request:${input.purchaseId}`,
        grantUsdMicros: 5_000_000n,
        id: input.purchaseId,
        offerCode: "usage_5_usd",
        payerMemberId: input.memberId,
        stripeCustomerIdEncrypted: `encrypted-customer:${input.purchaseId}`,
        stripeCustomerLookupKey: `customer-lookup:${input.purchaseId}`,
        stripeLiveMode: false,
        stripePriceIdEncrypted: `encrypted-price:${input.purchaseId}`,
        stripePriceLookupKey: `price-lookup:${input.purchaseId}`,
      },
    });
    const usageCreditModule = await loadHostedUsageCreditModule();
    return deps.prisma.$transaction(async (tx) =>
      await usageCreditModule.grantHostedUsageCreditForPurchaseTx({
        paidAt: effectiveAt,
        purchaseId: input.purchaseId,
        tx,
      })
    );
  });
}

export async function listHostedLinqDeliveriesForTest(input: {
  environment?: NodeJS.ProcessEnv;
  template: string;
}): Promise<HostedLinqDeliveryForTest[]> {
  return withHostedWebTestkitDeps(input.environment, async (deps) =>
    await deps.prisma.hostedLinqDelivery.findMany({
      orderBy: {
        attemptedAt: "asc",
      },
      where: {
        template: input.template,
      },
    })
  );
}

export async function seedHostedComputerRunForTest(input: {
  environment?: NodeJS.ProcessEnv;
  expiresAt?: Date;
  kernelSessionId?: string;
  memberId: string;
  runId: string;
}): Promise<HostedComputerRunForTest> {
  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const run = await deps.prisma.hostedComputerRun.create({
      data: {
        expiresAt: input.expiresAt ?? new Date(Date.now() + 60 * 60 * 1_000),
        id: input.runId,
        kernelProfileName: `hosted-local-${input.runId}`,
        kernelSessionId: input.kernelSessionId ?? `hosted-local-${input.runId}`,
        memberId: input.memberId,
        status: "running",
      },
    });
    return mapHostedComputerRunForTest(run);
  });
}

export async function readHostedComputerRunHandoffForTest(input: {
  environment?: NodeJS.ProcessEnv;
  runId: string;
}): Promise<{
  handoff: HostedComputerHandoffForTest | null;
  run: HostedComputerRunForTest | null;
}> {
  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const [run, handoff] = await Promise.all([
      deps.prisma.hostedComputerRun.findUnique({
        where: { id: input.runId },
      }),
      deps.prisma.hostedComputerHandoff.findFirst({
        orderBy: { updatedAt: "desc" },
        where: { runId: input.runId },
      }),
    ]);
    return {
      handoff: handoff ? mapHostedComputerHandoffForTest(handoff) : null,
      run: run ? mapHostedComputerRunForTest(run) : null,
    };
  });
}

export async function proveHostedComputerHandoffCompletionCasForTest(input: {
  environment?: NodeJS.ProcessEnv;
  handoffId: string;
  memberId: string;
  staleUpdatedAt: Date;
}): Promise<{
  claimedUpdatedAt: string;
  staleCompletionRejected: true;
}> {
  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const store = await createHostedComputerUseStoreForTest(deps.prisma);
    const claimed = await store.claimHandoffForCompletion({
      handoffId: input.handoffId,
      memberId: input.memberId,
    });
    if (!claimed) {
      throw new Error("Hosted computer handoff was not open for the CAS probe.");
    }

    let staleCompletionRejected = false;
    try {
      await store.completeHandoff({
        expectedUpdatedAt: input.staleUpdatedAt,
        handoffId: input.handoffId,
        now: new Date(),
      });
    } catch (error) {
      if (!isHostedComputerStaleStateConflictForTest(error)) {
        throw error;
      }
      staleCompletionRejected = true;
    }
    if (!staleCompletionRejected) {
      throw new Error("Hosted computer handoff accepted a stale completion write.");
    }

    await store.releaseHandoffClaim({
      expectedUpdatedAt: claimed.updatedAt,
      handoffId: input.handoffId,
    });
    return {
      claimedUpdatedAt: claimed.updatedAt.toISOString(),
      staleCompletionRejected: true,
    };
  });
}

export async function completeHostedComputerHandoffForTest(input: {
  environment?: NodeJS.ProcessEnv;
  memberId: string;
  token: string;
}): Promise<{
  returnContactKind: string | null;
  status: string;
  suggestedReply: string | null;
}> {
  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const service = await createHostedComputerUseServiceForTest(deps);
    return await service.completeHandoff({
      memberId: input.memberId,
      token: input.token,
    });
  });
}

export async function ensureHostedRuntimeLogDatabaseForTest(input: {
  databaseUrl: string;
}): Promise<void> {
  const databaseUrl = new URL(input.databaseUrl);
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ""));
  if (!databaseName) {
    throw new Error("Hosted runtime log test database URL must name a database.");
  }

  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  const adminClient = new Client({ connectionString: adminUrl.toString() });
  const lockName = `murph:hosted-runtime-log-test-database:${databaseName}`;
  let created = false;

  try {
    await adminClient.connect();
    await adminClient.query(
      "SELECT pg_advisory_lock(hashtext($1)::bigint)",
      [lockName],
    );
    const existing = await adminClient.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
      [databaseName],
    );
    if (existing.rows[0]?.exists !== true) {
      await adminClient.query(
        `CREATE DATABASE ${quoteHostedRuntimeLogTestIdentifier(databaseName)}`,
      );
      created = true;
    }

    try {
      await applyHostedRuntimeLogMigrationsForTest(databaseUrl.toString());
    } catch (error) {
      if (created) {
        try {
          await adminClient.query(
            `DROP DATABASE ${quoteHostedRuntimeLogTestIdentifier(databaseName)} WITH (FORCE)`,
          );
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Hosted runtime log test database setup and cleanup failed.",
          );
        }
      }
      throw error;
    }
  } finally {
    await adminClient.query(
      "SELECT pg_advisory_unlock(hashtext($1)::bigint)",
      [lockName],
    ).catch(() => {});
    await adminClient.end();
  }
}

export async function listHostedRuntimeLogsForTest(input: {
  environment?: NodeJS.ProcessEnv;
  fromAt?: Date | string | null;
  limit?: number;
  userId: string;
}): Promise<HostedRuntimeLogForTestRow[]> {
  const environment = input.environment ?? process.env;
  const databaseUrl = environment.HOSTED_RUNTIME_LOG_DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "Hosted runtime log test helpers require HOSTED_RUNTIME_LOG_DATABASE_URL.",
    );
  }

  const fromAt = input.fromAt ? new Date(input.fromAt) : null;
  if (fromAt && !Number.isFinite(fromAt.getTime())) {
    throw new TypeError("Hosted runtime log test lower bound must be a valid date.");
  }

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const rows = await client.query<HostedRuntimeLogForTestSqlRow>(`
      SELECT
        at,
        attempt_id AS "attemptId",
        component,
        event_code AS "eventCode",
        level,
        phase,
        redacted_json AS "redactedJson"
      FROM hosted_runtime_log
      WHERE subject_key = $1
        AND ($2::timestamptz IS NULL OR at >= $2)
      ORDER BY at ASC, id ASC
      LIMIT $3
    `, [
      hostedRuntimeLogSubjectKey(input.userId),
      fromAt,
      normalizeHostedTestingLimit(input.limit ?? 1_000),
    ]);

    return rows.rows.map((row) => ({
      at: normalizeHostedRuntimeLogTestAt(row.at),
      attemptId: row.attemptId,
      component: row.component,
      eventCode: row.eventCode,
      level: row.level,
      phase: row.phase,
      redactedJson: normalizeHostedTestingRedactedJson(row.redactedJson),
    }));
  } finally {
    await client.end();
  }
}

export async function readHostedIngressLatencyTraceForTest(input: {
  environment?: NodeJS.ProcessEnv;
  mailboxItemId: string;
  userId: string;
}): Promise<HostedIngressLatencyTraceForTest> {
  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const row = await deps.prisma.hostedIngressLatencyTrace.findUniqueOrThrow({
      where: {
        userId_mailboxItemId: {
          mailboxItemId: input.mailboxItemId,
          userId: input.userId,
        },
      },
    });
    if (!row.assistantInputId || !row.assistantInputStagedAt) {
      throw new Error("Hosted latency trace is missing its staged assistant input.");
    }
    const parsed = parseHostedRuntimeLatencyTraceEvent({
      assistantInputId: row.assistantInputId,
      at: row.assistantInputStagedAt.toISOString(),
      mailboxItemId: row.mailboxItemId,
      phaseBreakdown: row.phaseBreakdownJson,
      runnerJobAcceptedAt: row.runnerJobAcceptedAt?.toISOString() ?? null,
      runtimeAttemptId: row.runtimeAttemptId,
      runtimePhaseStartedAt: row.runtimePhaseStartedAt?.toISOString() ?? null,
      source: row.source,
      type: "assistant_input_staged",
      workspaceRestoreDoneAt: row.workspaceRestoreDoneAt?.toISOString() ?? null,
    });
    if (parsed.type !== "assistant_input_staged") {
      throw new Error("Hosted latency trace parser returned the wrong event type.");
    }

    return {
      acceptedAt: row.acceptedAt.toISOString(),
      assistantInputStagedAt: row.assistantInputStagedAt.toISOString(),
      mailboxImportDoneAt: row.mailboxImportDoneAt?.toISOString() ?? null,
      phaseBreakdown: parsed.phaseBreakdown ?? null,
      providerStartAt: row.providerStartAt?.toISOString() ?? null,
      runnerJobAcceptedAt: parsed.runnerJobAcceptedAt ?? null,
      runtimeAttemptId: parsed.runtimeAttemptId ?? null,
      runtimePhaseStartedAt: parsed.runtimePhaseStartedAt ?? null,
      workspaceRestoreDoneAt: parsed.workspaceRestoreDoneAt ?? null,
    };
  });
}

export async function signalHostedManualRunRuntimeForTest(input: {
  environment?: NodeJS.ProcessEnv;
  userId: string;
}): Promise<{
  signalAccepted: true;
  workflowId: string;
}> {
  return withHostedWebSignalTestkitDeps(input.environment, async (deps) => {
    const signalModule = await loadHostedRuntimeSignalModule();
    return await signalModule.signalHostedManualRunRuntime({
      client: deps.temporalSignalClient,
      environment: deps.environment,
      prisma: deps.prisma,
      userId: input.userId,
    });
  });
}

export async function signalHostedMailboxAppendRuntimeForTest(input: {
  environment?: NodeJS.ProcessEnv;
  expectedUserId?: string | null;
  mailboxItemId: string;
}): Promise<{
  signalAccepted: true;
  workflowId: string;
}> {
  return withHostedWebSignalTestkitDeps(input.environment, async (deps) => {
    const signalModule = await loadHostedRuntimeSignalModule();
    return await signalModule.signalHostedMailboxAppendRuntime({
      client: deps.temporalSignalClient,
      environment: deps.environment,
      expectedUserId: input.expectedUserId ?? null,
      mailboxItemId: input.mailboxItemId,
      prisma: deps.prisma,
    });
  });
}

export async function signalHostedRuntimeRecheckRuntimeForTest(input: {
  environment?: NodeJS.ProcessEnv;
  userId: string;
}): Promise<{
  signalAccepted: true;
  workflowId: string;
}> {
  return withHostedWebSignalTestkitDeps(input.environment, async (deps) => {
    const signalModule = await loadHostedRuntimeSignalModule();
    return await signalModule.signalHostedRuntimeRecheckRuntime({
      client: deps.temporalSignalClient,
      environment: deps.environment,
      prisma: deps.prisma,
      userId: input.userId,
    });
  });
}

export async function signalHostedRetentionRuntimeRecheckForTest(input: {
  environment?: NodeJS.ProcessEnv;
  userId: string;
}): Promise<{
  signalAccepted: true;
  workflowId: string;
}> {
  return withHostedWebSignalTestkitDeps(input.environment, async (deps) => {
    const signalModule = await loadHostedRuntimeSignalModule();
    return await signalModule.signalHostedRetentionRuntimeRecheck({
      client: deps.temporalSignalClient,
      environment: deps.environment,
      prisma: deps.prisma,
      userId: input.userId,
    });
  });
}

export async function queryHostedRuntimeWorkflowForTest(input: {
  environment?: NodeJS.ProcessEnv;
  queryName: string;
  workflowId: string;
}): Promise<unknown> {
  return withHostedWebSignalTestkitDeps(input.environment, async (deps) => {
    const handle = deps.temporalSignalClient?.workflow.getHandle?.(
      input.workflowId,
    );
    if (!handle) {
      throw new Error("Hosted runtime Temporal query client is not configured.");
    }
    return await handle.query(input.queryName);
  });
}

export async function signalHostedRuntimeWakeRuntimeForTest(input: {
  environment?: NodeJS.ProcessEnv;
  userId: string;
}): Promise<{
  signalAccepted: true;
  workflowId: string;
}> {
  return withHostedWebSignalTestkitDeps(input.environment, async (deps) => {
    const signalModule = await loadHostedRuntimeSignalModule();
    return await signalModule.signalHostedRuntimeWakeRuntime({
      client: deps.temporalSignalClient,
      environment: deps.environment,
      prisma: deps.prisma,
      userId: input.userId,
    });
  });
}

export async function updateHostedMemberAssistantProviderForTest(input: {
  environment?: NodeJS.ProcessEnv;
  provider: HostedAssistantProvider;
  userId: string;
}): Promise<{
  effectiveProviderUpdated: boolean;
  provider: HostedAssistantProvider;
  updated: boolean;
}> {
  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const preferenceModule = await loadHostedAssistantModelPreferenceModule();
    return await deps.prisma.$transaction(async (tx) =>
      await preferenceModule.updateHostedMemberAssistantConfigurationTx({
        memberId: input.userId,
        prisma: tx,
        provider: input.provider,
      })
    );
  });
}

export async function createHostedWebTestkitDeps(
  source: NodeJS.ProcessEnv = process.env,
): Promise<HostedWebTestkitDeps> {
  const environment = applyHostedWebTestkitEnvironment(source);
  const [
    hostedMailboxStore,
    hostedWorkspaceStore,
  ] = await Promise.all([
    loadHostedMailboxAppendForTestModules(),
    loadHostedWorkspaceSeedForTestModules(),
  ]);
  const prisma = await createHostedTestPrisma(environment);

  return {
    environment,
    hostedMailboxStore,
    hostedWorkspaceStore,
    prisma,
  };
}

export async function createHostedWebSignalTestkitDeps(
  source: NodeJS.ProcessEnv = process.env,
): Promise<HostedWebSignalTestkitDeps> {
  const deps = await createHostedWebTestkitDeps(source);
  try {
    const temporalClientModule = await loadHostedTemporalClientModule();
    return {
      ...deps,
      temporalSignalClient:
        await temporalClientModule.createHostedRuntimeTemporalSignalClient(deps.environment),
    };
  } catch (error) {
    await deps.prisma.$disconnect();
    throw error;
  }
}

async function withHostedWebTestkitDeps<T>(
  source: NodeJS.ProcessEnv | undefined,
  callback: (deps: HostedWebTestkitDeps) => Promise<T>,
): Promise<T> {
  const deps = await createHostedWebTestkitDeps(source ?? process.env);
  try {
    return await callback(deps);
  } finally {
    await deps.prisma.$disconnect();
  }
}

async function withHostedWebSignalTestkitDeps<T>(
  source: NodeJS.ProcessEnv | undefined,
  callback: (deps: HostedWebSignalTestkitDeps) => Promise<T>,
): Promise<T> {
  const deps = await createHostedWebSignalTestkitDeps(source ?? process.env);
  try {
    return await callback(deps);
  } finally {
    try {
      await deps.temporalSignalClient?.connection?.close();
    } finally {
      await deps.prisma.$disconnect();
    }
  }
}

function applyHostedWebTestkitEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const runtimeEnv = createHostedWebSmokeEnvironment(source);
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  restoreHostedTestingHostOnlyEnv();
  return runtimeEnv;
}

function restoreHostedTestingHostOnlyEnv(): void {
  for (const [key, value] of Object.entries(hostedTestingHostOnlyEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function loadHostedMailboxAppendForTestModules(): Promise<HostedMailboxAppendForTestStoreModule> {
  const hostedMailboxStoreModule = await import(hostedMailboxStoreModuleSpecifier);
  const typedHostedMailboxStoreModule =
    hostedMailboxStoreModule as HostedMailboxAppendForTestStoreModule;

  return {
    appendHostedMailboxEnvelopeTx: typedHostedMailboxStoreModule.appendHostedMailboxEnvelopeTx,
  };
}

async function loadHostedWorkspaceSeedForTestModules(): Promise<HostedWorkspaceSeedForTestStoreModule> {
  const hostedWorkspaceStoreModule = await import(hostedWorkspaceStoreModuleSpecifier);
  const typedHostedWorkspaceStoreModule =
    hostedWorkspaceStoreModule as HostedWorkspaceSeedForTestStoreModule;

  return {
    checkpointHostedWorkspace: typedHostedWorkspaceStoreModule.checkpointHostedWorkspace,
    ensureHostedWorkspace: typedHostedWorkspaceStoreModule.ensureHostedWorkspace,
    publishLatestBrowserVaultReplicaRef:
      typedHostedWorkspaceStoreModule.publishLatestBrowserVaultReplicaRef,
  };
}

async function loadHostedTemporalClientModule(): Promise<HostedTemporalClientModule> {
  return await import(hostedTemporalClientModuleSpecifier) as HostedTemporalClientModule;
}

async function loadHostedRuntimeSignalModule(): Promise<HostedRuntimeSignalModule> {
  return await import(hostedSignalRuntimeModuleSpecifier) as HostedRuntimeSignalModule;
}

async function loadHostedAssistantModelPreferenceModule(): Promise<
  HostedAssistantModelPreferenceModule
> {
  return await import(
    hostedAssistantModelPreferenceModuleSpecifier
  ) as HostedAssistantModelPreferenceModule;
}

async function loadHostedUsageCreditModule(): Promise<HostedUsageCreditModule> {
  return await import(hostedUsageCreditModuleSpecifier) as HostedUsageCreditModule;
}

async function createHostedComputerUseStoreForTest(
  prisma: HostedTestPrismaClient,
): Promise<HostedComputerUseStoreForTest> {
  const storeModule = await import(
    hostedComputerUseStoreModuleSpecifier
  ) as HostedComputerUseStoreModule;
  return new storeModule.PrismaComputerUseStore(prisma);
}

async function createHostedComputerUseServiceForTest(
  deps: HostedWebTestkitDeps,
): Promise<HostedComputerUseServiceForTest> {
  const serviceModule = await import(
    hostedComputerUseServiceModuleSpecifier
  ) as HostedComputerUseServiceModule;
  return new serviceModule.ComputerUseService({
    env: deps.environment,
    store: await createHostedComputerUseStoreForTest(deps.prisma),
  });
}

async function loadHostedThreadRouteForTestModule(): Promise<HostedThreadRouteForTestModule> {
  return await import(hostedThreadRouteStoreModuleSpecifier) as HostedThreadRouteForTestModule;
}

async function createHostedTestPrisma(
  environment: NodeJS.ProcessEnv,
): Promise<HostedTestPrismaClient> {
  if (!environment.DATABASE_URL) {
    throw new Error("Hosted test helpers require DATABASE_URL.");
  }

  const prismaModule = await import(hostedPrismaModuleSpecifier) as HostedTestPrismaModule;

  return prismaModule.createPrismaClient({
    databaseUrl: environment.DATABASE_URL,
    poolMax: 1,
  });
}

function normalizeHostedTestingLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    return 1;
  }

  return Math.min(value, 2_000);
}

function normalizeHostedTestingRedactedJson(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function normalizeHostedRuntimeLogTestAt(value: Date | string): string {
  const at = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(at.getTime())) {
    throw new TypeError("Hosted runtime log test row has an invalid at timestamp.");
  }
  return at.toISOString();
}

async function applyHostedRuntimeLogMigrationsForTest(databaseUrl: string): Promise<void> {
  const migrationDirectories = (await readdir(hostedRuntimeLogTestMigrationsRoot, {
    withFileTypes: true,
  }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const client = new Client({ connectionString: databaseUrl });
  const lockName = "murph:hosted-runtime-log-test-migrations";

  try {
    await client.connect();
    await client.query(
      "SELECT pg_advisory_lock(hashtext($1)::bigint)",
      [lockName],
    );
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${quoteHostedRuntimeLogTestIdentifier(
        hostedRuntimeLogTestMigrationTable,
      )} (
        migration_name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    for (const directory of migrationDirectories) {
      const migrationName = `${directory}/migration.sql`;
      const applied = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1
          FROM ${quoteHostedRuntimeLogTestIdentifier(hostedRuntimeLogTestMigrationTable)}
          WHERE migration_name = $1
        ) AS exists`,
        [migrationName],
      );
      if (applied.rows[0]?.exists === true) {
        continue;
      }

      const migrationSql = await readFile(
        new URL(migrationName, hostedRuntimeLogTestMigrationsRoot),
        "utf8",
      );
      await client.query("BEGIN");
      try {
        await client.query(migrationSql);
        await client.query(
          `INSERT INTO ${quoteHostedRuntimeLogTestIdentifier(
            hostedRuntimeLogTestMigrationTable,
          )} (migration_name)
           VALUES ($1)`,
          [migrationName],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query(
      "SELECT pg_advisory_unlock(hashtext($1)::bigint)",
      [lockName],
    ).catch(() => {});
    await client.end();
  }
}

function quoteHostedRuntimeLogTestIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function mapHostedComputerRunForTest(
  run: HostedComputerRunForTestPrismaRow,
): HostedComputerRunForTest {
  return {
    awaitingReason: run.awaitingReason,
    checkpointContext: readHostedComputerCheckpointContextForTest(run.metadataJson),
    completedAt: run.completedAt?.toISOString() ?? null,
    expiresAt: run.expiresAt.toISOString(),
    id: run.id,
    kernelSessionId: run.kernelSessionId,
    memberId: run.memberId,
    pausedAt: run.pausedAt?.toISOString() ?? null,
    pendingHandoffId: run.pendingHandoffId,
    status: run.status,
    updatedAt: run.updatedAt.toISOString(),
  };
}

function mapHostedComputerHandoffForTest(
  handoff: HostedComputerHandoffForTestPrismaRow,
): HostedComputerHandoffForTest {
  return {
    completedAt: handoff.completedAt?.toISOString() ?? null,
    expiresAt: handoff.expiresAt.toISOString(),
    id: handoff.id,
    memberId: handoff.memberId,
    purpose: handoff.purpose,
    returnContactKind: handoff.returnContactKind,
    runId: handoff.runId,
    status: handoff.status,
    suggestedReply: handoff.suggestedReply,
    tokenHash: handoff.tokenHash,
    updatedAt: handoff.updatedAt.toISOString(),
  };
}

function readHostedComputerCheckpointContextForTest(value: unknown): {
  conversationId: string | null;
  recipientKey: string | null;
} | null {
  const root = normalizeHostedTestingRedactedJson(value);
  const pause = normalizeHostedTestingRedactedJson(root?.pause);
  const context = normalizeHostedTestingRedactedJson(pause?.checkpointContext);
  if (!context) {
    return null;
  }
  return {
    conversationId:
      typeof context.conversationId === "string" ? context.conversationId : null,
    recipientKey:
      typeof context.recipientKey === "string" ? context.recipientKey : null,
  };
}

function isHostedComputerStaleStateConflictForTest(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as Record<string, unknown>;
  return record.code === "HOSTED_COMPUTER_RUN_STATE_CHANGED"
    && record.httpStatus === 409
    && record.retryable === true;
}
