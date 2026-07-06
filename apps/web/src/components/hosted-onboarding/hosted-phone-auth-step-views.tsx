"use client";

import { useId, type FormEvent } from "react";

import { Button } from "@/src/components/ui/button";
import { Label } from "@/src/components/ui/label";
import { PhoneNumberInput } from "@/src/components/ui/phone-number-input";

import { HostedUseDifferentNumberButton } from "./hosted-phone-auth-use-different-number-button";
import { HostedVerificationCodeStep } from "./hosted-verification-code-step";
import type {
  HostedPhoneAuthIntent,
  HostedPhoneAuthPendingAction,
  HostedPhoneCountryOption,
} from "./hosted-phone-auth-types";

export function HostedInviteMaskedPhoneStep({
  disabled,
  pendingAction,
  phoneHint,
  onSendCode,
  onUseDifferentNumber,
}: {
  disabled: boolean;
  pendingAction: HostedPhoneAuthPendingAction;
  phoneHint: string;
  onSendCode: () => void;
  onUseDifferentNumber: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <HostedInviteMaskedPhoneSummary phoneHint={phoneHint} />
      <Button
        type="button"
        disabled={disabled}
        size="xl"
        className="w-full"
        onClick={onSendCode}
      >
        {pendingAction === "send-code"
          ? "Sending code..."
          : "Send verification code"}
      </Button>
      <HostedUseDifferentNumberButton
        disabled={disabled}
        pendingAction={pendingAction}
        size="sm"
        onClick={onUseDifferentNumber}
      />
    </div>
  );
}


function HostedInviteMaskedPhoneSummary({
  phoneHint,
}: {
  phoneHint: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium leading-none text-foreground">
        Phone number
      </p>
      <div className="rounded-xl border border-border bg-muted px-4 py-3">
        <p className="text-lg font-semibold text-foreground">{phoneHint}</p>
      </div>
      <p className="text-sm text-muted-foreground">
        We will text a verification code to this number.
      </p>
    </div>
  );
}

export function HostedPhoneEntryStep({
  intent,
  phoneFieldLabel,
  phoneFieldDescription,
  phoneInputAutoFocus = false,
  pendingAction,
  phoneCountryOptions,
  phoneNumber,
  sendCodeDisabled,
  selectedPhoneCountry,
  onPhoneCountryChange,
  onPhoneNumberChange,
  onSubmitPhoneEntry,
}: {
  intent: HostedPhoneAuthIntent;
  phoneFieldLabel?: string | null;
  phoneFieldDescription?: string | null;
  phoneInputAutoFocus?: boolean;
  pendingAction: HostedPhoneAuthPendingAction;
  phoneCountryOptions: HostedPhoneCountryOption[];
  phoneNumber: string;
  sendCodeDisabled: boolean;
  selectedPhoneCountry: HostedPhoneCountryOption;
  onPhoneCountryChange: (code: string) => void;
  onPhoneNumberChange: (value: string) => void;
  onSubmitPhoneEntry: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const phoneInputId = useId();

  return (
    <form className="space-y-3" onSubmit={onSubmitPhoneEntry}>
      <div className="space-y-3">
        <Label htmlFor={phoneInputId}>
          {phoneFieldLabel ??
            (intent === "link" ? "Phone number" : "Your phone")}
        </Label>
        <PhoneNumberInput
          id={phoneInputId}
          autoFocus={phoneInputAutoFocus}
          options={phoneCountryOptions}
          selectedCountry={selectedPhoneCountry}
          value={phoneNumber}
          onCountryChange={onPhoneCountryChange}
          onPhoneNumberChange={onPhoneNumberChange}
        />
        {phoneFieldDescription ? (
          <p className="text-sm text-muted-foreground">{phoneFieldDescription}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          disabled={sendCodeDisabled}
          size="xl"
          className="w-full"
        >
          {pendingAction === "send-code"
            ? "Sending code..."
            : "Send verification code"}
        </Button>
      </div>
    </form>
  );
}

export function HostedCodeEntryStep({
  verificationPhoneNumberHint,
  code,
  disableSignup = false,
  disabled,
  intent,
  pendingAction,
  secondaryActionSize,
  size,
  onCodeChange,
  onResendCode,
  onUseDifferentNumber,
  onVerifyCode,
}: {
  verificationPhoneNumberHint: string;
  code: string;
  disableSignup?: boolean;
  disabled: boolean;
  intent: HostedPhoneAuthIntent;
  pendingAction: HostedPhoneAuthPendingAction;
  secondaryActionSize: "sm" | "lg";
  size?: "default" | "compact";
  onCodeChange: (value: string) => void;
  onResendCode: () => void;
  onUseDifferentNumber: () => void;
  onVerifyCode: () => void;
}) {
  return (
    <HostedVerificationCodeStep
      code={code}
      size={size}
      description={resolveHostedPhoneCodeEntryDescription({
        disableSignup,
        intent,
        verificationPhoneNumberHint,
      })}
      disabled={disabled}
      pendingAction={
        pendingAction === "send-code" || pendingAction === "verify-code"
          ? pendingAction
          : null
      }
      primaryActionLabel={
        intent === "link"
          ? "Link phone"
          : "Verify phone"
      }
      primaryActionPendingLabel={
        intent === "link"
          ? "Saving phone..."
          : "Finishing setup..."
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

function resolveHostedPhoneCodeEntryDescription({
  disableSignup,
  intent,
  verificationPhoneNumberHint,
}: {
  disableSignup: boolean;
  intent: HostedPhoneAuthIntent;
  verificationPhoneNumberHint: string;
}) {
  if (intent === "link") {
    return `We texted the latest verification code to ${verificationPhoneNumberHint}.`;
  }

  if (disableSignup) {
    return `If an account exists for ${verificationPhoneNumberHint}, we texted the latest code there.`;
  }

  return `We texted the latest code to ${verificationPhoneNumberHint}.`;
}
