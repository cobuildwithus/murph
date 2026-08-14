import { resolveExperimentAdherenceRollupTarget } from "../experiment-adherence.ts";
import { selectBrowserVaultTrackedExperiments } from "./tracked-experiments.ts";
import {
  selectBrowserVaultExperimentResults,
  type BrowserVaultExperimentAdherenceTarget,
  type BrowserVaultExperimentBiomarkerResult,
  type BrowserVaultExperimentProgressPhase,
  type BrowserVaultExperimentResultsView,
} from "./experiments.ts";
import {
  BROWSER_VAULT_EXPERIMENT_RUN_CARD_SCHEMA,
  type BrowserVaultEntity,
  type BrowserVaultExperimentRunCard,
  type BrowserVaultExperimentRunCardDailyCadence,
  type BrowserVaultExperimentRunCardMetric,
  type BrowserVaultExperimentRunCardStatus,
  type BrowserVaultExperimentRunCardSummary,
  type BrowserVaultMetricsCapableQueryClient,
} from "./shared.ts";
import {
  getBrowserVaultMetricBucketId,
  type BrowserVaultMetricBucketId,
} from "./metric-buckets.ts";

interface RunCardSignal extends BrowserVaultExperimentRunCardMetric {
  delta: string;
}

interface RunCardTrend {
  baseline: string;
  current: string;
  delta?: string;
  label: string;
}

interface SavedRunTiming {
  baselineDays: number;
  durationDays: number;
  durationDaysKnown: boolean;
  timingKnown: boolean;
}

/**
 * Build the bounded home-card projection while raw metric history is already
 * available to the replica producer. The result is display-only derived data;
 * it never advances independently of the replica generation/dataVersion.
 */
export async function buildBrowserVaultExperimentRunCards(
  client: BrowserVaultMetricsCapableQueryClient,
): Promise<BrowserVaultExperimentRunCard[]> {
  const cards: BrowserVaultExperimentRunCard[] = [];
  const seen = new Set<string>();

  for (const tracked of selectBrowserVaultTrackedExperiments(client)) {
    const results = selectBrowserVaultExperimentResults(
      client,
      { experimentId: tracked.id },
      { asOf: client.replica.generatedAt },
    );
    if (!results || seen.has(results.experiment.id)) {
      continue;
    }

    const entity = client.entities.get(tracked.id)
      ?? client.entities.get(results.experiment.id);
    if (!entity) {
      continue;
    }

    cards.push(projectExperimentRunCard(
      results,
      entity,
      await requiredMetricBuckets(results),
    ));
    seen.add(results.experiment.id);
  }

  return cards;
}

function projectExperimentRunCard(
  results: BrowserVaultExperimentResultsView,
  entity: BrowserVaultEntity,
  requiredMetricBuckets: BrowserVaultMetricBucketId[],
): BrowserVaultExperimentRunCard {
  const status = results.persistedOutcome
    ? "finished"
    : normalizeRunStatus(results);
  const timing = resolveSavedRunTiming(results);
  const startedOn = results.experiment.windows.baselineStart
    ?? results.experiment.startedOn;
  const savedWindows = results.persistedOutcome?.windows ?? null;
  const dateRangeStart = savedWindows
    ? savedWindows.baselineStart ?? savedWindows.interventionStart ?? undefined
    : startedOn ?? undefined;
  const referenceDate = resolveReferenceDate(results);
  const analysisAvailableOn = status === "stopped"
    ? results.experiment.completedAt
      ?? results.experiment.windows.interventionEnd
      ?? undefined
    : savedWindows?.interventionEnd
      ?? results.persistedOutcome?.asOf
      ?? results.experiment.windows.interventionEnd
      ?? results.experiment.completedAt
      ?? undefined;
  const durationDays = status !== "stopped" && startedOn && analysisAvailableOn
    ? Math.max(1, daysBetweenInclusive(startedOn, analysisAvailableOn))
    : timing.durationDays;
  const day = timing.timingKnown
    ? results.progress?.dayInRun
      ?? results.experiment.dayInRun
      ?? (timing.durationDaysKnown && startedOn
        ? clamp(daysBetweenInclusive(startedOn, referenceDate), 1, durationDays)
        : undefined)
    : undefined;
  const completionPercent = status === "finished"
    ? 100
    : timing.timingKnown && timing.durationDaysKnown && day
      ? clamp(Math.round((day / durationDays) * 100), 1, 99)
      : undefined;

  return {
    id: results.experiment.id,
    lookupKeys: buildLookupKeys(entity),
    requiredMetricBuckets,
    runSummary: buildRunCardSummary({
      ...(completionPercent === undefined ? {} : { completionPercent }),
      ...(dateRangeStart && analysisAvailableOn
        ? { dateRange: formatDateRange(dateRangeStart, analysisAvailableOn) }
        : {}),
      ...(day === undefined ? {} : { day }),
      results,
      status,
    }),
    schema: BROWSER_VAULT_EXPERIMENT_RUN_CARD_SCHEMA,
    slug: results.experiment.slug === results.experiment.id
      ? null
      : results.experiment.slug,
    startedOn,
    status,
    statusLabel: formatStatusLabel(
      results.experiment.status,
      status,
      results.experiment.phase,
    ),
    summary: buildRunSummary(results, status) ?? null,
    summaryDetail: buildRunSummaryDetail(results, status) ?? null,
    tags: entity.tags.slice(),
    title: results.experiment.title,
  };
}

