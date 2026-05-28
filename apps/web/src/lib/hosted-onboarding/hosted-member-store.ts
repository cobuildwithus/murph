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

import {
  createHostedEmailLookupKey,
  createHostedEmailLookupKeyReadCandidates,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import {
  decryptHostedWebNullableString,
  encryptHostedWebNullableString,
} from "../hosted-web/encryption";
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
  lockHostedMemberRow,
  type HostedOnboardingReadClient,
} from "./shared";

const HOSTED_MEMBER_EMAIL_AUTH_VERIFIED_EMAIL_FIELD =
  "hosted-member-email-authorization.verified-email";
const HOSTED_MEMBER_EMAIL_AUTH_DIRECT_PUBLIC_SENDER_FIELD =
  "hosted-member-email-authorization.direct-public-sender";
const HOSTED_MEMBER_EMAIL_AUTH_STRIPE_CHECKOUT_EMAIL_FIELD =
  "hosted-member-email-authorization.stripe-checkout-email";

const hostedMemberCoreStateSelect = Prisma.validator<Prisma.HostedMemberSelect>()({
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

export interface HostedMemberEmailAuthorizationWriteInput {
  directPublicSender?: {
    address: string;
    authorizedAt: Date;
  } | null;
  memberId: string;
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
  prisma?: Prisma.TransactionClient | HostedOnboardingReadClient;
  replyAliasLookupKey?: string | null;
  verifiedAt: Date;
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

export async function lookupHostedMemberByVerifiedEmailAddress(input: {
  address: string | null | undefined;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberEmailAuthorizationLookup | null> {
  const lookupKeys = createHostedEmailLookupKeyReadCandidates(input.address);

  if (lookupKeys.length === 0) {
    return null;
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

  const record = await input.prisma.hostedMemberEmailAuthorization.upsert({
    where: {
      memberId: input.memberId,
    },
    create: await buildHostedMemberEmailAuthorizationCreateData(input),
    update: await buildHostedMemberEmailAuthorizationUpdateData(input),
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

export async function syncHostedMemberVerifiedEmailAuthorization(
  input: HostedMemberVerifiedEmailSyncInput,
): Promise<HostedMemberEmailAuthorizationState> {
  const prismaClient = input.prisma;

  if (prismaClient && "$transaction" in prismaClient && typeof prismaClient.$transaction === "function") {
    return prismaClient.$transaction((tx: Prisma.TransactionClient) =>
      upsertHostedMemberVerifiedEmailAuthorizationTx({
        ...input,
        prisma: tx,
      })
    );
  }

  return upsertHostedMemberVerifiedEmailAuthorizationTx({
    memberId: input.memberId,
    prisma: input.prisma as Prisma.TransactionClient,
    replyAliasLookupKey: input.replyAliasLookupKey,
    address: input.address,
    verifiedAt: input.verifiedAt,
  });
}

async function upsertHostedMemberVerifiedEmailAuthorizationTx(
  input: HostedMemberVerifiedEmailSyncInput & {
    prisma: Prisma.TransactionClient;
  },
): Promise<HostedMemberEmailAuthorizationState> {
  const authorization = await upsertHostedMemberEmailAuthorization({
    directPublicSender: {
      address: input.address,
      authorizedAt: input.verifiedAt,
    },
    memberId: input.memberId,
    prisma: input.prisma,
    verifiedEmail: {
      address: input.address,
      verifiedAt: input.verifiedAt,
    },
  });

  if (input.replyAliasLookupKey) {
    await upsertHostedMemberReplyAliasLookupKeyTx({
      memberId: input.memberId,
      prisma: input.prisma,
      replyAliasLookupKey: input.replyAliasLookupKey,
    });
  }

  return authorization;
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
): Promise<Prisma.HostedMemberEmailAuthorizationUncheckedCreateInput> {
  const data = await buildHostedMemberEmailAuthorizationMutationData(input);
  return {
    ...data,
    memberId: input.memberId,
  };
}

async function buildHostedMemberEmailAuthorizationUpdateData(
  input: HostedMemberEmailAuthorizationWriteInput,
): Promise<Prisma.HostedMemberEmailAuthorizationUncheckedUpdateInput> {
  return buildHostedMemberEmailAuthorizationMutationData(input);
}

async function buildHostedMemberEmailAuthorizationMutationData(
  input: HostedMemberEmailAuthorizationWriteInput,
): Promise<Omit<Prisma.HostedMemberEmailAuthorizationUncheckedCreateInput, "memberId">> {
  const data: Omit<Prisma.HostedMemberEmailAuthorizationUncheckedCreateInput, "memberId"> = {};

  if (input.verifiedEmail !== undefined) {
    const fact = await buildHostedMemberEmailFactColumns({
      address: input.verifiedEmail?.address ?? null,
      field: HOSTED_MEMBER_EMAIL_AUTH_VERIFIED_EMAIL_FIELD,
      memberId: input.memberId,
      occurredAt: input.verifiedEmail?.verifiedAt ?? null,
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
    addressEncrypted: await encryptHostedWebNullableString({
      field: input.field,
      memberId: input.memberId,
      prisma: input.prisma,
      value: input.address,
    }),
    lookupKey,
    occurredAt: input.occurredAt,
  };
}
