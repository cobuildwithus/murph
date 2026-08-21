/**
 * Owns the core hosted_member row plus composed reads over the specialized
 * identity, routing, billing, and email-authorization store slices without
 * flattening them back into one wide row.
 */
import {
  HostedBillingStatus,
  type HostedMember,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { normalizeHostedEmailReplyAliasLookupKey } from "@murphai/hosted-execution/hosted-email";

import {
  createHostedEmailLookupKey,
  createHostedEmailLookupKeyReadCandidates,
} from "./contact-privacy";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import { createHostedMemberReplyAliasRoute } from "./hosted-email-reply-alias";
import { activeHostedMemberAccessWhere } from "./member-access";
import {
  decryptHostedWebNullableString,
  decryptHostedWebNullableStrings,
  encryptHostedWebNullableString,
  encryptHostedWebNullableStringFromPreparedRoot,
  type PreparedHostedWebEncryptionRoot,
} from "../hosted-web/encryption";
import {
  runWithHostedDomainRootProviderCallsDisabled,
  runWithHostedDomainRootUnwrapCache,
} from "../hosted-crypto/domain-root-unwrap-cache";
import {
  revalidatePreparedHostedDomainRootForWebTx,
  type PreparedHostedDomainRootForWeb,
} from "../hosted-crypto/domain-root-store";
import {
  type HostedMemberStripeBillingRefSnapshot,
  projectHostedMemberStripeBillingRefSnapshot,
} from "./hosted-member-billing-store";
import {
  type HostedMemberIdentityState,
  projectHostedMemberIdentityState,
} from "./hosted-member-identity-store";
import {
  type HostedMemberRoutingStateSnapshot,
  projectHostedMemberRoutingState,
  upsertHostedMemberReplyAliasLookupKeyTx,
} from "./hosted-member-routing-store";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  type HostedOnboardingReadClient,
} from "./shared";
import { readHostedMemberIdentityPhoneNumber } from "./member-private-codecs";

const HOSTED_MEMBER_EMAIL_AUTH_VERIFIED_EMAIL_FIELD =
  "hosted-member-email-authorization.verified-email";
const HOSTED_MEMBER_EMAIL_AUTH_DIRECT_PUBLIC_SENDER_FIELD =
  "hosted-member-email-authorization.direct-public-sender";
const HOSTED_MEMBER_EMAIL_AUTH_STRIPE_CHECKOUT_EMAIL_FIELD =
  "hosted-member-email-authorization.stripe-checkout-email";

// Assistant tone/voice are cosmetic preferences owned by `member-preferences.ts`.
// They stay out of core state so billing, auth, and routing paths never carry them.
export const hostedMemberCoreStateSelect = Prisma.validator<Prisma.HostedMemberSelect>()({
  billingStatus: true,
  createdAt: true,
  id: true,
  suspendedAt: true,
  updatedAt: true,
});

const hostedMemberActivationCoreStateSelect =
  Prisma.validator<Prisma.HostedMemberSelect>()({
    ...hostedMemberCoreStateSelect,
    pendingActivationTimeZone: true,
  });

const hostedMemberEmailAuthorizationStateSelect =
  Prisma.validator<Prisma.HostedMemberEmailAuthorizationSelect>()({
    directPublicSenderAddressEncrypted: true,
    directPublicSenderAuthorizedAt: true,
    directPublicSenderLookupKey: true,
    memberId: true,
    stripeCheckoutEmailAddressEncrypted: true,
    stripeCheckoutEmailCollectedAt: true,
    verifiedEmailAddressEncrypted: true,
    verifiedEmailLookupKey: true,
    verifiedEmailVerifiedAt: true,
  });

const hostedMemberEmailAuthorizationLookupSelect =
  Prisma.validator<Prisma.HostedMemberEmailAuthorizationSelect>()({
    ...hostedMemberEmailAuthorizationStateSelect,
    member: {
      select: hostedMemberCoreStateSelect,
    },
  });

const hostedMemberVerifiedEmailCoreLookupSelect =
  Prisma.validator<Prisma.HostedMemberEmailAuthorizationSelect>()({
    memberId: true,
    verifiedEmailVerifiedAt: true,
    member: {
      select: hostedMemberCoreStateSelect,
    },
  });

const hostedMemberVerifiedEmailSelect =
  Prisma.validator<Prisma.HostedMemberEmailAuthorizationSelect>()({
    memberId: true,
    verifiedEmailAddressEncrypted: true,
    verifiedEmailLookupKey: true,
    verifiedEmailVerifiedAt: true,
  });

export type HostedMemberCoreState = Prisma.HostedMemberGetPayload<{
  select: typeof hostedMemberCoreStateSelect;
}>;

export type HostedMemberActivationCoreState = Prisma.HostedMemberGetPayload<{
  select: typeof hostedMemberActivationCoreStateSelect;
}>;

export interface HostedMemberVerifiedEmailFact {
  address: string;
  lookupKey: string;
  verifiedAt: Date;
}

export interface HostedMemberDirectPublicSenderAuthorizationFact {
  address: string;
  authorizedAt: Date;
  lookupKey: string;
}

export interface HostedMemberStripeCheckoutEmailFact {
  address: string;
  collectedAt: Date;
}

export interface PreparedHostedMemberStripeCheckoutEmail {
  address: string;
  addressEncrypted: string;
  memberId: string;
}

export interface HostedMemberEmailAuthorizationState {
  directPublicSender: HostedMemberDirectPublicSenderAuthorizationFact | null;
  memberId: string;
  stripeCheckoutEmail: HostedMemberStripeCheckoutEmailFact | null;
  verifiedEmail: HostedMemberVerifiedEmailFact | null;
}

