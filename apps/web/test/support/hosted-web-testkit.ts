export {
  bindHostedActiveLinqHomeChat,
  readHostedJunctionDeviceSyncReplayDrainStatus,
  seedHostedJunctionDeviceSyncConnection,
  seedHostedJunctionDeviceSyncReplay,
  seedHostedActiveLinqMember,
  seedHostedActiveMember,
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
const hostedTemporalClientModuleSpecifier = new URL(
  "../../src/lib/hosted-orchestration/temporal-client.ts",
  import.meta.url,
).href;
const hostedSignalRuntimeModuleSpecifier = new URL(
  "../../src/lib/hosted-orchestration/signal-runtime.ts",
  import.meta.url,
).href;
const hostedTestingHostOnlyEnv = {
  DOCKER_BUILDKIT: process.env.DOCKER_BUILDKIT,
  DOCKER_CONFIG: process.env.DOCKER_CONFIG,
  DOCKER_DEFAULT_PLATFORM: process.env.DOCKER_DEFAULT_PLATFORM,
};

type HostedTestPrismaClient =
  & HostedTestPrismaFactoryClient
  & HostedWorkspaceSeedForTestPrismaClient
  & HostedUsageDiagnosticsForTestPrismaClient;

interface HostedTestPrismaFactoryClient {
  $disconnect(): Promise<void>;
  $transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T>;
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

interface HostedAiUsageForTestPrismaRow {
  allowanceCostUsdMicros: bigint | number;
  attemptCount: number;
  cacheWriteTokens: number | null;
  cachedInputTokens: number | null;
  inputTokens: number | null;
  occurredAt: Date;
  outputTokens: number | null;
  providerRequestOrdinal: number;
  reasoningTokens: number | null;
  requestedModel: string | null;
  servedModel: string | null;
  totalTokens: number | null;
}

export interface HostedAiUsageForTestRow {
  allowanceCostUsdMicros: string;
  attemptCount: number;
  cacheWriteTokens: number | null;
  cachedInputTokens: number | null;
  inputTokens: number | null;
  occurredAt: string;
  outputTokens: number | null;
  providerRequestOrdinal: number;
  reasoningTokens: number | null;
  requestedModel: string | null;
  servedModel: string | null;
  totalTokens: number | null;
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
      allowanceCostUsdMicros: row.allowanceCostUsdMicros.toString(),
      attemptCount: row.attemptCount,
      cacheWriteTokens: row.cacheWriteTokens,
      cachedInputTokens: row.cachedInputTokens,
      inputTokens: row.inputTokens,
      occurredAt: row.occurredAt.toISOString(),
      outputTokens: row.outputTokens,
      providerRequestOrdinal: row.providerRequestOrdinal,
      reasoningTokens: row.reasoningTokens,
      requestedModel: row.requestedModel,
      servedModel: row.servedModel,
      totalTokens: row.totalTokens,
    }));
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
