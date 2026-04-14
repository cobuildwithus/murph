import { HostedVerificationCodeStep } from "./hosted-verification-code-step";

import type {
  HostedPhoneAuthIntent,
  HostedPhoneAuthPendingAction,
} from "./hosted-phone-auth-types";
import { HostedUseDifferentNumberButton } from "./hosted-phone-auth-use-different-number-button";

export function HostedCodeEntryStep({
  verificationPhoneNumberHint,
  code,
  disabled,
  intent,
  pendingAction,
  secondaryActionSize,
  onCodeChange,
  onResendCode,
  onUseDifferentNumber,
  onVerifyCode,
}: {
  verificationPhoneNumberHint: string;
  code: string;
  disabled: boolean;
  intent: HostedPhoneAuthIntent;
  pendingAction: HostedPhoneAuthPendingAction;
  secondaryActionSize: "sm" | "lg";
  onCodeChange: (value: string) => void;
  onResendCode: () => void;
  onUseDifferentNumber: () => void;
  onVerifyCode: () => void;
}) {
  return (
    <HostedVerificationCodeStep
      code={code}
      description={`We texted the latest ${
        intent === "signin" ? "sign-in code" : "code"
      } to ${verificationPhoneNumberHint}.`}
      disabled={disabled}
      pendingAction={pendingAction === "send-code" || pendingAction === "verify-code"
        ? pendingAction
        : null}
      primaryActionLabel={intent === "signin" ? "Sign in" : "Verify phone"}
      primaryActionPendingLabel={
        intent === "signin" ? "Signing in..." : "Finishing setup..."
      }
      secondaryAction={
        <HostedUseDifferentNumberButton
          disabled={disabled}
          pendingAction={pendingAction}
          size={secondaryActionSize}
          onClick={onUseDifferentNumber}
        />
      }
      onCodeChange={onCodeChange}
      onResendCode={onResendCode}
      onSubmit={onVerifyCode}
    />
  );
}