export interface HostedMemberEmailAuthorizationLookup {
  core: HostedMemberCoreState;
  emailAuthorization: HostedMemberEmailAuthorizationState;
  matchedBy: "verifiedEmail";
}

export interface HostedMemberVerifiedEmailCoreLookup {
  core: HostedMemberCoreState;
  matchedBy: "verifiedEmail";
}

export interface HostedMemberEmailSnapshot {
  core: HostedMemberCoreState;
  emailAuthorization: HostedMemberEmailAuthorizationState | null;
}

export interface HostedMemberVerifiedEmailSnapshot {
  memberId: string;
  verifiedEmail: HostedMemberVerifiedEmailFact | null;
}

export interface HostedMemberEmailAuthorizationWriteInput {
  directPublicSender?: {
    address: string;
    authorizedAt: Date;
  } | null;
  memberId: string;
  preparedControlRoot?: PreparedHostedDomainRootForWeb;
  prisma: Prisma.TransactionClient;
  stripeCheckoutEmail?: {
    address: string;
    collectedAt: Date;
  } | null;
  verifiedEmail?: {
    address: string;
    verifiedAt: Date;
  } | null;
}

export interface HostedMemberVerifiedEmailSyncInput {
  address: string;
  memberId: string;
  preparedControlRoot?: PreparedHostedDomainRootForWeb;
  preparedReplyAlias?: HostedMemberVerifiedEmailReplyAliasPreparation;
  prisma?: Prisma.TransactionClient | HostedOnboardingReadClient;
  verifiedAt: Date;
}

export interface HostedMemberVerifiedEmailReplyAliasPreparation {
  generation: number;
  lookupKey: string | null;
  memberId: string;
  verifiedEmailLookupKeys: string[];
}

/**
 * Billing orchestration should depend on the core+billing slice instead of the
 * full hosted member snapshot so Stripe flows do not silently couple to
 * identity and routing ownership.
 */
export interface HostedMemberBillingSnapshot {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  core: HostedMemberCoreState;
}

export interface HostedMemberSnapshot extends HostedMemberBillingSnapshot {
  emailAuthorization?: HostedMemberEmailAuthorizationState | null;
  identity: HostedMemberIdentityState | null;
  routing: HostedMemberRoutingStateSnapshot | null;
}

export interface HostedMemberAssistantNotificationState {
  identity: Pick<HostedMemberIdentityState, "phoneLookupKey" | "phoneNumber"> | null;
  routing: HostedMemberRoutingStateSnapshot | null;
}

export interface HostedMemberMessagingSetupState {
  identity: Pick<HostedMemberIdentityState, "phoneLookupKey"> | null;
  routing: Pick<
    HostedMemberRoutingStateSnapshot,
    | "linqChatId"
    | "pendingLinqChatId"
    | "pendingLinqParticipantContact"
    | "telegramThreadId"
    | "telegramUserId"
  > | null;
}

export async function createHostedMember(input: {
  billingStatus: HostedMember["billingStatus"];
  memberId: string;
  prisma: Prisma.TransactionClient;
  suspendedAt?: Date | null;
}): Promise<HostedMemberCoreState> {
  return input.prisma.hostedMember.create({
    data: {
      billingStatus: input.billingStatus,
      id: input.memberId,
      // The database default protects legacy writers during a rolling deploy.
      // Current signup owns pending onboarding explicitly.
      initialOnboardingCompletedAt: null,
      ...(input.suspendedAt !== undefined
        ? {
            suspendedAt: input.suspendedAt,
          }
        : {}),
    },
    select: hostedMemberCoreStateSelect,
  });
}

export async function readHostedMemberCoreState(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberCoreState | null> {
  return input.prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    select: hostedMemberCoreStateSelect,
  });
}

