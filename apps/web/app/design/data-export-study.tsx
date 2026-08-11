"use client";

import { useSearchParams } from "next/navigation";

import {
  formatVaultExportSuccess,
  HostedDataExportDialogContent,
  HostedDataExportSuccess,
} from "@/src/components/settings/hosted-data-privacy-settings";

export function DataExportControlStudy() {
  return (
    <div data-design-component="data-export" inert>
      <DataExportStudyContent />
    </div>
  );
}

export function DataExportFlowStudy() {
  return (
    <div data-design-section="data-export" inert>
      <DataExportStudyContent />
    </div>
  );
}

function DataExportStudyContent() {
  const preview = useSearchParams().get("study");
  const pending = preview === "data-export-pending";
  const ready = preview === "data-export-ready";
  const errorMessage = preview === "data-export-error"
    ? "Murph does not have a retained dashboard export available yet. Try again later, or use Murph again to resume processing."
    : null;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground lg:col-span-2">
        Use study=data-export-ready, study=data-export-error, or
        study=data-export-pending to preview each dialog state.
      </p>
      <div className="rounded-2xl border border-border bg-background p-5">
        <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Latest retained export
        </p>
        <HostedDataExportSuccess
          message={formatVaultExportSuccess({
            deviceSyncImportPending: true,
            freshness: "stale",
            refreshPending: true,
          })}
        />
      </div>
      <div
        className="mx-auto w-full max-w-md rounded-3xl border border-border bg-popover p-6 sm:p-7"
        data-design-state="export-dialog"
      >
        <HostedDataExportDialogContent
          acknowledgedSensitiveDownload={pending || ready}
          errorMessage={errorMessage}
          onAcknowledgedChange={() => undefined}
          onCancel={() => undefined}
          onConfirm={() => undefined}
          pending={pending}
        />
      </div>
    </div>
  );
}
