"use client";

import { useId, type FormEvent } from "react";

import { Button } from "@/src/components/ui/button";
import { Label } from "@/src/components/ui/label";
import {
  PhoneNumberInput,
  type PhoneNumberInputChangeMetadata,
} from "@/src/components/ui/phone-number-input";
import { Spinner } from "@/src/components/ui/spinner";

import type {
  HostedPhoneAuthPendingAction,
  HostedPhoneCountryOption,
} from "./hosted-phone-auth-types";

export function HostedPhoneEntryStep({
  phoneFieldLabel,
  phoneFieldDescription,
  phoneInputAutoFocus = false,
  phoneInputDisabled = false,
  pendingAction,
  phoneCountryOptions,
  phoneNumber,
  sendCodeDisabled,
  selectedPhoneCountry,
  onPhoneCountryChange,
  onPhoneNumberChange,
  onSubmitPhoneEntry,
}: {
  phoneFieldLabel?: string | null;
  phoneFieldDescription?: string | null;
  phoneInputAutoFocus?: boolean;
  phoneInputDisabled?: boolean;
  pendingAction: HostedPhoneAuthPendingAction;
  phoneCountryOptions: HostedPhoneCountryOption[];
  phoneNumber: string;
  sendCodeDisabled: boolean;
  selectedPhoneCountry: HostedPhoneCountryOption;
  onPhoneCountryChange: (code: string) => void;
  onPhoneNumberChange: (
    value: string,
    metadata?: PhoneNumberInputChangeMetadata,
  ) => void;
  onSubmitPhoneEntry: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const phoneInputId = useId();

  return (
    <form className="space-y-3" onSubmit={onSubmitPhoneEntry}>
      <div className="space-y-3">
        <Label htmlFor={phoneInputId}>
          {phoneFieldLabel ?? "Your phone"}
        </Label>
        <PhoneNumberInput
          id={phoneInputId}
          autoFocus={phoneInputAutoFocus}
          disabled={phoneInputDisabled}
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
          aria-busy={pendingAction === "send-code"}
          type="submit"
          disabled={sendCodeDisabled}
          size="xl"
          className="w-full"
        >
          {pendingAction === "send-code" ? (
            <>
              <Spinner aria-hidden="true" />
              Sending code...
            </>
          ) : "Send verification code"}
        </Button>
      </div>
    </form>
  );
}
