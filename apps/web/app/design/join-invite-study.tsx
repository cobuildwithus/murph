import type { ReactNode } from "react";

import { JoinInviteCheckoutPausedScreen } from "@/src/components/hosted-onboarding/join-invite-checkout-paused-screen";
import { JoinInviteSignOutButtonIsland } from "@/src/components/hosted-onboarding/join-invite-islands";
import type { JoinInvitePageModel } from "@/src/components/hosted-onboarding/join-invite-page-model";
import { buildJoinInvitePreviewStatus } from "@/src/components/hosted-onboarding/join-invite-preview";
import { JoinInviteSignedInMismatchScreen } from "@/src/components/hosted-onboarding/join-invite-signed-in-mismatch-view";
import { JoinInviteStageServer } from "@/src/components/hosted-onboarding/join-invite-stage-server";
import { JoinInviteStarterUsageScreen } from "@/src/components/hosted-onboarding/join-invite-starter-usage-island";
import { JoinInviteSuccessScreen } from "@/src/components/hosted-onboarding/join-invite-success-client";
import { LinkPageSurface } from "@/src/components/link-page/link-page-shell";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";

const INVITE_CODE = "design-join";

// Open invites and messaging setup mount live Telegram and account requests, so
// their real states are proved on /join/<code>?preview=… and the auth study.
export function JoinInviteStudy() {
  const verify = status("verify");
  const signedIn = { authenticated: true, expiresAt: null, matchesInvite: true };

  return (
    <div
      className="grid gap-8 sm:grid-cols-2 xl:grid-cols-4"
      data-design-section="join-invite"
      id="join-invite-section"
    >
      <Stage label="Verify by phone" state="verify-phone">
        <JoinInviteStageServer model={model({ status: verify })} />
      </Stage>
      <Stage label="Verify by email" state="verify-email">
        <JoinInviteStageServer model={model({
          status: {
            ...verify,
            invite: {
              code: INVITE_CODE,
              emailAuthTarget: { emailAddress: "you@example.com", kind: "saved" },
              expiresAt: "2099-01-01T00:00:00.000Z",
              phoneAuthTarget: { kind: "manual" },
              phoneHint: null,
              verificationMode: "invite_email",
            },
          },
        })} />
      </Stage>
      <Stage label="Pick a plan" state="plans">
        <JoinInviteStageServer model={model({
          status: {
            ...status("checkout"),
            session: { ...signedIn, authenticated: false, matchesInvite: false },
          },
        })} />
      </Stage>
      <Stage label="Plans while billing is unavailable" state="plans-unavailable">
        <JoinInviteStageServer model={model({
          status: {
            ...status("checkout"),
            capabilities: { billingReady: false },
            session: { ...signedIn, authenticated: false, matchesInvite: false },
          },
        })} />
      </Stage>
      <Stage label="Family recovery: choices" state="family-available">
        <JoinInviteStageServer model={model({
          familyBillingRecovery: "available",
          status: status("checkout"),
        })} />
      </Stage>
      <Stage label="Family recovery: open checkout" state="family-checkout">
        <JoinInviteStageServer model={model({
          familyBillingRecovery: "checkout",
          status: status("checkout"),
        })} />
      </Stage>
      <Stage label="Family recovery: billing issue" state="family-billing-management">
        <JoinInviteStageServer model={model({
          familyBillingRecovery: "manage",
          status: status("checkout"),
        })} />
      </Stage>
      <Stage label="Family recovery: confirming" state="family-syncing">
        <JoinInviteStageServer model={model({
          familyBillingRecovery: "syncing",
          status: status("checkout"),
        })} />
      </Stage>
      <Stage label="Consent gate" state="consent">
        <JoinInviteStageServer model={model({
          launchConsent: {
            gateActive: true,
            initialStatus: CONSENT_STATUS,
            status: "required",
          },
          status: status("checkout"),
        })} />
      </Stage>
      <Stage label="Consent failed to load" state="consent-error">
        <JoinInviteStageServer model={model({
          launchConsent: {
            errorMessage: "Could not load Murph legal consent right now.",
            gateActive: true,
            initialStatus: null,
            status: "error",
          },
          status: status("checkout"),
        })} />
      </Stage>
      <Stage label="Starter: setting up" state="starter">
        <JoinInviteStarterUsageScreen errorState={null} />
      </Stage>
      <Stage label="Starter: paused" state="starter-retry">
        <JoinInviteStarterUsageScreen errorState={{
          action: "retry",
          checkoutErrorMessage: null,
          message: "Murph is still finishing starter setup. Try again.",
        }} />
      </Stage>
      <Stage label="Starter: prior billing" state="starter-checkout">
        <JoinInviteStarterUsageScreen errorState={{
          action: "checkout",
          checkoutErrorMessage: null,
          message: "Starter usage is unavailable.",
        }} />
      </Stage>
      <Stage label="Welcome" state="active">
        <JoinInviteStageServer model={model({ status: status("active") })} />
      </Stage>
      <Stage label="Welcome on Telegram" state="active-telegram">
        <JoinInviteStageServer model={model({
          status: { ...status("active"), telegramStartRequired: true },
        })} />
      </Stage>
      <Stage label="Blocked" state="blocked">
        <JoinInviteStageServer model={model({ status: status("blocked") })} />
      </Stage>
      <Stage label="Invalid link" state="invalid">
        <JoinInviteStageServer model={model({ status: status("invalid") })} />
      </Stage>
      <Stage label="Expired link" state="expired">
        <JoinInviteStageServer model={model({ status: status("expired") })} />
      </Stage>
      <Stage label="Dead link, signed in elsewhere" state="expired-signed-in">
        <JoinInviteStageServer model={model({
          status: {
            ...status("expired"),
            session: { ...signedIn, matchesInvite: false },
          },
        })} />
      </Stage>
      <Stage label="Another account" state="mismatch">
        <JoinInviteSignedInMismatchScreen
          signOutAction={
            <JoinInviteSignOutButtonIsland
              appearance="pill"
              idleLabel="Sign out and continue"
            />
          }
        />
      </Stage>
      <Stage label="Checkout paused" state="checkout-paused">
        <JoinInviteCheckoutPausedScreen href={`/join/${INVITE_CODE}`} />
      </Stage>
      <Stage label="Payment received" state="payment-received">
        <JoinInviteSuccessScreen status={status("checkout")} />
      </Stage>
      <Stage label="Setup delayed" state="setup-delayed">
        <JoinInviteSuccessScreen showSetupDelaySupport status={status("checkout")} />
      </Stage>
    </div>
  );
}

