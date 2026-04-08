"use client";

import { LoaderCircleIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

export type HostedPhoneAuthMode = "invite" | "public";
export type HostedPhoneAuthPendingAction = "continue" | "logout" | "send-code" | "verify-code" | null;
export type HostedAuthenticatedPhoneAuthView = "loading" | "manual-resume" | "restart" | null;

interface HostedPhoneCountryOption {
  code: string;
  dialCode: string;
  label: string;
  placeholder: string;
}

interface SharedFlowProps {
  code: string;
  disabled: boolean;
  mode: HostedPhoneAuthMode;
  pendingAction: HostedPhoneAuthPendingAction;
  phoneCountryOptions: HostedPhoneCountryOption[];
  phoneNumber: string;
  selectedPhoneCountry: HostedPhoneCountryOption;
  onCodeChange: (value: string) => void;
  onPhoneCountryChange: (code: string) => void;
  onPhoneNumberChange: (value: string) => void;
  onResendCode: () => void;
  onSendCode: () => void;
  onUseDifferentNumber: () => void;
  onVerifyCode: () => void;
  step: "phone" | "code";
}

interface InviteFlowProps extends SharedFlowProps {
  manualEntryVisible: boolean;
}

interface AuthenticatedStateProps {
  body: string;
  description: string;
  disabled: boolean;
  pendingAction: HostedPhoneAuthPendingAction;
  title: string;
  view: HostedAuthenticatedPhoneAuthView;
  onContinue: () => void;
  onUseDifferentNumber: () => void;
}

export function HostedInvitePhoneAuthFlow({
  manualEntryVisible,
  ...props
}: InviteFlowProps) {
  if (props.step === "code") {
    return (
      <HostedCodeEntryStep
        code={props.code}
        disabled={props.disabled}
        mode={props.mode}
        pendingAction={props.pendingAction}
        onCodeChange={props.onCodeChange}
        onResendCode={props.onResendCode}
        onUseDifferentNumber={props.onUseDifferentNumber}
        onVerifyCode={props.onVerifyCode}
      />
    );
  }

  if (!manualEntryVisible) {
    return (
      <HostedInviteShortcutStep
        disabled={props.disabled}
        pendingAction={props.pendingAction}
        onSendCode={props.onSendCode}
        onUseDifferentNumber={props.onUseDifferentNumber}
      />
    );
  }

  return (
    <HostedPhoneEntryStep
      disabled={props.disabled}
      mode={props.mode}
      pendingAction={props.pendingAction}
      phoneCountryOptions={props.phoneCountryOptions}
      phoneNumber={props.phoneNumber}
      selectedPhoneCountry={props.selectedPhoneCountry}
      onPhoneCountryChange={props.onPhoneCountryChange}
      onPhoneNumberChange={props.onPhoneNumberChange}
      onSendCode={props.onSendCode}
    />
  );
}

export function HostedPublicPhoneAuthFlow(props: SharedFlowProps) {
  if (props.step === "code") {
    return (
      <HostedCodeEntryStep
        code={props.code}
        disabled={props.disabled}
        mode={props.mode}
        pendingAction={props.pendingAction}
        onCodeChange={props.onCodeChange}
        onResendCode={props.onResendCode}
        onUseDifferentNumber={props.onUseDifferentNumber}
        onVerifyCode={props.onVerifyCode}
      />
    );
  }

  return (
    <HostedPhoneEntryStep
      disabled={props.disabled}
      mode={props.mode}
      pendingAction={props.pendingAction}
      phoneCountryOptions={props.phoneCountryOptions}
      phoneNumber={props.phoneNumber}
      selectedPhoneCountry={props.selectedPhoneCountry}
      onPhoneCountryChange={props.onPhoneCountryChange}
      onPhoneNumberChange={props.onPhoneNumberChange}
      onSendCode={props.onSendCode}
    />
  );
}

export function HostedAuthenticatedPhoneAuthState({
  body,
  description,
  disabled,
  pendingAction,
  title,
  view,
  onContinue,
  onUseDifferentNumber,
}: AuthenticatedStateProps) {
  if (view === "loading") {
    return (
      <Alert className="border-stone-200 bg-stone-50">
        <LoaderCircleIcon className="mt-0.5 size-4 animate-spin" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{body}</AlertDescription>
      </Alert>
    );
  }

  if (view === "manual-resume") {
    return (
      <Alert className="border-stone-200 bg-stone-50">
        <AlertTitle>You already started signup in this browser.</AlertTitle>
        <AlertDescription>
          Keep going with this number, or sign out and use a different one.
        </AlertDescription>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={onContinue}
            disabled={disabled}
            size="xl"
          >
            Continue signup
          </Button>
          <HostedUseDifferentNumberButton
            disabled={disabled}
            pendingAction={pendingAction}
            onClick={onUseDifferentNumber}
          />
        </div>
      </Alert>
    );
  }

  if (view === "restart") {
    return (
      <Alert className="border-stone-200 bg-stone-50">
        <AlertTitle>This browser needs a fresh phone sign-in.</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
        <div className="mt-3 flex flex-wrap gap-3">
          <HostedUseDifferentNumberButton
            disabled={disabled}
            pendingAction={pendingAction}
            onClick={onUseDifferentNumber}
          />
        </div>
      </Alert>
    );
  }

  return null;
}

function HostedInviteShortcutStep({
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
          size="xl"
          className="w-full"
        >
          {pendingAction === "send-code" ? "Sending code..." : "Send me a code"}
        </Button>
        <HostedUseDifferentNumberButton
          disabled={disabled}
          pendingAction={pendingAction}
          onClick={onUseDifferentNumber}
        />
      </div>
    </div>
  );
}

function HostedUseDifferentNumberButton({
  disabled,
  onClick,
  pendingAction,
}: {
  disabled: boolean;
  onClick: () => void;
  pendingAction: HostedPhoneAuthPendingAction;
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      variant="link"
      size="sm"
      className="w-full"
    >
      {pendingAction === "logout" ? "Signing out..." : "Use a different number"}
    </Button>
  );
}

function HostedPhoneEntryStep({
  disabled,
  mode,
  pendingAction,
  phoneCountryOptions,
  phoneNumber,
  selectedPhoneCountry,
  onPhoneCountryChange,
  onPhoneNumberChange,
  onSendCode,
}: {
  disabled: boolean;
  mode: HostedPhoneAuthMode;
  pendingAction: HostedPhoneAuthPendingAction;
  phoneCountryOptions: HostedPhoneCountryOption[];
  phoneNumber: string;
  selectedPhoneCountry: HostedPhoneCountryOption;
  onPhoneCountryChange: (code: string) => void;
  onPhoneNumberChange: (value: string) => void;
  onSendCode: () => void;
}) {
  return (
    <>
      <div className="space-y-3">
        <Label htmlFor={`hosted-phone-${mode}`}>
          {mode === "invite" ? "Phone number" : "Your phone number"}
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
            id={`hosted-phone-${mode}`}
            autoComplete="tel-national"
            inputMode="tel"
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
        <Button type="button" onClick={onSendCode} disabled={disabled} size="xl" className="w-full">
          {pendingAction === "send-code" ? "Sending code..." : "Text me a code"}
        </Button>
      </div>
    </>
  );
}

function HostedCodeEntryStep({
  code,
  disabled,
  mode,
  pendingAction,
  onCodeChange,
  onResendCode,
  onUseDifferentNumber,
  onVerifyCode,
}: {
  code: string;
  disabled: boolean;
  mode: HostedPhoneAuthMode;
  pendingAction: HostedPhoneAuthPendingAction;
  onCodeChange: (value: string) => void;
  onResendCode: () => void;
  onUseDifferentNumber: () => void;
  onVerifyCode: () => void;
}) {
  return (
    <>
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={`hosted-code-${mode}`}>
            Verification code
          </Label>
          <Button
            type="button"
            onClick={onResendCode}
            disabled={disabled}
            variant="link"
            size="xs"
            className="h-auto p-0 text-xs text-stone-500"
          >
            {pendingAction === "send-code" ? "Sending..." : "Resend code"}
          </Button>
        </div>
        <Input
          id={`hosted-code-${mode}`}
          autoFocus
          autoComplete="one-time-code"
          inputMode="numeric"
          placeholder="123456"
          value={code}
          onChange={(event) => onCodeChange(event.currentTarget.value)}
          className="h-14 px-4 text-lg md:text-base"
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={onVerifyCode}
          disabled={disabled}
          size="xl"
          className="w-full"
        >
          {pendingAction === "verify-code" ? "Finishing setup..." : "Verify phone"}
        </Button>
        <HostedUseDifferentNumberButton
          disabled={disabled}
          pendingAction={pendingAction}
          onClick={onUseDifferentNumber}
        />
      </div>
    </>
  );
}
