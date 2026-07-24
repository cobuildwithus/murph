"use client";

import { usePathname } from "next/navigation";

import {
  HostedLegalConsentCard,
  type HostedLegalConsentAcceptScope,
} from "@/src/components/legal/hosted-legal-consent-card";
import { reloadCurrentHostedAuthDocument } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
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

  if (pathname === "/records/connect") {
    return null;
  }

  return (
    <section
      aria-labelledby="dashboard-legal-consent-title"
      className="mx-auto max-w-2xl py-4 md:py-10"
      data-dashboard-legal-consent-gate="true"
    >
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
        {isUpdate ? "Updated legal documents" : "Consent required"}
      </p>
      <h1
        className="mt-3 font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground"
        id="dashboard-legal-consent-title"
      >
        {isUpdate ? "Review what changed" : "Finish your consent"}
      </h1>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
        {isUpdate ? (
          <>
            We updated Murph&apos;s legal documents. Accept the current versions
            to get your full dashboard back.
          </>
        ) : (
          <>
            Accept the remaining documents to connect health sources and use
            your full dashboard.
          </>
        )}
      </p>
      <HostedLegalConsentCard
        acceptedPendingLabel="Refreshing your dashboard"
        acceptScope={acceptScope}
        className="mt-7"
        initialStatus={initialStatus}
        launchDescription={
          isUpdate ? "Two quick items." : "Accept each remaining item to continue."
        }
        launchTitle={isUpdate ? "Current documents" : "Required documents"}
        onAccepted={onAccepted}
        source={isUpdate ? "dashboard-legal-update" : "dashboard-legal-recovery"}
      />
    </section>
  );
}

function reloadDashboardAfterConsentHandoff() {
  window.setTimeout(reloadCurrentHostedAuthDocument, 100);
}
