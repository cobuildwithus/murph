/**
 * Owns the core hosted_member row plus composed reads over the specialized
 * identity, routing, billing, and email-authorization store slices without
 * flattening them back into one wide row.
 */
import {
  type HostedMember,
  Prisma,
} from "@prisma/client";

import { createHostedEmailLookupKey } from "./contact-privacy";
import {
  decryptHostedWebNullableString,
  encryptHostedWebNullableString,
} from "../hosted-web/encryption";
import {
  readHostedMemberRoutingTelegramPrivateState,
} from "./member-private-codecs";

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
} from "./hosted-member-routing-store";
import { type HostedOnboardingReadClient } from "./shared";

const HOSTED_MEMBER_EMAIL_AUTH_VERIFIED_EMAIL_FIELD =
  "hosted-member-email-authorization.verified-email";
const HOSTED_MEMBER_EMAIL_AUTH_DIRECT_PUBLIC_SENDER_FIELD =
  "hosted-member-email-authorization.direct-public-sender";

const hostedMemberCoreStateSelect = Prisma.validator<Prisma.HostedMemberSelect>()({
  billingStatus: true,
  createdAt: true,
  id: true,
  suspendedAt: true,
  updatedAt: true,
});

const hostedMemberEmailAuthorizationStateSelect =
  Prisma.validator<Prisma.HostedMemberEmailAuthorizationSelect>()({
    directPublicSenderAddressEncrypted: true,
    directPublicSenderAuthorizedAt: true,
    directPublicSenderLookupKey: true,
    memberId: true,
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

export interface HostedMemberEmailAuthorizationState {
  directPublicSender: HostedMemberDirectPublicSenderAuthorizationFact | null;
  memberId: string;
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
  verifiedEmail?: {
    address: string;
    verifiedAt: Date;
  } | null;
}

export interface HostedMemberVerifiedEmailSyncInput {
  address: string;
  memberId: string;
  prisma?: Prisma.TransactionClient | HostedOnboardingReadClient;
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
  routing: Pick<HostedMemberRoutingStateSnapshot, "telegramThreadId" | "telegramUserId"> | null;
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
      ? projectHostedMemberStripeBillingRefSnapshot(memberRecord.billingRef)
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

  return record ? projectHostedMemberEmailAuthorizationState(record) : null;
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
  const lookupKey = createHostedEmailLookupKey(input.address);

  if (!lookupKey) {
    return null;
  }

  const record = await input.prisma.hostedMemberEmailAuthorization.findUnique({
    where: {
      verifiedEmailLookupKey: lookupKey,
    },
    select: hostedMemberEmailAuthorizationLookupSelect,
  });

  if (!record || !record.verifiedEmailVerifiedAt) {
    return null;
  }

  return projectHostedMemberEmailAuthorizationLookup(record);
}

export async function upsertHostedMemberEmailAuthorization(
  input: HostedMemberEmailAuthorizationWriteInput,
): Promise<HostedMemberEmailAuthorizationState> {
  if (input.verifiedEmail === undefined && input.directPublicSender === undefined) {
    throw new TypeError("Hosted member email authorization updates require at least one fact.");
  }

  const record = await input.prisma.hostedMemberEmailAuthorization.upsert({
    where: {
      memberId: input.memberId,
    },
    create: buildHostedMemberEmailAuthorizationCreateData(input),
    update: buildHostedMemberEmailAuthorizationUpdateData(input),
    select: hostedMemberEmailAuthorizationStateSelect,
  });

  return projectHostedMemberEmailAuthorizationState(record);
}

export async function syncHostedMemberVerifiedEmailAuthorization(
  input: HostedMemberVerifiedEmailSyncInput,
): Promise<HostedMemberEmailAuthorizationState> {
  const prismaClient = input.prisma;

  if (prismaClient && "$transaction" in prismaClient && typeof prismaClient.$transaction === "function") {
    return prismaClient.$transaction((tx: Prisma.TransactionClient) => upsertHostedMemberEmailAuthorization({
      memberId: input.memberId,
      prisma: tx,
      verifiedEmail: {
        address: input.address,
        verifiedAt: input.verifiedAt,
      },
    }));
  }

  return upsertHostedMemberEmailAuthorization({
    memberId: input.memberId,
    prisma: input.prisma as Prisma.TransactionClient,
    verifiedEmail: {
      address: input.address,
      verifiedAt: input.verifiedAt,
    },
  });
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
    ? projectHostedMemberIdentityState(memberRecord.identity)
    : null;
  const emailAuthorization = memberRecord.emailAuthorization
    ? projectHostedMemberEmailAuthorizationState(memberRecord.emailAuthorization)
    : undefined;
  const routing = memberRecord.routing
    ? projectHostedMemberRoutingState(memberRecord.routing)
    : null;
  const billing = composeHostedMemberBillingSnapshot(
    projectHostedMemberCoreState(memberRecord),
    memberRecord.billingRef
      ? projectHostedMemberStripeBillingRefSnapshot(memberRecord.billingRef)
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
      routing: {
        select: {
          memberId: true,
          telegramUserIdEncrypted: true,
        },
      },
    },
  });

  if (!memberRecord) {
    return null;
  }

  const telegramRouting = memberRecord.routing
    ? readHostedMemberRoutingTelegramPrivateState(memberRecord.routing)
    : null;

  return {
    identity: memberRecord.identity
      ? {
          phoneLookupKey: memberRecord.identity.phoneLookupKey,
        }
      : null,
    routing: telegramRouting
      ? {
          telegramThreadId: telegramRouting.telegramThreadId,
          telegramUserId: telegramRouting.telegramUserId,
        }
      : null,
  };
}

