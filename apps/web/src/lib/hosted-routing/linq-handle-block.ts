import "server-only";
import type { PrismaClient } from "@prisma/client";
import { decryptHostedContactPhoneEnvelope, encryptHostedContactPhoneEnvelope } from "../hosted-onboarding/contact-phone-envelope";
import { readHostedContactPrivacyKeyring } from "../hosted-onboarding/env";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { acquireHostedLinqParticipantContactLockTx, createHostedLinqParticipantContact, createHostedLinqParticipantContactLookupKeyReadCandidates,
  type HostedLinqParticipantContact } from "../hosted-onboarding/linq-participant-contact";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";

export const LINQ_HANDLE_BLOCK_REASONS = ["bot_ring", "spam", "abuse", "operator"] as const;
export type LinqHandleBlockReason = typeof LINQ_HANDLE_BLOCK_REASONS[number];

export function parseHostedLinqBlockContact(value: string): HostedLinqParticipantContact {
  const contact = createHostedLinqParticipantContact({ kind: value.includes("@") ? "email" : "phone", value });
  if (!contact) throw hostedOnboardingError({ code: "HOSTED_LINQ_BLOCK_CONTACT_INVALID", httpStatus: 400,
    message: "Enter a valid phone number or email address.", retryable: false });
  return contact;
}
function codec(contactLookupKey: string, contactKind: string) {
  return { aad: (version: string) => Buffer.from(JSON.stringify(["hosted-linq-handle-block:v1", version, contactLookupKey, contactKind])),
    keyPurpose: "linq-handle-block-contact", label: "Linq blocked contact", schema: "hosted-linq-handle-block:v1" };
}
function seal(contact: HostedLinqParticipantContact) {
  return encryptHostedContactPhoneEnvelope({ codec: codec(contact.lookupKey, contact.kind), phoneNumber: contact.value });
}
function open(row: { contactLookupKey: string; contactKind: string; contactEncrypted: string }) {
  const value = decryptHostedContactPhoneEnvelope({ codec: codec(row.contactLookupKey, row.contactKind), encrypted: row.contactEncrypted });
  const contact = parseHostedLinqBlockContact(value);
  if (contact.kind !== row.contactKind || !createHostedLinqParticipantContactLookupKeyReadCandidates(contact).includes(row.contactLookupKey)) {
    throw new TypeError("Blocked contact does not match its identity.");
  }
  return contact;
}

export async function isHostedLinqSenderBlocked(contact: HostedLinqParticipantContact | null, prisma: HostedOnboardingReadClient): Promise<boolean> {
  return contact !== null && (await prisma.hostedLinqHandleBlock.findFirst({
    where: { contactLookupKey: { in: createHostedLinqParticipantContactLookupKeyReadCandidates(contact) } },
    select: { contactLookupKey: true },
  })) !== null;
}

/** One bounded read over every readable key version of the given handles. */
export async function hasHostedLinqBlockedHandle(handles: readonly string[], prisma: HostedOnboardingReadClient): Promise<boolean> {
  const keys = handles.flatMap(handle => {
    const contact = createHostedLinqParticipantContact({ kind: handle.includes("@") ? "email" : "phone", value: handle });
    return contact ? createHostedLinqParticipantContactLookupKeyReadCandidates(contact) : [];
  });
  return keys.length > 0 && (await prisma.hostedLinqHandleBlock.findFirst({
    where: { contactLookupKey: { in: keys } }, select: { contactLookupKey: true },
  })) !== null;
}

export async function blockHostedLinqHandle(input: { contact: HostedLinqParticipantContact; reason: LinqHandleBlockReason; prisma: PrismaClient }) {
  const { contact, reason, prisma } = input;
  const contactEncrypted = seal(contact);
  await prisma.$transaction(async tx => {
    await acquireHostedLinqParticipantContactLockTx({ contact, tx });
    const existing = await tx.hostedLinqHandleBlock.findFirst({ where: {
      contactLookupKey: { in: createHostedLinqParticipantContactLookupKeyReadCandidates(contact) },
    }, select: { contactLookupKey: true } });
    if (existing) return; // An add during overlap must not create a second block.
    await tx.hostedLinqHandleBlock.create({ data: { contactLookupKey: contact.lookupKey, contactKind: contact.kind, contactEncrypted, reason } });
  });
}

export async function unblockHostedLinqHandle(input: { contact: HostedLinqParticipantContact; prisma: PrismaClient }) {
  const { contact, prisma } = input;
  return prisma.$transaction(async tx => {
    await acquireHostedLinqParticipantContactLockTx({ contact, tx });
    return tx.hostedLinqHandleBlock.deleteMany({ where: { contactLookupKey: { in: createHostedLinqParticipantContactLookupKeyReadCandidates(contact) } } });
  });
}

/** Operator-only callers may open contacts, never return the envelope. */
export async function listHostedLinqHandleBlocks(input: { after?: string; prisma: PrismaClient }) {
  const rows = await input.prisma.hostedLinqHandleBlock.findMany({
    where: input.after ? { contactLookupKey: { gt: input.after } } : {}, orderBy: { contactLookupKey: "asc" }, take: 51,
  });
  return { blocks: rows.slice(0, 50).map(row => ({ contact: open(row).value, reason: row.reason, createdAt: row.createdAt.toISOString() })),
    nextCursor: rows.length > 50 ? rows[49]!.contactLookupKey : null };
}

/** Rotate dormant blocks too; remove the prior key only after this returns zero. */
export async function rotateHostedLinqHandleBlockBatch(prisma: PrismaClient): Promise<number> {
  const { currentVersion } = readHostedContactPrivacyKeyring(process.env);
  const rows = await prisma.hostedLinqHandleBlock.findMany({
    where: { NOT: { contactLookupKey: { contains: `:${currentVersion}:` } } }, orderBy: { contactLookupKey: "asc" }, take: 100,
  });
  let rotated = 0;
  for (const row of rows) {
    const contact = open(row), contactEncrypted = seal(contact);
    rotated += await prisma.$transaction(async tx => {
      await acquireHostedLinqParticipantContactLockTx({ contact, tx });
      const result = await tx.hostedLinqHandleBlock.updateMany({
        where: { contactLookupKey: row.contactLookupKey, contactEncrypted: row.contactEncrypted },
        data: { contactLookupKey: contact.lookupKey, contactEncrypted },
      });
      return result.count;
    });
  }
  return rotated;
}
