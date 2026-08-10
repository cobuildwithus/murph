"use client";

import { useMemo } from "react";
import { selectBrowserVaultOverview } from "@murphai/query/browser-overview";

import { PersonalPatternsSection } from "@/src/components/overview/personal-patterns-section";
import { useBrowserVault } from "@/src/lib/browser-vault/context";

export default function PatternsPageClient() {
  const { client, error, refresh, refreshPending, status } = useBrowserVault();
  const report = useMemo(
    () => client ? selectBrowserVaultOverview(client).personalPatterns : null,
    [client],
  );
  const patternsAvailable = client?.replica.personalPatterns !== undefined;
  const isPreparing = refreshPending && (status === "empty" || !patternsAvailable);
  const sectionState = status === "loading" || isPreparing
    ? "loading"
    : status === "error"
      ? "error"
      : client && !patternsAvailable ? "unavailable" : "ready";

  return (
    <div className="flex flex-col gap-8">
      <PersonalPatternsSection
        error={error}
        onRetry={() => void refresh()}
        report={report}
        state={sectionState}
      />
    </div>
  );
}
