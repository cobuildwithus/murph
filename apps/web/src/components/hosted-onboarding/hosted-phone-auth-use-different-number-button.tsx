import { Button } from "@/src/components/ui/button";

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
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      variant="link"
      size={size}
      className="relative h-auto p-0 text-xs font-medium text-muted-foreground hover:text-foreground before:absolute before:-inset-x-3 before:-inset-y-2.5 before:content-['']"
    >
      {pendingAction === "logout" ? "Signing out…" : "Use a different number"}
    </Button>
  );
}
