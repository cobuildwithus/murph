"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

import {
  HostedHealthDataConsentControl,
  HostedHealthDataConsentSettings,
  HostedHealthDataResumeConsent,
  HostedHealthDataWithdrawalDialog,
  type HealthDataConsentPresentation,
} from "@/src/components/settings/hosted-health-data-consent-settings";
import { HostedLaunchConsentPrompt } from "@/src/components/legal/hosted-legal-consent-card";
import type {
  HostedConsentDocumentSnapshot,
  HostedConsentGrantSnapshot,
  HostedConsentStatus,
} from "@/src/lib/legal/consent";
import { cn } from "@/src/lib/utils";

const DESIGN_CONSENT_AT = "2026-07-30T12:00:00.000Z";
const DESIGN_LEGAL_DOCUMENTS: HostedConsentDocumentSnapshot[] = [
  {
    href: "/legal/terms",
    id: "terms-of-service",
    pdfHref: "/legal/terms.pdf",
    title: "Murph Terms of Service",
    version: "2026-07-23",
  },
  {
    href: "/legal/privacy",
    id: "privacy-policy",
    pdfHref: "/legal/privacy.pdf",
    title: "Murph Privacy Policy",
    version: "2026-07-23",
  },
  {
    href: "/legal/health-ai-safety-disclosure",
    id: "health-ai-safety-disclosure",
    pdfHref: "/legal/health-ai-safety-disclosure.pdf",
    title: "Murph Health AI Safety Disclosure",
    version: "2026-07-23",
  },
];
const DESIGN_HEALTH_DOCUMENTS: HostedConsentDocumentSnapshot[] = [
  {
    href: "/consumer-health-data-privacy-policy",
    id: "consumer-health-data-notice",
    pdfHref: "/legal/consumer-health-data-notice.pdf",
    title: "Murph Consumer Health Data Notice",
    version: "2026-07-23",
  },
];

export const DESIGN_ACTIVE_HEALTH_DATA_CONSENT_STATUS =
  createDesignHealthDataConsentStatus("granted");
export const DESIGN_NOT_ENABLED_HEALTH_DATA_CONSENT_STATUS =
  createDesignHealthDataConsentStatus("missing");
export const DESIGN_WITHDRAWN_HEALTH_DATA_CONSENT_STATUS =
  createDesignHealthDataConsentStatus("revoked");

export function HealthDataConsentControlStudy() {
  return (
    <div
      className="grid items-start gap-6 lg:grid-cols-2"
      data-design-component="health-data-consent-settings"
      inert
    >
      <ConsentStateFrame
        className="lg:col-span-2"
        label="Active source and consent controls"
      >
        <HostedHealthDataConsentSettings
          authenticated
          initialStatus={DESIGN_ACTIVE_HEALTH_DATA_CONSENT_STATUS}
        />
      </ConsentStateFrame>
      <ConsentStateFrame label="Processing paused">
        <HostedHealthDataConsentSettings
          authenticated
          initialStatus={DESIGN_WITHDRAWN_HEALTH_DATA_CONSENT_STATUS}
        />
      </ConsentStateFrame>
      <ConsentStateFrame label="Not enabled">
        <HostedHealthDataConsentSettings
          authenticated
          initialStatus={DESIGN_NOT_ENABLED_HEALTH_DATA_CONSENT_STATUS}
        />
      </ConsentStateFrame>
      <ConsentStateFrame label="Status unavailable">
        <HostedHealthDataConsentSettings authenticated initialStatus={null} />
      </ConsentStateFrame>
      <ConsentStateFrame label="Checking status">
        <HostedHealthDataConsentControl
          errorMessage={null}
          onAction={() => undefined}
          pending={false}
          presentation="unavailable"
          statusPending
        />
      </ConsentStateFrame>
      <ConsentStateFrame label="Status retry failed">
        <HostedHealthDataConsentControl
          errorMessage="Status is still unavailable. Try again."
          onAction={() => undefined}
          pending={false}
          presentation="unavailable"
          statusPending={false}
        />
      </ConsentStateFrame>
    </div>
  );
}

