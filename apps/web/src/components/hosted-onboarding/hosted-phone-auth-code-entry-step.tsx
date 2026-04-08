"use client";

import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const codeInputId = useId();

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={codeInputId}>Verification code</Label>
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
          id={codeInputId}
          autoFocus
          autoComplete="one-time-code"
          inputMode="numeric"
          placeholder="123456"
          value={code}
          onChange={(event) => onCodeChange(event.currentTarget.value)}
          className="h-14 px-4 text-lg md:text-base"
        />
        <p className="text-sm text-stone-500">
          We texted the latest {intent === "signin" ? "sign-in code" : "code"} to {verificationPhoneNumberHint}.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={onVerifyCode} disabled={disabled} size="lg" className="w-full">
          {pendingAction === "verify-code"
            ? intent === "signin"
              ? "Signing in..."
              : "Finishing setup..."
            : intent === "signin"
              ? "Sign in"
              : "Verify phone"}
        </Button>
        <HostedUseDifferentNumberButton
          disabled={disabled}
          pendingAction={pendingAction}
          size={secondaryActionSize}
          onClick={onUseDifferentNumber}
        />
      </div>
    </>
  );
}
