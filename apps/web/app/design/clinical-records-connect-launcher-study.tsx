"use client";

import { useState, type ReactNode } from "react";

import {
  RecordsConnectLauncherState,
} from "@/app/(dashboard)/records/connect/records-connect-client";

import { ProviderSearchView, type ProviderSearchViewProps } from "@/app/(dashboard)/records/connect/provider-search-view";

import { ConnectionRow, DisconnectDialog, RecordsPrivacyControls } from "@/app/(dashboard)/records/records-page-client";
import type { ClinicalRecordConnectionContract } from "@/src/lib/clinical-records/client-contracts";

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
      <StudyState label="Find your provider">
        <ProviderSearchView {...searchPreview} />
      </StudyState>
      <StudyState label="Finding a provider">
        <ProviderSearchView {...searchPreview} providers={[]} hasSearched={false} searchPending />
      </StudyState>
      <StudyState label="No matching provider">
        <ProviderSearchView {...searchPreview} providers={[]} />
      </StudyState>
      <StudyState label="Search retry">
        <ProviderSearchView {...searchPreview} providers={[]} searchError="Hospitals and clinics could not be searched right now. Try again." />
      </StudyState>
      <StudyState label="Saved lab results">
        <ul>
          <ConnectionRow connection={savedSource} disabled={false} onDisconnect={() => setDisconnectOpen(true)} />
        </ul>
      </StudyState>
      <StudyState label="Incomplete import">
        <ul><ConnectionRow connection={{ ...savedSource, latestRun: { ...savedSource.latestRun!, status: "partial", reviewCount: 2, skippedExistingCount: 1 } }} disabled={false} onDisconnect={() => {}} /></ul>
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
      <StudyState label="Authenticated launcher loading">
        <RecordsConnectLauncherState state="loading" />
      </StudyState>
      <StudyState label="Launcher needs sign-in">
        <RecordsConnectLauncherState state="authentication-required" />
      </StudyState>
      <StudyState label="Launcher can be retried">
        <RecordsConnectLauncherState state="launch-failed" />
      </StudyState>
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
