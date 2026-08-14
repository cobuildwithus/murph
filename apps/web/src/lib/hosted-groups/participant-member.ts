import "server-only";

import type {
  HostedExecutionAcceptedGroupMessageParticipant,
} from "@murphai/hosted-execution/contracts";

import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { lookupHostedMemberRoutingByTelegramUserId } from "../hosted-onboarding/hosted-member-routing-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "../hosted-onboarding/hosted-member-store";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  createHostedLinqParticipantContact,
  createHostedLinqParticipantContactLookupKeyReadCandidates,
  type HostedLinqParticipantContactKind,
} from "../hosted-onboarding/linq-participant-contact";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";

type HostedGroupParticipantHandleLookup = {
  kind: HostedLinqParticipantContactKind;
  lookupKeys: readonly string[];
};

export async function lookupHostedGroupParticipantMemberIdsByHandles(input: {
  handles: readonly string[];
  prisma: HostedOnboardingReadClient;
}): Promise<ReadonlyMap<string, string | null>> {
  const lookupsByHandle = new Map<string, HostedGroupParticipantHandleLookup | null>();
  const phoneLookupKeys = new Set<string>();
  const verifiedEmailLookupKeys = new Set<string>();

  for (const handle of input.handles) {
    if (lookupsByHandle.has(handle)) {
      continue;
    }

    const contact = createHostedLinqParticipantContact({
      kind: handle.includes("@") ? "email" : "phone",
      value: handle,
    });
    if (!contact) {
      lookupsByHandle.set(handle, null);
      continue;
    }

    const lookupKeys = createHostedLinqParticipantContactLookupKeyReadCandidates({
      kind: contact.kind,
      value: contact.value,
    });
    if (lookupKeys.length === 0) {
      lookupsByHandle.set(handle, null);
      continue;
    }

    lookupsByHandle.set(handle, {
      kind: contact.kind,
      lookupKeys,
    });
    const ownerLookupKeys = contact.kind === "phone"
      ? phoneLookupKeys
      : verifiedEmailLookupKeys;
    for (const lookupKey of lookupKeys) {
      ownerLookupKeys.add(lookupKey);
    }
  }

  const [phoneRecords, verifiedEmailRecords] = await Promise.all([
    phoneLookupKeys.size === 0
      ? []
      : input.prisma.hostedMemberIdentity.findMany({
          select: {
            memberId: true,
            phoneLookupKey: true,
          },
          where: {
            phoneLookupKey: { in: [...phoneLookupKeys] },
          },
        }),
    verifiedEmailLookupKeys.size === 0
      ? []
      : input.prisma.hostedMemberEmailAuthorization.findMany({
          select: {
            memberId: true,
            verifiedEmailLookupKey: true,
          },
          where: {
            verifiedEmailLookupKey: { in: [...verifiedEmailLookupKeys] },
            verifiedEmailVerifiedAt: { not: null },
          },
        }),
  ]);

  const phoneMemberIdsByLookupKey = indexHostedGroupParticipantMemberIdsByLookupKey(
    phoneRecords.map((record) => ({
      lookupKey: record.phoneLookupKey,
      memberId: record.memberId,
    })),
  );
  const verifiedEmailMemberIdsByLookupKey =
    indexHostedGroupParticipantMemberIdsByLookupKey(
      verifiedEmailRecords.map((record) => ({
        lookupKey: record.verifiedEmailLookupKey,
        memberId: record.memberId,
      })),
    );
  const memberIdsByHandle = new Map<string, string | null>();

  for (const [handle, lookup] of lookupsByHandle) {
    if (!lookup) {
      memberIdsByHandle.set(handle, null);
      continue;
    }

    const memberIdsByLookupKey = lookup.kind === "phone"
      ? phoneMemberIdsByLookupKey
      : verifiedEmailMemberIdsByLookupKey;
    const memberIds = new Set<string>();
    for (const lookupKey of lookup.lookupKeys) {
      for (const memberId of memberIdsByLookupKey.get(lookupKey) ?? []) {
        memberIds.add(memberId);
      }
    }
    memberIdsByHandle.set(
      handle,
      resolveHostedGroupParticipantMemberId({
        kind: lookup.kind,
        memberIds,
      }),
    );
  }

  return memberIdsByHandle;
}

export async function lookupHostedGroupParticipantMemberIdByHandle(input: {
  handle: string;
  prisma: HostedOnboardingReadClient;
}): Promise<string | null> {
  const memberIdsByHandle = await lookupHostedGroupParticipantMemberIdsByHandles({
    handles: [input.handle],
    prisma: input.prisma,
  });
  return memberIdsByHandle.get(input.handle) ?? null;
}

export async function lookupHostedGroupParticipantMemberByHandle(input: {
  handle: string;
  prisma: HostedOnboardingReadClient;
}) {
  if (input.handle.includes("@")) {
    return await lookupHostedMemberByVerifiedEmailAddress({
      address: input.handle,
      prisma: input.prisma,
    });
  }

  const phoneNumber = normalizePhoneNumber(input.handle);
  return phoneNumber
    ? await lookupHostedMemberIdentityByPhoneNumber({
        phoneNumber,
        prisma: input.prisma,
      })
    : null;
}

export async function lookupHostedGroupParticipantMemberByProviderEvidence(input: {
  participant: Pick<
    HostedExecutionAcceptedGroupMessageParticipant,
    "senderHandle" | "source"
  >;
  prisma: HostedOnboardingReadClient;
}) {
  if (input.participant.source === "telegram") {
    return await lookupHostedMemberRoutingByTelegramUserId({
      prisma: input.prisma,
      telegramUserId: input.participant.senderHandle,
    });
  }

  return await lookupHostedGroupParticipantMemberByHandle({
    handle: input.participant.senderHandle,
    prisma: input.prisma,
  });
}

function indexHostedGroupParticipantMemberIdsByLookupKey(
  records: readonly {
    lookupKey: string | null;
    memberId: string;
  }[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const memberIdsByLookupKey = new Map<string, Set<string>>();
  for (const record of records) {
    if (!record.lookupKey) {
      continue;
    }
    const memberIds = memberIdsByLookupKey.get(record.lookupKey) ?? new Set<string>();
    memberIds.add(record.memberId);
    memberIdsByLookupKey.set(record.lookupKey, memberIds);
  }
  return memberIdsByLookupKey;
}

function resolveHostedGroupParticipantMemberId(input: {
  kind: HostedLinqParticipantContactKind;
  memberIds: ReadonlySet<string>;
}): string | null {
  if (input.memberIds.size > 1) {
    throw hostedOnboardingError({
      code: input.kind === "phone"
        ? "HOSTED_MEMBER_IDENTITY_LOOKUP_AMBIGUOUS"
        : "HOSTED_MEMBER_VERIFIED_EMAIL_LOOKUP_AMBIGUOUS",
      details: {
        matchCount: input.memberIds.size,
        matchedBy: input.kind === "phone" ? "phoneNumber" : "verifiedEmail",
      },
      httpStatus: 500,
      message: "Hosted group participant lookup matched multiple members.",
      retryable: true,
    });
  }

  return input.memberIds.values().next().value ?? null;
}
