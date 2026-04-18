import type { HostedOnboardingStage } from "./lifecycle";
import type {
  HostedBillingPlanCode,
  HostedBillingPlanPresentation,
} from "./billing-plans";

export interface HostedInviteStatusPayload {
  activationPending: boolean;
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
  activationPending: boolean;
  inviteCode: string;
  joinUrl: string;
  messagingSetupRequired: boolean;
  stage: "checkout" | "blocked" | "active";
}
