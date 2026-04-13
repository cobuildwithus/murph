import type { HostedOnboardingStage } from "./lifecycle";

export interface HostedInviteStatusPayload {
  activationPending: boolean;
  capabilities: {
    billingReady: boolean;
    phoneAuthReady: boolean;
  };
  invite: {
    code: string;
    expiresAt: string;
    phoneHint: string;
  } | null;
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
  stage: "checkout" | "blocked" | "active";
}
