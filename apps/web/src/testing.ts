export {
  bindHostedActiveLinqHomeChat,
  seedHostedActiveLinqMember,
  seedHostedActiveMember,
} from "./lib/hosted-onboarding/hosted-member-test-seed";

import { createHostedWebSmokeEnvironment } from "../next-artifacts";
import type { HostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/contracts";
import type { HostedExecutionWake } from "@murphai/hosted-execution/contracts";
import type { HostedExecutionSnapshotRef } from "@murphai/hosted-execution/contracts";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";

const prismaModuleSpecifier = new URL("./lib/prisma.ts", import.meta.url).href;
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

interface HostedMailboxAppendForTestPrismaModule {
  getPrisma(): HostedMailboxAppendForTestPrismaClient;
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

interface HostedWorkspaceSeedForTestPrismaModule {
  getPrisma(): HostedWorkspaceSeedForTestPrismaClient;
}

interface HostedWorkspaceSeedForTestStoreModule {
  checkpointHostedWorkspace(input: {
    browserVaultReplicaRef: HostedBrowserVaultReplicaRef;
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
  const prisma = modules.getPrisma();

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
  const prisma = modules.getPrisma();

  try {
    const workspace = await modules.ensureHostedWorkspace({
      prisma,
      userId: input.userId,
    });
    const checkpoint = await modules.checkpointHostedWorkspace({
      browserVaultReplicaRef: input.browserVaultReplicaRef,
      expectedVersion: workspace.version,
      nextWakeAt: input.nextWakeAt ?? null,
      nextWakeReason: input.nextWakeReason ?? null,
      prisma,
      reason: "import",
      redactedStatusJson: input.redactedStatusJson ?? null,
      snapshotRef: input.snapshotRef,
      userId: input.userId,
    });

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
): Promise<HostedMailboxAppendForTestPrismaModule & HostedMailboxAppendForTestStoreModule> {
  const [prismaModule, hostedMailboxStoreModule] = await Promise.all([
    import(prismaModuleSpecifier),
    import(hostedMailboxStoreModuleSpecifier),
  ]);

  if (environment.DATABASE_URL) {
    process.env.DATABASE_URL = environment.DATABASE_URL;
  }

  const typedPrismaModule = prismaModule as HostedMailboxAppendForTestPrismaModule;
  const typedHostedMailboxStoreModule =
    hostedMailboxStoreModule as HostedMailboxAppendForTestStoreModule;

  return {
    appendHostedMailboxEnvelopeTx: typedHostedMailboxStoreModule.appendHostedMailboxEnvelopeTx,
    getPrisma: typedPrismaModule.getPrisma,
  };
}

async function loadHostedWorkspaceSeedForTestModules(
  environment: NodeJS.ProcessEnv,
): Promise<HostedWorkspaceSeedForTestPrismaModule & HostedWorkspaceSeedForTestStoreModule> {
  const [prismaModule, hostedWorkspaceStoreModule] = await Promise.all([
    import(prismaModuleSpecifier),
    import(hostedWorkspaceStoreModuleSpecifier),
  ]);

  if (environment.DATABASE_URL) {
    process.env.DATABASE_URL = environment.DATABASE_URL;
  }

  const typedPrismaModule = prismaModule as HostedWorkspaceSeedForTestPrismaModule;
  const typedHostedWorkspaceStoreModule =
    hostedWorkspaceStoreModule as HostedWorkspaceSeedForTestStoreModule;

  return {
    checkpointHostedWorkspace: typedHostedWorkspaceStoreModule.checkpointHostedWorkspace,
    ensureHostedWorkspace: typedHostedWorkspaceStoreModule.ensureHostedWorkspace,
    getPrisma: typedPrismaModule.getPrisma,
  };
}
