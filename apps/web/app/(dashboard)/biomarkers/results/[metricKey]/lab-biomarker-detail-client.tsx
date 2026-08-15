"use client";

import {
  useCallback,
  type ReactNode,
} from "react";
import type { BiomarkerFallbackRangeForDisplay } from "@murphai/health-commons/biomarker-fallback-ranges";
import {
  selectBrowserVaultLabBiomarkerDetail,
  type BrowserVaultLabsCapableQueryClient,
  type BrowserVaultLabBiomarkerDetail,
} from "@murphai/query/browser-biomarkers";

import {
  BiomarkerDetailContent,
  BiomarkerDetailShell,
  BiomarkerStaleRefreshAlert,
  EmptyBiomarkerDetailCard,
} from "@/src/components/biomarkers/lab-biomarker-detail-view";
import { BiomarkerDetailSkeleton } from "@/src/components/biomarkers/lab-biomarker-detail-skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import {
  useBrowserVault,
  useBrowserVaultLabsSelector,
} from "@/src/lib/browser-vault/context";

interface LabBiomarkerDetailClientProps {
  authenticated: boolean;
  chatAction?: ReactNode;
  fallbackRanges?: readonly BiomarkerFallbackRangeForDisplay[];
  metricKey: string;
  summary?: string | null;
  uploadLabsAction?: ReactNode;
}

export function LabBiomarkerDetailClient({
  authenticated,
  chatAction = null,
  fallbackRanges = [],
  metricKey,
  summary = null,
  uploadLabsAction = null,
}: LabBiomarkerDetailClientProps) {
  const {
    error,
    freshness,
    refresh,
    refreshPending,
    status,
  } = useBrowserVault();
  const selectDetail = useCallback(
    (client: BrowserVaultLabsCapableQueryClient) =>
      selectBrowserVaultLabBiomarkerDetail(client, metricKey),
    [metricKey],
  );
  const detail = useBrowserVaultLabsSelector(selectDetail);
  const authRequired = !authenticated
    || (status === "error" && isAuthRequiredBrowserVaultError(error));

  let content: ReactNode;
  let visibleDetail: BrowserVaultLabBiomarkerDetail | null = null;

  if (authRequired) {
    content = (
      <EmptyBiomarkerDetailCard
        authRequired
        preparing={false}
        uploadLabsAction={null}
      />
    );
  } else if (status === "loading") {
    content = <BiomarkerDetailSkeleton />;
  } else if (status === "error") {
    content = (
      <Alert variant="destructive">
        <AlertTitle>Could not load this biomarker</AlertTitle>
        <AlertDescription>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>Your saved lab results are not available right now.</span>
            <Button size="sm" variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  } else if (!detail) {
    content = (
      <>
        {freshness === "stale" && !refreshPending ? (
          <BiomarkerStaleRefreshAlert
            hasResults={false}
            onRefresh={() => void refresh()}
          />
        ) : null}
        <EmptyBiomarkerDetailCard
          authRequired={authRequired}
          preparing={refreshPending}
          uploadLabsAction={uploadLabsAction}
        />
      </>
    );
  } else {
    visibleDetail = detail;
    content = (
      <>
        {freshness === "stale" && !refreshPending ? (
          <BiomarkerStaleRefreshAlert
            hasResults
            onRefresh={() => void refresh()}
          />
        ) : null}
        <BiomarkerDetailContent
          detail={detail}
          fallbackRanges={fallbackRanges}
        />
      </>
    );
  }

  return (
    <BiomarkerDetailShell chatAction={chatAction} detail={visibleDetail} summary={summary}>
      {content}
    </BiomarkerDetailShell>
  );
}

function isAuthRequiredBrowserVaultError(error: string | null): boolean {
  const normalized = error?.toLowerCase() ?? "";
  return normalized.includes("sign in")
    || normalized.includes("auth_required")
    || normalized.includes("unauthorized")
    || normalized.includes("session expired");
}