export async function readHostedMemberEmailSnapshots(input: {
  memberIds: readonly string[];
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberEmailSnapshot[]> {
  if (input.memberIds.length === 0) {
    return [];
  }

  const records = await input.prisma.hostedMember.findMany({
    where: {
      id: {
        in: [...input.memberIds],
      },
    },
    select: {
      ...hostedMemberCoreStateSelect,
      emailAuthorization: {
        select: hostedMemberEmailAuthorizationStateSelect,
      },
    },
  });

  // Sequential on purpose: each projection can read per-member crypto envelopes,
  // so running members in parallel fans out one query per member on the pool.
  const snapshots: HostedMemberEmailSnapshot[] = [];
  for (const record of records) {
    snapshots.push({
      core: projectHostedMemberCoreState(record),
      emailAuthorization: record.emailAuthorization
        ? await projectHostedMemberEmailAuthorizationState(
            record.emailAuthorization,
            input.prisma,
          )
        : null,
    });
  }
  return snapshots;
}

export async function readHostedMemberVerifiedEmailSnapshots(input: {
  memberIds: readonly string[];
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberVerifiedEmailSnapshot[]> {
  const memberIds = [...new Set(input.memberIds)];
  if (memberIds.length === 0) {
    return [];
  }

  const records = await input.prisma.hostedMemberEmailAuthorization.findMany({
    where: {
      memberId: {
        in: memberIds,
      },
    },
    select: hostedMemberVerifiedEmailSelect,
  });

  const addresses = await decryptHostedWebNullableStrings({
    field: HOSTED_MEMBER_EMAIL_AUTH_VERIFIED_EMAIL_FIELD,
    prisma: input.prisma,
    values: records.map((record) => ({
      memberId: record.memberId,
      value: record.verifiedEmailAddressEncrypted,
    })),
  });
  return records.map((record, index) => {
    const address = addresses[index] ?? null;
    return {
      memberId: record.memberId,
      verifiedEmail:
        address
        && record.verifiedEmailLookupKey
        && record.verifiedEmailVerifiedAt
          ? {
              address,
              lookupKey: record.verifiedEmailLookupKey,
              verifiedAt: record.verifiedEmailVerifiedAt,
            }
          : null,
    };
  });
}

export async function claimHostedMemberSignupWelcomeEmailAttempt(input: {
  attemptedAt: Date;
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<boolean> {
  const result = await input.prisma.hostedMember.updateMany({
    data: {
      signupWelcomeEmailAttemptedAt: input.attemptedAt,
    },
    where: {
      billingStatus: HostedBillingStatus.active,
      id: input.memberId,
      signupWelcomeEmailAttemptedAt: null,
      suspendedAt: null,
    },
  });

  return result.count === 1;
}

export async function claimHostedMemberSignupNotificationEmailAttempt(input: {
  attemptedAt: Date;
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<boolean> {
  const result = await input.prisma.hostedMember.updateMany({
    data: {
      signupNotificationEmailAttemptedAt: input.attemptedAt,
    },
    where: {
      ...activeHostedMemberAccessWhere(),
      id: input.memberId,
      signupNotificationEmailAttemptedAt: null,
    },
  });

  return result.count === 1;
}

export async function readHostedMemberActivationCoreState(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberActivationCoreState | null> {
  return input.prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    select: hostedMemberActivationCoreStateSelect,
  });
}

export async function readHostedMemberBillingSnapshot(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberBillingSnapshot | null> {
  const memberRecord = await input.prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    include: {
      billingRef: true,
    },
  });

  if (!memberRecord) {
    return null;
  }

  return composeHostedMemberBillingSnapshot(
    projectHostedMemberCoreState(memberRecord),
    memberRecord.billingRef
      ? await projectHostedMemberStripeBillingRefSnapshot(memberRecord.billingRef, input.prisma)
      : null,
  );
}

export interface HostedMemberPulseTrialBillingDecisionSnapshot {
  core: HostedMemberCoreState;
  currentBillingPhase: string | null;
  currentTrialStartedAt: Date | null;
  pulseTrialRedeemedAt: Date | null;
  stripeSubscriptionLookupKey: string | null;
}

/**
 * Reads only the durable fields needed to classify a Pulse completion. Stripe
 * identity comparison uses the deterministic lookup key, so this locked read
 * never needs a KMS unwrap.
 */
export async function readHostedMemberPulseTrialBillingDecisionSnapshot(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberPulseTrialBillingDecisionSnapshot | null> {
  const memberRecord = await input.prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    select: {
      ...hostedMemberCoreStateSelect,
      billingRef: {
        select: {
          currentBillingPhase: true,
          currentTrialStartedAt: true,
          pulseTrialRedeemedAt: true,
          stripeSubscriptionLookupKey: true,
        },
      },
    },
  });
  if (!memberRecord) {
    return null;
  }

  return {
    core: projectHostedMemberCoreState(memberRecord),
    currentBillingPhase:
      memberRecord.billingRef?.currentBillingPhase ?? null,
    currentTrialStartedAt:
      memberRecord.billingRef?.currentTrialStartedAt ?? null,
    pulseTrialRedeemedAt:
      memberRecord.billingRef?.pulseTrialRedeemedAt ?? null,
    stripeSubscriptionLookupKey:
      memberRecord.billingRef?.stripeSubscriptionLookupKey ?? null,
  };
}

export async function readHostedMemberEmailAuthorization(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberEmailAuthorizationState | null> {
  const record = await input.prisma.hostedMemberEmailAuthorization.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: hostedMemberEmailAuthorizationStateSelect,
  });

  return record ? await projectHostedMemberEmailAuthorizationState(record, input.prisma) : null;
}

export async function readHostedMemberIdByAuthorizedDirectPublicSenderAddress(input: {
  address: string | null | undefined;
  prisma: HostedOnboardingReadClient;
}): Promise<string | null> {
  const lookupKey = createHostedEmailLookupKey(input.address);

  if (!lookupKey) {
    return null;
  }

  const record = await input.prisma.hostedMemberEmailAuthorization.findUnique({
    where: {
      directPublicSenderLookupKey: lookupKey,
    },
    select: {
      directPublicSenderAuthorizedAt: true,
      memberId: true,
    },
  });

  return record?.directPublicSenderAuthorizedAt
    ? record.memberId
    : null;
}

type HostedMemberByVerifiedEmailAddressInput = {
  address: string | null | undefined;
  prisma: HostedOnboardingReadClient;
};

export async function lookupHostedMemberByVerifiedEmailAddress(
  input: HostedMemberByVerifiedEmailAddressInput & { projection: "core" },
): Promise<HostedMemberVerifiedEmailCoreLookup | null>;
export async function lookupHostedMemberByVerifiedEmailAddress(
  input: HostedMemberByVerifiedEmailAddressInput,
): Promise<HostedMemberEmailAuthorizationLookup | null>;
export async function lookupHostedMemberByVerifiedEmailAddress(
  input: HostedMemberByVerifiedEmailAddressInput & { projection?: "core" },
): Promise<
  HostedMemberEmailAuthorizationLookup | HostedMemberVerifiedEmailCoreLookup | null
> {
  const lookupKeys = createHostedEmailLookupKeyReadCandidates(input.address);

  if (lookupKeys.length === 0) {
    return null;
  }

  if (input.projection === "core") {
    const records = await input.prisma.hostedMemberEmailAuthorization.findMany({
      where: {
        verifiedEmailLookupKey: {
          in: lookupKeys,
        },
        verifiedEmailVerifiedAt: {
          not: null,
        },
      },
      select: hostedMemberVerifiedEmailCoreLookupSelect,
    });
    return resolveHostedMemberVerifiedEmailCoreLookup(records);
  }

  const records = await input.prisma.hostedMemberEmailAuthorization.findMany({
    where: {
      verifiedEmailLookupKey: {
        in: lookupKeys,
      },
      verifiedEmailVerifiedAt: {
        not: null,
      },
    },
    select: hostedMemberEmailAuthorizationLookupSelect,
  });

  return resolveHostedMemberVerifiedEmailLookup(records, input.prisma);
}

export async function upsertHostedMemberEmailAuthorization(
  input: HostedMemberEmailAuthorizationWriteInput,
): Promise<HostedMemberEmailAuthorizationState> {
  if (
    input.verifiedEmail === undefined
    && input.directPublicSender === undefined
    && input.stripeCheckoutEmail === undefined
  ) {
    throw new TypeError("Hosted member email authorization updates require at least one fact.");
  }

  const preparedRoot = input.preparedControlRoot
    ? await revalidateHostedMemberEmailPreparedRootTx({
        memberId: input.memberId,
        prepared: input.preparedControlRoot,
        tx: input.prisma,
      })
    : undefined;
  const record = await input.prisma.hostedMemberEmailAuthorization.upsert({
    where: {
      memberId: input.memberId,
    },
    create: await buildHostedMemberEmailAuthorizationCreateData(input, preparedRoot),
    update: await buildHostedMemberEmailAuthorizationUpdateData(input, preparedRoot),
    select: hostedMemberEmailAuthorizationStateSelect,
  });

  return projectHostedMemberEmailAuthorizationState(record, input.prisma);
}

export async function upsertHostedMemberStripeCheckoutEmailIfFreshTx(input: {
  address: string;
  collectedAt: Date;
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberEmailAuthorizationState | null> {
  await lockHostedMemberRow(input.prisma, input.memberId);

  const current = await input.prisma.hostedMemberEmailAuthorization.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: {
      stripeCheckoutEmailCollectedAt: true,
    },
  });

  if (
    current?.stripeCheckoutEmailCollectedAt
    && input.collectedAt.getTime() <= current.stripeCheckoutEmailCollectedAt.getTime()
  ) {
    return null;
  }

  return upsertHostedMemberEmailAuthorization({
    memberId: input.memberId,
    prisma: input.prisma,
    stripeCheckoutEmail: {
      address: input.address,
      collectedAt: input.collectedAt,
    },
  });
}

export async function prepareHostedMemberStripeCheckoutEmail(input: {
  address: string;
  memberId: string;
  prisma: PrismaClient;
}): Promise<PreparedHostedMemberStripeCheckoutEmail> {
  if (!createHostedEmailLookupKey(input.address)) {
    throw new TypeError("Hosted Stripe checkout email must be a valid email address.");
  }
  const addressEncrypted = await encryptHostedWebNullableString({
    field: HOSTED_MEMBER_EMAIL_AUTH_STRIPE_CHECKOUT_EMAIL_FIELD,
    memberId: input.memberId,
    prisma: input.prisma,
    value: input.address,
  });
  if (!addressEncrypted) {
    throw new TypeError("Hosted Stripe checkout email encryption failed.");
  }
  return {
    address: input.address,
    addressEncrypted,
    memberId: input.memberId,
  };
}

export async function upsertPreparedHostedMemberStripeCheckoutEmailIfFreshUnderLockTx(
  input: {
    collectedAt: Date;
    memberId: string;
    preparedEmail: PreparedHostedMemberStripeCheckoutEmail;
    tx: Prisma.TransactionClient;
  },
): Promise<void> {
  if (input.preparedEmail.memberId !== input.memberId) {
    throw new TypeError("Prepared Stripe checkout email has a different owner.");
  }
  const current = await input.tx.hostedMemberEmailAuthorization.findUnique({
    select: {
      stripeCheckoutEmailCollectedAt: true,
    },
    where: {
      memberId: input.memberId,
    },
  });
  if (
    current?.stripeCheckoutEmailCollectedAt
    && input.collectedAt.getTime() <=
      current.stripeCheckoutEmailCollectedAt.getTime()
  ) {
    return;
  }
  await input.tx.hostedMemberEmailAuthorization.upsert({
    create: {
      memberId: input.memberId,
      stripeCheckoutEmailAddressEncrypted:
        input.preparedEmail.addressEncrypted,
      stripeCheckoutEmailCollectedAt: input.collectedAt,
    },
    update: {
      stripeCheckoutEmailAddressEncrypted:
        input.preparedEmail.addressEncrypted,
      stripeCheckoutEmailCollectedAt: input.collectedAt,
    },
    where: {
      memberId: input.memberId,
    },
  });
}

export async function syncHostedMemberVerifiedEmailAuthorization(
  input: HostedMemberVerifiedEmailSyncInput,
): Promise<HostedMemberEmailAuthorizationState> {
  const prismaClient = input.prisma;

  if (
    !input.preparedReplyAlias
    && prismaClient
    && "$transaction" in prismaClient
    && typeof prismaClient.$transaction === "function"
  ) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const preparedReplyAlias = await prepareHostedMemberVerifiedEmailReplyAlias({
        address: input.address,
        memberId: input.memberId,
        prisma: prismaClient,
      });
      try {
        return await prismaClient.$transaction((tx: Prisma.TransactionClient) => {
          const write = () => runWithHostedDomainRootUnwrapCache(() =>
            upsertHostedMemberVerifiedEmailAuthorizationTx({
              ...input,
              preparedReplyAlias,
              prisma: tx,
            })
          );
          return input.preparedControlRoot
            ? runWithHostedDomainRootProviderCallsDisabled(write)
            : write();
        }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
      } catch (error) {
        if (
          attempt === 0
          && isHostedOnboardingError(error)
          && error.code === "HOSTED_EMAIL_REPLY_ALIAS_STALE"
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("Hosted member reply alias preparation retry was exhausted.");
  }

  return upsertHostedMemberVerifiedEmailAuthorizationTx({
    memberId: input.memberId,
    preparedControlRoot: input.preparedControlRoot,
    preparedReplyAlias: input.preparedReplyAlias,
    prisma: input.prisma as Prisma.TransactionClient,
    address: input.address,
    verifiedAt: input.verifiedAt,
  });
}

export async function prepareHostedMemberVerifiedEmailReplyAlias(input: {
  address: string;
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberVerifiedEmailReplyAliasPreparation> {
  const [currentAuthorization, currentRouting] = await Promise.all([
    input.prisma.hostedMemberEmailAuthorization.findUnique({
      where: { memberId: input.memberId },
      select: {
        verifiedEmailLookupKey: true,
        verifiedEmailVerifiedAt: true,
      },
    }),
    input.prisma.hostedMemberRouting.findUnique({
      where: { memberId: input.memberId },
      select: { replyAliasGeneration: true },
    }),
  ]);
  const currentGeneration = requireHostedMemberReplyAliasGeneration(
    currentRouting?.replyAliasGeneration ?? 0,
  );
  const verifiedEmailLookupKeys = createHostedEmailLookupKeyReadCandidates(
    input.address,
  );
  const sameVerifiedAddress = Boolean(
    currentAuthorization?.verifiedEmailVerifiedAt
    && currentAuthorization.verifiedEmailLookupKey
    && verifiedEmailLookupKeys.includes(currentAuthorization.verifiedEmailLookupKey),
  );
  const generation = currentAuthorization?.verifiedEmailVerifiedAt
    && !sameVerifiedAddress
    ? incrementHostedMemberReplyAliasGeneration(currentGeneration)
    : currentGeneration;
  const route = await createHostedMemberReplyAliasRoute({
    generation,
    memberId: input.memberId,
  });

  return {
    generation,
    lookupKey: route?.replyAliasLookupKey ?? null,
    memberId: input.memberId,
    verifiedEmailLookupKeys,
  };
}

async function upsertHostedMemberVerifiedEmailAuthorizationTx(
  input: HostedMemberVerifiedEmailSyncInput & {
    prisma: Prisma.TransactionClient;
  },
): Promise<HostedMemberEmailAuthorizationState> {
  await lockHostedMemberRow(input.prisma, input.memberId);

  const currentAuthorization = await input.prisma.hostedMemberEmailAuthorization.findUnique({
    where: { memberId: input.memberId },
    select: {
      verifiedEmailLookupKey: true,
      verifiedEmailVerifiedAt: true,
    },
  });
  const currentRouting = await input.prisma.hostedMemberRouting.findUnique({
    where: { memberId: input.memberId },
    select: {
      replyAliasGeneration: true,
      replyAliasLookupKey: true,
    },
  });
  const currentVerifiedLookupKey = currentAuthorization?.verifiedEmailLookupKey ?? null;
  const sameVerifiedAddress = Boolean(
    currentAuthorization?.verifiedEmailVerifiedAt
    && currentVerifiedLookupKey
    && input.preparedReplyAlias?.verifiedEmailLookupKeys
      .includes(currentVerifiedLookupKey),
  );
  const shouldRotateReplyAlias = Boolean(
    currentAuthorization?.verifiedEmailVerifiedAt && !sameVerifiedAddress,
  );
  const currentReplyAliasLookupKey = normalizeHostedEmailReplyAliasLookupKey(
    currentRouting?.replyAliasLookupKey,
  );
  const currentReplyAliasGeneration = requireHostedMemberReplyAliasGeneration(
    currentRouting?.replyAliasGeneration ?? 0,
  );
  const replyAliasGeneration = shouldRotateReplyAlias
    ? incrementHostedMemberReplyAliasGeneration(currentReplyAliasGeneration)
    : currentReplyAliasGeneration;
  const preparedReplyAliasLookupKey = normalizeHostedEmailReplyAliasLookupKey(
    input.preparedReplyAlias?.lookupKey,
  );
  if (
    input.preparedReplyAlias?.memberId !== input.memberId
    || input.preparedReplyAlias.generation !== replyAliasGeneration
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_EMAIL_REPLY_ALIAS_STALE",
      message: "Hosted email reply alias changed and must be re-resolved.",
      httpStatus: 409,
      retryable: true,
    });
  }
  const replyAliasLookupKey = !shouldRotateReplyAlias
    ? currentReplyAliasLookupKey ?? preparedReplyAliasLookupKey
    : preparedReplyAliasLookupKey;

  const authorization = await upsertHostedMemberEmailAuthorization({
    directPublicSender: {
      address: input.address,
      authorizedAt: input.verifiedAt,
    },
    memberId: input.memberId,
    preparedControlRoot: input.preparedControlRoot,
    prisma: input.prisma,
    verifiedEmail: {
      address: input.address,
      verifiedAt: input.verifiedAt,
    },
  });

  // The verified-email update and bearer-capability rotation share the member
  // lock and transaction. An old alias therefore stops resolving before any
  // later Worker can persist its raw message or append a mailbox wake.
  await upsertHostedMemberReplyAliasLookupKeyTx({
    memberId: input.memberId,
    prisma: input.prisma,
    replyAliasGeneration,
    replyAliasLookupKey,
  });

  return authorization;
}

function requireHostedMemberReplyAliasGeneration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new TypeError("Hosted member reply alias generation is invalid.");
  }
  return value;
}

function incrementHostedMemberReplyAliasGeneration(value: number): number {
  if (value === 2_147_483_647) {
    throw new RangeError("Hosted member reply alias generation is exhausted.");
  }
  return value + 1;
}

export async function readHostedMemberSnapshot(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberSnapshot | null> {
  const memberRecord = await input.prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    include: {
      billingRef: true,
      emailAuthorization: {
        select: hostedMemberEmailAuthorizationStateSelect,
      },
      identity: true,
      routing: true,
    },
  });

  if (!memberRecord) {
    return null;
  }

  const identity = memberRecord.identity
    ? await projectHostedMemberIdentityState(memberRecord.identity, input.prisma)
    : null;
  const emailAuthorization = memberRecord.emailAuthorization
    ? await projectHostedMemberEmailAuthorizationState(memberRecord.emailAuthorization, input.prisma)
    : undefined;
  const routing = memberRecord.routing
    ? await projectHostedMemberRoutingState(memberRecord.routing, input.prisma)
    : null;
  const billing = composeHostedMemberBillingSnapshot(
    projectHostedMemberCoreState(memberRecord),
    memberRecord.billingRef
      ? await projectHostedMemberStripeBillingRefSnapshot(memberRecord.billingRef, input.prisma)
      : null,
  );

  return composeHostedMemberSnapshot(billing.core, {
    billingRef: billing.billingRef,
    emailAuthorization,
    identity,
    routing,
  });
}

export async function readHostedMemberAssistantNotificationState(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberAssistantNotificationState | null> {
  const memberRecord = await input.prisma.hostedMember.findUnique({
    where: { id: input.memberId },
    select: {
      identity: {
        select: {
          memberId: true,
          phoneLookupKey: true,
          phoneNumberEncrypted: true,
        },
      },
      routing: true,
    },
  });
  if (!memberRecord) {
    return null;
  }

  // This projection is used from interactive transactions. Keep the narrow
  // private-field reads ordered on that transaction's single connection.
  const phoneNumber = memberRecord.identity
    ? await readHostedMemberIdentityPhoneNumber(memberRecord.identity, input.prisma)
    : null;
  const routing = memberRecord.routing
    ? await projectHostedMemberRoutingState(memberRecord.routing, input.prisma)
    : null;
  return {
    identity: memberRecord.identity
      ? {
          phoneLookupKey: memberRecord.identity.phoneLookupKey,
          phoneNumber,
        }
      : null,
    routing,
  };
}

export async function readHostedMemberMessagingSetupState(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberMessagingSetupState | null> {
  const memberRecord = await input.prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    select: {
      identity: {
        select: {
          phoneLookupKey: true,
        },
      },
      routing: true,
    },
  });

  if (!memberRecord) {
    return null;
  }

  const routing = memberRecord.routing
    ? await projectHostedMemberRoutingState(memberRecord.routing, input.prisma)
    : null;

  return {
    identity: memberRecord.identity
      ? {
          phoneLookupKey: memberRecord.identity.phoneLookupKey,
        }
      : null,
    routing: routing
      ? {
          linqChatId: routing.linqChatId,
          pendingLinqChatId: routing.pendingLinqChatId,
          pendingLinqParticipantContact: routing.pendingLinqParticipantContact,
          telegramThreadId: routing.telegramThreadId,
          telegramUserId: routing.telegramUserId,
        }
      : null,
  };
}

async function projectHostedMemberEmailAuthorizationLookup(
  record: Prisma.HostedMemberEmailAuthorizationGetPayload<{
    select: typeof hostedMemberEmailAuthorizationLookupSelect;
  }>,
  prisma?: HostedOnboardingReadClient,
): Promise<HostedMemberEmailAuthorizationLookup> {
  return {
    core: record.member,
    emailAuthorization: await projectHostedMemberEmailAuthorizationState(record, prisma),
    matchedBy: "verifiedEmail",
  };
}

async function resolveHostedMemberVerifiedEmailLookup(
  records: Array<Prisma.HostedMemberEmailAuthorizationGetPayload<{
    select: typeof hostedMemberEmailAuthorizationLookupSelect;
  }>>,
  prisma: HostedOnboardingReadClient,
): Promise<HostedMemberEmailAuthorizationLookup | null> {
  const verifiedRecordByMemberId = new Map<
    string,
    Prisma.HostedMemberEmailAuthorizationGetPayload<{
      select: typeof hostedMemberEmailAuthorizationLookupSelect;
    }>
  >();

  for (const record of records) {
    if (!record.verifiedEmailVerifiedAt || verifiedRecordByMemberId.has(record.memberId)) {
      continue;
    }

    verifiedRecordByMemberId.set(record.memberId, record);
  }

  if (verifiedRecordByMemberId.size === 0) {
    return null;
  }

  if (verifiedRecordByMemberId.size !== 1) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_VERIFIED_EMAIL_LOOKUP_AMBIGUOUS",
      details: {
        matchCount: verifiedRecordByMemberId.size,
        matchedBy: "verifiedEmail",
      },
      httpStatus: 500,
      message:
        "Hosted member verified email lookup matched multiple accounts during blind-index rotation. Repair the duplicate binding before retrying.",
      retryable: true,
    });
  }

  const [record] = [...verifiedRecordByMemberId.values()];
  return await projectHostedMemberEmailAuthorizationLookup(record, prisma);
}

