"use client";

import { usePathname } from "next/navigation";

import {
  HostedLegalConsentCard,
  type HostedLegalConsentAcceptScope,
} from "@/src/components/legal/hosted-legal-consent-card";
import { reloadCurrentHostedAuthDocument } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";

export function DashboardLegalConsentGate({
  acceptScope,
  initialStatus,
  onAccepted = reloadDashboardAfterConsentHandoff,
  variant = "update",
}: {
  acceptScope?: HostedLegalConsentAcceptScope;
  initialStatus: HostedConsentStatus;
  onAccepted?: (status: HostedConsentStatus) => void | Promise<void>;
  variant?: "initial" | "update";
}) {
  const isUpdate = variant === "update";
  const pathname = usePathname();
  const healthDataExplicitlyWithdrawn = initialStatus.scopes.some(
    (scope) =>
      scope.scope === "launch.health-data"
      && scope.grant?.status === "revoked",
  );

  if (
    pathname === "/records/connect"
    || (pathname === "/settings" && healthDataExplicitlyWithdrawn)
  ) {
    return null;
  }

  const title = isUpdate ? "Review what changed" : "Finish your consent";
  const description = isUpdate
    ? "We updated Murph's legal documents. Accept the current versions to get your full dashboard back."
    : "Accept the remaining documents to connect health sources and use your full dashboard.";

  return (
    <Dialog open>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-6 overflow-y-auto rounded-2xl border border-border bg-popover p-6 sm:max-w-xl sm:p-8"
        data-dashboard-legal-consent-gate="true"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <HostedLegalConsentCard
          acceptedPendingLabel="Refreshing..."
          acceptScope={acceptScope}
          initialStatus={initialStatus}
          launchDescription={description}
          launchTitle={title}
          mode="compact"
          onAccepted={onAccepted}
          source={isUpdate ? "dashboard-legal-update" : "dashboard-legal-recovery"}
        />
      </DialogContent>
    </Dialog>
  );
}

function reloadDashboardAfterConsentHandoff() {
  window.setTimeout(reloadCurrentHostedAuthDocument, 100);
}
