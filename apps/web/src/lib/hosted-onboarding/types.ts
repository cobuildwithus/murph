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
    phoneAuthTarget?: HostedInvitePhoneAuthTarget;
    phoneHint: string | null;
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

export type HostedInvitePhoneAuthTarget =
  | {
      kind: "saved";
      phoneHint: string;
    }
  | {
      kind: "manual";
    };

export interface HostedPrivyCompletionPayload {
  inviteCode: string;
  joinUrl: string;
  messagingSetupRequired: boolean;
  stage: HostedPostVerificationStage;
}
