import "server-only";

import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  HOSTED_RUNTIME_GROUP_SHARED_READ_DISPLAY_NAME_MAX_CODE_POINTS,
  type HostedRuntimeGroupSharedMember,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_ADDRESS_BOOK_LOOKUP_MAX_HANDLES,
  HOSTED_ADDRESS_BOOK_LOOKUP_TIMEOUT_MS,
  isHostedAddressBookAdvisoryEnabled,
  readHostedOwnerAddressBookAdvisoryNames,
} from "../hosted-address-book/projection";
import { hostedHealthDataConsentNotRevokedWhere } from "../legal/consent";
import { hostedPhoneLookupKeyMatchesValue } from "../hosted-onboarding/contact-privacy";
import { readHostedMemberIdentityPhoneNumberBatch } from "../hosted-onboarding/member-private-codecs";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";

/**
 * Presentation only. Identity, grants and current-turn sender evidence keep
 * their existing owners. No contact identifier leaves this optional overlay.
 */
export async function labelHostedGroupSharedMembers(input: {
  members: readonly HostedRuntimeGroupSharedMember[];
  prisma: PrismaClient;
  runtimeMemberId: string;
}): Promise<HostedRuntimeGroupSharedMember[]> {
  const contacts = await readReportContactNames(input).catch(() => new Map<string, string>());
  const labels = input.members.map((member) => {
    const contact = contacts.get(member.participantId);
    return member.displayName?.trim()
      || (contact ? `${contact} (unverified owner contact)` : null);
  });
  const digests = input.members.map((member) => createHash("sha256")
    .update(`murph.group-report-participant.v1\0${input.runtimeMemberId}\0${member.participantId}`)
    .digest("hex").toUpperCase());
  const shortTokens = digests.map((digest) => digest.slice(0, 12));
  const tokens = new Set(shortTokens).size === shortTokens.length ? shortTokens : digests;
  const fallback = (index: number) => `Participant ${tokens[index]}`;
  const names = labels.map((label, index) => label || fallback(index));
  const counts = new Map<string, number>();
  for (const name of names) {
    const key = name.normalize("NFKC").toLocaleLowerCase("en-US");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const displayNames = names.map((name, index) =>
    (counts.get(name.normalize("NFKC").toLocaleLowerCase("en-US")) ?? 0) > 1
      ? `${Array.from(name).slice(0, HOSTED_RUNTIME_GROUP_SHARED_READ_DISPLAY_NAME_MAX_CODE_POINTS - tokens[index]!.length - 3).join("")} (${tokens[index]})`
      : name);
  // Even a profile that imitates a generated label cannot make two rows
  // ambiguous or suppress their data. Fall back as a set to avoid cascades
  // where a third profile imitates the first collision's pseudonym.
  const finalNames = new Set(displayNames.map((name) =>
    name.normalize("NFKC").toLocaleLowerCase("en-US"))).size === displayNames.length
    ? displayNames : tokens.map((_, index) => fallback(index));
  return input.members.map((member, index) => ({ ...member, displayName: finalNames[index]! }));
}

async function readReportContactNames(input: {
  members: readonly HostedRuntimeGroupSharedMember[];
  prisma: PrismaClient;
  runtimeMemberId: string;
}): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!isHostedAddressBookAdvisoryEnabled()) return names;
  const candidates = input.members.filter((member) => !member.displayName?.trim()
    && member.projections.some((projection) => projection.dataStatus === "available"));
  if (candidates.length === 0) return names;
  const signal = AbortSignal.timeout(HOSTED_ADDRESS_BOOK_LOOKUP_TIMEOUT_MS);
  // Keep the existing 16-phone advisory ceiling. Overflow still gets a stable
  // pseudonym, and a later targeted read can attempt its own optional label.
  const memberships = await input.prisma.hostedGroupMember.findMany({
    where: {
      id: { in: candidates.map((member) => member.participantId) },
      group: { runtimeMemberId: input.runtimeMemberId },
      joinedAt: { not: null },
      member: { AND: [{ suspendedAt: null }, hostedHealthDataConsentNotRevokedWhere()] },
    },
    orderBy: { id: "asc" },
    take: HOSTED_ADDRESS_BOOK_LOOKUP_MAX_HANDLES,
    select: { id: true, memberId: true, member: { select: { identity: { select: {
      phoneLookupKey: true, phoneNumberEncrypted: true, phoneNumberVerifiedAt: true,
    } } } } },
  });
  signal.throwIfAborted();
  const verified = memberships.flatMap((membership) => {
    const identity = membership.member.identity;
    const captured = candidates.find((member) => member.participantId === membership.id);
    return captured?.memberId === membership.memberId
      && identity?.phoneNumberVerifiedAt && identity.phoneLookupKey && identity.phoneNumberEncrypted
      ? [{ ...identity, memberId: membership.memberId, participantId: membership.id }]
      : [];
  });
  if (verified.length === 0) return names;
  const phones = await readHostedMemberIdentityPhoneNumberBatch(verified, input.prisma, signal);
  signal.throwIfAborted();
  const matches = verified.flatMap((identity, index) => {
    const phone = phones[index];
    return phone && normalizePhoneNumber(phone) === phone
      && hostedPhoneLookupKeyMatchesValue(phone, identity.phoneLookupKey)
      ? [{ participantId: identity.participantId, phone }] : [];
  });
  const unique = matches.filter((match) =>
    matches.filter((other) => other.phone === match.phone).length === 1);
  if (unique.length === 0) return names;
  const result = await readHostedOwnerAddressBookAdvisoryNames({
    containerMemberId: input.runtimeMemberId,
    phoneHandles: unique.map((match) => match.phone),
    prisma: input.prisma,
  });
  for (const match of unique) {
    const name = result.names.get(match.phone);
    if (name) names.set(match.participantId, name);
  }
  return names;
}