async function requiredMetricBuckets(
  results: BrowserVaultExperimentResultsView,
): Promise<BrowserVaultMetricBucketId[]> {
  const metricKeys = [...new Set(results.biomarkers.flatMap((biomarker) =>
    biomarker.sourceMetric?.metricKey ? [biomarker.sourceMetric.metricKey] : []
  ))];
  return [...new Set(await Promise.all(metricKeys.map(getBrowserVaultMetricBucketId)))].sort();
}

function buildRunCardSummary(input: {
  completionPercent?: number;
  dateRange?: string;
  day?: number;
  results: BrowserVaultExperimentResultsView;
  status: BrowserVaultExperimentRunCardStatus;
}): BrowserVaultExperimentRunCardSummary {
  const signals = buildSignals(input.results);
  const trends = buildTrends(input.results);
  const primaryTrend = trends[0];
  const primarySignal = (primaryTrend
    ? signals.find((signal) => signal.label === primaryTrend.label)
    : undefined) ?? signals[0];
  const dailyCadence = input.status === "active" || input.status === "paused"
    ? buildDailyCadence(input.results)
    : undefined;

  return {
    ...(input.completionPercent === undefined
      ? {}
      : { completionPercent: input.completionPercent }),
    ...(dailyCadence ? { dailyCadence } : {}),
    ...(input.dateRange ? { dateRange: input.dateRange } : {}),
    ...(input.day === undefined ? {} : { day: input.day }),
    ...(primarySignal || primaryTrend
      ? { metric: buildMetric(primarySignal, primaryTrend) }
      : {}),
    metrics: signals
      .filter((signal) => signal.delta.trim().length > 0)
      .map((signal) => buildMetric(signal, undefined)),
  };
}

function buildSignals(results: BrowserVaultExperimentResultsView): RunCardSignal[] {
  return results.biomarkers
    .filter(isRenderableBiomarker)
    .flatMap((biomarker) => {
      if (biomarker.deltaAbs === null) {
        return [];
      }

      const currentValue = readCurrentBiomarkerValue(biomarker);
      if (currentValue === null) {
        return [];
      }
      const unit = resolveOutcomeDisplayUnit(biomarker);
      const showDelta = biomarker.completeness === "good";

      return [{
        ...(biomarker.baseline.mean === null
          ? {}
          : { baseline: formatValueWithUnit(biomarker.baseline.mean, unit) }),
        biomarkerKey: biomarker.biomarkerKey,
        current: formatValueWithUnit(currentValue, unit),
        delta: showDelta ? formatDelta(biomarker.deltaAbs, unit) : "",
        ...(showDelta
          ? { direction: resolveSignalDirection(biomarker.deltaAbs) }
          : {}),
        label: biomarker.label,
      } satisfies RunCardSignal];
    });
}

