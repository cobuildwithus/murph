import type { VaultReadModel } from "./model.ts";

export interface OverviewMetric {
  label: string;
  note: string;
  value: number;
}

export interface OverviewJournalEntry {
  date: string;
  id: string;
  summary: string | null;
  tags: string[];
  title: string;
}

export interface OverviewExperiment {
  id: string;
  slug: string | null;
  startedOn: string | null;
  status: string | null;
  summary: string | null;
  tags: string[];
  title: string;
}

export interface OverviewWeeklyStat {
  currentWeekAvg: number | null;
  deltaPercent: number | null;
  previousWeekAvg: number | null;
  stream: string;
  unit: string | null;
}

export function buildOverviewMetrics(vault: VaultReadModel): OverviewMetric[] {
  const registryCount =
    vault.goals.length +
    vault.conditions.length +
    vault.allergies.length +
    vault.protocols.length +
    vault.familyMembers.length +
    vault.geneticVariants.length;

  return [
    {
      label: "entities",
      note: "Canonical read model rows",
      value: vault.entities.length,
    },
    {
      label: "events",
      note: "Ledger event entries",
      value: vault.events.length,
    },
    {
      label: "samples",
      note: "Recorded measurements",
      value: vault.samples.length,
    },
    {
      label: "journal days",
      note: "Human review pages",
      value: vault.journalEntries.length,
    },
    {
      label: "experiments",
      note: "Tracked investigations",
      value: vault.experiments.length,
    },
    {
      label: "registries",
      note: "Goals, conditions, family, genetics",
      value: registryCount,
    },
  ];
}

export function summarizeRecentOverviewJournals(
  vault: VaultReadModel,
  limit = 3,
): OverviewJournalEntry[] {
  return [...vault.journalEntries]
    .sort((left, right) =>
      compareLatestStrings(right.date ?? right.occurredAt, left.date ?? left.occurredAt),
    )
    .slice(0, normalizeLimit(limit, 3))
    .map((entry) => ({
      date: entry.date ?? extractDate(entry.occurredAt),
      id: entry.entityId,
      summary: summarizeText(entry.body),
      tags: compactStrings(entry.tags),
      title: entry.title ?? entry.entityId,
    }));
}

export function buildOverviewWeeklyStats(
  vault: VaultReadModel,
  timeZone: string,
): OverviewWeeklyStat[] {
  const today = formatOverviewDateTimeParts(new Date(), timeZone);
  const mondayOffset = today.dayOfWeek === 0 ? 6 : today.dayOfWeek - 1;
  const thisWeekStart = addDaysToIsoDate(today.dayKey, -mondayOffset);
  const lastWeekStart = addDaysToIsoDate(thisWeekStart, -7);

  const thisWeekSamples = new Map<string, { stream: string; unit: string | null; values: number[] }>();
  const lastWeekSamples = new Map<string, { stream: string; unit: string | null; values: number[] }>();

  for (const sample of vault.samples) {
    const sampleDate = sample.date ?? extractDate(sample.occurredAt);
    const numericValue = getNumericSampleValue(sample.attributes?.value);
    if (!sample.stream || numericValue === null) {
      continue;
    }

    const unit = normalizeString(sample.attributes?.unit);
    let bucket: Map<string, { stream: string; unit: string | null; values: number[] }> | null = null;

    if (sampleDate >= thisWeekStart && sampleDate <= today.dayKey) {
      bucket = thisWeekSamples;
    } else if (sampleDate >= lastWeekStart && sampleDate < thisWeekStart) {
      bucket = lastWeekSamples;
    }

    if (!bucket) {
      continue;
    }

    const key = buildWeeklyStatKey(sample.stream, unit);
    const existing = bucket.get(key);
    if (existing) {
      existing.values.push(numericValue);
      continue;
    }

    bucket.set(key, {
      stream: sample.stream,
      unit,
      values: [numericValue],
    });
  }

  const allKeys = new Set([...thisWeekSamples.keys(), ...lastWeekSamples.keys()]);
  const stats: OverviewWeeklyStat[] = [];

  for (const key of allKeys) {
    const currentWeek = thisWeekSamples.get(key);
    const previousWeek = lastWeekSamples.get(key);
    const stream = currentWeek?.stream ?? previousWeek?.stream;

    if (!stream) {
      continue;
    }

    const currentWeekAvg = averageValues(currentWeek?.values ?? null);
    const previousWeekAvg = averageValues(previousWeek?.values ?? null);
    let deltaPercent: number | null = null;

    if (
      currentWeekAvg !== null &&
      previousWeekAvg !== null &&
      previousWeekAvg !== 0
    ) {
      deltaPercent = ((currentWeekAvg - previousWeekAvg) / Math.abs(previousWeekAvg)) * 100;
    }

    stats.push({
      currentWeekAvg,
      deltaPercent,
      previousWeekAvg,
      stream,
      unit: currentWeek?.unit ?? previousWeek?.unit ?? null,
    });
  }

  return stats.sort((left, right) =>
    left.stream === right.stream
      ? (left.unit ?? "").localeCompare(right.unit ?? "")
      : left.stream.localeCompare(right.stream),
  );
}

