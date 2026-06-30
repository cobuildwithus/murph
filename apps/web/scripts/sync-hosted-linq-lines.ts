import { getPrisma } from "../src/lib/prisma";
import { readHostedPhoneHint } from "../src/lib/hosted-onboarding/contact-privacy";
import { syncHostedLinqConfiguredLinesTx } from "../src/lib/hosted-onboarding/linq-line-store";
import { syncHostedLinqPhoneNumberInventory } from "../src/lib/hosted-onboarding/linq-phone-number-inventory";
import { getHostedOnboardingEnvironment } from "../src/lib/hosted-onboarding/runtime";

async function main(): Promise<void> {
  const prisma = getPrisma();
  const environment = getHostedOnboardingEnvironment();
  const observedAt = new Date();

  const inventory = await syncHostedLinqPhoneNumberInventory({
    observedAt,
    prisma,
  });

  await prisma.$transaction(async (tx) => {
    await syncHostedLinqConfiguredLinesTx({
      activeMemberLimit: environment.linqMaxActiveMembersPerConversationPhone,
      observedAt,
      phoneNumbers: environment.linqConversationPhoneNumbers,
      prisma: tx,
    });
  });

  const configuredHints = environment.linqConversationPhoneNumbers
    .map((phoneNumber) => readHostedPhoneHint(phoneNumber))
    .join(", ");

  console.log(`Synced ${inventory.syncedCount} Linq provider inventory line(s).`);
  console.log(
    `Configured ${environment.linqConversationPhoneNumbers.length} hosted Linq line(s)${
      configuredHints ? `: ${configuredHints}` : "."
    }`,
  );
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
