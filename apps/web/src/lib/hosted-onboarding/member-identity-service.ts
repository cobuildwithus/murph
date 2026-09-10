import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  createHostedPhoneLookupKey,
  hostedPhoneLookupKeyMatchesValue,
} from "./contact-privacy";
import { assertHostedMemberNotSuspended } from "./entitlement";
import { getPrisma } from "../prisma";
import {
  HostedDomainRootPreparationMismatchError,
  type PreparedHostedDomainRootForWeb,
} from "../hosted-crypto/domain-root-store";
import {
  hostedOnboardingError,
} from "./errors";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  generateHostedMemberId,

  normalizePhoneNumber,
} from "./shared";
import {
  createHostedMember,
  type HostedMemberCoreState,

} from "./hosted-member-store";
import {
  lookupHostedMemberRoutingByPendingLinqParticipantContact,
  tryCreateHostedMemberPendingLinqParticipantContactTx,
  upsertHostedMemberPendingLinqParticipantContactTx,
} from "./hosted-member-routing-store";
import {

  bindHostedMemberLinqEmailHandleTx,
  lookupHostedMemberIdentityByLinqEmailHandle,
  lookupHostedMemberIdentityByPhoneLookupKey,
  lookupHostedMemberIdentityByPhoneNumber,
  lookupHostedMemberIdByPhoneNumber,
  readHostedMemberIdentity,

  type HostedMemberIdentityLookup,
  tryCreateHostedMemberIdentity,
  upsertHostedMemberIdentity,
} from "./hosted-member-identity-store";
import {
  buildHostedMemberPhoneIdentityFields,
} from "./member-identity-fields";
import {
  acquireHostedLinqParticipantContactLockTx,
  acquireHostedLinqParticipantPhoneLockTx,

  type HostedLinqParticipantContact,
} from "./linq-participant-contact";

