"use client";

import { useState, type ReactNode } from "react";

import { AuthButton, type AuthButtonProps } from "@/src/components/ui/auth-button";
import { buttonVariants } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";
import type { VariantProps } from "class-variance-authority";

type HeartbeatButtonStatus = "idle" | "pending";

interface HeartbeatButtonProps
  extends Omit<AuthButtonProps, "onClick" | "render" | "children">,
    Pick<VariantProps<typeof buttonVariants>, "size" | "variant"> {
  onClick: () => Promise<void> | void;
  idleLabel: ReactNode;
  connectLabel?: ReactNode;
  idleAdornment?: ReactNode;
  onComplete?: () => void;
  onError?: (error: unknown) => void;
  status?: HeartbeatButtonStatus;
}

function HeartbeatButton({
  onClick,
  idleLabel,
  connectLabel,
  idleAdornment,
  onComplete,
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

  async function handleClick() {
    if (status !== "idle") return;
    if (controlledStatus === undefined) setInternalStatus("pending");
    try {
      await onClick();
      if (controlledStatus === undefined) setInternalStatus("idle");
      onComplete?.();
    } catch (error) {
      if (controlledStatus === undefined) setInternalStatus("idle");
      onError?.(error);
    }
  }

  const isPending = status === "pending";

  return (
    <AuthButton
      type="button"
      disabled={disabled || isPending}
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
          isPending && "translate-y-3 opacity-0",
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
          isPending ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
        )}
      >
        <HeartbeatTrace />
      </span>
    </AuthButton>
  );
}

function HeartbeatTrace() {
  const ecgPath = [
    "M0,12 L25,12",
    "Q28,12 30,10 Q32,8 34,10 Q36,12 38,12",
    "L42,12",
    "L44,14 L47,22 L50,2 L53,20 L56,12",
    "L100,12",
  ].join(" ");

  return (
    <div className="absolute inset-0 animate-[hb-clip_4s_linear_infinite]">
      <svg
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
        fill="none"
        role="status"
        aria-label="Processing"
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
        />
      </svg>
      <style>{`
        @keyframes hb-clip {
          0% { clip-path: inset(0 100% 0 0); opacity: 0; }
          3% { opacity: 1; }
          80% { clip-path: inset(0 0 0 0); opacity: 1; }
          92% { clip-path: inset(0 0 0 0); opacity: 0; }
          100% { clip-path: inset(0 100% 0 0); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

export { HeartbeatButton, HeartbeatTrace };
export type { HeartbeatButtonProps, HeartbeatButtonStatus };
