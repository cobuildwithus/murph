"use client";

import { Button } from "@/components/ui/button";

import type { HostedPhoneAuthPendingAction } from "./hosted-phone-auth-types";

export function HostedUseDifferentNumberButton({
  disabled,
  onClick,
  pendingAction,
  size,
}: {
  disabled: boolean;
  onClick: () => void;
  pendingAction: HostedPhoneAuthPendingAction;
  size: "sm" | "lg";
}) {
  return (
    <Button type="button" onClick={onClick} disabled={disabled} variant="link" size={size} className="w-full">
      {pendingAction === "logout" ? "Signing out..." : "Use a different number"}
    </Button>
  );
}
