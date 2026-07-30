import { getPrisma } from "@/src/lib/prisma";
import {
  signalHostedMailboxAppendRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { readHostedPhoneHint } from "@/src/lib/hosted-onboarding/contact-privacy";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import {
  assertHostedMemberNotSuspended,
} from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { readHostedMemberIdentity } from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx,
} from "@/src/lib/hosted-onboarding/member-channel-sync";
import { reconcileHostedPrivyIdentityOnMemberTx } from "@/src/lib/hosted-onboarding/member-identity-service";
import { normalizePhoneNumber } from "@/src/lib/hosted-onboarding/phone";
import { readHostedPrivyUserById } from "@/src/lib/hosted-onboarding/privy";
import { buildHostedPrivySessionState } from "@/src/lib/hosted-onboarding/privy-user";
import { requireFreshPrivyMemberAuthForHostedAppSession } from "@/src/lib/hosted-onboarding/request-auth";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const { appSession, freshPrivy: auth } =
    await requireFreshPrivyMemberAuthForHostedAppSession(request);
  assertHostedMemberNotSuspended(auth.member);
  const expectation = readPhoneSyncExpectation(
    await readOptionalJsonObject(request, { limitBytes: 1_024 }),
  );
  const providerSession = buildHostedPrivySessionState(
    await readHostedPrivyUserById(appSession.privyUserId),
  );
  const phoneNumber = normalizePhoneNumber(providerSession.identity.phone?.number);

  assertPhoneSyncExpectation({
    expectation,
    phoneNumber,
  });

  const prisma = getPrisma();
  const now = new Date();
  const syncResult = await prisma.$transaction(async (tx) => {
    const currentIdentity = await readHostedMemberIdentity({
      memberId: auth.member.id,
      prisma: tx,
    });
    const currentPhoneNumber = normalizePhoneNumber(currentIdentity?.phoneNumber);

    if (expectation.kind === "prepare") {
      if (!phoneNumber || phoneNumber === currentPhoneNumber) {
        return {
          channelSyncDispatch: null,
          result: {
            phoneNumber,
            status: "ready" as const,
          },
        };
      }
    } else if (
      expectation.kind === "changed-from"
      && phoneNumber === expectation.phoneNumber
    ) {
      return {
        channelSyncDispatch: null,
        result: {
          status: "unchanged" as const,
        },
      };
    }

    if (!phoneNumber) {
      throwPhoneNotReady();
    }

    if (phoneNumber === currentPhoneNumber) {
      return {
        channelSyncDispatch: null,
        result: buildSyncedPhoneResult(phoneNumber, false),
      };
    }

    await reconcileHostedPrivyIdentityOnMemberTx({
      identity: providerSession.identity,
      member: auth.member,
      now,
      prisma: tx,
    });

    const channelSyncDispatch =
      await enqueueHostedMemberChannelsUpdatedForActiveMemberTx({
      linkedAccounts: providerSession.linkedAccounts,
      memberId: auth.member.id,
      occurredAt: now.toISOString(),
      prisma: tx,
      sourceType: "settings.phone.sync",
    });

    return {
      channelSyncDispatch,
      result: buildSyncedPhoneResult(
        phoneNumber,
        channelSyncDispatch !== null,
      ),
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (syncResult.channelSyncDispatch) {
    await signalHostedMailboxAppendBestEffort({
      expectedUserId: auth.member.id,
      mailboxItemId: syncResult.channelSyncDispatch.mailboxItemId,
    });
  }

  return jsonOk(syncResult.result);
});

type PhoneSyncExpectation =
  | {
      kind: "changed-from";
      phoneNumber: string | null;
    }
  | {
      kind: "exact";
      phoneNumber: string;
    }
  | {
      kind: "prepare";
    };

function readPhoneSyncExpectation(body: Record<string, unknown>): PhoneSyncExpectation {
  if (body.kind === "prepare") {
    return {
      kind: "prepare",
    };
  }

  if (body.kind === "exact") {
    const phoneNumber = normalizePhoneNumber(
      typeof body.phoneNumber === "string" ? body.phoneNumber : null,
    );
    if (phoneNumber) {
      return {
        kind: "exact",
        phoneNumber,
      };
    }
  }

  if (body.kind === "changed-from") {
    const rawPhoneNumber = body.phoneNumber;
    const phoneNumber = rawPhoneNumber === null
      ? null
      : normalizePhoneNumber(
          typeof rawPhoneNumber === "string" ? rawPhoneNumber : null,
        );

    if (rawPhoneNumber === null || phoneNumber) {
      return {
        kind: "changed-from",
        phoneNumber,
      };
    }
  }

  throw hostedOnboardingError({
    code: "PHONE_SYNC_REQUEST_INVALID",
    message: "The phone verification request was invalid. Try again.",
    httpStatus: 400,
  });
}

function assertPhoneSyncExpectation(input: {
  expectation: PhoneSyncExpectation;
  phoneNumber: string | null;
}): void {
  if (
    input.expectation.kind === "exact"
    && input.expectation.phoneNumber !== input.phoneNumber
  ) {
    throwPhoneNotReady();
  }

  if (
    input.expectation.kind === "changed-from"
    && input.phoneNumber === null
    && input.expectation.phoneNumber !== null
  ) {
    throwPhoneNotReady();
  }
}

function throwPhoneNotReady(): never {
  throw hostedOnboardingError({
    code: "PRIVY_PHONE_NOT_READY",
    message:
      "Your verified phone number has not reached Privy yet. Wait a moment and try again.",
    httpStatus: 409,
    retryable: true,
  });
}

function buildSyncedPhoneResult(phoneNumber: string, runTriggered: boolean) {
  return {
    phoneNumber,
    phoneNumberHint: readHostedPhoneHint(phoneNumber),
    runTriggered,
    status: "synced" as const,
  };
}

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
