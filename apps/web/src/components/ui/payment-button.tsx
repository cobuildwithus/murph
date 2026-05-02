"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { AuthButton, type AuthButtonProps } from "@/src/components/ui/auth-button";
import { buttonVariants } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";
import type { VariantProps } from "class-variance-authority";

type PaymentButtonStatus = "idle" | "pending" | "success";

interface PaymentButtonProps
  extends Omit<AuthButtonProps, "onClick" | "render" | "children">,
    Pick<VariantProps<typeof buttonVariants>, "size" | "variant"> {
  onClick: () => Promise<void> | void;
  idleLabel: ReactNode;
  connectLabel?: ReactNode;
  idleAdornment?: ReactNode;
  successHoldMs?: number;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
  status?: PaymentButtonStatus;
}

function PaymentButton({
  onClick,
  idleLabel,
  connectLabel,
  idleAdornment,
  successHoldMs = 650,
  onSuccess,
  onError,
  status: controlledStatus,
  disabled,
  className,
  size = "lg",
  variant = "default",
  onConnect,
  ...rest
}: PaymentButtonProps) {
  const [internalStatus, setInternalStatus] = useState<PaymentButtonStatus>("idle");
  const status = controlledStatus ?? internalStatus;
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (status !== "success") return;
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => {
      onSuccess?.();
    }, successHoldMs);
  }, [status, successHoldMs, onSuccess]);

  async function handleClick() {
    if (status !== "idle") return;
    if (controlledStatus === undefined) setInternalStatus("pending");
    try {
      await onClick();
      if (controlledStatus === undefined) setInternalStatus("success");
    } catch (error) {
      if (controlledStatus === undefined) setInternalStatus("idle");
      onError?.(error);
    }
  }

  const isPending = status === "pending";
  const isSuccess = status === "success";
  const isBusy = isPending || isSuccess;

  return (
    <AuthButton
      type="button"
      disabled={disabled || isBusy}
      onClick={handleClick}
      onConnect={onConnect}
      size={size}
      variant={variant}
      data-status={status}
      aria-live="polite"
      className={cn("relative overflow-hidden", className)}
      connectLabel={
        <>
          <span className="flex-1 text-center">{connectLabel ?? idleLabel}</span>
          {idleAdornment ? (
            <span className="flex size-6 shrink-0 items-center justify-center" aria-hidden>
              {idleAdornment}
            </span>
          ) : null}
        </>
      }
      {...rest}
    >
      <span
        className={cn(
          "flex flex-1 items-center justify-center gap-2 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
          isBusy && "translate-y-3 opacity-0",
        )}
      >
        <span>{idleLabel}</span>
        {idleAdornment ? (
          <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
            {idleAdornment}
          </span>
        ) : null}
      </span>
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
          isBusy ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0",
        )}
      >
        <PaymentProgressMark status={status} />
      </span>
    </AuthButton>
  );
}

function PaymentProgressMark({ status }: { status: PaymentButtonStatus }) {
  const isSuccess = status === "success";
  return (
    <svg
      viewBox="0 0 36 36"
      className="size-6"
      fill="none"
      role="status"
      aria-label={isSuccess ? "Complete" : "Processing"}
    >
      <circle
        cx="18"
        cy="18"
        r="14"
        stroke="currentColor"
        strokeOpacity={isSuccess ? 1 : 0.25}
        strokeWidth="2.75"
        className="transition-[stroke-opacity] duration-200"
      />
      {!isSuccess ? (
        <circle
          cx="18"
          cy="18"
          r="14"
          stroke="currentColor"
          strokeWidth="2.75"
          strokeLinecap="round"
          strokeDasharray="22 66"
          className="origin-center animate-[payment-spin_900ms_linear_infinite]"
        />
      ) : null}
      <path
        d="M11.5 18.5 L16 23 L24.5 13.5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={isSuccess ? 0 : 1}
        className="transition-[stroke-dashoffset] duration-[450ms] ease-[cubic-bezier(0.65,0,0.35,1)]"
      />
      <style>{`@keyframes payment-spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

export { PaymentButton, PaymentProgressMark };
export type { PaymentButtonProps, PaymentButtonStatus };
