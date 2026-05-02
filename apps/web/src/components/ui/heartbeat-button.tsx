"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { AuthButton, type AuthButtonProps } from "@/src/components/ui/auth-button";
import { buttonVariants } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";
import type { VariantProps } from "class-variance-authority";

type HeartbeatButtonStatus = "idle" | "pending" | "success";

interface HeartbeatButtonProps
  extends Omit<AuthButtonProps, "onClick" | "render" | "children">,
    Pick<VariantProps<typeof buttonVariants>, "size" | "variant"> {
  onClick: () => Promise<void> | void;
  idleLabel: ReactNode;
  connectLabel?: ReactNode;
  idleAdornment?: ReactNode;
  successHoldMs?: number;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
  status?: HeartbeatButtonStatus;
}

function HeartbeatButton({
  onClick,
  idleLabel,
  connectLabel,
  idleAdornment,
  successHoldMs = 900,
  onSuccess,
  onError,
  status: controlledStatus,
  disabled,
  className,
  size = "lg",
  variant = "default",
  onConnect,
  ...rest
}: HeartbeatButtonProps) {
  const [internalStatus, setInternalStatus] = useState<HeartbeatButtonStatus>("idle");
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
          "absolute inset-0 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
          isBusy ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
        )}
      >
        <HeartbeatTrace status={status} />
      </span>
    </AuthButton>
  );
}

function HeartbeatTrace({ status }: { status: HeartbeatButtonStatus }) {
  const isSuccess = status === "success";

  const ecgPath = [
    "M0,12 L25,12",
    "Q28,12 30,10 Q32,8 34,10 Q36,12 38,12",
    "L42,12",
    "L44,14 L47,22 L50,2 L53,20 L56,12",
    "L62,12",
    "Q65,12 68,8 Q71,4 74,8 Q77,12 80,12",
    "L100,12",
  ].join(" ");

  return (
    <div
      className="absolute inset-y-0 left-[10%] right-[10%]"
    >
      <svg
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
        fill="none"
        role="status"
        aria-label={isSuccess ? "Complete" : "Processing"}
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <path
          d={ecgPath}
          stroke="currentColor"
          strokeOpacity={0.4}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          pathLength={1}
          strokeDasharray="1 2"
          className={cn(
            isSuccess
              ? "animate-[hb-reveal_0.6s_ease-out_forwards]"
              : "animate-[hb-draw_2s_linear_infinite]",
          )}
        />
      </svg>
      <style>{`
        @keyframes hb-draw {
          0% { stroke-dashoffset: 1; opacity: 0; }
          5% { opacity: 1; }
          70% { stroke-dashoffset: 0; opacity: 1; }
          90% { stroke-dashoffset: 0; opacity: 0; }
          100% { stroke-dashoffset: 1; opacity: 0; }
        }
        @keyframes hb-reveal {
          from { stroke-dashoffset: 1; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}

export { HeartbeatButton, HeartbeatTrace };
export type { HeartbeatButtonProps, HeartbeatButtonStatus };
