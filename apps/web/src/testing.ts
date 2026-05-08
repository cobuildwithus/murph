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
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";

const hostedMailboxStoreModuleSpecifier = new URL(
  "./lib/hosted-mailbox/store.ts",
  import.meta.url,
).href;
const hostedWorkspaceStoreModuleSpecifier = new URL(
  "./lib/hosted-workspace/store.ts",
  import.meta.url,
).href;

interface HostedMailboxAppendForTestPrismaClient {
  $disconnect(): Promise<void>;
  $transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T>;
}

type HostedTestPrismaClient =
  & HostedMailboxAppendForTestPrismaClient
  & HostedWorkspaceSeedForTestPrismaClient;

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

function applyHostedMailboxAppendForTestEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const runtimeEnv = createHostedWebSmokeEnvironment(source);
  Object.assign(process.env, runtimeEnv);
  return runtimeEnv;
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
