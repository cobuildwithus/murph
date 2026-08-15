import {
  resolveExperimentAdherenceRollupTarget,
  selectBrowserVaultExperimentResults,
  type BrowserVaultExperimentResultsView,
  type BrowserVaultMetricsCapableQueryClient,
} from "@murphai/query/browser-experiments";

import type { ExperimentRunCardDailyCadence } from "@/src/lib/experiments/run-card-summary";

interface ResolveExperimentRunCardDailyCadenceInput {
  cadence?: string;
  client: BrowserVaultMetricsCapableQueryClient | null;
  experimentId: string;
}

type BrowserVaultAdherenceCell = NonNullable<
  BrowserVaultExperimentResultsView["adherence"]
>["cells"][number];

export function resolveExperimentRunCardDailyCadence({
  cadence,
  client,
  experimentId,
}: ResolveExperimentRunCardDailyCadenceInput): ExperimentRunCardDailyCadence | undefined {
  const normalizedCadence = cadence?.trim();
  if (!client || !normalizedCadence) {
    return undefined;
  }

  const results = selectBrowserVaultExperimentResults(
    client,
    { experimentId },
    { asOf: client.replica.generatedAt },
  );
  const adherence = results?.adherence;
  if (!results || !adherence) {
    return undefined;
  }

  const target = resolveExperimentAdherenceRollupTarget(
    results.experiment.runPlan.adherenceTargets,
  );
  if (!target?.calendar) {
    return undefined;
  }

  const todayLocalDate = formatIsoDateInTimeZone(results.asOf, adherence.timeZone);
  const todayCells = adherence.cells.filter((cell) =>
    cell.targetId === target.targetId && cell.localDate === todayLocalDate
  );
  const expected = todayCells.reduce(
    (total, cell) => total + normalizeCount(cell.expectedCount),
    0,
  );

  // A one-per-day target is already served well by the standard experiment
  // progress treatment. This view is specifically for repeated daily actions.
  if (expected <= 1) {
    return undefined;
  }

  const completed = Math.min(
    expected,
    todayCells.reduce(
      (total, cell) => total + resolveCompletedCount(cell),
      0,
    ),
  );

  return {
    cadence: normalizedCadence,
    completed,
    expected,
    label: target.label,
  };
}

function resolveCompletedCount(cell: BrowserVaultAdherenceCell): number {
  const expected = normalizeCount(cell.expectedCount);
  const observed = normalizeOptionalCount(cell.observedCount);

  if (observed !== null) {
    return Math.min(expected, observed);
  }

  return cell.status === "satisfied" || cell.status === "assumed"
    ? expected
    : 0;
}

function normalizeCount(value: number | null | undefined): number {
  return normalizeOptionalCount(value) ?? 0;
}

function normalizeOptionalCount(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.trunc(value));
}

function formatIsoDateInTimeZone(value: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;

    return year && month && day
      ? `${year}-${month}-${day}`
      : date.toISOString().slice(0, 10);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
