export type HostedPhoneAuthIntent = "signup" | "signin" | "link";
export type HostedPhoneAuthPendingAction = "continue" | "logout" | "send-code" | "verify-code" | null;
export type HostedAuthenticatedPhoneAuthView =
  | "loading"
  | "manual-resume"
  | "restart"
  | "signin-account-not-found"
  | null;

export interface HostedPhoneVerificationAttempt {
  maskedPhoneNumber: string;
  phoneNumber: string;
}

export interface HostedPhoneCountryOption {
  code: string;
  dialCode: string;
  label: string;
  placeholder: string;
}

export interface HostedResolvedPhoneSubmission {
  draftPhoneNumber: string;
  normalizedPhoneNumber: string | null;
}

export interface HostedPhoneLinkPayload {
  phoneNumber: string;
  phoneNumberHint: string;
}
