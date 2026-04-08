"use client";

import { useId, type FormEvent } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { HostedUseDifferentNumberButton } from "./hosted-phone-auth-use-different-number-button";
import type {
  HostedPhoneAuthIntent,
  HostedPhoneAuthMode,
  HostedPhoneAuthPendingAction,
  HostedPhoneCountryOption,
} from "./hosted-phone-auth-types";

export { HostedCodeEntryStep } from "./hosted-phone-auth-code-entry-step";

export function HostedInviteShortcutStep({
  disabled,
  pendingAction,
  onSendCode,
  onUseDifferentNumber,
}: {
  disabled: boolean;
  pendingAction: HostedPhoneAuthPendingAction;
  onSendCode: () => void;
  onUseDifferentNumber: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600">
        We&apos;ll text a verification code to your phone.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={onSendCode}
          disabled={disabled}
          size="lg"
          className="w-full"
        >
          {pendingAction === "send-code" ? "Sending code..." : "Send me a code"}
        </Button>
        <HostedUseDifferentNumberButton
          disabled={disabled}
          pendingAction={pendingAction}
          size="sm"
          onClick={onUseDifferentNumber}
        />
      </div>
    </div>
  );
}

export function HostedPhoneEntryStep({
  intent,
  mode,
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
  mode: HostedPhoneAuthMode;
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
          {mode === "invite"
            ? "Phone number"
            : intent === "signin"
              ? "Phone number"
              : "Your phone number"}
        </Label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Combobox
            items={phoneCountryOptions}
            value={selectedPhoneCountry}
            itemToStringValue={(option) => `${option.label} (${option.dialCode})`}
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
                "w-auto shrink-0 justify-between px-4 text-left font-medium sm:min-w-28",
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
                      <span className="text-xs text-stone-500">{option.dialCode}</span>
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <Input
            id={phoneInputId}
            autoComplete="tel-national"
            inputMode="tel"
            name="phone-number"
            placeholder={selectedPhoneCountry.placeholder}
            value={phoneNumber}
            onChange={(event) => onPhoneNumberChange(event.currentTarget.value)}
            className="px-4 text-base sm:flex-1 md:text-sm"
          />
        </div>
        {mode === "invite" ? (
          <p className="text-sm text-stone-500">
            Enter the number that messaged Murph.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={sendCodeDisabled} size="lg" className="w-full">
          {pendingAction === "send-code"
            ? "Sending code..."
            : intent === "signin"
              ? "Text me a sign-in code"
              : "Text me a code"}
        </Button>
      </div>
    </form>
  );
}
