export type HostedPhoneAuthPendingAction = "continue" | "logout" | "send-code" | "verify-code" | null;

export interface HostedPhoneCountryOption {
  code: string;
  dialCode: string;
  label: string;
  placeholder: string;
}
