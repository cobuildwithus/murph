import type { HostedExecutionWake } from "@murphai/hosted-execution/contracts";

import { createHostedWebSmokeEnvironment } from "../../../next-artifacts";

interface HostedWakeSeedModules {
  appendHostedExecutionWakePayloadTx:
    typeof import("./queue").appendHostedExecutionWakePayloadTx;
  getPrisma: typeof import("../prisma").getPrisma;
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
    import("../prisma"),
    import("./queue"),
  ]);

  if (environment.DATABASE_URL) {
    process.env.DATABASE_URL = environment.DATABASE_URL;
  }

  return {
    appendHostedExecutionWakePayloadTx: queueModule.appendHostedExecutionWakePayloadTx,
    getPrisma: prismaModule.getPrisma,
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
