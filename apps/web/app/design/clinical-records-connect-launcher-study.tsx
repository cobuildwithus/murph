"use client";

import { useState, type ReactNode } from "react";

import {
  RecordsConnectLauncherState,
  UnavailableIntentState,
} from "@/app/records/connect/records-connect-client";

import { ProviderSearchView, type ProviderSearchViewProps } from "@/app/records/connect/provider-search-view";

import { ConnectionRow, DisconnectDialog, RecordsPageClient, RecordsPrivacyControls } from "@/app/(dashboard)/records/records-page-client";
import { AuthProvider } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { HostedLaunchConsentPrompt } from "@/src/components/legal/hosted-legal-consent-card";
import { LINK_PAGE_NIGHT_TOKENS } from "@/src/components/link-page/link-page-shell";
import type { ClinicalRecordConnectionContract } from "@/src/lib/clinical-records/client-contracts";

import { LinkPageStudyState } from "./link-page-study-state";

const savedSource: ClinicalRecordConnectionContract = {
  connectedAt: "2026-09-04T12:00:00.000Z",
  connectionId: "crc_design",
  displayName: "Example Health",
  lastErrorCode: null,
  lastSyncCompletedAt: "2026-09-04T12:05:00.000Z",
  providerDirectoryEntryId: "epic-design",
  sourceSystem: "epic-fhir",
  status: "active",
  canImport: true,
  lastCheckedAt: "2026-09-17T12:00:00.000Z",
  nextSyncAt: "2026-09-18T12:00:00.000Z",
  latestRun: {
    completedAt: "2026-09-04T12:05:00.000Z",
    importedCount: 3,
    labResultCount: 3,
    reviewCount: 0,
    skippedExistingCount: 0,
    runId: "crr_design",
    status: "complete",
  },
};

const searchPreview: ProviderSearchViewProps = {
  keepUpdated: true, onKeepUpdatedChange: () => {},
  query: "Clinic", providers: [
    { id: "epic-320", brandName: "Cleveland Clinic", facilities: [{ city: "Cleveland", state: "OH", name: null, postalCode: null }], sourceSystem: "epic-fhir" },
    { id: "epic-958", brandName: "Mayo Clinic", facilities: [{ city: "Rochester", state: "MN", name: null, postalCode: null }], sourceSystem: "epic-fhir" },
    { id: "epic-example", brandName: "Example Community Clinic", facilities: [], sourceSystem: "epic-fhir" },
  ],
  hasSearched: true, searchPending: false, searchError: null, startError: null,
  startingProviderId: null, selectedProviderId: null,
  onQueryChange: () => {}, onSearch: () => {}, onSelect: () => {}, onRestart: () => {},
};