function resolveHostedMemberVerifiedEmailCoreLookup(
  records: readonly Prisma.HostedMemberEmailAuthorizationGetPayload<{
    select: typeof hostedMemberVerifiedEmailCoreLookupSelect;
  }>[],
): HostedMemberVerifiedEmailCoreLookup | null {
  const coreByMemberId = new Map<string, HostedMemberCoreState>();
  for (const record of records) {
    if (!record.verifiedEmailVerifiedAt) {
      continue;
    }
    coreByMemberId.set(record.memberId, record.member);
  }
  if (coreByMemberId.size === 0) {
    return null;
  }
  if (coreByMemberId.size !== 1) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_VERIFIED_EMAIL_LOOKUP_AMBIGUOUS",
      details: {
        matchCount: coreByMemberId.size,
        matchedBy: "verifiedEmail",
      },
      httpStatus: 500,
      message:
        "Hosted member verified email lookup matched multiple accounts during blind-index rotation. Repair the duplicate binding before retrying.",
      retryable: true,
    });
  }
  return {
    core: coreByMemberId.values().next().value!,
    matchedBy: "verifiedEmail",
  };
}

export async function updateHostedMemberCoreState(input: {
  billingStatus?: HostedMember["billingStatus"];
  memberId: string;
  prisma: Prisma.TransactionClient | PrismaClient;
  suspendedAt?: Date | null;
}): Promise<HostedMemberCoreState> {
  const data = {
    ...(input.billingStatus !== undefined
      ? {
          billingStatus: input.billingStatus,
        }
      : {}),
    ...(input.suspendedAt !== undefined
      ? {
          suspendedAt: input.suspendedAt,
        }
      : {}),
  };

  if (Object.keys(data).length === 0) {
    throw new TypeError("Hosted member core state updates require at least one field.");
  }

  return input.prisma.hostedMember.update({
    where: {
      id: input.memberId,
    },
    data,
    select: hostedMemberCoreStateSelect,
  });
}