export async function ensureHostedMemberForPhone(input: {
  phoneNumber: string;
  prisma?: PrismaClient;
  phoneNumberVerifiedAt?: Date | null;
}): Promise<HostedMemberCoreState> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => ensureHostedMemberForPhoneTx({
    phoneNumber: input.phoneNumber,
    phoneNumberVerifiedAt: input.phoneNumberVerifiedAt,
    prisma: tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function ensureHostedMemberForPhoneTx(input: {
  phoneNumber: string;
  phoneNumberVerifiedAt?: Date | null;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberCoreState> {
  const resolution = await ensureHostedMemberForPhoneResolutionTx(input);
  return resolution.member;
}

/**
 * Binds a provider-verified phone to an already resolved member. The caller
 * must own the participant-phone lock and the member row before invoking this
 * prepared path; it never creates or selects a different member.
 */
export async function bindHostedMemberPhoneToPreparedMemberTx(input: {
  currentIdentity: Awaited<ReturnType<typeof readHostedMemberIdentity>>;
  member: HostedMemberCoreState;
  phoneNumber: string;
  phoneNumberVerifiedAt: Date;
  preparedControlRoot: PreparedHostedDomainRootForWeb;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberCoreState> {
  const phoneOwnerMemberId = await lookupHostedMemberIdByPhoneNumber({
    phoneNumber: input.phoneNumber,
    prisma: input.prisma,
  });
  if (phoneOwnerMemberId && phoneOwnerMemberId !== input.member.id) {
    throw new HostedDomainRootPreparationMismatchError();
  }
  if (
    input.currentIdentity?.phoneLookupKey
    && !hostedPhoneLookupKeyMatchesValue(
      input.phoneNumber,
      input.currentIdentity.phoneLookupKey,
    )
  ) {
    throw new HostedDomainRootPreparationMismatchError();
  }
  if (input.currentIdentity?.phoneNumber) {
    const currentPhoneNumber = normalizePhoneNumber(input.currentIdentity.phoneNumber);
    const incomingPhoneNumber = normalizePhoneNumber(input.phoneNumber);
    if (!currentPhoneNumber || currentPhoneNumber !== incomingPhoneNumber) {
      throw new HostedDomainRootPreparationMismatchError();
    }
  }

  return refreshHostedMemberForPhoneTx({
    currentIdentity: input.currentIdentity,
    member: input.member,
    phoneNumber: input.phoneNumber,
    phoneNumberVerifiedAt: input.phoneNumberVerifiedAt,
    preparedControlRoot: input.preparedControlRoot,
    prisma: input.prisma,
  });
}

export async function ensureHostedMemberForPhoneResolutionTx(input: {
  phoneNumber: string;
  phoneNumberVerifiedAt?: Date | null;
  prisma: Prisma.TransactionClient;
}): Promise<{
  created: boolean;
  member: HostedMemberCoreState;
}> {
  const phoneLookupKey = createHostedPhoneLookupKey(input.phoneNumber);

  if (!phoneLookupKey) {
    throw hostedOnboardingError({
      code: "PHONE_NUMBER_INVALID",
      message: "A valid phone number is required to issue a hosted invite.",
      httpStatus: 400,
    });
  }

  await acquireHostedLinqParticipantPhoneLockTx({
    phoneNumber: input.phoneNumber,
    tx: input.prisma,
  });

  const existingIdentity = await lookupHostedMemberIdentityByPhoneNumber({
    phoneNumber: input.phoneNumber,
    prisma: input.prisma,
  });

  if (existingIdentity) {
    return {
      created: false,
      member: await refreshHostedMemberForPhoneTx({
        currentIdentity: existingIdentity.identity,
        member: existingIdentity.core,
        phoneNumber: input.phoneNumber,
        phoneNumberVerifiedAt: input.phoneNumberVerifiedAt,
        prisma: input.prisma,
      }),
    };
  }

  const phoneIdentityFields = {
    ...buildHostedMemberPhoneIdentityFields(input.phoneNumber),
    phoneNumberVerifiedAt: input.phoneNumberVerifiedAt ?? null,
  };
  const memberId = generateHostedMemberId();

  const createdMember = await createHostedMember({
    billingStatus: HostedBillingStatus.not_started,
    memberId,
    prisma: input.prisma,
  });
  const identityCreated = await tryCreateHostedMemberIdentity({
    ...phoneIdentityFields,
    memberId,
    prisma: input.prisma,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: input.phoneNumber,
  });

  if (identityCreated) {
    return {
      created: true,
      member: createdMember,
    };
  }

  await input.prisma.hostedMember.delete({
    where: {
      id: memberId,
    },
  });
  const concurrentIdentity = await lookupHostedMemberIdentityByPhoneLookupKey({
    phoneLookupKey: phoneIdentityFields.phoneLookupKey,
    prisma: input.prisma,
  });

  if (concurrentIdentity) {
    return {
      created: false,
      member: await refreshHostedMemberForPhoneTx({
        currentIdentity: concurrentIdentity.identity,
        member: concurrentIdentity.core,
        phoneNumber: input.phoneNumber,
        phoneNumberVerifiedAt: input.phoneNumberVerifiedAt,
        prisma: input.prisma,
      }),
    };
  }

  throw new Prisma.PrismaClientKnownRequestError(
    "Hosted member phone identity was not created and no concurrent identity was found.",
    {
      clientVersion: Prisma.prismaVersion.client,
      code: "P2002",
    },
  );
}

export async function ensureHostedMemberForPendingLinqParticipantContactTx(input: {
  contact: HostedLinqParticipantContact;
  observedAt: Date;
  prisma: Prisma.TransactionClient;
}): Promise<{
  created: boolean;
  member: HostedMemberCoreState;
}> {
  if (Number.isNaN(input.observedAt.getTime())) {
    throw new TypeError("Hosted Linq participant contact observed timestamp must be valid.");
  }

  await acquireHostedLinqParticipantContactLockTx({
    contact: input.contact,
    tx: input.prisma,
  });

  const existingIdentityLookup = input.contact.kind === "phone"
    ? await lookupHostedMemberIdentityByPhoneNumber({
        phoneNumber: input.contact.value,
        prisma: input.prisma,
      })
    : await lookupHostedMemberIdentityByLinqEmailHandle({
        emailAddress: input.contact.value,
        prisma: input.prisma,
      });
  const existingRoutingLookup =
    await lookupHostedMemberRoutingByPendingLinqParticipantContact({
      contact: input.contact,
      prisma: input.prisma,
    });

  if (
    existingIdentityLookup
    && existingRoutingLookup
    && existingIdentityLookup.core.id !== existingRoutingLookup.core.id
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_PARTICIPANT_IDENTITY_CONFLICT",
      httpStatus: 409,
      message:
        "This iMessage participant conflicts with an existing Murph account. Contact support so we can resolve it safely.",
    });
  }

  const existingMember = existingIdentityLookup?.core ?? existingRoutingLookup?.core ?? null;
  if (existingMember) {
    assertHostedMemberNotSuspended(existingMember);
    if (input.contact.kind === "email") {
      await bindHostedMemberLinqEmailHandleTx({
        emailAddress: input.contact.value,
        lookupKey: input.contact.lookupKey,
        memberId: existingMember.id,
        prisma: input.prisma,
      });
    }
    await upsertHostedMemberPendingLinqParticipantContactTx({
      contact: input.contact,
      memberId: existingMember.id,
      observedAt: input.observedAt,
      prisma: input.prisma,
    });
    return {
      created: false,
      member: existingMember,
    };
  }

  const memberId = generateHostedMemberId();

  const createdMember = await createHostedMember({
    billingStatus: HostedBillingStatus.not_started,
    memberId,
    prisma: input.prisma,
  });
  // Email-handle writers hold the contact lock across lookup and creation.
  // An unexpected unique-index conflict aborts this transaction.
  await upsertHostedMemberIdentity({
    ...(input.contact.kind === "email"
      ? { linqEmailHandle: input.contact.value }
      : {}),
    maskedPhoneNumberHint: null,
    memberId,
    phoneLookupKey: null,
    phoneNumber: null,
    phoneNumberVerifiedAt: null,
    prisma: input.prisma,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: null,
  });

  const routingCreated = await tryCreateHostedMemberPendingLinqParticipantContactTx({
    contact: input.contact,
    memberId,
    observedAt: input.observedAt,
    prisma: input.prisma,
  });

  if (routingCreated) {
    return {
      created: true,
      member: createdMember,
    };
  }

  await input.prisma.hostedMember.delete({
    where: {
      id: memberId,
    },
  });
  const concurrentRoutingLookup =
    await lookupHostedMemberRoutingByPendingLinqParticipantContact({
      contact: input.contact,
      prisma: input.prisma,
    });

  if (concurrentRoutingLookup) {
    assertHostedMemberNotSuspended(concurrentRoutingLookup.core);
    if (input.contact.kind === "email") {
      await bindHostedMemberLinqEmailHandleTx({
        emailAddress: input.contact.value,
        lookupKey: input.contact.lookupKey,
        memberId: concurrentRoutingLookup.core.id,
        prisma: input.prisma,
      });
    }
    return {
      created: false,
      member: concurrentRoutingLookup.core,
    };
  }

  throw new Prisma.PrismaClientKnownRequestError(
    "Hosted member pending Linq route was not created and no concurrent route was found.",
    {
      clientVersion: Prisma.prismaVersion.client,
      code: "P2002",
    },
  );
}

async function refreshHostedMemberForPhoneTx(input: {
  currentIdentity:
    | HostedMemberIdentityLookup["identity"]
    | Awaited<ReturnType<typeof readHostedMemberIdentity>>;
  member: HostedMemberCoreState;
  phoneNumber: string;
  phoneNumberVerifiedAt?: Date | null;
  preparedControlRoot?: PreparedHostedDomainRootForWeb;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberCoreState> {
  assertHostedMemberNotSuspended(input.member);
  await upsertHostedMemberIdentity({
    ...buildHostedMemberPhoneIdentityFields(input.phoneNumber),
    memberId: input.member.id,
    ...(input.preparedControlRoot
      ? { preparedControlRoot: input.preparedControlRoot }
      : {}),
    phoneNumberVerifiedAt:
      input.phoneNumberVerifiedAt ?? input.currentIdentity?.phoneNumberVerifiedAt ?? null,
    prisma: input.prisma,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: input.phoneNumber,
  });
  return input.member;
}
