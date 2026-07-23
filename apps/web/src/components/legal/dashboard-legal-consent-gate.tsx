"use client";

import { HostedLegalConsentCard } from "@/src/components/legal/hosted-legal-consent-card";
import { reloadCurrentHostedAuthDocument } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";

export function DashboardLegalConsentGate({
  initialStatus,
}: {
  initialStatus: HostedConsentStatus;
}) {
  return (
    <section
      aria-labelledby="dashboard-legal-consent-title"
      className="mx-auto max-w-2xl py-4 md:py-10"
      data-dashboard-legal-consent-gate="true"
    >
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
        Updated legal documents
      </p>
      <h1
        className="mt-3 font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground"
        id="dashboard-legal-consent-title"
      >
        Review what changed
      </h1>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
        We updated Murph&apos;s terms, privacy disclosures, health data notice,
        and AI safety boundaries. You can still connect and sync devices now.
        Accept the current documents to restore protected dashboard features.
      </p>
      <HostedLegalConsentCard
        acceptedPendingLabel="Refreshing your dashboard"
        className="mt-7"
        initialStatus={initialStatus}
        launchDescription="Review and accept both items to restore protected dashboard features."
        launchTitle="Current documents"
        onAccepted={reloadDashboardAfterConsentHandoff}
        source="dashboard-legal-update"
      />
    </section>
  );
}

function reloadDashboardAfterConsentHandoff() {
  window.setTimeout(reloadCurrentHostedAuthDocument, 100);
}
