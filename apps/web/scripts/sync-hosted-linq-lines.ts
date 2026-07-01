import { getPrisma } from "../src/lib/prisma";
import { readHostedPhoneHint } from "../src/lib/hosted-onboarding/contact-privacy";
import type { HostedOnboardingEnvironment } from "../src/lib/hosted-onboarding/env";
import { syncHostedLinqConfiguredLinesTx } from "../src/lib/hosted-onboarding/linq-line-store";
import { syncHostedLinqPhoneNumberInventory } from "../src/lib/hosted-onboarding/linq-phone-number-inventory";
import { getHostedOnboardingEnvironment } from "../src/lib/hosted-onboarding/runtime";

type HostedLinqLineSyncPrisma = ReturnType<typeof getPrisma>;

type HostedLinqLineSyncResult = {
  configuredHints: string[];
  configuredLineCount: number;
  providerInventorySyncedCount: number;
};

export async function syncHostedLinqLinesFromEnvironment(input: {
  environment: HostedOnboardingEnvironment;
  observedAt: Date;
  prisma: HostedLinqLineSyncPrisma;
  syncConfiguredLines?: typeof syncHostedLinqConfiguredLinesTx;
  syncProviderInventory?: typeof syncHostedLinqPhoneNumberInventory;
}): Promise<HostedLinqLineSyncResult> {
  const syncConfiguredLines = input.syncConfiguredLines ?? syncHostedLinqConfiguredLinesTx;
  const syncProviderInventory = input.syncProviderInventory ?? syncHostedLinqPhoneNumberInventory;

  await input.prisma.$transaction(async (tx) => {
    await syncConfiguredLines({
      activeMemberLimit: input.environment.linqMaxActiveMembersPerConversationPhone,
      observedAt: input.observedAt,
      phoneNumbers: input.environment.linqConversationPhoneNumbers,
      prisma: tx,
    });
  });

  const inventory = await syncProviderInventory({
    observedAt: input.observedAt,
    prisma: input.prisma,
  });

  return {
    configuredHints: input.environment.linqConversationPhoneNumbers
      .map((phoneNumber) => readHostedPhoneHint(phoneNumber))
      .filter((hint): hint is string => typeof hint === "string" && hint.length > 0),
    configuredLineCount: input.environment.linqConversationPhoneNumbers.length,
    providerInventorySyncedCount: inventory.syncedCount,
  };
}

async function main(): Promise<void> {
  const prisma = getPrisma();
  const environment = getHostedOnboardingEnvironment();
  const observedAt = new Date();

  const result = await syncHostedLinqLinesFromEnvironment({
    environment,
    observedAt,
    prisma,
  });

  console.log(
    `Configured ${result.configuredLineCount} hosted Linq line(s)${
      result.configuredHints.length > 0 ? `: ${result.configuredHints.join(", ")}` : "."
    }`,
  );
  console.log(`Synced ${result.providerInventorySyncedCount} Linq provider inventory line(s).`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
