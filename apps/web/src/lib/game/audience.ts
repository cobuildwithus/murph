import "server-only";
import { createHash } from "node:crypto";
import { isGameMemberSet } from "./roster";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "../prisma";
import { createHostedGameAudienceLookupKeys } from "../hosted-onboarding/contact-privacy";
import { createHostedLinqParticipantContact, createHostedLinqParticipantContactLookupKeyReadCandidates, type HostedLinqParticipantContact } from "../hosted-onboarding/linq-participant-contact";
import { lookupHostedGroupParticipantMemberIdsByHandles } from "../hosted-groups/participant-member";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { readHostedMemberVerifiedEmailSnapshots } from "../hosted-onboarding/hosted-member-store";
import type { GameInviteTarget } from "./command";
import { reject } from "./rules";

export function gamePairLoreFingerprint(memberIds: readonly string[]): string {
  if (!isGameMemberSet(memberIds)) {
    throw new TypeError("Game lore requires 2 to 10 distinct players.");
  }
  return createHash("sha256")
    .update("murph-game-lore-v1\0")
    .update([...memberIds].sort().join("\0"))
    .digest("hex")
    .slice(0, 32);
}

/** The stored original audience survives joins, departures and rematches. */
export function gameGroupLoreFingerprint(audienceKey: string): string {
  return createHash("sha256")
    .update("murph-group-game-lore-v1\0")
    .update(audienceKey)
    .digest("hex")
    .slice(0, 32);
}

/** Addresses exist only during preparation, never in the game row or event log. */
export function gameAudienceKeys(contacts: readonly Pick<HostedLinqParticipantContact, "kind" | "value">[]) {
  const handles = contacts.map(contact => {
    const normalized = createHostedLinqParticipantContact(contact);
    if (!normalized) reject("INVALID_REQUEST", "Choose valid invitation addresses.");
    return `${normalized.kind}:${normalized.value}`;
  }).sort();
  if (handles.length < 2 || handles.length > 10 || new Set(handles).size !== handles.length) reject("INVALID_REQUEST", "Choose distinct people, including the starter.");
  return createHostedGameAudienceLookupKeys(JSON.stringify(handles));
}

export async function readGameVerifiedContacts(memberId: string): Promise<HostedLinqParticipantContact[]> {
  const prisma = getPrisma();
  const [identity, emails] = await Promise.all([
    readHostedMemberIdentity({ memberId, prisma }),
    readHostedMemberVerifiedEmailSnapshots({ memberIds: [memberId], prisma }),
  ]);
  const phone = identity?.phoneNumberVerifiedAt ? createHostedLinqParticipantContact({ kind: "phone", value: identity.phoneNumber }) : null;
  const email = createHostedLinqParticipantContact({ kind: "email", value: emails[0]?.verifiedEmail?.address });
  return [phone, email].filter((contact): contact is HostedLinqParticipantContact => contact !== null);
}

export async function prepareGameAudience(actor: string, targets: readonly GameInviteTarget[]) {
  if (targets.length < 1 || targets.length > 9) reject("INVALID_REQUEST", "Choose one to nine recipients.");
  const starter = (await readGameVerifiedContacts(actor))[0];
  if (!starter) reject("PROFILE_REQUIRED", "Verify a phone number or email before inviting people.");
  const contacts = targets.map(target => createHostedLinqParticipantContact(target.recipient)
    ?? reject("INVALID_REQUEST", "Choose valid invitation addresses."));
  const keys = gameAudienceKeys([starter, ...contacts]);
  const resolved = await lookupHostedGroupParticipantMemberIdsByHandles({ handles: contacts.map(contact => contact.value), prisma: getPrisma() });
  const members = [actor, ...contacts.flatMap(contact => resolved.get(contact.value) ? [resolved.get(contact.value)!] : [])];
  if (new Set(members).size !== members.length) reject("INVALID_REQUEST", "Choose distinct people, including the starter.");
  return { keys, starter, contacts, invitees: targets.map((target, index) => ({ ...target,
    memberId: resolved.get(contacts[index].value) ?? null, recipientLookupKey: contacts[index].lookupKey })) };
}

/** Rotation candidates lock in one stable order before any game row lock. */
export async function lockGameAudience(tx: Prisma.TransactionClient, candidates: readonly string[]): Promise<void> {
  for (const key of [...new Set(candidates)].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('weekly-game-audience'), hashtext(${key}))`;
}

/** Revalidate prepared verified ownership without decrypting under a lock. */
export async function verifiedGameContactKeys(tx: Prisma.TransactionClient, actor: string, contacts: readonly HostedLinqParticipantContact[]): Promise<string[]> {
  const keys = contacts.flatMap(createHostedLinqParticipantContactLookupKeyReadCandidates);
  const phone = await tx.hostedMemberIdentity.findFirst({ where: { memberId: actor, phoneLookupKey: { in: keys }, phoneNumberVerifiedAt: { not: null } }, select: { phoneLookupKey: true } });
  const email = await tx.hostedMemberEmailAuthorization.findFirst({ where: { memberId: actor, verifiedEmailLookupKey: { in: keys }, verifiedEmailVerifiedAt: { not: null } }, select: { verifiedEmailLookupKey: true } });
  return contacts.filter(contact => createHostedLinqParticipantContactLookupKeyReadCandidates(contact).some(key => key === phone?.phoneLookupKey || key === email?.verifiedEmailLookupKey))
    .flatMap(createHostedLinqParticipantContactLookupKeyReadCandidates);
}

/** Direct bindings win; otherwise the lowest addressed seat with current contact proof wins. */
export function addressedGameInvite<T extends { seat: number; memberId: string | null; recipientLookupKey: string | null }>(
  invitees: readonly T[], actor: string, verifiedKeys: readonly string[],
): T | undefined {
  const seats = [...invitees].sort((a, b) => a.seat - b.seat);
  return seats.find(invitee => invitee.memberId === actor)
    ?? seats.find(invitee => invitee.memberId === null && invitee.recipientLookupKey !== null && verifiedKeys.includes(invitee.recipientLookupKey));
}
