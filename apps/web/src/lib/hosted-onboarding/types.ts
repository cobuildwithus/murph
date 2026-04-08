import type { HostedOnboardingStage } from "./lifecycle";

export interface HostedInviteStatusPayload {
  capabilities: {
    billingReady: boolean;
    phoneAuthReady: boolean;
  };
  invite: {
    code: string;
    expiresAt: string;
    phoneHint: string;
  } | null;
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
  stage: "checkout" | "activating" | "blocked" | "active";
}
