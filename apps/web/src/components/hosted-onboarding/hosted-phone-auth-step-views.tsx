"use client";

import { useId, useState, type FormEvent } from "react";
import { CheckIcon, ChevronDownIcon, LoaderCircleIcon } from "lucide-react";

import { Button, buttonVariants } from "@/src/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/src/components/ui/combobox";
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
} from "@/src/components/ui/drawer";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { useIsMobile } from "@/src/hooks/use-mobile";
import { cn } from "@/src/lib/utils";

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
        {pendingAction === "send-code" ? "Sending code..." : "Send verification code"}
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

export function HostedInviteMaskedPhoneLoadingStep({
  phoneHint,
  onUseDifferentNumber,
}: {
  phoneHint: string;
  onUseDifferentNumber: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <HostedInviteMaskedPhoneSummary phoneHint={phoneHint} />
      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
        <LoaderCircleIcon className="mt-0.5 size-4 shrink-0 animate-spin" />
        <div>
          <p className="font-medium text-foreground">
            Preparing phone verification...
          </p>
          <p>Keep this tab open for a moment.</p>
        </div>
      </div>
      <HostedUseDifferentNumberButton
        disabled={false}
        pendingAction={null}
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
        <div className="flex gap-3">
          <CountryCodePicker
            options={phoneCountryOptions}
            selectedCountry={selectedPhoneCountry}
            onCountryChange={onPhoneCountryChange}
          />
          <Input
            id={phoneInputId}
            autoFocus={phoneInputAutoFocus}
            autoComplete="tel-national"
            inputMode="tel"
            name="phone-number"
            placeholder={selectedPhoneCountry.placeholder}
            inputSize="xl"
            value={phoneNumber}
            onChange={(event) => onPhoneNumberChange(event.currentTarget.value)}
            className="flex-1"
          />
        </div>
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

const COUNTRY_TRIGGER_CLASS = cn(
  buttonVariants({ variant: "outline", size: "lg" }),
  "h-14 w-auto shrink-0 justify-between rounded-2xl px-5 text-left text-base font-medium md:text-base sm:min-w-28",
);

function CountryCodePicker({
  options,
  selectedCountry,
  onCountryChange,
}: {
  options: HostedPhoneCountryOption[];
  selectedCountry: HostedPhoneCountryOption;
  onCountryChange: (code: string) => void;
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <CountryCodeDrawer
        options={options}
        selectedCountry={selectedCountry}
        onCountryChange={onCountryChange}
      />
    );
  }

  return (
    <Combobox
      items={options}
      value={selectedCountry}
      itemToStringValue={(option) =>
        `${option.label} ${option.dialCode} ${option.dialCode.replace("+", "")}`
      }
      onValueChange={(option) => {
        if (option) {
          onCountryChange(option.code);
        }
      }}
    >
      <ComboboxTrigger
        aria-label={`Country or region, ${selectedCountry.label} ${selectedCountry.dialCode}`}
        className={COUNTRY_TRIGGER_CLASS}
      >
        {selectedCountry.dialCode}
      </ComboboxTrigger>
      <ComboboxContent className="w-64">
        <ComboboxInput placeholder="Search countries..." />
        <ComboboxList>
          {(option) => (
            <ComboboxItem key={option.code} value={option}>
              <span className="flex min-w-0 items-center justify-between gap-3">
                <span>{option.label}</span>
                <span className="text-xs text-muted-foreground">
                  {option.dialCode}
                </span>
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function CountryCodeDrawer({
  options,
  selectedCountry,
  onCountryChange,
}: {
  options: HostedPhoneCountryOption[];
  selectedCountry: HostedPhoneCountryOption;
  onCountryChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const digits = search.replace(/[^0-9]/g, "");
  const normalizedSearch = search.toLowerCase();
  const filtered = search
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(normalizedSearch) ||
          (digits.length > 0 && o.dialCode.replace("+", "").startsWith(digits)),
      )
    : options;

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <DrawerTrigger asChild>
        <button
          type="button"
          aria-label={`Country or region, ${selectedCountry.label} ${selectedCountry.dialCode}`}
          className={COUNTRY_TRIGGER_CLASS}
        >
          {selectedCountry.dialCode}
          <ChevronDownIcon className="pointer-events-none size-4 text-stone-500" />
        </button>
      </DrawerTrigger>
      <DrawerContent>
        <div className="flex flex-col pb-12">
          <div className="sticky top-0 border-b border-border bg-popover px-4 py-3">
            <input
              autoFocus
              type="text"
              placeholder="Search countries..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-border bg-muted px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="overflow-y-auto overscroll-contain">
            {filtered.map((option) => (
              <button
                key={option.code}
                type="button"
                className={cn(
                  "flex w-full items-center gap-3 px-5 py-3.5 text-left text-base transition-colors active:bg-muted",
                  option.code === selectedCountry.code
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
                onClick={() => {
                  onCountryChange(option.code);
                  setOpen(false);
                  setSearch("");
                }}
              >
                <span className="flex-1">{option.label}</span>
                <span className="text-xs text-muted-foreground">
                  {option.dialCode}
                </span>
                {option.code === selectedCountry.code && (
                  <CheckIcon className="size-4 shrink-0 text-foreground" />
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                No countries found
              </p>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
