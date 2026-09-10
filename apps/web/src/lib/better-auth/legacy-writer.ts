import "server-only";
import type { Prisma } from "@prisma/client";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

// Caller already holds the member row lock (or inserted the new member in this
// transaction), after any contact lock. Presence only denies legacy writes;
// it never grants authority from an unauthenticated projection.
export async function assertHostedLegacyCredentialWriterTx(prisma: Prisma.TransactionClient, memberId: string): Promise<void> {
  const migrated = await prisma.hostedAuthRecord.findUnique({
    where: { model_id: { model: "user", id: memberId } }, select: { id: true },
  });
  if (migrated) throw hostedOnboardingError({
    code: "AUTHORITY_MIGRATED", httpStatus: 409,
    message: "Refresh Murph to manage your sign-in methods.",
  });
}
