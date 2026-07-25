export {
  bindHostedActiveLinqHomeChat,
  bindHostedActiveTelegramMember,
  readHostedLinqFirstContactMemberState,
  readHostedJunctionDeviceSyncReplayDrainStatus,
  seedHostedJunctionDeviceSyncConnection,
  seedHostedJunctionDeviceSyncReplay,
  seedHostedActiveLinqMember,
  seedHostedFamilySponsoredLinqMember,
  seedHostedLinqFirstContactFallbackLines,
  seedHostedActiveMember,
  type HostedLinqFirstContactMemberState,
  type HostedJunctionDeviceSyncConnectionSeedInput,
  type HostedJunctionDeviceSyncConnectionSeedResult,
  type HostedJunctionDeviceSyncReplayDrainStatus,
  type HostedJunctionDeviceSyncReplayDrainStatusInput,
  type HostedJunctionDeviceSyncReplaySeedInput,
  type HostedJunctionDeviceSyncReplaySeedResult,
} from "./hosted-member-seeds";

import type { HostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/contracts";
import type { HostedExecutionSnapshotRef } from "@murphai/hosted-execution/contracts";
import type { HostedExecutionWake } from "@murphai/hosted-execution/contracts";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";

import { createHostedWebSmokeEnvironment } from "../../next-artifacts";
import type { HostedRuntimeTemporalSignalClient } from "../../src/lib/hosted-orchestration/temporal-client";

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
  & HostedLinqWorkspaceIsolationForTestPrismaClient
  & HostedWorkspaceSeedForTestPrismaClient
  & HostedUsageDiagnosticsForTestPrismaClient;

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
  hostedRuntimeLog: {
    findMany(input: {
      orderBy: {
        at: "asc";
      };
      take: number;
      where: {
        userId: string;
      };
    }): Promise<HostedRuntimeLogForTestPrismaRow[]>;
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

export interface HostedWebSignalTestkitDeps extends HostedWebTestkitDeps {
  temporalSignalClient: HostedRuntimeTemporalSignalClient | null;
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

interface HostedRuntimeLogForTestPrismaRow {
  at: Date;
  component: string;
  eventCode: string;
  level: string;
  phase: string;
  redactedJson: unknown;
}

export interface HostedRuntimeLogForTestRow {
  at: string;
  component: string;
  eventCode: string;
  level: string;
  phase: string;
  redactedJson: Record<string, unknown> | null;
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

export async function listHostedRuntimeLogsForTest(input: {
  environment?: NodeJS.ProcessEnv;
  limit?: number;
  userId: string;
}): Promise<HostedRuntimeLogForTestRow[]> {
  return withHostedWebTestkitDeps(input.environment, async (deps) => {
    const rows = await deps.prisma.hostedRuntimeLog.findMany({
      orderBy: {
        at: "asc",
      },
      take: normalizeHostedTestingLimit(input.limit ?? 1_000),
      where: {
        userId: input.userId,
      },
    });

    return rows.map((row) => ({
      at: row.at.toISOString(),
      component: row.component,
      eventCode: row.eventCode,
      level: row.level,
      phase: row.phase,
      redactedJson: normalizeHostedTestingRedactedJson(row.redactedJson),
    }));
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
    await deps.prisma.$disconnect();
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
