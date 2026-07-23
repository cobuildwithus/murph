"use client";

import { Button } from "@/src/components/ui/button";

export function HostedLaunchConsentActions({
  children,
  declinePending = false,
  onDecline,
}: {
  children: React.ReactNode;
  declinePending?: boolean;
  onDecline: () => void;
}) {
  return (
    <div className="space-y-3">
      {children}
      <Button
        className="w-full"
        disabled={declinePending}
        onClick={onDecline}
        size="xl"
        type="button"
        variant="outline"
      >
        {declinePending ? "Declining..." : "Decline"}
      </Button>
    </div>
  );
}
