"use client";

import { LoaderCircleIcon } from "lucide-react";
import type { FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import {
  HostedCodeEntryStep,
  HostedInviteShortcutStep,
  HostedPhoneEntryStep,
} from "./hosted-phone-auth-step-views";
import { HostedUseDifferentNumberButton } from "./hosted-phone-auth-use-different-number-button";
import type {
  HostedAuthenticatedPhoneAuthView,
  HostedPhoneAuthIntent,
  HostedPhoneAuthMode,
  HostedPhoneAuthPendingAction,
  HostedPhoneCountryOption,
  HostedPhoneVerificationAttempt,
} from "./hosted-phone-auth-types";

interface SharedFlowProps {
  activeAttempt: HostedPhoneVerificationAttempt | null;
  code: string;
  disabled: boolean;
  intent: HostedPhoneAuthIntent;
  mode: HostedPhoneAuthMode;
  pendingAction: HostedPhoneAuthPendingAction;
  phoneCountryOptions: HostedPhoneCountryOption[];
  phoneNumber: string;
  sendCodeDisabled: boolean;
  selectedPhoneCountry: HostedPhoneCountryOption;
  onCodeChange: (value: string) => void;
  onPhoneCountryChange: (code: string) => void;
  onPhoneNumberChange: (value: string) => void;
  onResendCode: () => void;
  onSendCode?: () => void;
  onSubmitPhoneEntry: (event: FormEvent<HTMLFormElement>) => void;
  onUseDifferentNumber: () => void;
  onVerifyCode: () => void;
}

interface HostedPhoneAuthFlowProps extends SharedFlowProps {
  shortcutVisible: boolean;
  onSendCode: () => void;
}

interface AuthenticatedStateProps {
  body: string;
  description: string;
  disabled: boolean;
  intent: HostedPhoneAuthIntent;
  mode: HostedPhoneAuthMode;
  pendingAction: HostedPhoneAuthPendingAction;
  title: string;
  view: HostedAuthenticatedPhoneAuthView;
  onContinue: () => void;
  onUseDifferentNumber: () => void;
}

export function HostedPhoneAuthFlow({
  shortcutVisible,
  ...props
}: HostedPhoneAuthFlowProps) {
  if (props.activeAttempt) {
    return (
      <HostedCodeEntryStep
        verificationPhoneNumberHint={props.activeAttempt.maskedPhoneNumber}
        code={props.code}
        disabled={props.disabled}
        intent={props.intent}
        mode={props.mode}
        pendingAction={props.pendingAction}
        onCodeChange={props.onCodeChange}
        onResendCode={props.onResendCode}
        onUseDifferentNumber={props.onUseDifferentNumber}
        onVerifyCode={props.onVerifyCode}
      />
    );
  }

  if (shortcutVisible) {
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
      intent={props.intent}
      mode={props.mode}
      pendingAction={props.pendingAction}
      phoneCountryOptions={props.phoneCountryOptions}
      phoneNumber={props.phoneNumber}
      sendCodeDisabled={props.sendCodeDisabled}
      selectedPhoneCountry={props.selectedPhoneCountry}
      onPhoneCountryChange={props.onPhoneCountryChange}
      onPhoneNumberChange={props.onPhoneNumberChange}
      onSubmitPhoneEntry={props.onSubmitPhoneEntry}
    />
  );
}

export function HostedAuthenticatedPhoneAuthState({
  body,
  description,
  disabled,
  intent,
  mode,
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
        <AlertTitle>
          {intent === "signin"
            ? "You already started signing in on this browser."
            : "You already started signup in this browser."}
        </AlertTitle>
        <AlertDescription>
          Keep going with this number, or sign out and use a different one.
        </AlertDescription>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={onContinue}
            disabled={disabled}
            size="lg"
          >
            {intent === "signin" ? "Continue sign in" : "Continue signup"}
          </Button>
          <HostedUseDifferentNumberButton
            disabled={disabled}
            pendingAction={pendingAction}
            size={mode === "public" ? "lg" : "sm"}
            onClick={onUseDifferentNumber}
          />
        </div>
      </Alert>
    );
  }

  if (view === "restart") {
    return (
      <Alert className="border-stone-200 bg-stone-50">
        <AlertTitle>
          {intent === "signin"
            ? "This browser needs a fresh phone sign-in."
            : "This browser needs a fresh phone signup."}
        </AlertTitle>
        <AlertDescription>{description}</AlertDescription>
        <div className="mt-3 flex flex-wrap gap-3">
          <HostedUseDifferentNumberButton
            disabled={disabled}
            pendingAction={pendingAction}
            size={mode === "public" ? "lg" : "sm"}
            onClick={onUseDifferentNumber}
          />
        </div>
      </Alert>
    );
  }

  return null;
}