export async function updateHostedMemberPendingActivationTimeZoneIfActivationPending(input: {
  memberId: string;
  pendingActivationTimeZone: string;
  prisma: Prisma.TransactionClient | PrismaClient;
}): Promise<boolean> {
  const result = await input.prisma.hostedMember.updateMany({
    where: {
      billingStatus: {
        in: [
          HostedBillingStatus.incomplete,
          HostedBillingStatus.not_started,
        ],
      },
      id: input.memberId,
    },
    data: {
      pendingActivationTimeZone: input.pendingActivationTimeZone,
    },
  });

  return result.count > 0;
}

export async function clearHostedMemberPendingActivationTimeZone(input: {
  memberId: string;
  prisma: Prisma.TransactionClient | PrismaClient;
}): Promise<void> {
  await input.prisma.hostedMember.update({
    where: {
      id: input.memberId,
    },
    data: {
      pendingActivationTimeZone: null,
    },
    select: {
      id: true,
    },
  });
}

export function composeHostedMemberBillingSnapshot(
  core: HostedMemberCoreState,
  billingRef: HostedMemberStripeBillingRefSnapshot | null,
): HostedMemberBillingSnapshot {
  return {
    billingRef,
    core,
  };
}

export function composeHostedMemberSnapshot(
  core: HostedMemberCoreState,
  input: {
    billingRef: HostedMemberStripeBillingRefSnapshot | null;
    emailAuthorization?: HostedMemberEmailAuthorizationState | null;
    identity: HostedMemberIdentityState | null;
    routing: HostedMemberRoutingStateSnapshot | null;
  },
): HostedMemberSnapshot {
  return {
    billingRef: input.billingRef,
    core,
    ...(input.emailAuthorization !== undefined
      ? {
          emailAuthorization: input.emailAuthorization,
        }
      : {}),
    identity: input.identity,
    routing: input.routing,
  };
}

