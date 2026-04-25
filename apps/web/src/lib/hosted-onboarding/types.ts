import type {
  HostedOnboardingStage,
  HostedPostVerificationStage,
} from "./stage";
import type {
  HostedBillingPlanCode,
  HostedBillingPlanPresentation,
} from "./billing-plans";

export interface HostedInviteStatusPayload {
  billing: {
    defaultPlanCode: HostedBillingPlanCode | null;
    plans: readonly HostedBillingPlanPresentation[];
  };
  capabilities: {
    billingReady: boolean;
    phoneAuthReady: boolean;
  };
  invite: {
    code: string;
    expiresAt: string;
    phoneHint: string;
    phonePrefill?: string | null;
  } | null;
  messagingSetupRequired: boolean;
  murphPhoneNumber?: string | null;
  session: {
    authenticated: boolean;
    expiresAt: string | null;
    matchesInvite: boolean;
  };
  stage: HostedOnboardingStage;
}

export interface HostedPrivyCompletionPayload {
  inviteCode: string;
  joinUrl: string;
  messagingSetupRequired: boolean;
  stage: HostedPostVerificationStage;
}