function buildTrends(results: BrowserVaultExperimentResultsView): RunCardTrend[] {
  return results.biomarkers
    .filter(isRenderableBiomarker)
    .flatMap((biomarker) => {
      const currentValue = readCurrentBiomarkerValue(biomarker);
      if (currentValue === null || biomarker.baseline.mean === null) {
        return [];
      }
      const hasPoints = biomarker.points.some((point) =>
        point.phase === "baseline" || point.phase === "intervention"
      );
      const hasPersistedWindow = !hasPoints
        && results.persistedOutcome !== null
        && biomarker.intervention.mean !== null;
      if (!hasPoints && !hasPersistedWindow) {
        return [];
      }

      const unit = resolveOutcomeDisplayUnit(biomarker);
      return [{
        baseline: formatTrendValue(biomarker.baseline.mean, unit),
        current: formatTrendValue(currentValue, unit),
        ...(biomarker.deltaAbs === null || biomarker.completeness !== "good"
          ? {}
          : { delta: formatDelta(biomarker.deltaAbs, unit) }),
        label: biomarker.label,
      }];
    });
}

function buildMetric(
  signal: RunCardSignal | undefined,
  trend: RunCardTrend | undefined,
): BrowserVaultExperimentRunCardMetric {
  return {
    ...((signal?.baseline ?? trend?.baseline) === undefined
      ? {}
      : { baseline: signal?.baseline ?? trend?.baseline }),
    ...(signal?.biomarkerKey ? { biomarkerKey: signal.biomarkerKey } : {}),
    current: signal?.current ?? trend?.current ?? "—",
    ...((signal?.delta || trend?.delta) ? { delta: signal?.delta || trend?.delta } : {}),
    ...(signal?.direction ? { direction: signal.direction } : {}),
    label: signal?.label ?? trend?.label ?? "Primary signal",
  };
}

function buildDailyCadence(
  results: BrowserVaultExperimentResultsView,
): BrowserVaultExperimentRunCardDailyCadence | undefined {
  const adherence = results.adherence;
  const targetRef = resolveExperimentAdherenceRollupTarget(
    results.experiment.runPlan.adherenceTargets,
  );
  const target = targetRef
    ? results.experiment.runPlan.adherenceTargets.find((entry) =>
        entry.targetId === targetRef.targetId
      )
    : undefined;
  if (!adherence || !target?.calendar) {
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
  if (expected <= 1) {
    return undefined;
  }

  const completed = Math.min(
    expected,
    todayCells.reduce((total, cell) => {
      const expectedCount = normalizeCount(cell.expectedCount);
      const observed = normalizeOptionalCount(cell.observedCount);
      if (observed !== null) {
        return total + Math.min(expectedCount, observed);
      }
      return total + (
        cell.status === "satisfied" || cell.status === "assumed"
          ? expectedCount
          : 0
      );
    }, 0),
  );

  return {
    cadence: formatTargetCadence(target),
    completed,
    expected,
    label: target.label,
  };
}

function formatTargetCadence(
  target: BrowserVaultExperimentAdherenceTarget,
): string {
  const calendar = target.calendar;
  if (!calendar) {
    return `${target.label} target`;
  }
  const targetCount = calendar.kind === "explicitDates"
    ? Math.max(1, ...calendar.dates.map((date) => date.targetCount ?? 1))
    : calendar.targetCountPerDay ?? 1;
  const countPrefix = targetCount > 1 ? `${targetCount}x ` : "";

  if (calendar.kind === "daily") {
    return `${countPrefix}Daily${calendar.localTime ? ` at ${calendar.localTime}` : ""}`;
  }
  if (calendar.kind === "weekdays") {
    const weekdays = calendar.weekdays.map((day) =>
      ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day] ?? "Day"
    );
    return `${countPrefix}${weekdays.join(", ")}${
      calendar.localTime ? ` at ${calendar.localTime}` : ""
    }`;
  }
  return `${target.label} target`;
}

