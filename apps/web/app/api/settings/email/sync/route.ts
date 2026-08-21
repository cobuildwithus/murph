import { getPrisma } from "@/src/lib/prisma";
import {
  signalHostedMailboxAppendRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  prepareHostedMemberVerifiedEmailReplyAlias,
  readHostedMemberEmailAuthorization,
  syncHostedMemberVerifiedEmailAuthorization,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import { enqueueHostedMemberChannelsUpdatedTx } from "@/src/lib/hosted-onboarding/member-channel-sync";
import {
  extractHostedPrivyVerifiedEmailAccount,
} from "@/src/lib/hosted-onboarding/privy-shared";
import { requireFreshActivePrivyMemberAuthForHostedAppSession } from "@/src/lib/hosted-onboarding/request-auth";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "@/src/lib/hosted-onboarding/shared";
import {
  HostedSignupWelcomeEmailError,
  sendHostedSignupWelcomeEmailForRecentMember,
} from "@/src/lib/hosted-onboarding/signup-welcome-email";

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

  const verifiedAt = new Date(verifiedEmail.verifiedAt * 1000).toISOString();
  const prisma = getPrisma();
  const verifiedAtDate = new Date(verifiedAt);
  const occurredAt = new Date().toISOString();
  const preparedReplyAlias = await prepareHostedMemberVerifiedEmailReplyAlias({
    address: verifiedEmail.address,
    memberId: auth.member.id,
    prisma,
  });
  const channelSyncDispatch = await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, auth.member.id);
    const currentAuthorization = await readHostedMemberEmailAuthorization({
      memberId: auth.member.id,
      prisma: tx,
    });

    const emailAuthorizationMatches = hostedEmailAuthorizationMatchesVerifiedEmail({
      address: verifiedEmail.address,
      currentAuthorization,
      verifiedAt: verifiedAtDate,
    });

    await syncHostedMemberVerifiedEmailAuthorization({
      address: verifiedEmail.address,
      memberId: auth.member.id,
      preparedReplyAlias,
      prisma: tx,
      verifiedAt: verifiedAtDate,
    });

    if (emailAuthorizationMatches) {
      return null;
    }

    return enqueueHostedMemberChannelsUpdatedTx({
      emailLinked: true,
      memberId: auth.member.id,
      occurredAt,
      prisma: tx,
      sourceType: "settings.email.sync",
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  await sendSettingsEmailSyncWelcomeEmailBestEffort({
    memberId: auth.member.id,
    prisma,
  });
  if (channelSyncDispatch) {
    await signalHostedMailboxAppendBestEffort({
      expectedUserId: auth.member.id,
      mailboxItemId: channelSyncDispatch.mailboxItemId,
    });
  }

  return jsonOk({
    emailAddress: verifiedEmail.address,
    ok: true,
    runTriggered: channelSyncDispatch !== null,
    verifiedAt,
  });
});

async function signalHostedMailboxAppendBestEffort(input: {
  expectedUserId: string;
  mailboxItemId: string;
}): Promise<void> {
  try {
    await signalHostedMailboxAppendRuntime({
      expectedUserId: input.expectedUserId,
      mailboxItemId: input.mailboxItemId,
    });
  } catch {
    // Settings sync should not fail if the best-effort runtime wake is unavailable.
  }
}

async function sendSettingsEmailSyncWelcomeEmailBestEffort(input: {
  memberId: string;
  prisma: ReturnType<typeof getPrisma>;
}): Promise<void> {
  try {
    await sendHostedSignupWelcomeEmailForRecentMember({
      memberId: input.memberId,
      prisma: input.prisma,
    });
  } catch (error) {
    console.warn("Hosted signup welcome email send failed after settings email sync.", {
      ...(error instanceof HostedSignupWelcomeEmailError
        ? {
            errorCode: error.code,
            providerStatus: error.providerStatus,
          }
        : {
            errorName: error instanceof Error ? error.name : "UnknownError",
          }),
    });
  }
}

function normalizeComparableEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized.toLowerCase() : null;
}

function hostedEmailAuthorizationMatchesVerifiedEmail(input: {
  address: string;
  currentAuthorization: Awaited<ReturnType<typeof readHostedMemberEmailAuthorization>>;
  verifiedAt: Date;
}): boolean {
  const verifiedAddress = normalizeComparableEmail(input.address);
  const currentVerifiedEmail = input.currentAuthorization?.verifiedEmail;
  const currentDirectPublicSender = input.currentAuthorization?.directPublicSender;

  return (
    verifiedAddress !== null
    && normalizeComparableEmail(currentVerifiedEmail?.address) === verifiedAddress
    && currentVerifiedEmail?.verifiedAt.getTime() === input.verifiedAt.getTime()
    && normalizeComparableEmail(currentDirectPublicSender?.address) === verifiedAddress
    && currentDirectPublicSender?.authorizedAt.getTime() === input.verifiedAt.getTime()
  );
}
