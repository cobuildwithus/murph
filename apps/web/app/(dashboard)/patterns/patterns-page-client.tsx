"use client";

import { useMemo } from "react";
import {
  resolveAdherenceObservationActivityKind,
  selectBrowserVaultJournal,
} from "@murphai/query/browser-overview";

import { PersonalPatternsSection } from "@/src/components/overview/personal-patterns-section";
import { PersonalPatternsDiagnostics } from "@/src/components/overview/personal-patterns-diagnostics";
import { useBrowserVault } from "@/src/lib/browser-vault/context";

export default function PatternsPageClient({
  debugFactor = null,
}: {
  debugFactor?: string | null;
}) {
  const { client, refresh, refreshPending, status } = useBrowserVault();
  const report = client?.replica.personalPatterns ?? null;
  const diagnosticActivityEvents = useMemo(
    () => debugFactor && client
      ? collectDiagnosticActivityEvents(client, debugFactor)
      : [],
    [client, debugFactor],
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
      {debugFactor && report ? (
        <PersonalPatternsDiagnostics
          activityEvents={diagnosticActivityEvents}
          factorToken={debugFactor}
          report={report}
        />
      ) : null}
      <PersonalPatternsSection
        onRetry={() => void refresh()}
        report={report}
        state={sectionState}
      />
    </div>
  );
}

function collectDiagnosticActivityEvents(
  client: NonNullable<ReturnType<typeof useBrowserVault>["client"]>,
  factorToken: string,
) {
  const journalRecordIds = new Set(
    selectBrowserVaultJournal(client).days.flatMap((day) =>
      day.events
        .filter((event) => normalizeFactorToken(event.title) === factorToken)
        .flatMap((event) =>
          event.records
            .filter((record) => record.kind === "activity_session")
            .map((record) => record.id)
        )
    ),
  );
  const entities = client.entities
    .list({ kinds: ["activity_session"] })
    .filter(
      (entity) =>
        journalRecordIds.has(entity.id) ||
        normalizeFactorToken(entity.title) === factorToken,
    );

  return entities
    .map((entity) => ({
      date: entity.date,
      inputFields: formatActivityTypeInputs(entity.attributes),
      resolvedFactor:
        resolveAdherenceObservationActivityKind({
          attributes: entity.attributes,
        }) ?? null,
      title: entity.title ?? "Untitled activity",
    }))
    .sort((left, right) => (right.date ?? "").localeCompare(left.date ?? ""));
}

function normalizeFactorToken(value: string | null): string | null {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!normalized) return null;
  return normalized === "yard-work"
    ? "yardwork"
    : normalized === "house-work"
      ? "housework"
      : normalized;
}

function formatActivityTypeInputs(
  attributes: Record<string, unknown>,
): string {
  const keys = [
    "activityKind",
    "activityType",
    "sportName",
    "type",
    "sport",
  ] as const;
  const fields = keys.flatMap((key) => {
    const value = attributes[key];
    return typeof value === "string" && value.trim().length > 0
      ? [`${key}=${value.trim()}`]
      : [];
  });
  return fields.length > 0 ? fields.join(", ") : "No top-level type fields";
}