function buildLookupKeys(entity: BrowserVaultEntity): BrowserVaultExperimentRunCard["lookupKeys"] {
  const protocolRef = readRecord(entity.attributes.protocolRef);
  const commonsProtocolRef = readRecord(entity.attributes.commonsProtocolRef);
  return {
    experimentIds: uniqueStrings([
      entity.id,
      ...entity.lookupIds,
      readString(entity.attributes.experimentId),
    ]),
    protocolKeys: uniqueStrings([
      readString(protocolRef?.protocolId),
      readString(protocolRef?.protocolRevisionId),
      readString(protocolRef?.effectiveSpecHash),
      readString(commonsProtocolRef?.key),
      readString(commonsProtocolRef?.pageRevisionId),
      readString(commonsProtocolRef?.runSpecRevisionId),
      readString(commonsProtocolRef?.testPlanId),
    ]),
    slugs: uniqueStrings([
      entity.experimentSlug,
      readString(entity.attributes.slug),
      ...entity.lookupIds,
    ]),
  };
}

function resolveSavedRunTiming(results: BrowserVaultExperimentResultsView): SavedRunTiming {
  const experiment = results.experiment;
  const startedOn = experiment.windows.baselineStart
    ?? experiment.startedOn
    ?? experiment.windows.interventionStart;
  const endedOn = experiment.windows.interventionEnd ?? experiment.completedAt;
  const knownDurationDays = startedOn && endedOn
    ? Math.max(1, daysBetweenInclusive(startedOn, endedOn))
    : null;
  const durationDays = knownDurationDays
    ?? normalizeDayCount(results.progress?.dayInRun ?? experiment.dayInRun ?? 1, 1);
  const hasBaselineWindow = experiment.windows.baselineStart !== null
    && experiment.windows.baselineEnd !== null;
  const hasInterventionWindow = experiment.windows.interventionStart !== null
    && experiment.windows.interventionEnd !== null;
  const hasExplicitZeroBaseline = experiment.windows.baselineStart === null
    && experiment.windows.baselineEnd === null
    && hasInterventionWindow
    && experiment.startedOn === experiment.windows.interventionStart;
  const baselineDays = hasBaselineWindow
    ? knownDurationDays === null
      ? Math.max(
          0,
          daysBetweenInclusive(
            experiment.windows.baselineStart!,
            experiment.windows.baselineEnd!,
          ),
        )
      : Math.max(
          0,
          Math.min(
            daysBetweenInclusive(
              experiment.windows.baselineStart!,
              experiment.windows.baselineEnd!,
            ),
            durationDays - 1,
          ),
        )
    : 0;

  return {
    baselineDays,
    durationDays,
    durationDaysKnown: knownDurationDays !== null,
    timingKnown: hasBaselineWindow || hasExplicitZeroBaseline,
  };
}

function buildRunSummary(
  results: BrowserVaultExperimentResultsView,
  status: BrowserVaultExperimentRunCardStatus,
): string | undefined {
  const primary = results.biomarkers.find(isRenderableBiomarker);
  if (status === "finished") {
    if (results.persistedOutcome) {
      return results.persistedOutcome.conclusion.headline;
    }
    if (results.savedOutcomeStatus === "pending") {
      return "Your run is complete";
    }
    if (results.savedOutcomeStatus === "unavailable") {
      return "Saved analysis unavailable";
    }
    return "Private run recorded";
  }
  if (status === "stopped") {
    return "Private run stopped";
  }

  const phaseLabel = formatProgressPhase(results.experiment.phase);
  const adherence = results.progress?.adherence;
  if (!primary || primary.deltaAbs === null || primary.completeness !== "good") {
    return `${phaseLabel} in progress`;
  }
  const adherencePart = adherence
    ? ` with ${formatRunSummaryAdherence(adherence)}`
    : "";
  return `${phaseLabel}${adherencePart}: ${primary.label} is ${
    formatDelta(primary.deltaAbs, primary.unit)
  } from baseline.`;
}