export async function projectHostedMemberEmailAuthorizationState(
  record: {
    directPublicSenderAddressEncrypted: string | null;
    directPublicSenderAuthorizedAt: Date | null;
    directPublicSenderLookupKey: string | null;
    memberId: string;
    stripeCheckoutEmailAddressEncrypted: string | null;
    stripeCheckoutEmailCollectedAt: Date | null;
    verifiedEmailAddressEncrypted: string | null;
    verifiedEmailLookupKey: string | null;
    verifiedEmailVerifiedAt: Date | null;
  },
  prisma?: HostedOnboardingReadClient,
): Promise<HostedMemberEmailAuthorizationState> {
  const [verifiedEmailAddress, directPublicSenderAddress, stripeCheckoutEmailAddress] =
    await Promise.all([
      decryptHostedWebNullableString({
        field: HOSTED_MEMBER_EMAIL_AUTH_VERIFIED_EMAIL_FIELD,
        memberId: record.memberId,
        prisma,
        value: record.verifiedEmailAddressEncrypted,
      }),
      decryptHostedWebNullableString({
        field: HOSTED_MEMBER_EMAIL_AUTH_DIRECT_PUBLIC_SENDER_FIELD,
        memberId: record.memberId,
        prisma,
        value: record.directPublicSenderAddressEncrypted,
      }),
      decryptHostedWebNullableString({
        field: HOSTED_MEMBER_EMAIL_AUTH_STRIPE_CHECKOUT_EMAIL_FIELD,
        memberId: record.memberId,
        prisma,
        value: record.stripeCheckoutEmailAddressEncrypted,
      }),
    ]);

  return {
    directPublicSender:
      directPublicSenderAddress
      && record.directPublicSenderLookupKey
      && record.directPublicSenderAuthorizedAt
        ? {
            address: directPublicSenderAddress,
            authorizedAt: record.directPublicSenderAuthorizedAt,
            lookupKey: record.directPublicSenderLookupKey,
          }
        : null,
    memberId: record.memberId,
    stripeCheckoutEmail:
      stripeCheckoutEmailAddress
      && record.stripeCheckoutEmailCollectedAt
        ? {
            address: stripeCheckoutEmailAddress,
            collectedAt: record.stripeCheckoutEmailCollectedAt,
          }
        : null,
    verifiedEmail:
      verifiedEmailAddress
      && record.verifiedEmailLookupKey
      && record.verifiedEmailVerifiedAt
        ? {
            address: verifiedEmailAddress,
            lookupKey: record.verifiedEmailLookupKey,
            verifiedAt: record.verifiedEmailVerifiedAt,
          }
        : null,
  };
}

