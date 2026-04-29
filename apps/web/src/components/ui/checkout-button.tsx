"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { AuthButton, type AuthButtonProps } from "@/src/components/ui/auth-button";
import { buttonVariants } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";
import type { VariantProps } from "class-variance-authority";

type CheckoutButtonStatus = "idle" | "pending" | "success";

interface CheckoutButtonProps
  extends Omit<AuthButtonProps, "onClick" | "render" | "children">,
    Pick<VariantProps<typeof buttonVariants>, "size" | "variant"> {
  /** Async work to run on click once authenticated. Resolve to advance to the success animation. */
  onCheckout: () => Promise<void> | void;
  /** Label shown alongside the trailing indicator (authenticated state). */
  idleLabel: ReactNode;
  /** Label shown when the user is not yet authenticated. Defaults to `idleLabel`. */
  connectLabel?: ReactNode;
  /** Trailing decoration shown while idle (e.g. arrow icon). Replaced by the spinner/checkmark when busy. */
  idleAdornment?: ReactNode;
  /** Milliseconds to hold the checkmark visible before `onSuccess` fires. */
  successHoldMs?: number;
  /** Called after the checkmark animation completes. Use this to redirect. */
  onSuccess?: () => void;
  /** Called if `onCheckout` rejects. Receives the thrown value. */
  onError?: (error: unknown) => void;
  /** Force the button into a status (controlled). Defaults to uncontrolled. */
  status?: CheckoutButtonStatus;
}

export function CheckoutButton({
  onCheckout,
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
}: CheckoutButtonProps) {
  const [internalStatus, setInternalStatus] = useState<CheckoutButtonStatus>("idle");
  const status = controlledStatus ?? internalStatus;
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
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
      await onCheckout();
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
      className={cn(className)}
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
      <span className="flex-1 text-center">{idleLabel}</span>
      <span className="relative flex size-6 shrink-0 items-center justify-center" aria-hidden>
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center transition-opacity duration-150",
            isBusy ? "opacity-0" : "opacity-100",
          )}
        >
          {idleAdornment}
        </span>
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center transition-opacity duration-150",
            isBusy ? "opacity-100" : "opacity-0",
          )}
        >
          <CheckoutProgressMark status={status} />
        </span>
      </span>
    </AuthButton>
  );
}

function CheckoutProgressMark({ status }: { status: CheckoutButtonStatus }) {
  const isSuccess = status === "success";
  return (
    <svg
      viewBox="0 0 36 36"
      className="size-6"
      fill="none"
      role="status"
      aria-label={isSuccess ? "Checkout ready" : "Opening checkout"}
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
          className="origin-center animate-[checkout-spin_900ms_linear_infinite]"
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
      <style>{`@keyframes checkout-spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}