function buildRunSummaryDetail(
  results: BrowserVaultExperimentResultsView,
  status: BrowserVaultExperimentRunCardStatus,
): string | undefined {
  const adherence = results.progress?.adherence;
  if (status === "finished") {
    if (results.persistedOutcome) {
      return results.persistedOutcome.conclusion.plainLanguage;
    }
    const outcomeState = results.savedOutcomeStatus === "pending"
      ? "The run is safely recorded in your vault. Its saved outcome analysis is still pending."
      : results.savedOutcomeStatus === "unavailable"
        ? "The run is safely recorded in your vault, but its referenced saved outcome is unavailable in this private snapshot."
        : "The private run is recorded, but it does not have a canonical saved outcome to render.";
    return adherence ? `${outcomeState} ${formatAdherenceDetail(adherence)}` : outcomeState;
  }

  const details: string[] = [];
  if (results.progress?.dataCoverage) {
    details.push(
      `Coverage is ${results.progress.dataCoverage.status.replaceAll("_", " ")} for the primary signal.`,
    );
  }
  if (adherence) {
    details.push(formatAdherenceDetail(adherence));
  }
  details.push(...results.biomarkers
    .filter((biomarker) => biomarker.status !== "available")
    .map((biomarker) => `${biomarker.label}: ${biomarker.statusReason}`));
  return details.filter(Boolean).join(" ");
}

function formatAdherenceDetail(
  adherence: NonNullable<BrowserVaultExperimentResultsView["progress"]>["adherence"],
): string {
  const assumedSessions = adherence.assumedSessions ?? 0;
  const parts = [
    assumedSessions > 0
      ? `${adherence.loggedSessions} done (${assumedSessions} assumed)`
      : `${adherence.loggedSessions} logged`,
    formatCount(adherence.sensedSessions ?? 0, "sensed"),
    formatCount(adherence.confirmedSessions ?? 0, "confirmed"),
    assumedSessions > 0 ? undefined : formatCount(assumedSessions, "assumed"),
    formatCount(adherence.partialSessions, "partial"),
    formatCount(adherence.missedSessions, "not logged"),
    adherence.targetSessions !== null
      ? `${adherence.targetSessions} target`
      : undefined,
  ].filter((part): part is string => Boolean(part));
  return `Adherence is ${adherence.status.replaceAll("_", " ")} (${parts.join(" · ")}).`;
}

function formatRunSummaryAdherence(
  adherence: NonNullable<BrowserVaultExperimentResultsView["progress"]>["adherence"],
): string {
  const assumedSessions = adherence.assumedSessions ?? 0;
  return assumedSessions > 0
    ? `${adherence.loggedSessions} done (${assumedSessions} assumed)`
    : `${adherence.loggedSessions} logged target${adherence.loggedSessions === 1 ? "" : "s"}`;
}

function normalizeRunStatus(
  results: BrowserVaultExperimentResultsView,
): BrowserVaultExperimentRunCardStatus {
  const phase = results.experiment.phase;
  const normalized = results.experiment.status?.trim().toLowerCase() ?? "";
  if (phase === "paused" || normalized === "paused") return "paused";
  if (
    phase === "abandoned"
    || ["abandoned", "closed", "stopped"].includes(normalized)
  ) return "stopped";
  if (
    phase === "completed"
    || phase === "review_due"
    || ["complete", "completed", "concluded", "done", "finished", "waiting-for-review"]
      .includes(normalized)
  ) return "finished";
  return "active";
}

function formatStatusLabel(
  sourceStatus: string | null,
  normalizedStatus: BrowserVaultExperimentRunCardStatus,
  phase: BrowserVaultExperimentProgressPhase,
): string {
  const normalizedLabel = normalizedStatus === "active"
    ? "Active"
    : normalizedStatus === "paused"
      ? "Paused"
      : normalizedStatus === "stopped"
        ? "Stopped"
        : phase === "review_due"
          ? "Review due"
          : "Finished";
  if (normalizedStatus === "stopped" || !sourceStatus) return normalizedLabel;
  if (isOpenSourceStatus(sourceStatus) && normalizedStatus !== "active") {
    return normalizedLabel;
  }
  if (
    normalizedStatus === "finished"
    && !["complete", "completed", "concluded", "done", "finished", "waiting-for-review"]
      .includes(sourceStatus.trim().toLowerCase())
  ) return normalizedLabel;
  return sourceStatus
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^./u, (match) => match.toUpperCase());
}