export function ClinicalRecordsConnectLauncherStudy() {
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  return (
    <div
      className="grid gap-6 xl:grid-cols-2"
      id="clinical-records"
      ref={(node) => { node?.setAttribute("data-preview-ready", "true"); }}
      data-design-section="clinical-records-connect-launcher"
      inert
    >
      <div id="records-overview" className="xl:col-span-2">
        <RecordsPageClient
          authenticated
          initialCallback={null}
          initialLoadError={false}
          initialConnections={[{
            ...savedSource, displayName: "Northstar Health", lastCheckedAt: null, nextSyncAt: null,
            latestRun: { ...savedSource.latestRun!, importedCount: 248, status: "partial", reviewCount: 12, skippedExistingCount: 6 },
          }]}
        />
      </div>
      <LinkPageStudyState label="Results">
        <ProviderSearchView {...searchPreview} />
      </LinkPageStudyState>
      <LinkPageStudyState label="Consent">
        <div className="flex flex-1 flex-col justify-center py-6" style={LINK_PAGE_NIGHT_TOKENS}>
          <HostedLaunchConsentPrompt
            documents={[
              { href: "/legal/terms", id: "terms-of-service", pdfHref: "/legal/terms.pdf", title: "Murph Terms of Service", version: "2026-07-23" },
              { href: "/legal/privacy", id: "privacy-policy", pdfHref: "/legal/privacy.pdf", title: "Murph Privacy Policy", version: "2026-07-23" },
            ]}
            onContinue={() => {}}
          />
        </div>
      </LinkPageStudyState>
      <LinkPageStudyState label="Search">
        <ProviderSearchView {...searchPreview} query="" providers={[]} hasSearched={false} keepUpdated={false} />
      </LinkPageStudyState>
      <LinkPageStudyState label="Finding a provider">
        <ProviderSearchView {...searchPreview} providers={[]} hasSearched={false} searchPending />
      </LinkPageStudyState>
      <LinkPageStudyState label="No matching provider">
        <ProviderSearchView {...searchPreview} query="Northwood" providers={[]} />
      </LinkPageStudyState>
      <LinkPageStudyState label="Search retry">
        <ProviderSearchView {...searchPreview} providers={[]} hasSearched={false} searchError="Hospitals and clinics could not be searched right now. Try again." />
      </LinkPageStudyState>
      <LinkPageStudyState label="Portal couldn’t open">
        <ProviderSearchView {...searchPreview} startError="Could not continue with Mayo Clinic. Try this portal again, or start a new connection to choose another." />
      </LinkPageStudyState>
      <LinkPageStudyState label="Opening a portal">
        <ProviderSearchView {...searchPreview} selectedProviderId="epic-958" startingProviderId="epic-958" />
      </LinkPageStudyState>
      <StudyState label="Saved lab results">
        <ul>
          <ConnectionRow connection={savedSource} disabled={false} onDisconnect={() => setDisconnectOpen(true)} />
        </ul>
      </StudyState>
      <StudyState label="Incomplete import">
        <ul><ConnectionRow connection={{ ...savedSource, latestRun: { ...savedSource.latestRun!, status: "partial", reviewCount: 2, skippedExistingCount: 1 } }} disabled={false} onDisconnect={() => {}} /></ul>
      </StudyState>
      <StudyState label="Limited portal coverage">
        <ul><ConnectionRow connection={{ ...savedSource, lastErrorCode: "provider-search-incomplete", latestRun: { ...savedSource.latestRun!, status: "partial", reviewCount: 4, skippedExistingCount: 2 } }} disabled={false} onDisconnect={() => {}} /></ul>
      </StudyState>
      <StudyState label="Partial results after access ends">
        <ul>
          <ConnectionRow
            connection={{
              ...savedSource,
              status: "needs_reauth",
              nextSyncAt: null,
              latestRun: { ...savedSource.latestRun!, status: "needs_reauth", reviewCount: 2 },
            }}
            disabled={false}
            onDisconnect={() => {}}
          />
        </ul>
      </StudyState>
      <StudyState label="Raw evidence only">
        <ul>
          <ConnectionRow
            connection={{
              ...savedSource,
              latestRun: {
                ...savedSource.latestRun!,
                importedCount: 0,
                labResultCount: 0,
                reviewCount: 12,
              },
            }}
            disabled={false}
            onDisconnect={() => {}}
          />
        </ul>
      </StudyState>
      <StudyState label="Disconnected with saved results">
        <ul>
          <ConnectionRow
            connection={{ ...savedSource, status: "disconnected" }}
            disabled={false}
            onDisconnect={() => {}}
          />
        </ul>
      </StudyState>
      <StudyState label="Record privacy controls"><RecordsPrivacyControls /></StudyState>
      <LinkPageStudyState label="Authenticated launcher loading">
        <RecordsConnectLauncherState state="loading" />
      </LinkPageStudyState>
      <LinkPageStudyState label="Launcher needs sign-in">
        <AuthProvider authenticated={false}>
          <RecordsConnectLauncherState state="authentication-required" />
        </AuthProvider>
      </LinkPageStudyState>
      <LinkPageStudyState label="Launcher can be retried">
        <RecordsConnectLauncherState state="launch-failed" />
      </LinkPageStudyState>
      <LinkPageStudyState label="Link unavailable">
        <UnavailableIntentState />
      </LinkPageStudyState>
      <DisconnectDialog connection={disconnectOpen ? savedSource : null} errorMessage={null} onConfirm={() => setDisconnectOpen(false)} onOpenChange={setDisconnectOpen} pending={false} />
    </div>
  );
}

function StudyState({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <div className="min-w-0 rounded-2xl border bg-background p-5 sm:p-7">{children}</div>
    </div>
  );
}
