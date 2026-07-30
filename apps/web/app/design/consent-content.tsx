"use client";

import { useState } from "react";

import { HostedLaunchConsentPrompt } from "@/src/components/legal/hosted-legal-consent-card";
import { Separator } from "@/src/components/ui/separator";
import type { HostedConsentScopeStatus } from "@/src/lib/legal/consent";

const DESIGN_LAUNCH_DOCUMENTS: HostedConsentScopeStatus["documents"] = [
  {
    href: "/legal/terms",
    id: "terms-of-service",
    pdfHref: "/legal/terms.pdf",
    title: "Murph Terms of Service",
    version: "2026-04-29",
  },
  {
    href: "/legal/privacy",
    id: "privacy-policy",
    pdfHref: "/legal/privacy.pdf",
    title: "Murph Privacy Policy",
    version: "2026-06-24",
  },
  {
    href: "/legal/health-ai-safety-disclosure",
    id: "health-ai-safety-disclosure",
    pdfHref: "/legal/health-ai-safety-disclosure.pdf",
    title: "Murph Health AI Safety Disclosure",
    version: "2026-04-29",
  },
  {
    href: "/consumer-health-data-privacy-policy",
    id: "consumer-health-data-notice",
    pdfHref: "/legal/consumer-health-data-notice.pdf",
    title: "Murph Consumer Health Data Notice",
    version: "2026-04-29",
  },
];

const DESIGN_LEGAL_DOCUMENTS = DESIGN_LAUNCH_DOCUMENTS.filter(
  (document) => document.id !== "consumer-health-data-notice",
);

export function ConsentContent() {
  const [interactivePending, setInteractivePending] = useState(false);

  function previewContinue() {
    setInteractivePending(true);
    window.setTimeout(() => setInteractivePending(false), 1200);
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-12 px-6 py-12 sm:px-10 lg:px-16">
      <div>
        <h1 className="font-serif text-4xl font-semibold tracking-tight text-foreground">
          Consent
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          One explicit decision, no checkboxes, and a clear way to decline.
        </p>
      </div>

      <Separator />

      <section className="flex scroll-mt-24 flex-col gap-6" id="launch-consent">
        <div className="flex flex-col gap-2">
          <h2 className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
            Launch consent
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Decline records the current unaccepted launch scopes, then signs the
            person out without advancing onboarding.
          </p>
        </div>
        <div className="grid items-start gap-8 lg:grid-cols-2">
          <PreviewFrame label="Onboarding dialog">
            <HostedLaunchConsentPrompt
              documents={DESIGN_LAUNCH_DOCUMENTS}
              onContinue={previewContinue}
              onDecline={() => {}}
              pending={interactivePending}
            />
          </PreviewFrame>

          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <PreviewLabel>Legal update</PreviewLabel>
              <HostedLaunchConsentPrompt
                documents={DESIGN_LEGAL_DOCUMENTS}
                mode="panel"
                onContinue={() => {}}
                onDecline={() => {}}
                variant="legal"
              />
            </div>
            <div className="flex flex-col gap-3">
              <PreviewLabel>Retryable error</PreviewLabel>
              <HostedLaunchConsentPrompt
                documents={DESIGN_LAUNCH_DOCUMENTS}
                errorMessage="Could not record consent. Try again."
                mode="panel"
                onContinue={() => {}}
                onDecline={() => {}}
              />
            </div>
            <div className="flex flex-col gap-3">
              <PreviewLabel>Error after three attempts</PreviewLabel>
              <HostedLaunchConsentPrompt
                documents={DESIGN_LAUNCH_DOCUMENTS}
                errorMessage="Could not record consent. Try again."
                failedAttempts={3}
                mode="panel"
                onContinue={() => {}}
                onDecline={() => {}}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function PreviewFrame({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <PreviewLabel>{label}</PreviewLabel>
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        {children}
      </div>
    </div>
  );
}

function PreviewLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </p>
  );
}
