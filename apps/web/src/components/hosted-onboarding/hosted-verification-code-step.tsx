import type { ReactNode, Ref } from "react";
import { useId } from "react";

import { Button } from "@/src/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/src/components/ui/input-otp";
import { Label } from "@/src/components/ui/label";

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
  inputRef?: Ref<HTMLInputElement>;
  onCodeChange: (value: string) => void;
  onResendCode: () => void;
  onSubmit: () => void;
}) {
  const codeInputId = useId();

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
            className="h-auto p-0 text-sm text-muted-foreground"
          >
            {pendingAction === "send-code" ? "Sending..." : "Resend code"}
          </Button>
        </div>
        <InputOTP
          id={codeInputId}
          autoFocus={autoFocus}
          autoComplete="one-time-code"
          data-1p-ignore
          data-lpignore="true"
          maxLength={CODE_LENGTH}
          ref={inputRef}
          value={code}
          disabled={disabled}
          onChange={onCodeChange}
          onComplete={onSubmit}
        >
          <InputOTPGroup className="w-full gap-2">
            {Array.from({ length: CODE_LENGTH }, (_, index) => (
              <InputOTPSlot
                key={index}
                index={index}
                className={`${size === "compact" ? "h-14 text-lg" : "h-16 text-xl"} flex-1 min-w-0 rounded-lg border bg-card`}
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          size="xl"
          className="w-full"
        >
          {pendingAction === "verify-code"
            ? primaryActionPendingLabel
            : primaryActionLabel}
        </Button>
        {secondaryAction}
      </div>
    </>
  );
}
