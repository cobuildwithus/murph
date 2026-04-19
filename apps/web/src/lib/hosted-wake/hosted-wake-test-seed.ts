import type { HostedExecutionWake } from "@murphai/hosted-execution/contracts";
import type { HostedWakeAppendResponse } from "@murphai/hosted-execution/contracts";

import { createHostedWebSmokeEnvironment } from "../../../next-artifacts";

const prismaModuleSpecifier = "../prisma";
const hostedWakeQueueModuleSpecifier = "./queue";

interface HostedWakeSeedPrismaClient {
  $disconnect(): Promise<void>;
  $transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T>;
}

interface HostedWakeSeedPrismaModule {
  getPrisma(): HostedWakeSeedPrismaClient;
}

interface HostedWakeQueueModule {
  appendHostedExecutionWakePayloadTx(input: {
    tx: unknown;
    wake: HostedExecutionWake;
  }): Promise<HostedWakeAppendResponse>;
}

interface HostedWakeSeedModules {
  appendHostedExecutionWakePayloadTx:
    HostedWakeQueueModule["appendHostedExecutionWakePayloadTx"];
  getPrisma: HostedWakeSeedPrismaModule["getPrisma"];
}

export async function appendHostedExecutionWakeForTest(input: {
  environment?: NodeJS.ProcessEnv;
  wake: HostedExecutionWake;
}) {
  const modules = await loadHostedWakeSeedModules(applyHostedWakeSeedEnvironment(input.environment));
  const prisma = modules.getPrisma();

  try {
    return await prisma.$transaction(async (tx) =>
      await modules.appendHostedExecutionWakePayloadTx({
        tx,
        wake: input.wake,
      }));
  } finally {
    await prisma.$disconnect();
  }
}

function applyHostedWakeSeedEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const runtimeEnv = createHostedWebSmokeEnvironment(source);
  Object.assign(process.env, runtimeEnv);
  clearHostedWakeSeedGlobals();
  return runtimeEnv;
}

async function loadHostedWakeSeedModules(
  environment: NodeJS.ProcessEnv,
): Promise<HostedWakeSeedModules> {
  const [prismaModule, queueModule] = await Promise.all([
    import(prismaModuleSpecifier),
    import(hostedWakeQueueModuleSpecifier),
  ]);

  if (environment.DATABASE_URL) {
    process.env.DATABASE_URL = environment.DATABASE_URL;
  }

  const typedPrismaModule = prismaModule as HostedWakeSeedPrismaModule;
  const typedQueueModule = queueModule as HostedWakeQueueModule;

  return {
    appendHostedExecutionWakePayloadTx: typedQueueModule.appendHostedExecutionWakePayloadTx,
    getPrisma: typedPrismaModule.getPrisma,
  };
}

function clearHostedWakeSeedGlobals(): void {
  const globalForHostedOnboarding = globalThis as typeof globalThis & {
    __murphHostedOnboardingEnv?: unknown;
    __murphHostedOnboardingStripe?: unknown;
  };

  delete globalForHostedOnboarding.__murphHostedOnboardingEnv;
  delete globalForHostedOnboarding.__murphHostedOnboardingStripe;
}
