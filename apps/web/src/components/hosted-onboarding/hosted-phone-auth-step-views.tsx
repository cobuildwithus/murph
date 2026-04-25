import { useId, type FormEvent } from "react";

import { Button, buttonVariants } from "@/src/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/src/components/ui/combobox";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { cn } from "@/src/lib/utils";

import { HostedAuthLegalNotice } from "./hosted-auth-shared";
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
      <div className="space-y-2">
        <p className="text-sm font-medium leading-none text-[#2d3436]">
          Phone number
        </p>
        <div className="rounded-xl border border-[#d9cdbb] bg-[#f7f4ee] px-4 py-3">
          <p className="text-lg font-semibold text-[#2d3436]">{phoneHint}</p>
        </div>
        <p className="text-sm text-stone-500">
          We will text a verification code to this number.
        </p>
      </div>
      <Button
        type="button"
        disabled={disabled}
        size="lg"
        className="w-full"
        onClick={onSendCode}
      >
        {pendingAction === "send-code" ? "Sending code..." : "Text me a code"}
      </Button>
      <HostedUseDifferentNumberButton
        disabled={disabled}
        pendingAction={pendingAction}
        size="sm"
        onClick={onUseDifferentNumber}
      />
      <HostedAuthLegalNotice />
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
  showPassiveConsentNotice = true,
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
  showPassiveConsentNotice?: boolean;
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
            (intent === "signin" || intent === "link"
              ? "Phone number"
              : "Your phone")}
        </Label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Combobox
            items={phoneCountryOptions}
            value={selectedPhoneCountry}
            itemToStringValue={(option) =>
              `${option.label} (${option.dialCode})`
            }
            onValueChange={(option) => {
              if (option) {
                onPhoneCountryChange(option.code);
              }
            }}
          >
            <ComboboxTrigger
              aria-label={`Country or region, ${selectedPhoneCountry.label} ${selectedPhoneCountry.dialCode}`}
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "w-auto shrink-0 justify-between px-4 text-left font-medium sm:min-w-28"
              )}
            >
              {selectedPhoneCountry.dialCode}
            </ComboboxTrigger>
            <ComboboxContent className="w-64">
              <ComboboxInput placeholder="Search countries..." />
              <ComboboxList>
                {(option) => (
                  <ComboboxItem key={option.code} value={option}>
                    <span className="flex min-w-0 items-center justify-between gap-3">
                      <span>{option.label}</span>
                      <span className="text-xs text-stone-500">
                        {option.dialCode}
                      </span>
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <Input
            id={phoneInputId}
            autoFocus={phoneInputAutoFocus}
            autoComplete="tel-national"
            inputMode="tel"
            name="phone-number"
            placeholder={selectedPhoneCountry.placeholder}
            inputSize="lg"
            value={phoneNumber}
            onChange={(event) => onPhoneNumberChange(event.currentTarget.value)}
            className="sm:flex-1"
          />
        </div>
        {phoneFieldDescription ? (
          <p className="text-sm text-stone-500">{phoneFieldDescription}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          disabled={sendCodeDisabled}
          size="lg"
          className="w-full"
        >
          {pendingAction === "send-code"
            ? "Sending code..."
            : intent === "link"
            ? "Send verification code"
            : "Text me a code"}
        </Button>
      </div>
      {intent === "signup" && showPassiveConsentNotice ? (
        <HostedAuthLegalNotice />
      ) : null}
    </form>
  );
}

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
        intent === "signin"
          ? "sign-in code"
          : intent === "link"
          ? "verification code"
          : "code"
      } to ${verificationPhoneNumberHint}.`}
      disabled={disabled}
      pendingAction={
        pendingAction === "send-code" || pendingAction === "verify-code"
          ? pendingAction
          : null
      }
      primaryActionLabel={
        intent === "signin"
          ? "Sign in"
          : intent === "link"
          ? "Link phone"
          : "Verify phone"
      }
      primaryActionPendingLabel={
        intent === "signin"
          ? "Signing in..."
          : intent === "link"
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