function formatProgressPhase(phase: BrowserVaultExperimentProgressPhase): string {
  switch (phase) {
    case "planned": return "Planned";
    case "baseline": return "Baseline";
    case "intervention": return "Protocol";
    case "review_due": return "Review due";
    case "completed": return "Completed";
    case "paused": return "Paused";
    case "abandoned": return "Stopped";
  }
}

function isRenderableBiomarker(biomarker: BrowserVaultExperimentBiomarkerResult): boolean {
  return biomarker.status === "available" && readCurrentBiomarkerValue(biomarker) !== null;
}

function readCurrentBiomarkerValue(
  biomarker: BrowserVaultExperimentBiomarkerResult,
): number | null {
  return biomarker.intervention.mean
    ?? biomarker.points.at(-1)?.value
    ?? biomarker.baseline.mean;
}

function resolveOutcomeDisplayUnit(
  biomarker: BrowserVaultExperimentBiomarkerResult,
): string | undefined {
  return biomarker.statistic === "count"
    ? undefined
    : biomarker.unit
      ?? biomarker.intervention.unit
      ?? biomarker.baseline.unit
      ?? undefined;
}

function resolveSignalDirection(value: number): "down" | "neutral" | "up" {
  return value === 0 ? "neutral" : value > 0 ? "up" : "down";
}

function formatDelta(value: number, unit: string | null | undefined): string {
  const rounded = roundMetric(value);
  const formatted = formatMetricValue(Math.abs(rounded));
  const signed = rounded > 0 ? `+${formatted}` : rounded < 0 ? `-${formatted}` : formatted;
  return `${signed}${unit ? ` ${unit}` : ""}`;
}

function formatValueWithUnit(value: number, unit: string | null | undefined): string {
  return `${formatMetricValue(value)}${unit ? ` ${unit}` : ""}`;
}

function formatTrendValue(value: number, unit: string | null | undefined): string {
  const rounded = roundMetric(value);
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(rounded) >= 100 ? 0 : 1,
  }).format(rounded);
  return `${formatted}${unit ? ` ${unit}` : ""}`;
}

function formatMetricValue(value: number): string {
  const rounded = roundMetric(value);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
  }).format(rounded);
}

function formatDateRange(startDate: string, endDate: string): string {
  const start = formatShortDate(startDate);
  const end = formatShortDate(endDate);
  return start === end ? start : `${start} – ${end}`;
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function resolveReferenceDate(results: BrowserVaultExperimentResultsView): string {
  const timeZone = results.schedule?.timeZone
    ?? results.experiment.runPlan.schedule?.timeZone
    ?? null;
  return timeZone
    ? formatIsoDateInTimeZone(results.asOf, timeZone)
    : extractIsoDate(results.asOf) ?? results.asOf.slice(0, 10);
}

function formatIsoDateInTimeZone(value: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    }).formatToParts(date);
    const byType = new Map(parts.map((part) => [part.type, part.value]));
    const year = byType.get("year");
    const month = byType.get("month");
    const day = byType.get("day");
    return year && month && day
      ? `${year}-${month}-${day}`
      : date.toISOString().slice(0, 10);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function daysBetweenInclusive(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T12:00:00.000Z`);
  const end = new Date(`${endDate}T12:00:00.000Z`);
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function extractIsoDate(value: string): string | null {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/u);
  return match?.[1] ?? null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string =>
    typeof value === "string" && value.length > 0
  ))];
}

function normalizeCount(value: number | null | undefined): number {
  return normalizeOptionalCount(value) ?? 0;
}

function normalizeOptionalCount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null;
}

function normalizeDayCount(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isOpenSourceStatus(value: string): boolean {
  return /^(active|in[\s_-]*progress|running|ongoing|open)$/u.test(
    value.trim().toLowerCase(),
  );
}

function formatCount(count: number, label: string): string | undefined {
  return count > 0 ? `${count} ${label}` : undefined;
}
