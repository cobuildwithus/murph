import { getPrisma } from "../src/lib/prisma";
import { readHostedPhoneHint } from "../src/lib/hosted-onboarding/contact-privacy";
import {
  assertHostedLinqAssignableHomeLinePoolReady,
  syncHostedLinqConfiguredLinesTx,
} from "../src/lib/hosted-onboarding/linq-line-store";
import { sanitizeHostedOnboardingLogString } from "../src/lib/hosted-onboarding/http";
import {
  HOSTED_LINQ_PHONE_NUMBER_INVENTORY_SYNC_LIMIT,
  syncHostedLinqPhoneNumberInventory,
} from "../src/lib/hosted-onboarding/linq-phone-number-inventory";
import { getHostedOnboardingEnvironment } from "../src/lib/hosted-onboarding/runtime";

async function main(): Promise<void> {
  const prisma = getPrisma();
  const environment = getHostedOnboardingEnvironment();
  const observedAt = new Date();
  const syncProviderInventory = !process.argv.includes("--skip-provider-inventory");

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
    .filter((hint): hint is string => typeof hint === "string" && hint.length > 0);

  console.log(
    `Configured ${environment.linqConversationPhoneNumbers.length} hosted Linq line(s)${
      configuredHints.length > 0 ? `: ${configuredHints.join(", ")}` : "."
    }`,
  );

  if (syncProviderInventory) {
    const inventory = await syncHostedLinqPhoneNumberInventory({
      maxLines: HOSTED_LINQ_PHONE_NUMBER_INVENTORY_SYNC_LIMIT,
      observedAt,
      prisma,
    });
    console.log(`Synced ${inventory.syncedCount} Linq provider inventory line(s).`);
  } else {
    console.log("Skipped Linq provider inventory sync.");
  }

  await assertHostedLinqAssignableHomeLinePoolReady({
    prisma,
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error: unknown) => {
    console.error(
      sanitizeHostedOnboardingLogString(error instanceof Error ? error.message : String(error))
      ?? "Hosted Linq line sync failed.",
    );
    process.exitCode = 1;
  });
}
