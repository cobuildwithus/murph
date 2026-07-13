import type { HostedLinqFirstContactAdmissionRequest } from "./linq-first-contact-admission";
import type { HostedLinqChatHandleSummary } from "./linq-client";
import type { HostedLinqParticipantContact } from "./linq-participant-contact";
import type { HostedLinqMessageSideEffect } from "./webhook-transport";
import type { HostedWebhookPlan } from "./webhook-service-types";

export type HostedOnboardingLinqWebhookResponse = {
  duplicate?: boolean;
  ignored?: boolean;
  inviteCode?: string;
  joinUrl?: string;
  ok: true;
  reason?: string;
};

export type HostedOnboardingLinqCurrentGroupRosterRequest = {
  chatId: string;
  containerMemberId: string;
};

export type HostedOnboardingLinqCurrentGroupRosterSnapshot =
  HostedOnboardingLinqCurrentGroupRosterRequest
  & {
    handles: readonly HostedLinqChatHandleSummary[];
    observationOrdinal: bigint;
    observedAt: Date;
  };

export type HostedOnboardingLinqDirectPlan =
  HostedWebhookPlan<HostedOnboardingLinqWebhookResponse, HostedLinqMessageSideEffect>
  & {
    currentGroupRosterRequest?: HostedOnboardingLinqCurrentGroupRosterRequest;
    firstContactAdmissionParticipantContact?: HostedLinqParticipantContact;
    firstContactAdmissionRequest?: HostedLinqFirstContactAdmissionRequest;
  };
