"use client";

import type { ReactNode } from "react";

import {
  RecordsConnectLauncherState,
  ProviderSearch,
} from "@/app/(dashboard)/records/connect/records-connect-client";

import { ConnectionRow } from "@/app/(dashboard)/records/records-page-client";
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
  importsRemaining: 7,
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

export function ClinicalRecordsConnectLauncherStudy() {
  return (
    <div
      className="grid gap-6 xl:grid-cols-2"
      id="clinical-records"
      data-design-section="clinical-records-connect-launcher"
      inert
    >
      <StudyState label="Find your provider">
        <ProviderSearch intentClaim={`cr_${"d".repeat(32)}`} onConsentRequired={() => {}} />
      </StudyState>
      <StudyState label="Saved lab results">
        <ul>
          <ConnectionRow connection={savedSource} disabled={false} onDisconnect={() => {}} />
        </ul>
      </StudyState>
      <StudyState label="Partial results after access ends">
        <ul>
          <ConnectionRow
            connection={{
              ...savedSource,
              status: "needs_reauth",
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
      <StudyState label="Authenticated launcher loading">
        <RecordsConnectLauncherState state="loading" />
      </StudyState>
      <StudyState label="Launcher needs sign-in">
        <RecordsConnectLauncherState state="authentication-required" />
      </StudyState>
      <StudyState label="Launcher can be retried">
        <RecordsConnectLauncherState state="launch-failed" />
      </StudyState>
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
