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
  HostedPhoneAuthPendingAction,
  HostedPhoneCountryOption,
} from "./hosted-phone-auth-types";

export { HostedCodeEntryStep } from "./hosted-phone-auth-code-entry-step";

const HOSTED_TERMS_URL = "/legal/terms.pdf";
const HOSTED_PRIVACY_URL = "/legal/privacy.pdf";

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
      <HostedPassiveConsentNotice />
    </div>
  );
}

export function HostedPhoneEntryStep({
  intent,
  phoneFieldLabel,
  phoneFieldDescription,
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
          {phoneFieldLabel ?? (intent === "signin" ? "Phone number" : "Your phone number")}
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
        {phoneFieldDescription ? (
          <p className="text-sm text-stone-500">
            {phoneFieldDescription}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={sendCodeDisabled} size="lg" className="w-full">
          {pendingAction === "send-code"
            ? "Sending code..."
            : "Text me a code"}
        </Button>
      </div>
      {intent === "signup" ? <HostedPassiveConsentNotice /> : null}
    </form>
  );
}

function HostedPassiveConsentNotice() {
  return (
    <p className="text-xs leading-relaxed text-stone-500">
      By signing up, you agree to our{" "}
      <a href={HOSTED_TERMS_URL} target="_blank" rel="noreferrer" className="hover:underline hover:underline-offset-4">
        Terms
      </a>{" "}
      and{" "}
      <a href={HOSTED_PRIVACY_URL} target="_blank" rel="noreferrer" className="hover:underline hover:underline-offset-4">
        Privacy Policy
      </a>
      .
    </p>
  );
}
