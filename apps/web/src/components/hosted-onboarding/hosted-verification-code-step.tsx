import type { ReactNode, RefObject } from "react";
import { useEffect, useId, useRef } from "react";

import { Button } from "@/src/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/src/components/ui/input-otp";
import { Label } from "@/src/components/ui/label";
import { Spinner } from "@/src/components/ui/spinner";

const CODE_LENGTH = 6;

export function HostedVerificationCodeStep({
  autoFocus = true,
  code,
  codeLabel = "Verification code",
  description,
  disabled,
  pendingAction,
  primaryActionLabel,
  primaryActionPendingLabel,
  secondaryAction = null,
  size = "default",
  inputRef,
  onCodeChange,
  onResendCode,
  onSubmit,
}: {
  autoFocus?: boolean;
  code: string;
  codeLabel?: string;
  description: string;
  disabled: boolean;
  pendingAction: "send-code" | "verify-code" | null;
  primaryActionLabel: string;
  primaryActionPendingLabel: string;
  secondaryAction?: ReactNode;
  size?: "default" | "compact";
  inputRef?: RefObject<HTMLInputElement | null>;
  onCodeChange: (value: string) => void;
  onResendCode: () => void;
  onSubmit: () => void;
}) {
  const codeInputId = useId();
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const codeInputRef = inputRef ?? localInputRef;
  const wasDisabledRef = useRef(disabled);

  useEffect(() => {
    const wasDisabled = wasDisabledRef.current;
    wasDisabledRef.current = disabled;

    if (autoFocus && wasDisabled && !disabled) {
      codeInputRef.current?.focus();
    }
  }, [autoFocus, codeInputRef, disabled]);

  // iOS draws native selection handles over the OTP boxes after one-time-code
  // autofill (input-otp keeps a ranged selection on its hidden input, and CSS
  // cannot hide the handles; see input-otp issues #75 and #110). Blurring on
  // completion dismisses them, along with the keyboard, while the code
  // auto-submits.
  const handleComplete = () => {
    codeInputRef.current?.blur();
    onSubmit();
  };

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={codeInputId}>{codeLabel}</Label>
          <Button
            type="button"
            onClick={onResendCode}
            disabled={disabled}
            variant="link"
            size="xs"
            className="relative h-auto p-0 text-sm text-muted-foreground before:absolute before:-inset-x-3 before:-inset-y-2.5 before:content-['']"
          >
            {pendingAction === "send-code" ? "Sending..." : "Resend code"}
          </Button>
        </div>
        <InputOTP
          id={codeInputId}
          autoFocus={autoFocus}
          autoComplete="one-time-code"
          data-1p-ignore
          data-bwignore="true"
          data-form-type="other"
          data-lpignore="true"
          maxLength={CODE_LENGTH}
          ref={codeInputRef}
          value={code}
          disabled={disabled}
          onChange={onCodeChange}
          onComplete={handleComplete}
        >
          <InputOTPGroup className="w-full justify-center gap-2">
            {Array.from({ length: CODE_LENGTH }, (_, index) => (
              <InputOTPSlot
                key={index}
                index={index}
                className={`${size === "compact" ? "h-12 max-w-12 text-lg" : "h-16 max-w-16 text-xl"} aspect-square min-w-0 flex-1 rounded-lg border bg-card`}
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          aria-busy={pendingAction === "verify-code"}
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          size="xl"
          className="w-full"
        >
          {pendingAction === "verify-code" ? (
            <>
              <Spinner aria-hidden="true" />
              {primaryActionPendingLabel}
            </>
          ) : primaryActionLabel}
        </Button>
        {secondaryAction}
      </div>
    </>
  );
}
