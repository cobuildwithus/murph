import type { HostedIngressEnvelope } from "@murphai/hosted-execution/contracts";
import type { HostedIngressAppendResponse } from "@murphai/hosted-execution/contracts";

import { createHostedWebSmokeEnvironment } from "../../../next-artifacts";

const prismaModuleSpecifier = new URL("../prisma.ts", import.meta.url).href;
const hostedIngressQueueModuleSpecifier = new URL("./queue.ts", import.meta.url).href;

interface HostedIngressSeedPrismaClient {
  $disconnect(): Promise<void>;
  $transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T>;
}

interface HostedIngressSeedPrismaModule {
  getPrisma(): HostedIngressSeedPrismaClient;
}

interface HostedIngressQueueModule {
  appendHostedIngressEnvelopePayloadTx(input: {
    tx: unknown;
    wake: HostedIngressEnvelope;
  }): Promise<HostedIngressAppendResponse>;
}

interface HostedIngressSeedModules {
  appendHostedIngressEnvelopePayloadTx:
    HostedIngressQueueModule["appendHostedIngressEnvelopePayloadTx"];
  getPrisma: HostedIngressSeedPrismaModule["getPrisma"];
}

export async function appendHostedIngressEnvelopeForTest(input: {
  environment?: NodeJS.ProcessEnv;
  wake: HostedIngressEnvelope;
}) {
  const modules = await loadHostedIngressSeedModules(applyHostedIngressSeedEnvironment(input.environment));
  const prisma = modules.getPrisma();

  try {
    return await prisma.$transaction(async (tx) =>
      await modules.appendHostedIngressEnvelopePayloadTx({
        tx,
        wake: input.wake,
      }));
  } finally {
    await prisma.$disconnect();
  }
}

function applyHostedIngressSeedEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const runtimeEnv = createHostedWebSmokeEnvironment(source);
  Object.assign(process.env, runtimeEnv);
  clearHostedIngressSeedGlobals();
  return runtimeEnv;
}

async function loadHostedIngressSeedModules(
  environment: NodeJS.ProcessEnv,
): Promise<HostedIngressSeedModules> {
  const [prismaModule, queueModule] = await Promise.all([
    import(prismaModuleSpecifier),
    import(hostedIngressQueueModuleSpecifier),
  ]);

  if (environment.DATABASE_URL) {
    process.env.DATABASE_URL = environment.DATABASE_URL;
  }

  const typedPrismaModule = prismaModule as HostedIngressSeedPrismaModule;
  const typedQueueModule = queueModule as HostedIngressQueueModule;

  return {
    appendHostedIngressEnvelopePayloadTx: typedQueueModule.appendHostedIngressEnvelopePayloadTx,
    getPrisma: typedPrismaModule.getPrisma,
  };
}

function clearHostedIngressSeedGlobals(): void {
  const globalForHostedOnboarding = globalThis as typeof globalThis & {
    __murphHostedOnboardingEnv?: unknown;
    __murphHostedOnboardingStripe?: unknown;
  };

  delete globalForHostedOnboarding.__murphHostedOnboardingEnv;
  delete globalForHostedOnboarding.__murphHostedOnboardingStripe;
}
