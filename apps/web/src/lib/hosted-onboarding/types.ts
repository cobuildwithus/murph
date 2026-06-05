import type {
  HostedOnboardingStage,
  HostedPostVerificationStage,
} from "./stage";
import type {
  HostedBillingPlanCode,
  HostedBillingPlanPresentation,
} from "./billing-plans";

export const HOSTED_PRIVY_AUTH_METHODS = ["phone", "email", "telegram"] as const;

export type HostedPrivyAuthMethod = (typeof HOSTED_PRIVY_AUTH_METHODS)[number];

export function isHostedPrivyAuthMethod(value: unknown): value is HostedPrivyAuthMethod {
  return HOSTED_PRIVY_AUTH_METHODS.includes(value as HostedPrivyAuthMethod);
}

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
    emailAuthTarget?: HostedInviteEmailAuthTarget;
    expiresAt: string;
    phoneAuthTarget?: HostedInvitePhoneAuthTarget;
    phoneHint: string | null;
    verificationMode: HostedInviteVerificationMode;
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

export type HostedInviteEmailAuthTarget =
  | {
      emailAddress: string;
      kind: "saved";
    }
  | {
      kind: "manual";
    };

export type HostedInviteVerificationMode = "invite_email" | "invite_phone" | "manual_phone";

export interface HostedPrivyCompletionPayload {
  inviteCode: string;
  joinUrl: string;
  launchConsentGranted?: boolean;
  messagingSetupRequired: boolean;
  stage: HostedPostVerificationStage;
  status: HostedInviteStatusPayload;
}
