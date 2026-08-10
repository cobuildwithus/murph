import { getPrisma } from "@/src/lib/prisma";
import {
  signalHostedMailboxAppendRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import {
  deleteHostedPrivyPhoneTransferSourceAccountData,
} from "@/src/lib/hosted-privacy/account-data-service";
import {
  hostedPhoneLookupKeyMatchesValue,
  readHostedPhoneHint,
} from "@/src/lib/hosted-onboarding/contact-privacy";
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
import {
  reconcileHostedPrivyIdentityOnMemberTx,
} from "@/src/lib/hosted-onboarding/member-identity-service";
import {
  HOSTED_PRIVY_PHONE_TRANSFER_RETIREMENT_TRANSACTION_OPTIONS,
  prepareHostedPrivyPhoneTransferSourceRetirementTx,
  readHostedPrivyPhoneTransferProof,
} from "@/src/lib/hosted-onboarding/privy-phone-transfer-retirement";
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
  traceHostedPhoneSync("provider-session-read", {
    expectationKind: expectation.kind,
    providerPhonePresent: Boolean(phoneNumber),
  });

  if (!phoneNumber) {
    if (
      expectation.kind === "changed-from"
      && expectation.phoneNumber === null
    ) {
      return jsonOk({
        status: "unchanged" as const,
      });
    }
    throwPhoneNotReady();
  }

  const prisma = getPrisma();
  const currentIdentity = await readHostedMemberIdentity({
    memberId: auth.member.id,
    prisma,
  });
  const currentPhoneNumber = normalizePhoneNumber(currentIdentity?.phoneNumber);
  const currentProjectionAligned = isHostedPhoneProjectionAligned({
    currentIdentity,
    identity: providerSession.identity,
    phoneNumber,
  });

  if (
    expectation.kind === "changed-from"
    && phoneNumber === expectation.phoneNumber
    && currentProjectionAligned
  ) {
    return jsonOk({
      status: "unchanged" as const,
    });
  }
  if (phoneNumber === currentPhoneNumber && currentProjectionAligned) {
    return jsonOk(buildSyncedPhoneResult(phoneNumber, false));
  }

  const phoneTransfer = await readHostedPrivyPhoneTransferProof({
    identity: providerSession.identity,
    memberId: auth.member.id,
    prisma,
  });
  traceHostedPhoneSync("transfer-proof-read", {
    transferRequired: Boolean(phoneTransfer),
  });
  const now = new Date();
  if (phoneTransfer) {
    const retirement = await prisma.$transaction((tx) =>
      prepareHostedPrivyPhoneTransferSourceRetirementTx({
        identity: providerSession.identity,
        member: auth.member,
        now,
        prisma: tx,
        targetPhoneNumberBeforeTransfer:
          currentIdentity?.phoneNumber ?? null,
        transfer: phoneTransfer,
      }), HOSTED_PRIVY_PHONE_TRANSFER_RETIREMENT_TRANSACTION_OPTIONS);
    traceHostedPhoneSync("source-classified", {
      sourceKind: retirement.autoTrialBilling
        ? "legacy-auto-trial"
        : "non-billing-scaffold",
    });
    const deletion =
      await deleteHostedPrivyPhoneTransferSourceAccountData({
        prisma,
        request,
        retirement,
        targetMember: auth.member,
        targetPhoneNumberBeforeTransfer:
          currentIdentity?.phoneNumber ?? null,
        targetPrivyUserId: appSession.privyUserId,
        transfer: phoneTransfer,
      });
    traceHostedPhoneSync("transfer-committed", {
      channelSyncQueued: deletion.channelSyncDispatch !== null,
    });
    if (deletion.channelSyncDispatch) {
      await signalHostedMailboxAppendBestEffort({
        expectedUserId: auth.member.id,
        mailboxItemId: deletion.channelSyncDispatch.mailboxItemId,
      });
    }
    return jsonOk(buildSyncedPhoneResult(
      phoneNumber,
      deletion.channelSyncDispatch !== null,
    ));
  }

  const syncResult = await prisma.$transaction(async (tx) => {
    const transactionIdentity = await readHostedMemberIdentity({
      memberId: auth.member.id,
      prisma: tx,
    });
    if (isHostedPhoneProjectionAligned({
      currentIdentity: transactionIdentity,
      identity: providerSession.identity,
      phoneNumber,
    })) {
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

  traceHostedPhoneSync("projection-reconciled", {
    channelSyncQueued: syncResult.channelSyncDispatch !== null,
  });
  return jsonOk(syncResult.result);
});

function traceHostedPhoneSync(
  phase: string,
  details: Record<string, boolean | string>,
): void {
  if (process.env.MURPH_DEV_PHONE_SYNC_TRACE !== "1") {
    return;
  }

  console.info("Hosted settings phone sync trace.", {
    ...details,
    phase,
  });
}

function isHostedPhoneProjectionAligned(input: {
  currentIdentity: Awaited<ReturnType<typeof readHostedMemberIdentity>>;
  identity: ReturnType<typeof buildHostedPrivySessionState>["identity"];
  phoneNumber: string;
}): boolean {
  return Boolean(
    input.currentIdentity
    && input.currentIdentity.phoneNumber === input.phoneNumber
    && input.currentIdentity.phoneNumberVerifiedAt
    && input.currentIdentity.privyUserId === input.identity.userId
    && input.currentIdentity.phoneLookupKey
    && hostedPhoneLookupKeyMatchesValue(
      input.phoneNumber,
      input.currentIdentity.phoneLookupKey,
    )
  );
}

type PhoneSyncExpectation =
  | {
      kind: "changed-from";
      phoneNumber: string | null;
    }
  | {
      kind: "exact";
      phoneNumber: string;
    };

function readPhoneSyncExpectation(body: Record<string, unknown>): PhoneSyncExpectation {
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
