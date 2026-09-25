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
  smsEnabled?: boolean;
}): boolean {
  const participantContact = resolveHostedLinqParticipantContact(input.event);
  return participantContact !== null
    && isHostedLinqInstantStartCandidate({
      event: input.event,
      participantContact,
      phonePrefixes: input.phonePrefixes,
      smsEnabled: input.smsEnabled,
    });
}

export function isHostedLinqInstantStartCandidate(input: {
  event: HostedLinqMessageReceivedEvent;
  participantContact: HostedLinqParticipantContact;
  phonePrefixes: readonly string[];
  smsEnabled?: boolean;
}): boolean {
  return input.event.data.chat?.is_group === false
    && !input.event.data.is_from_me
    && (
      input.participantContact.kind === "email"
        ? isHostedLinqIMessageService(input.event.data.service)
        : (isHostedLinqIMessageService(input.event.data.service)
            || (input.smsEnabled === true && ["sms", "rcs"].includes(
              input.event.data.service?.trim().toLowerCase() ?? "",
            ))) && resolveHostedLinqInstantStartPhonePrefix({
            phoneNumber: input.participantContact.value,
            prefixes: input.phonePrefixes,
          }) !== null
    );
}

export function isHostedLinqInstantStartEligible(input: {
  admissionDecision: HostedLinqFirstContactAdmissionDecision | null | undefined;
  event: HostedLinqMessageReceivedEvent;
  participantContact: HostedLinqParticipantContact;
  phonePrefixes: readonly string[];
  smsEnabled?: boolean;
}): boolean {
  return input.admissionDecision?.kind === "allow"
    && input.admissionDecision.source === "model"
    && isHostedLinqInstantStartCandidate(input);
}