export function summarizeOverviewExperiments(
  vault: VaultReadModel,
  limit = 6,
): OverviewExperiment[] {
  const sortedExperiments = [...vault.experiments].sort((left, right) =>
    compareLatestStrings(right.occurredAt ?? right.date, left.occurredAt ?? left.date),
  );
  const prioritizedExperiments = [
    ...sortedExperiments.filter((entry) => isActiveExperimentStatus(entry.status)),
    ...sortedExperiments.filter((entry) => !isActiveExperimentStatus(entry.status)),
  ];

  return prioritizedExperiments.slice(0, normalizeLimit(limit, 6)).map((entry) => ({
    id: entry.entityId,
    slug: entry.experimentSlug,
    startedOn: entry.date ?? extractDate(entry.occurredAt),
    status: entry.status ?? null,
    summary: summarizeText(entry.body),
    tags: compactStrings(entry.tags),
    title: entry.title ?? entry.entityId,
  }));
}

function summarizeText(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !/^#{1,6}\s+/u.test(line))
    .map((line) => line.replace(/^[-*+]\s+/u, "").trim())
    .filter((line) => line.length > 0)
    .join(" ");

  if (!normalized) {
    return null;
  }

  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}...`;
}

function compactStrings(values: readonly (string | null | undefined)[]): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function compareLatestStrings(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return (left ?? "").localeCompare(right ?? "");
}

function extractDate(value: string | null | undefined): string {
  return extractOverviewDatePrefix(value) ?? "Undated";
}

function buildWeeklyStatKey(stream: string, unit: string | null): string {
  return `${stream}:${unit ?? ""}`;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getNumericSampleValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function averageValues(values: readonly number[] | null): number | null {
  if (!values || values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isActiveExperimentStatus(status: string | null | undefined): boolean {
  return status?.trim().toLowerCase() === "active";
}

function normalizeLimit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.trunc(value));
}

function extractOverviewDatePrefix(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/^(\d{4}-\d{2}-\d{2})/u);
  return match?.[1] ?? null;
}

function addDaysToIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatOverviewDateTimeParts(
  value: Date,
  timeZone: string,
): { dayKey: string; dayOfWeek: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Mon";

  return {
    dayKey: `${year}-${month}-${day}`,
    dayOfWeek: mapWeekdayToIndex(weekday),
  };
}

function mapWeekdayToIndex(weekday: string): number {
  switch (weekday) {
    case "Sun":
      return 0;
    case "Mon":
      return 1;
    case "Tue":
      return 2;
    case "Wed":
      return 3;
    case "Thu":
      return 4;
    case "Fri":
      return 5;
    case "Sat":
      return 6;
    default:
      return 1;
  }
}