function projectHostedMemberCoreState(
  member: Pick<
    HostedMember,
    | "billingStatus"
    | "createdAt"
    | "id"
    | "suspendedAt"
    | "updatedAt"
  >,
): HostedMemberCoreState {
  return {
    billingStatus: member.billingStatus,
    createdAt: member.createdAt,
    id: member.id,
    suspendedAt: member.suspendedAt,
    updatedAt: member.updatedAt,
  };
}

async function buildHostedMemberEmailAuthorizationCreateData(
  input: HostedMemberEmailAuthorizationWriteInput,
  preparedRoot?: PreparedHostedWebEncryptionRoot,
): Promise<Prisma.HostedMemberEmailAuthorizationUncheckedCreateInput> {
  const data = await buildHostedMemberEmailAuthorizationMutationData(input, preparedRoot);
  return {
    ...data,
    memberId: input.memberId,
  };
}

async function buildHostedMemberEmailAuthorizationUpdateData(
  input: HostedMemberEmailAuthorizationWriteInput,
  preparedRoot?: PreparedHostedWebEncryptionRoot,
): Promise<Prisma.HostedMemberEmailAuthorizationUncheckedUpdateInput> {
  return buildHostedMemberEmailAuthorizationMutationData(input, preparedRoot);
}

async function buildHostedMemberEmailAuthorizationMutationData(
  input: HostedMemberEmailAuthorizationWriteInput,
  preparedRoot?: PreparedHostedWebEncryptionRoot,
): Promise<Omit<Prisma.HostedMemberEmailAuthorizationUncheckedCreateInput, "memberId">> {
  const data: Omit<Prisma.HostedMemberEmailAuthorizationUncheckedCreateInput, "memberId"> = {};

  if (input.verifiedEmail !== undefined) {
    const fact = await buildHostedMemberEmailFactColumns({
      address: input.verifiedEmail?.address ?? null,
      field: HOSTED_MEMBER_EMAIL_AUTH_VERIFIED_EMAIL_FIELD,
      memberId: input.memberId,
      occurredAt: input.verifiedEmail?.verifiedAt ?? null,
      preparedRoot,
      prisma: input.prisma,
      label: "Hosted verified email",
    });

    data.verifiedEmailLookupKey = fact.lookupKey;
    data.verifiedEmailAddressEncrypted = fact.addressEncrypted;
    data.verifiedEmailVerifiedAt = fact.occurredAt;
  }

  if (input.directPublicSender !== undefined) {
    const fact = await buildHostedMemberEmailFactColumns({
      address: input.directPublicSender?.address ?? null,
      field: HOSTED_MEMBER_EMAIL_AUTH_DIRECT_PUBLIC_SENDER_FIELD,
      memberId: input.memberId,
      occurredAt: input.directPublicSender?.authorizedAt ?? null,
      preparedRoot,
      prisma: input.prisma,
      label: "Hosted direct-public sender authorization",
    });

    data.directPublicSenderLookupKey = fact.lookupKey;
    data.directPublicSenderAddressEncrypted = fact.addressEncrypted;
    data.directPublicSenderAuthorizedAt = fact.occurredAt;
  }

  if (input.stripeCheckoutEmail !== undefined) {
    const fact = await buildHostedMemberEmailFactColumns({
      address: input.stripeCheckoutEmail?.address ?? null,
      field: HOSTED_MEMBER_EMAIL_AUTH_STRIPE_CHECKOUT_EMAIL_FIELD,
      memberId: input.memberId,
      occurredAt: input.stripeCheckoutEmail?.collectedAt ?? null,
      preparedRoot,
      prisma: input.prisma,
      label: "Hosted Stripe checkout email",
    });

    data.stripeCheckoutEmailAddressEncrypted = fact.addressEncrypted;
    data.stripeCheckoutEmailCollectedAt = fact.occurredAt;
  }

  return data;
}

