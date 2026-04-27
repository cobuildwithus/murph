export {
  bindHostedActiveLinqHomeChat,
  seedHostedActiveLinqMember,
  seedHostedActiveMember,
} from "./lib/hosted-onboarding/hosted-member-test-seed";

import { createHostedWebSmokeEnvironment } from "../next-artifacts";
import type { HostedExecutionWake } from "@murphai/hosted-execution/contracts";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";

const prismaModuleSpecifier = new URL("./lib/prisma.ts", import.meta.url).href;
const hostedMailboxStoreModuleSpecifier = new URL(
  "./lib/hosted-mailbox/store.ts",
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
