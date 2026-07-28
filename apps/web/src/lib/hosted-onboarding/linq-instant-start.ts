import {
  resolveHostedLinqParticipantContact,
  type HostedLinqMessageReceivedEvent,
} from "./linq";
import type {
  HostedLinqFirstContactAdmissionDecision,
} from "./linq-first-contact-admission";
import type { HostedLinqParticipantContact } from "./linq-participant-contact";
import { normalizePhoneNumber } from "./phone";
import { isHostedLinqIMessageService } from "./webhook-provider-linq-shared";

export function resolveHostedLinqInstantStartPhonePrefix(input: {
  phoneNumber: string | null | undefined;
  prefixes: readonly string[];
}): string | null {
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  if (!phoneNumber) {
    return null;
  }

  let matchedPrefix: string | null = null;
  for (const prefix of input.prefixes) {
    if (
      phoneNumber.startsWith(prefix)
      && (matchedPrefix === null || prefix.length > matchedPrefix.length)
    ) {
      matchedPrefix = prefix;
    }
  }

  return matchedPrefix;
}

export function isHostedLinqInstantStartEventCandidate(input: {
  event: HostedLinqMessageReceivedEvent;
  phonePrefixes: readonly string[];
}): boolean {
  const participantContact = resolveHostedLinqParticipantContact(input.event);
  return participantContact !== null
    && isHostedLinqInstantStartCandidate({
      event: input.event,
      participantContact,
      phonePrefixes: input.phonePrefixes,
    });
}

export function isHostedLinqInstantStartCandidate(input: {
  event: HostedLinqMessageReceivedEvent;
  participantContact: HostedLinqParticipantContact;
  phonePrefixes: readonly string[];
}): boolean {
  return input.participantContact.kind === "phone"
    && input.event.data.chat?.is_group === false
    && !input.event.data.is_from_me
    && isHostedLinqIMessageService(input.event.data.service)
    && resolveHostedLinqInstantStartPhonePrefix({
        phoneNumber: input.participantContact.value,
        prefixes: input.phonePrefixes,
      }) !== null;
}

export function isHostedLinqInstantStartEligible(input: {
  admissionDecision: HostedLinqFirstContactAdmissionDecision | null | undefined;
  event: HostedLinqMessageReceivedEvent;
  participantContact: HostedLinqParticipantContact;
  phonePrefixes: readonly string[];
}): boolean {
  return input.admissionDecision?.kind === "allow"
    && input.admissionDecision.source === "model"
    && isHostedLinqInstantStartCandidate(input);
}
