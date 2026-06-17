import type { ReactNode } from "react";
import type { FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";

import {
  HostedCodeEntryStep,
  HostedPhoneEntryStep,
} from "./hosted-phone-auth-step-views";
import { HostedUseDifferentNumberButton } from "./hosted-phone-auth-use-different-number-button";
import type {
  HostedAuthenticatedPhoneAuthView,
  HostedPhoneAuthIntent,
  HostedPhoneAuthPendingAction,
  HostedPhoneCountryOption,
  HostedPhoneVerificationAttempt,
} from "./hosted-phone-auth-types";

interface SharedFlowProps {
  activeAttempt: HostedPhoneVerificationAttempt | null;
  code: string;
  disableSignup?: boolean;
  disabled: boolean;
  intent: HostedPhoneAuthIntent;
  pendingAction: HostedPhoneAuthPendingAction;
  phoneFieldDescription?: string | null;
  phoneFieldLabel?: string | null;
  phoneInputAutoFocus?: boolean;
  phoneCountryOptions: HostedPhoneCountryOption[];
  phoneNumber: string;
  sendCodeDisabled: boolean;
  secondaryActionSize: "sm" | "lg";
  selectedPhoneCountry: HostedPhoneCountryOption;
  size?: "default" | "compact";
  onCodeChange: (value: string) => void;
  onPhoneCountryChange: (code: string) => void;
  onPhoneNumberChange: (value: string) => void;
  onResendCode: () => void;
  onSubmitPhoneEntry: (event: FormEvent<HTMLFormElement>) => void;
  onUseDifferentNumber: () => void;
  onVerifyCode: () => void;
}

interface AuthenticatedStateProps {
  body: string;
  description: string;
  disabled: boolean;
  pendingAction: HostedPhoneAuthPendingAction;
  secondaryActionSize: "sm" | "lg";
  title: string;
  view: HostedAuthenticatedPhoneAuthView;
  onContinue: () => void;
  onUseDifferentNumber: () => void;
}

interface HostedPhoneAuthScaffoldProps extends AuthenticatedStateProps {
  errorMessage: string | null;
  children?: ReactNode;
}

export function HostedPhoneAuthScaffold({
  body,
  children,
  description,
  disabled,
  errorMessage,
  pendingAction,
  secondaryActionSize,
  title,
  view,
  onContinue,
  onUseDifferentNumber,
}: HostedPhoneAuthScaffoldProps) {
  return (
    <div className="space-y-4">
      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to continue</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {view ? (
        <HostedAuthenticatedPhoneAuthState
          body={body}
          description={description}
          disabled={disabled}
          pendingAction={pendingAction}
          secondaryActionSize={secondaryActionSize}
          title={title}
          view={view}
          onContinue={onContinue}
          onUseDifferentNumber={onUseDifferentNumber}
        />
      ) : (
        children
      )}
    </div>
  );
}

export function HostedPhoneAuthFlow(props: SharedFlowProps) {
  if (props.activeAttempt) {
    return (
      <HostedCodeEntryStep
        verificationPhoneNumberHint={props.activeAttempt.maskedPhoneNumber}
        code={props.code}
        disableSignup={props.disableSignup}
        disabled={props.disabled}
        intent={props.intent}
        pendingAction={props.pendingAction}
        secondaryActionSize={props.secondaryActionSize}
        size={props.size}
        onCodeChange={props.onCodeChange}
        onResendCode={props.onResendCode}
        onUseDifferentNumber={props.onUseDifferentNumber}
        onVerifyCode={props.onVerifyCode}
      />
    );
  }

  return (
    <HostedPhoneEntryStep
      intent={props.intent}
      phoneFieldDescription={props.phoneFieldDescription}
      phoneFieldLabel={props.phoneFieldLabel}
      phoneInputAutoFocus={props.phoneInputAutoFocus}
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
  pendingAction,
  secondaryActionSize,
  title,
  view,
  onContinue,
  onUseDifferentNumber,
}: AuthenticatedStateProps) {
  if (view === "loading") {
    return (
      <Alert className="border-stone-200 bg-stone-50">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{body}</AlertDescription>
      </Alert>
    );
  }

  if (view === "manual-resume") {
    return (
      <Alert className="border-stone-200 bg-stone-50">
        <AlertTitle>You already started logging in or signing up.</AlertTitle>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={onContinue}
            disabled={disabled}
            size="lg"
            className="w-full"
          >
            Continue
          </Button>
          <HostedUseDifferentNumberButton
            disabled={disabled}
            pendingAction={pendingAction}
            size={secondaryActionSize}
            onClick={onUseDifferentNumber}
          />
        </div>
      </Alert>
    );
  }

  if (view === "restart") {
    return (
      <Alert className="border-stone-200 bg-stone-50">
        <AlertTitle>Sign in with this phone again</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={onUseDifferentNumber}
            disabled={disabled}
            size="lg"
            className="w-full"
          >
            {pendingAction === "logout" ? "Signing out..." : "Sign out"}
          </Button>
        </div>
      </Alert>
    );
  }

  return null;
}
