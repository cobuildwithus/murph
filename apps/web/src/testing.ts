export {
  bindHostedActiveLinqHomeChat,
  seedHostedActiveLinqMember,
  seedHostedActiveMember,
} from "./lib/hosted-onboarding/hosted-member-test-seed";

import { createHostedWebSmokeEnvironment } from "../next-artifacts";
import { PrismaPg } from "@prisma/adapter-pg";
import type { HostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/contracts";
import type { HostedExecutionWake } from "@murphai/hosted-execution/contracts";
import type { HostedExecutionSnapshotRef } from "@murphai/hosted-execution/contracts";
import type {
  HostedRuntimeManualSignalSource,
} from "@murphai/hosted-execution/orchestration-control";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";

const hostedMailboxStoreModuleSpecifier = new URL(
  "./lib/hosted-mailbox/store.ts",
  import.meta.url,
).href;
const hostedWorkspaceStoreModuleSpecifier = new URL(
  "./lib/hosted-workspace/store.ts",
  import.meta.url,
).href;
const hostedTestingHostOnlyEnv = {
  DOCKER_BUILDKIT: process.env.DOCKER_BUILDKIT,
  DOCKER_CONFIG: process.env.DOCKER_CONFIG,
  DOCKER_DEFAULT_PLATFORM: process.env.DOCKER_DEFAULT_PLATFORM,
};

interface HostedMailboxAppendForTestPrismaClient {
  $disconnect(): Promise<void>;
  $transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T>;
}

type HostedTestPrismaClient =
  & HostedMailboxAppendForTestPrismaClient
  & HostedWorkspaceSeedForTestPrismaClient
  & HostedUsageDiagnosticsForTestPrismaClient;

interface HostedTestPrismaClientConstructor {
  new (options: {
    adapter: PrismaPg;
    transactionOptions: {
      maxWait: number;
      timeout: number;
    };
  }): HostedTestPrismaClient;
}

interface HostedTestPrismaClientModule {
  PrismaClient: HostedTestPrismaClientConstructor;
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
  const modules = await loadHostedMailboxAppendForTestModules(
    applyHostedMailboxAppendForTestEnvironment(input.environment),
  );
  const prisma = await createHostedTestPrisma(modules.environment);

  try {
    const append = await prisma.$transaction(async (tx) =>
      modules.appendHostedMailboxEnvelopeTx({
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
  } finally {
    await prisma.$disconnect();
  }
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
  const modules = await loadHostedWorkspaceSeedForTestModules(
    applyHostedMailboxAppendForTestEnvironment(input.environment),
  );
  const prisma = await createHostedTestPrisma(modules.environment);

  try {
    const workspace = await modules.ensureHostedWorkspace({
      prisma,
      userId: input.userId,
    });
    const checkpoint = await modules.checkpointHostedWorkspace({
      expectedVersion: workspace.version,
      nextWakeAt: input.nextWakeAt ?? null,
      nextWakeReason: input.nextWakeReason ?? null,
      prisma,
      reason: "import",
      redactedStatusJson: input.redactedStatusJson ?? null,
      snapshotRef: input.snapshotRef,
      userId: input.userId,
    });
    if (checkpoint.workspace) {
      await modules.publishLatestBrowserVaultReplicaRef({
        prisma,
        replicaRef: input.browserVaultReplicaRef,
        userId: input.userId,
      });
    }

    return {
      status: checkpoint.status,
      version: checkpoint.workspace?.version ?? workspace.version,
    };
  } finally {
    await prisma.$disconnect();
  }
}

export async function listHostedAiUsageForTest(input: {
  environment?: NodeJS.ProcessEnv;
  limit?: number;
  memberId: string;
}): Promise<HostedAiUsageForTestRow[]> {
  const environment = applyHostedMailboxAppendForTestEnvironment(input.environment);
  const prisma = await createHostedTestPrisma(environment);

  try {
    const rows = await prisma.hostedAiUsage.findMany({
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
  } finally {
    await prisma.$disconnect();
  }
}

export async function listHostedRuntimeLogsForTest(input: {
  environment?: NodeJS.ProcessEnv;
  limit?: number;
  userId: string;
}): Promise<HostedRuntimeLogForTestRow[]> {
  const environment = applyHostedMailboxAppendForTestEnvironment(input.environment);
  const prisma = await createHostedTestPrisma(environment);

  try {
    const rows = await prisma.hostedRuntimeLog.findMany({
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
  } finally {
    await prisma.$disconnect();
  }
}

export async function signalHostedManualRunRuntimeForTest(input: {
  environment?: NodeJS.ProcessEnv;
  eventId?: string | null;
  eventSource?: string | null;
  source: HostedRuntimeManualSignalSource;
  userId: string;
}): Promise<{
  signalAccepted: true;
  workflowId: string;
}> {
  applyHostedMailboxAppendForTestEnvironment(input.environment);
  const temporalClientModule = await import("./lib/hosted-orchestration/temporal-client");
  temporalClientModule.resetHostedRuntimeTemporalSignalClientForTesting();
  const signalModule = await import("./lib/hosted-orchestration/signal-runtime");

  return await signalModule.signalHostedManualRunRuntime({
    ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
    ...(input.eventSource !== undefined ? { eventSource: input.eventSource } : {}),
    source: input.source,
    userId: input.userId,
  });
}

function applyHostedMailboxAppendForTestEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
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

async function loadHostedMailboxAppendForTestModules(
  environment: NodeJS.ProcessEnv,
): Promise<HostedMailboxAppendForTestStoreModule & { environment: NodeJS.ProcessEnv }> {
  const hostedMailboxStoreModule = await import(hostedMailboxStoreModuleSpecifier);

  if (environment.DATABASE_URL) {
    process.env.DATABASE_URL = environment.DATABASE_URL;
  }

  const typedHostedMailboxStoreModule =
    hostedMailboxStoreModule as HostedMailboxAppendForTestStoreModule;

  return {
    appendHostedMailboxEnvelopeTx: typedHostedMailboxStoreModule.appendHostedMailboxEnvelopeTx,
    environment,
  };
}

async function loadHostedWorkspaceSeedForTestModules(
  environment: NodeJS.ProcessEnv,
): Promise<HostedWorkspaceSeedForTestStoreModule & { environment: NodeJS.ProcessEnv }> {
  const hostedWorkspaceStoreModule = await import(hostedWorkspaceStoreModuleSpecifier);

  if (environment.DATABASE_URL) {
    process.env.DATABASE_URL = environment.DATABASE_URL;
  }

  const typedHostedWorkspaceStoreModule =
    hostedWorkspaceStoreModule as HostedWorkspaceSeedForTestStoreModule;

  return {
    checkpointHostedWorkspace: typedHostedWorkspaceStoreModule.checkpointHostedWorkspace,
    environment,
    ensureHostedWorkspace: typedHostedWorkspaceStoreModule.ensureHostedWorkspace,
    publishLatestBrowserVaultReplicaRef:
      typedHostedWorkspaceStoreModule.publishLatestBrowserVaultReplicaRef,
  };
}

async function createHostedTestPrisma(
  environment: NodeJS.ProcessEnv,
): Promise<HostedTestPrismaClient> {
  if (!environment.DATABASE_URL) {
    throw new Error("Hosted test helpers require DATABASE_URL.");
  }

  const prismaClientPackageName = "@prisma/client";
  const prismaClientModule: unknown = await import(prismaClientPackageName);

  if (!isHostedTestPrismaClientModule(prismaClientModule)) {
    throw new TypeError("Hosted test helpers could not load PrismaClient.");
  }

  return new prismaClientModule.PrismaClient({
    adapter: new PrismaPg({
      connectionString: normalizeTestPrismaConnectionString(environment.DATABASE_URL),
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: 1,
    }),
    transactionOptions: {
      maxWait: 10_000,
      timeout: 15_000,
    },
  });
}

function isHostedTestPrismaClientModule(
  value: unknown,
): value is HostedTestPrismaClientModule {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return typeof Reflect.get(value, "PrismaClient") === "function";
}

function normalizeTestPrismaConnectionString(databaseUrl: string): string {
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    return databaseUrl;
  }

  let changed = false;
  for (const key of ["sslcert", "sslkey", "sslrootcert"] as const) {
    if (parsed.searchParams.get(key) === "system") {
      parsed.searchParams.delete(key);
      changed = true;
    }
  }

  return changed ? parsed.toString() : databaseUrl;
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
