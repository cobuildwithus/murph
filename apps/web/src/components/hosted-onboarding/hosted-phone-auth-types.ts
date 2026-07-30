export type HostedPhoneAuthPendingAction = "continue" | "logout" | "send-code" | "verify-code" | null;
export type HostedAuthenticatedPhoneAuthView =
  | "loading"
  | "manual-resume"
  | "restart"
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

export type HostedPhoneLinkSyncExpectation =
  | {
      kind: "changed-from";
      phoneNumber: string | null;
    }
  | {
      kind: "exact";
      phoneNumber: string;
    }
  | {
      kind: "prepare";
    };

export type HostedPhoneLinkSyncResult =
  | {
      phoneNumber: string | null;
      status: "ready";
    }
  | {
      status: "unchanged";
    }
  | (HostedPhoneLinkPayload & {
      status: "synced";
    });
