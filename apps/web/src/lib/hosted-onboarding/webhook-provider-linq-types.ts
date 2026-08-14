import type { HostedLinqFirstContactAdmissionRequest } from "./linq-first-contact-admission";
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

export type HostedOnboardingLinqGroupRosterReconcile = {
  chatId: string;
  containerMemberId: string;
};

export type HostedLinqInstantStartEnrollment = {
  admissionEventId: string;
  inviteCode: string;
  memberId: string;
};

export type HostedOnboardingLinqDirectPlan =
  HostedWebhookPlan<HostedOnboardingLinqWebhookResponse, HostedLinqMessageSideEffect>
  & {
    firstContactAdmissionParticipantContact?: HostedLinqParticipantContact;
    firstContactAdmissionRequest?: HostedLinqFirstContactAdmissionRequest;
    instantStartEnrollment?: HostedLinqInstantStartEnrollment;
    nextRequiredPendingGroupSetupCandidateId?: string | null;
    postCommitGroupRosterReconciles?: readonly HostedOnboardingLinqGroupRosterReconcile[];
  };