function projectHostedMemberEmailAuthorizationLookup(
  record: Prisma.HostedMemberEmailAuthorizationGetPayload<{
    select: typeof hostedMemberEmailAuthorizationLookupSelect;
  }>,
): HostedMemberEmailAuthorizationLookup {
  return {
    core: record.member,
    emailAuthorization: projectHostedMemberEmailAuthorizationState(record),
    matchedBy: "verifiedEmail",
  };
}

export async function updateHostedMemberCoreState(input: {
  billingStatus?: HostedMember["billingStatus"];
  memberId: string;
  prisma: Prisma.TransactionClient;
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

export function projectHostedMemberEmailAuthorizationState(
  record: {
    directPublicSenderAddressEncrypted: string | null;
    directPublicSenderAuthorizedAt: Date | null;
    directPublicSenderLookupKey: string | null;
    memberId: string;
    verifiedEmailAddressEncrypted: string | null;
    verifiedEmailLookupKey: string | null;
    verifiedEmailVerifiedAt: Date | null;
  },
): HostedMemberEmailAuthorizationState {
  const verifiedEmailAddress = decryptHostedWebNullableString({
    field: HOSTED_MEMBER_EMAIL_AUTH_VERIFIED_EMAIL_FIELD,
    memberId: record.memberId,
    value: record.verifiedEmailAddressEncrypted,
  });
  const directPublicSenderAddress = decryptHostedWebNullableString({
    field: HOSTED_MEMBER_EMAIL_AUTH_DIRECT_PUBLIC_SENDER_FIELD,
    memberId: record.memberId,
    value: record.directPublicSenderAddressEncrypted,
  });

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
    "billingStatus" | "createdAt" | "id" | "suspendedAt" | "updatedAt"
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

function buildHostedMemberEmailAuthorizationCreateData(
  input: HostedMemberEmailAuthorizationWriteInput,
): Prisma.HostedMemberEmailAuthorizationUncheckedCreateInput {
  const data = buildHostedMemberEmailAuthorizationMutationData(input);
  return {
    ...data,
    memberId: input.memberId,
  };
}

function buildHostedMemberEmailAuthorizationUpdateData(
  input: HostedMemberEmailAuthorizationWriteInput,
): Prisma.HostedMemberEmailAuthorizationUncheckedUpdateInput {
  return buildHostedMemberEmailAuthorizationMutationData(input);
}

function buildHostedMemberEmailAuthorizationMutationData(
  input: HostedMemberEmailAuthorizationWriteInput,
): Omit<Prisma.HostedMemberEmailAuthorizationUncheckedCreateInput, "memberId"> {
  const data: Omit<Prisma.HostedMemberEmailAuthorizationUncheckedCreateInput, "memberId"> = {};

  if (input.verifiedEmail !== undefined) {
    const fact = buildHostedMemberEmailFactColumns({
      address: input.verifiedEmail?.address ?? null,
      field: HOSTED_MEMBER_EMAIL_AUTH_VERIFIED_EMAIL_FIELD,
      memberId: input.memberId,
      occurredAt: input.verifiedEmail?.verifiedAt ?? null,
      label: "Hosted verified email",
    });

    data.verifiedEmailLookupKey = fact.lookupKey;
    data.verifiedEmailAddressEncrypted = fact.addressEncrypted;
    data.verifiedEmailVerifiedAt = fact.occurredAt;
  }

  if (input.directPublicSender !== undefined) {
    const fact = buildHostedMemberEmailFactColumns({
      address: input.directPublicSender?.address ?? null,
      field: HOSTED_MEMBER_EMAIL_AUTH_DIRECT_PUBLIC_SENDER_FIELD,
      memberId: input.memberId,
      occurredAt: input.directPublicSender?.authorizedAt ?? null,
      label: "Hosted direct-public sender authorization",
    });

    data.directPublicSenderLookupKey = fact.lookupKey;
    data.directPublicSenderAddressEncrypted = fact.addressEncrypted;
    data.directPublicSenderAuthorizedAt = fact.occurredAt;
  }

  return data;
}

function buildHostedMemberEmailFactColumns(input: {
  address: string | null;
  field: string;
  label: string;
  memberId: string;
  occurredAt: Date | null;
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
    addressEncrypted: encryptHostedWebNullableString({
      field: input.field,
      memberId: input.memberId,
      value: input.address,
    }),
    lookupKey,
    occurredAt: input.occurredAt,
  };
}
