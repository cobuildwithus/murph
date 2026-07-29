import type { Prisma } from "@prisma/client";

import {
  createHostedEmailLookupKey,
  createHostedEmailLookupKeyReadCandidates,
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
  normalizeHostedEmailAddress,
} from "./contact-privacy";
import { normalizePhoneNumber } from "./phone";

export const HOSTED_LINQ_PARTICIPANT_CONTACT_KINDS = [
  "email",
  "phone",
] as const;

export type HostedLinqParticipantContactKind =
  typeof HOSTED_LINQ_PARTICIPANT_CONTACT_KINDS[number];

export interface HostedLinqParticipantContact {
  kind: HostedLinqParticipantContactKind;
  lookupKey: string;
  value: string;
}

export type HostedLinqParticipantIdentity = Pick<
  HostedLinqParticipantContact,
  "kind" | "lookupKey"
>;

export interface HostedLinqParticipantContactClaim extends HostedLinqParticipantContact {
  observedAt: Date | null;
}

export async function acquireHostedLinqParticipantContactLockTx(input: {
  contact: HostedLinqParticipantContact;
  lockTimeoutMs?: number;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const lockValue = buildHostedLinqParticipantContactLockValue(input.contact);
  if (input.lockTimeoutMs !== undefined) {
    const lockTimeoutMs = Math.max(1, Math.trunc(input.lockTimeoutMs));
    await input.tx.$executeRaw`
      SELECT set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, true)
    `;
  }

  await input.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext('hosted-linq-routing:participant-contact'),
      hashtext(${lockValue})
    )
  `;
}

export async function acquireHostedLinqParticipantPhoneLockTx(input: {
  lockTimeoutMs?: number;
  phoneNumber: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const contact = createHostedLinqParticipantContact({
    kind: "phone",
    value: input.phoneNumber,
  });
  if (!contact) {
    throw new TypeError("Hosted Linq participant phone lock requires a valid phone number.");
  }

  await acquireHostedLinqParticipantContactLockTx({
    contact,
    ...(input.lockTimeoutMs !== undefined
      ? { lockTimeoutMs: input.lockTimeoutMs }
      : {}),
    tx: input.tx,
  });
}

export function buildHostedLinqParticipantContactLockValue(
  contact: HostedLinqParticipantContact,
): string {
  const value = normalizeHostedLinqParticipantContactValue({
    kind: contact.kind,
    value: contact.value,
  });
  if (!value) {
    throw new TypeError("Hosted Linq participant contact requires a valid contact value.");
  }

  return `${contact.kind}:${value}`;
}

export function createHostedLinqParticipantContact(input: {
  kind: HostedLinqParticipantContactKind;
  value: string | null | undefined;
}): HostedLinqParticipantContact | null {
  const value = normalizeHostedLinqParticipantContactValue(input);
  if (!value) {
    return null;
  }

  const lookupKey = createHostedLinqParticipantContactLookupKey({
    kind: input.kind,
    value,
  });
  if (!lookupKey) {
    return null;
  }

  return {
    kind: input.kind,
    lookupKey,
    value,
  };
}

export function createHostedLinqParticipantContactLookupKey(input: {
  kind: HostedLinqParticipantContactKind;
  value: string | null | undefined;
}): string | null {
  switch (input.kind) {
    case "email":
      return createHostedEmailLookupKey(input.value);
    case "phone":
      return createHostedPhoneLookupKey(input.value);
    default: {
      const exhaustive: never = input.kind;
      void exhaustive;
      return null;
    }
  }
}

export function createHostedLinqParticipantContactLookupKeyReadCandidates(input: {
  kind: HostedLinqParticipantContactKind;
  value: string | null | undefined;
}): string[] {
  switch (input.kind) {
    case "email":
      return createHostedEmailLookupKeyReadCandidates(input.value);
    case "phone":
      return createHostedPhoneLookupKeyReadCandidates(input.value);
    default: {
      const exhaustive: never = input.kind;
      void exhaustive;
      return [];
    }
  }
}

export function normalizeHostedLinqParticipantContactKind(
  value: string | null | undefined,
): HostedLinqParticipantContactKind | null {
  if (value === "email" || value === "phone") {
    return value;
  }

  return null;
}

export function normalizeHostedLinqParticipantContactValue(input: {
  kind: HostedLinqParticipantContactKind;
  value: string | null | undefined;
}): string | null {
  switch (input.kind) {
    case "email":
      return normalizeHostedEmailAddress(input.value);
    case "phone":
      return normalizePhoneNumber(input.value);
    default: {
      const exhaustive: never = input.kind;
      void exhaustive;
      return null;
    }
  }
}
