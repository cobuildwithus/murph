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