export function HealthDataConsentWithdrawalFlowStudy() {
  const preview = useSearchParams().get("study");
  const showWithdrawalError = preview === "health-data-withdrawal-error";
  const showWithdrawal =
    preview === "health-data-withdrawal" ||
    showWithdrawalError;
  const showResumePending = preview === "health-data-resume-pending";
  const showResume = preview === "health-data-resume" || showResumePending;
  const [presentation, setPresentation] =
    useState<HealthDataConsentPresentation>(showWithdrawal ? "active" : "paused");
  const [withdrawOpen, setWithdrawOpen] = useState(showWithdrawal);

  return (
    <div
      className={cn(
        "grid w-full items-start gap-8",
        showResume
          ? "lg:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)] lg:gap-12"
          : "mx-auto max-w-2xl",
      )}
      data-design-section="health-data-consent-withdrawal"
    >
      <div className="flex min-w-0 flex-col gap-5 border-y border-border py-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {presentation === "active" ? "Consent active" : "Consent withdrawn"}
        </p>
        <HostedHealthDataConsentControl
          errorMessage={null}
          onAction={() => {
            if (presentation === "active") {
              setWithdrawOpen(true);
            }
          }}
          pending={false}
          presentation={presentation}
          statusPending={false}
        />
      </div>
      {showResume ? (
        <div
          className="mx-auto w-full max-w-lg lg:mx-0 lg:max-w-none"
          inert
        >
          {showResumePending ? (
            <HostedLaunchConsentPrompt
              documents={DESIGN_HEALTH_DOCUMENTS}
              mode="compact"
              onContinue={() => undefined}
              pending
              variant="health-data"
            />
          ) : (
            <HostedHealthDataResumeConsent
              onAccepted={() => undefined}
              status={DESIGN_WITHDRAWN_HEALTH_DATA_CONSENT_STATUS}
            />
          )}
        </div>
      ) : null}
      <HostedHealthDataWithdrawalDialog
        errorMessage={
          showWithdrawalError
            ? "Murph could not withdraw health data consent right now."
            : null
        }
        onConfirm={() => {
          setPresentation("paused");
          setWithdrawOpen(false);
        }}
        onOpenChange={setWithdrawOpen}
        open={withdrawOpen}
        pending={false}
      />
    </div>
  );
}

function ConsentStateFrame({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-2xl border border-border bg-background p-5",
        className,
      )}
      data-design-state={label.toLowerCase().replaceAll(" ", "-")}
    >
      <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function createDesignHealthDataConsentStatus(
  healthStatus: "granted" | "missing" | "revoked",
): HostedConsentStatus {
  const legalGrant = buildDesignGrant("launch.legal", "granted", DESIGN_LEGAL_DOCUMENTS);
  const healthGrant = healthStatus === "missing"
    ? null
    : buildDesignGrant(
        "launch.health-data",
        healthStatus,
        DESIGN_HEALTH_DOCUMENTS,
      );
  const healthGranted = healthStatus === "granted";

  return {
    documents: [...DESIGN_LEGAL_DOCUMENTS, ...DESIGN_HEALTH_DOCUMENTS],
    generatedAt: DESIGN_CONSENT_AT,
    launchGranted: healthGranted,
    launchScopes: [
      {
        granted: true,
        missingDocuments: [],
        scope: "launch.legal",
      },
      {
        granted: healthGranted,
        missingDocuments: healthGranted ? [] : DESIGN_HEALTH_DOCUMENTS,
        scope: "launch.health-data",
      },
    ],
    ok: true,
    schema: "murph.hosted-consent-status.v1",
    scopes: [
      {
        current: true,
        documents: DESIGN_LEGAL_DOCUMENTS,
        grant: legalGrant,
        granted: true,
        label: "Terms, privacy, and AI disclosure",
        missingDocuments: [],
        revocable: false,
        scope: "launch.legal",
      },
      {
        current: healthGranted,
        documents: DESIGN_HEALTH_DOCUMENTS,
        grant: healthGrant,
        granted: healthGranted,
        label: "Health data notice and processing authorization",
        missingDocuments: healthGranted ? [] : DESIGN_HEALTH_DOCUMENTS,
        revocable: true,
        scope: "launch.health-data",
      },
    ],
  };
}

function buildDesignGrant(
  scope: string,
  status: "granted" | "revoked",
  documents: HostedConsentDocumentSnapshot[],
): HostedConsentGrantSnapshot {
  return {
    documentVersions: Object.fromEntries(
      documents.map((document) => [document.id, document.version]),
    ),
    grantedAt: DESIGN_CONSENT_AT,
    lastEventId: null,
    revokedAt: status === "revoked" ? DESIGN_CONSENT_AT : null,
    scope,
    source: "design-preview",
    status,
    updatedAt: DESIGN_CONSENT_AT,
  };
}