function Stage({
  children,
  label,
  state,
}: {
  children: ReactNode;
  label: string;
  state: string;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">{label}</h3>
      <div
        className="flex min-h-[46rem] flex-1 flex-col overflow-hidden rounded-[2rem] bg-[#1C1915]"
        data-join-state={state}
        inert
      >
        <LinkPageSurface>{children}</LinkPageSurface>
      </div>
    </section>
  );
}

function status(
  stage: Parameters<typeof buildJoinInvitePreviewStatus>[0],
): HostedInviteStatusPayload {
  return buildJoinInvitePreviewStatus(stage, INVITE_CODE);
}

function model(
  overrides: Partial<JoinInvitePageModel> & { status: HostedInviteStatusPayload },
): JoinInvitePageModel {
  return {
    awaitingInviteSessionResolution: false,
    familyBillingRecovery: null,
    inviteCode: INVITE_CODE,
    launchConsent: {
      gateActive: false,
      initialStatus: null,
      status: "preview",
    },
    preview: true,
    ...overrides,
  };
}

const CONSENT_DOCUMENTS: HostedConsentStatus["documents"] = [
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

const CONSENT_STATUS: HostedConsentStatus = {
  documents: CONSENT_DOCUMENTS,
  generatedAt: "2026-04-30T00:00:00.000Z",
  launchGranted: false,
  launchScopes: [
    { granted: false, missingDocuments: CONSENT_DOCUMENTS, scope: "launch.legal" },
    { granted: false, missingDocuments: CONSENT_DOCUMENTS, scope: "launch.health-data" },
  ],
  ok: true,
  schema: "murph.hosted-consent-status.v1",
  scopes: [
    {
      current: false,
      documents: CONSENT_DOCUMENTS.slice(0, 3),
      grant: null,
      granted: false,
      label: "Terms, privacy, and AI disclosure",
      missingDocuments: CONSENT_DOCUMENTS.slice(0, 3),
      revocable: false,
      scope: "launch.legal",
    },
    {
      current: false,
      documents: CONSENT_DOCUMENTS.slice(3),
      grant: null,
      granted: false,
      label: "Health data",
      missingDocuments: CONSENT_DOCUMENTS.slice(3),
      revocable: true,
      scope: "launch.health-data",
    },
  ],
};
