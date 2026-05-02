import { getPrisma } from "@/src/lib/prisma";
import { nudgeHostedRunnerBestEffort } from "@/src/lib/hosted-runner/control";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { upsertHostedMemberEmailAuthorization } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import { enqueueHostedMemberChannelsUpdatedTx } from "@/src/lib/hosted-onboarding/member-channel-sync";
import {
  extractHostedPrivyVerifiedEmailAccount,
} from "@/src/lib/hosted-onboarding/privy-shared";
import { requireFreshActivePrivyMemberAuthForHostedAppSession } from "@/src/lib/hosted-onboarding/request-auth";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const { freshPrivy: auth } = await requireFreshActivePrivyMemberAuthForHostedAppSession(request);
  const body = await readOptionalJsonObject(request);
  const expectedEmailAddress = normalizeComparableEmail(
    typeof body.expectedEmailAddress === "string" ? body.expectedEmailAddress : null,
  );
  const verifiedEmail = extractHostedPrivyVerifiedEmailAccount(auth.linkedAccounts);
  const comparableVerifiedEmail = normalizeComparableEmail(verifiedEmail?.address ?? null);

  if (!verifiedEmail || (expectedEmailAddress && expectedEmailAddress !== comparableVerifiedEmail)) {
    throw hostedOnboardingError({
      code: "PRIVY_EMAIL_NOT_READY",
      message:
        "Your verified email has not reached the server-side Privy session yet. Wait a moment and try again.",
      httpStatus: 409,
      retryable: true,
    });
  }

  const now = new Date().toISOString();
  const verifiedAt = new Date(verifiedEmail.verifiedAt * 1000).toISOString();
  await getPrisma().$transaction((tx) => {
    return upsertHostedMemberEmailAuthorization({
      directPublicSender: {
        address: verifiedEmail.address,
        authorizedAt: new Date(verifiedAt),
      },
      memberId: auth.member.id,
      prisma: tx,
      verifiedEmail: {
        address: verifiedEmail.address,
        verifiedAt: new Date(verifiedAt),
      },
    }).then(() =>
      enqueueHostedMemberChannelsUpdatedTx({
        emailLinked: true,
        memberId: auth.member.id,
        occurredAt: now,
        prisma: tx,
        sourceType: "settings.email.sync",
      })
    );
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  await nudgeHostedRunnerBestEffort({
    context: "settings.email.sync",
    userId: auth.member.id,
  });

  return jsonOk({
    emailAddress: verifiedEmail.address,
    ok: true,
    runTriggered: true,
    verifiedAt,
  });
});

function normalizeComparableEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized.toLowerCase() : null;
}