async function buildHostedMemberEmailFactColumns(input: {
  address: string | null;
  field: string;
  label: string;
  memberId: string;
  occurredAt: Date | null;
  preparedRoot?: PreparedHostedWebEncryptionRoot;
  prisma: Prisma.TransactionClient;
}) {
  if (input.address === null) {
    return {
      addressEncrypted: null,
      lookupKey: null,
      occurredAt: null,
    };
  }

  const lookupKey = createHostedEmailLookupKey(input.address);

  if (!lookupKey) {
    throw new TypeError(`${input.label} must be a valid email address.`);
  }

  if (!input.occurredAt) {
    throw new TypeError(`${input.label} must include a timestamp.`);
  }

  return {
    addressEncrypted: await (input.preparedRoot
      ? encryptHostedWebNullableStringFromPreparedRoot({
          field: input.field,
          memberId: input.memberId,
          prepared: input.preparedRoot,
          value: input.address,
        })
      : encryptHostedWebNullableString({
          field: input.field,
          memberId: input.memberId,
          prisma: input.prisma,
          value: input.address,
        })),
    lookupKey,
    occurredAt: input.occurredAt,
  };
}

async function revalidateHostedMemberEmailPreparedRootTx(input: {
  memberId: string;
  prepared: PreparedHostedDomainRootForWeb;
  tx: Prisma.TransactionClient;
}): Promise<PreparedHostedWebEncryptionRoot> {
  if (input.prepared.domain !== "control" || input.prepared.userId !== input.memberId) {
    throw new TypeError("Prepared hosted member email root does not match the member.");
  }
  const prepared = await revalidatePreparedHostedDomainRootForWebTx({
    prepared: input.prepared,
    tx: input.tx,
  });
  return {
    preparedRoot: prepared.root,
    preparedRootKeyId: prepared.rootKeyId,
  };
}
