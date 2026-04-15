import type { ReactNode, Ref } from "react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function HostedVerificationCodeStep({
  autoFocus = true,
  code,
  codeLabel = "Verification code",
  description,
  disabled,
  inputMode = "numeric",
  pendingAction,
  placeholder = "123456",
  primaryActionLabel,
  primaryActionPendingLabel,
  secondaryAction = null,
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
  inputMode?: "numeric" | "text";
  pendingAction: "send-code" | "verify-code" | null;
  placeholder?: string;
  primaryActionLabel: string;
  primaryActionPendingLabel: string;
  secondaryAction?: ReactNode;
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
            className="h-auto p-0 text-xs text-stone-500"
          >
            {pendingAction === "send-code" ? "Sending..." : "Resend code"}
          </Button>
        </div>
        <Input
          id={codeInputId}
          autoFocus={autoFocus}
          autoComplete="one-time-code"
          inputMode={inputMode}
          placeholder={placeholder}
          ref={inputRef}
          value={code}
          onChange={(event) => onCodeChange(event.currentTarget.value)}
          className="h-14 px-4 text-lg md:text-base"
        />
        <p className="text-sm text-stone-500">{description}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          size="lg"
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
