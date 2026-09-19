import type { Prisma } from "@prisma/client";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

// Caller holds the member deletion locks. Only the explicitly selected,
// never-onboarded legacy signup may cross the ordinary suspension fence.
export async function assertUnusedHostedSignupTx(input: {
  createdAt: Date;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const signupWindowEnd = new Date(input.createdAt.getTime() + 10 * 60_000);
  const member = await input.tx.hostedMember.findFirst({
    select: { id: true },
    where: {
      id: input.memberId, createdAt: input.createdAt,
      billingStatus: "not_started", initialOnboardingCompletedAt: null,
      authRecords: { none: {} }, approvalCredentials: { is: null },
      hostedWorkspace: { is: null }, hostedMailboxItems: { none: {} },
      identity: { is: {
        privyUserIdEncrypted: { not: null }, privyUserLookupKey: { not: null },
        phoneNumberEncrypted: null, phoneLookupKey: null, phoneNumberVerifiedAt: null,
        walletAddressEncrypted: null, walletAddressLookupKey: null,
        signupPhoneNumberEncrypted: null, linqEmailHandleEncrypted: null,
      } },
      AND: [
        { OR: [{ routing: { is: null } }, { routing: { is: {
          telegramUserIdEncrypted: null, linqChatLookupKey: null,
          linqRecipientPhoneLookupKey: null, pendingLinqChatLookupKey: null,
          pendingLinqRecipientPhoneLookupKey: null, pendingLinqParticipantContactLookupKey: null,
        } } }] },
        { OR: [{ emailAuthorization: { is: null } }, { emailAuthorization: { is: {
          verifiedEmailAddressEncrypted: null, verifiedEmailLookupKey: null,
          directPublicSenderAddressEncrypted: null, stripeCheckoutEmailAddressEncrypted: null,
        } } }] },
        { OR: [{ billingRef: { is: null } }, { billingRef: { is: {
          stripeCustomerLookupKey: null, stripeCustomerIdEncrypted: null,
          stripeSubscriptionLookupKey: null, stripeSubscriptionIdEncrypted: null,
          stripeCheckoutSessionLookupKey: null, stripeEffectClaimId: null,
        } } }] },
      ],
      webSessions: { none: { OR: [
        { createdAt: { gt: signupWindowEnd } }, { lastSeenAt: { gt: signupWindowEnd } },
      ] } },
      subscriptionCheckouts: { none: {} }, aiUsage: { none: {} },
      usageCreditPurchasesPaid: { none: {} }, usageCreditPurchasesReceived: { none: {} },
      usageCreditEntries: { none: {} }, hostedAiUsagePeriods: { none: {} },
      groupSponsorshipsPaid: { none: {} }, groupSponsorshipsReceived: { none: {} },
      accountGroupsOwned: { none: {} }, accountGroupMemberships: { none: {} },
      hostedGroupsOwned: { none: {} }, hostedGroupMemberships: { none: {} },
      hostedGroupRuntime: { is: null }, ownedThreadContainers: { none: {} },
      threadContainer: { is: null }, threadContainerParticipations: { none: {} },
      clinicalRecordConnections: { none: {} }, clinicalRecordConnectIntents: { none: {} },
      connectedAppsSession: { is: null }, connectedAppConnectIntents: { none: {} },
      mealPhotoCaptureEnrollments: { none: {} }, addressBookProjection: { is: null },
      codexAuthConnection: { is: null }, inferenceConnection: { is: null },
      computerRuns: { none: {} }, computerHandoffs: { none: {} },
      phoneCalls: { none: {} }, physicalNotes: { none: {} },
      vaultSharesGranted: { none: {} }, vaultSharesReceived: { none: {} },
    },
  });
  if (!member) throw unusedSignupChanged();
  // These device owners do not have a hosted-member relation. Each probe is
  // indexed by user and returns at most one row; never enumerate credentials.
  const device = await input.tx.deviceConnection.findFirst({ where: { userId: input.memberId }, select: { id: true } });
  const oauth = await input.tx.deviceOauthSession.findFirst({ where: { userId: input.memberId }, select: { state: true } });
  const intent = await input.tx.deviceConnectIntent.findFirst({ where: { memberId: input.memberId }, select: { claimHash: true } });
  if (device || oauth || intent) throw unusedSignupChanged();
}

function unusedSignupChanged() {
  return hostedOnboardingError({ code: "UNUSED_SIGNUP_CHANGED", httpStatus: 409,
    message: "The selected account no longer matches an unused legacy signup. No deletion was started." });
}
