import {
  selectBrowserVaultExperimentResults,
  type BrowserVaultExperimentBiomarkerResult,
  type BrowserVaultExperimentExpectedRange,
  type BrowserVaultExperimentResultsLookup,
  type BrowserVaultExperimentResultsView,
  type BrowserVaultExperimentScheduleResult,
  type BrowserVaultQueryClient,
} from "@murphai/query/browser-experiments";

import type {
  ExperimentCommonsReference,
  ExperimentProtocolStep,
  ExperimentRunProjection,
  ExperimentStatus,
  ScheduleCell,
  ScheduleCellKind,
  ScheduleWeek,
  TimelineEvent,
  TrendData,
} from "@/src/types/experiments";
import { normalizeExperimentRunStatus } from "@/src/lib/browser-vault/experiment-status";
import { resolveBiomarkerDesiredDirection } from "@/src/lib/health-commons/biomarker-desired-direction";
import type { HealthCommonsBiomarkerDesiredDirection } from "@murphai/contracts";

export interface ResolveBrowserVaultExperimentRunInput {
  client: BrowserVaultQueryClient | null;
  protocol: BrowserVaultExperimentProtocol;
}

export interface BrowserVaultExperimentProtocol {
  baselineDays: number;
  commons?: ExperimentCommonsReference;
  durationDays: number;
  id: string;
  protocol: ExperimentProtocolStep[];
}

export function resolveBrowserVaultExperimentRun({
  client,
  protocol,
}: ResolveBrowserVaultExperimentRunInput): ExperimentRunProjection | null {
  if (!client) {
    return null;
  }

  const results = selectExperimentResultsForProtocol(client, protocol);
  if (!results) {
    return null;
  }

  return mapExperimentResultsProjection(client, protocol, results);
}

function selectExperimentResultsForProtocol(
  client: BrowserVaultQueryClient,
  protocol: BrowserVaultExperimentProtocol,
): BrowserVaultExperimentResultsView | null {
  for (const lookup of buildExperimentResultLookups(protocol)) {
    const result = selectBrowserVaultExperimentResults(client, lookup, {
      asOf: client.replica.generatedAt,
    });

    if (result) {
      return result;
    }
  }

  return null;
}

function mapExperimentResultsProjection(
  client: BrowserVaultQueryClient,
  protocol: BrowserVaultExperimentProtocol,
  results: BrowserVaultExperimentResultsView,
): ExperimentRunProjection {
  const { experiment } = results;
  const status = normalizePrivateRunStatus(results);
  const startedOn = experiment.windows.baselineStart ?? experiment.startedOn;
  const referenceDate = resolveResultsReferenceDate(results, client);
  const analysisAvailableOn = experiment.windows.interventionEnd ?? experiment.completedAt ?? undefined;
  const fallbackDurationDays = normalizeDayCount(protocol.durationDays, 1);
  const durationDays =
    startedOn && analysisAvailableOn
      ? Math.max(1, daysBetweenInclusive(startedOn, analysisAvailableOn))
      : fallbackDurationDays;
  const day = results.progress?.dayInRun ?? experiment.dayInRun ?? (startedOn
    ? clamp(daysBetweenInclusive(startedOn, referenceDate), 1, durationDays)
    : undefined);
  const completionPercent = status === "finished"
    ? 100
    : day
      ? clamp(Math.round((day / durationDays) * 100), 1, 99)
      : undefined;
  const tags = lookupExperimentTags(client, experiment.id, experiment.slug);
  const summary = buildRunSummary(results, status);
  const summaryDetail = buildRunSummaryDetail(results, status);

  return {
    id: experiment.id,
    source: "browser-vault",
    snapshotGeneratedAt: client.replica.generatedAt,
    slug: experiment.slug === experiment.id ? null : experiment.slug,
    status,
    statusLabel: formatStatusLabel(experiment.status, status, experiment.phase),
    startedOn,
    tags,
    title: experiment.title,
    day,
    completionPercent,
    dateRange: startedOn && analysisAvailableOn
      ? formatDateRange(startedOn, analysisAvailableOn)
      : undefined,
    analysisAvailableOn,
    signals: buildSignals(results),
    trends: buildTrends(client, results),
    timeline: buildPrivateRunTimeline({
      analysisAvailableOn,
      baselineDays: resolveResultBaselineDays(results, protocol),
      day,
      phase: experiment.phase,
      interventionStart: experiment.windows.interventionStart,
      referenceDate,
      startedOn,
      status,
    }),
    schedule: buildSchedule(results),
    sessionContext: buildSessionContext(results),
    nextStep: status === "active" || status === "paused"
      ? buildRunNextStep({
          baselineDays: resolveResultBaselineDays(results, protocol),
          day,
          progress: results.progress,
          protocol,
          status,
        })
      : undefined,
    summary,
    summaryDetail,
    conclusions: status === "finished"
      ? buildConclusions(results)
      : undefined,
  };
}

function buildExperimentResultLookups(
  protocol: BrowserVaultExperimentProtocol,
): BrowserVaultExperimentResultsLookup[] {
  const protocolKeys = buildProtocolLookupKeys(protocol);
  const slugCandidates = uniqueStrings([
    protocol.id,
    protocol.commons?.routeId,
    protocol.commons?.slug,
    protocol.commons?.key,
    protocol.commons?.key?.replace(/^protocol_variant:/u, ""),
    protocol.commons?.key?.replace(/^protocol:/u, ""),
    ...(protocol.commons?.aliases ?? []),
  ]);
  const lookups: BrowserVaultExperimentResultsLookup[] = [{
    protocolKeys,
    slug: protocol.id,
  }];

  for (const slug of slugCandidates) {
    lookups.push(slug);
    lookups.push({ protocolKeys, slug });
  }

  return dedupeLookups(lookups);
}

function buildProtocolLookupKeys(protocol: BrowserVaultExperimentProtocol): string[] {
  const values = uniqueStrings([
    protocol.id,
    protocol.commons?.key,
    protocol.commons?.routeId,
    protocol.commons?.slug,
    protocol.commons?.key?.replace(/^protocol_variant:/u, ""),
    protocol.commons?.key?.replace(/^protocol:/u, ""),
    ...(protocol.commons?.aliases ?? []),
  ]);
  const expanded: string[] = [];

  for (const value of values) {
    const normalized = normalizeLookupKey(value);
    const withoutPrefix = normalized.replace(/^protocol_variant:/u, "").replace(/^protocol:/u, "");
    const lastSegment = withoutPrefix.split("/").at(-1);

    expanded.push(value, normalized, withoutPrefix);

    if (lastSegment) {
      expanded.push(lastSegment, `protocol:${lastSegment}`, `protocol_variant:${withoutPrefix}`);
    }

    expanded.push(`protocol:${withoutPrefix}`, `protocol_variant:${withoutPrefix}`);
  }

  return uniqueStrings(expanded);
}

function dedupeLookups(
  lookups: readonly BrowserVaultExperimentResultsLookup[],
): BrowserVaultExperimentResultsLookup[] {
  const seen = new Set<string>();
  const deduped: BrowserVaultExperimentResultsLookup[] = [];

  for (const lookup of lookups) {
    const key = typeof lookup === "string"
      ? `string:${lookup}`
      : JSON.stringify({
          experimentId: lookup.experimentId ?? null,
          protocolKeys: lookup.protocolKeys ?? [],
          slug: lookup.slug ?? null,
        });

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(lookup);
  }

  return deduped;
}

function buildSignals(results: BrowserVaultExperimentResultsView): ExperimentRunProjection["signals"] {
  return results.biomarkers
    .filter(isRenderableBiomarker)
    .flatMap((biomarker) => {
      if (biomarker.deltaAbs === null) {
        return [];
      }

      const currentValue = readCurrentBiomarkerValue(biomarker);
      const unit = biomarker.unit ?? biomarker.intervention.unit ?? biomarker.baseline.unit ?? undefined;
      // A day-one reading against a multi-day baseline is noise, not a change.
      // Only present the delta once the replica classifies both windows as
      // having enough days (`completeness === "good"`).
      const showDelta = biomarker.completeness === "good";
      const direction = showDelta ? resolveSignalDirection(biomarker.deltaAbs) : "neutral";

      return [{
        label: biomarker.label,
        value: formatMetricValue(currentValue),
        unit,
        delta: showDelta ? formatDelta(biomarker.deltaAbs, unit) : "",
        direction,
        sentiment: showDelta
          ? resolveSignalSentiment(
              direction,
              resolveBiomarkerDesiredDirection(biomarker.biomarkerKey),
            )
          : undefined,
        baseline: biomarker.baseline.mean !== null
          ? formatValueWithUnit(biomarker.baseline.mean, unit)
          : undefined,
        expected: formatExpectedSignalText(biomarker) ?? "",
        protocolProminence: "focus",
      }];
    });
}

const HISTORY_LOOKBACK_DAYS = 30;

function buildTrends(
  client: BrowserVaultQueryClient,
  results: BrowserVaultExperimentResultsView,
): TrendData[] {
  const runStart = results.experiment.windows.baselineStart ?? results.experiment.startedOn;

  return results.biomarkers
    .filter(isRenderableBiomarker)
    .flatMap((biomarker) => {
      const currentValue = readCurrentBiomarkerValue(biomarker);
      const unit = biomarker.unit ?? biomarker.intervention.unit ?? biomarker.baseline.unit ?? "";

      if (!runStart || currentValue === null || biomarker.baseline.mean === null) {
        return [];
      }

      const baseline = biomarker.points
        .filter((point) => point.phase === "baseline")
        .map((point) => ({
          day: daysBetweenInclusive(runStart, point.date),
          value: roundMetric(point.value),
        }));
      const active = biomarker.points
        .filter((point) => point.phase === "intervention")
        .map((point) => ({
          day: daysBetweenInclusive(runStart, point.date),
          value: roundMetric(point.value),
        }));

      if (baseline.length === 0 && active.length === 0) {
        return [];
      }

      const history = buildHistoryPoints(client, biomarker, runStart);

      return [{
        label: biomarker.label,
        unit,
        startDate: runStart,
        history,
        baseline,
        active,
        expectedRange: buildExpectedRangePoints(biomarker, results.experiment),
        baselineAvg: roundMetric(biomarker.baseline.mean),
        currentValue: roundMetric(currentValue),
        delta: biomarker.deltaAbs === null || biomarker.completeness !== "good"
          ? ""
          : formatDelta(biomarker.deltaAbs, unit),
      }];
    });
}

function buildHistoryPoints(
  client: BrowserVaultQueryClient,
  biomarker: BrowserVaultExperimentBiomarkerResult,
  runStart: string,
): { day: number; value: number }[] {
  if (!biomarker.sourceMetric) {
    return [];
  }

  const historyStart = addDaysToIsoDate(runStart, -HISTORY_LOOKBACK_DAYS);
  const points: { day: number; value: number }[] = [];

  for (const row of client.metrics.series({ metricKey: biomarker.sourceMetric.metricKey })) {
    if (row.date >= runStart) break;
    if (row.date < historyStart) continue;
    if (typeof row.value !== "number" || !Number.isFinite(row.value)) continue;
    points.push({
      day: -daysBetweenInclusive(row.date, runStart) + 1,
      value: roundMetric(row.value),
    });
  }

  return points;
}

function buildExpectedRangePoints(
  biomarker: BrowserVaultExperimentBiomarkerResult,
  experiment: BrowserVaultExperimentResultsView["experiment"],
): TrendData["expectedRange"] | undefined {
  const range = biomarker.expectedEffect.expectedRange;
  const runStart = experiment.windows.baselineStart ?? experiment.startedOn;

  if (!range || range.sourceKeys.length === 0 || range.startDay > range.endDay || !runStart) {
    return undefined;
  }

  const points: NonNullable<TrendData["expectedRange"]> = [];
  const dayOffset = resolveExpectedRangeDayOffset(range, experiment, runStart);

  if (dayOffset === null) {
    return undefined;
  }

  for (let day = range.startDay; day <= range.endDay; day += 1) {
    const low = convertExpectedRangeValue(range.low, range, biomarker.baseline.mean);
    const high = convertExpectedRangeValue(range.high, range, biomarker.baseline.mean);

    if (low === null || high === null) {
      return undefined;
    }

    points.push({
      day: day + dayOffset,
      low: roundMetric(Math.min(low, high)),
      high: roundMetric(Math.max(low, high)),
    });
  }

  return points.length > 0 ? points : undefined;
}

function resolveExpectedRangeDayOffset(
  range: BrowserVaultExperimentExpectedRange,
  experiment: BrowserVaultExperimentResultsView["experiment"],
  runStart: string,
): number | null {
  if (range.dayOrigin === "run") {
    return 0;
  }

  const interventionStart = experiment.windows.interventionStart;
  if (!interventionStart) {
    return null;
  }

  return daysBetweenInclusive(runStart, interventionStart) - 1;
}

function convertExpectedRangeValue(
  value: number,
  range: BrowserVaultExperimentExpectedRange,
  baselineMean: number | null,
): number | null {
  if (range.scale === "absolute") {
    return value;
  }

  if (baselineMean === null) {
    return null;
  }

  if (range.scale === "delta") {
    return baselineMean + value;
  }

  return baselineMean * (1 + value / 100);
}

function buildSchedule(
  results: BrowserVaultExperimentResultsView,
): ExperimentRunProjection["schedule"] {
  const schedule = results.schedule;
  const windows = results.experiment.windows;
  const firstCellDate = schedule?.cells[0]?.localDate ?? null;
  const lastCellDate = schedule?.cells.at(-1)?.localDate ?? null;
  const startDate = minIsoDate(windows.baselineStart, windows.interventionStart, firstCellDate);
  const endDate = maxIsoDate(windows.baselineEnd, windows.interventionEnd, lastCellDate);

  if (!startDate || !endDate) {
    return undefined;
  }

  const todayLocalDate = schedule
    ? formatIsoDateInTimeZone(results.asOf, schedule.timeZone)
    : results.asOf.slice(0, 10);

  const weeks = buildScheduleWeeks({
    baselineEnd: windows.baselineEnd,
    baselineStart: windows.baselineStart,
    endDate,
    interventionStart: windows.interventionStart,
    schedule,
    startDate,
    todayLocalDate,
  });

  return {
    cadence: formatScheduleCadence(results),
    dose: formatScheduleDose(results),
    loggedSessions: results.progress?.adherence.loggedSessions ?? schedule?.completedSessions,
    weeks,
  };
}

function buildSessionContext(
  results: BrowserVaultExperimentResultsView,
): ExperimentRunProjection["sessionContext"] {
  const entries = results.context;

  if (entries.length === 0) {
    return undefined;
  }

  return entries.map((entry) => ({
    confounders: entry.confounders.slice(),
    date: entry.date,
    id: entry.id,
    kind: entry.kind,
    note: entry.note ?? undefined,
    symptoms: entry.symptoms.slice(),
  }));
}

function buildScheduleWeeks(input: {
  baselineEnd: string | null;
  baselineStart: string | null;
  endDate: string;
  interventionStart: string | null;
  schedule: BrowserVaultExperimentScheduleResult | null;
  startDate: string;
  todayLocalDate: string;
}): ScheduleWeek[] {
  const scheduleByDate = input.schedule
    ? groupScheduleCellsByDate(input.schedule.cells)
    : new Map<string, BrowserVaultExperimentScheduleResult["cells"]>();
  const weeks: ScheduleWeek[] = [];
  let protocolWeekIndex = 1;

  for (
    let weekStart = input.startDate;
    weekStart <= input.endDate;
    weekStart = addDaysToIsoDate(weekStart, 7)
  ) {
    const weekEnd = minIsoDate(addDaysToIsoDate(weekStart, 6), input.endDate) ?? input.endDate;
    const cells: ScheduleCell[] = dateRange(weekStart, weekEnd).flatMap<ScheduleCell>((date) => {
      const scheduledCells = scheduleByDate.get(date) ?? [];
      const baselineKind = resolveScheduleCellKind({
        baselineEnd: input.baselineEnd,
        baselineStart: input.baselineStart,
        date,
        todayLocalDate: input.todayLocalDate,
      });

      if (baselineKind) {
        return [{
          columnStart: isoDateWeekdayColumn(date),
          dayLabel: formatWeekday(date),
          date: formatShortDate(date),
          kind: baselineKind,
          detail: formatScheduleCellDetail(baselineKind),
          isToday: date === input.todayLocalDate,
        } satisfies ScheduleCell];
      }

      if (scheduledCells.length === 0) {
        const isIntervention = input.interventionStart && date >= input.interventionStart;
        if (!isIntervention) {
          return [];
        }
        const kind: ScheduleCellKind = date >= input.todayLocalDate ? "scheduled" : "missed";
        return [{
          columnStart: isoDateWeekdayColumn(date),
          dayLabel: formatWeekday(date),
          date: formatShortDate(date),
          kind,
          detail: formatScheduleCellDetail(kind),
          isToday: date === input.todayLocalDate,
        } satisfies ScheduleCell];
      }

      return scheduledCells.map((scheduledCell): ScheduleCell => ({
        columnStart: isoDateWeekdayColumn(date),
        dayLabel: formatWeekday(date),
        date: formatShortDate(date),
        kind: scheduledCell.kind,
        detail: formatScheduleCellDetail(scheduledCell.kind, scheduledCell),
        isToday: date === input.todayLocalDate,
      } satisfies ScheduleCell));
    });

    const isPreProtocolWeek = input.interventionStart
      ? weekEnd < input.interventionStart
      : cells.every((cell) => cell.kind === "baseline");

    if (cells.length > 0) {
      weeks.push({
        label: isPreProtocolWeek ? "Baseline" : `Week ${protocolWeekIndex}`,
        dateRange: formatDateRange(weekStart, weekEnd),
        summary: isPreProtocolWeek ? "Baseline window" : summarizeScheduleWeek(cells),
        cells,
      });
    }
    if (!isPreProtocolWeek) {
      protocolWeekIndex += 1;
    }
  }

  return weeks;
}

function groupScheduleCellsByDate(
  cells: readonly BrowserVaultExperimentScheduleResult["cells"][number][],
): Map<string, BrowserVaultExperimentScheduleResult["cells"]> {
  const byDate = new Map<string, BrowserVaultExperimentScheduleResult["cells"]>();
  for (const cell of cells) {
    const existing = byDate.get(cell.localDate) ?? [];
    existing.push(cell);
    byDate.set(cell.localDate, existing);
  }
  return byDate;
}

function resolveScheduleCellKind(input: {
  baselineEnd: string | null;
  baselineStart: string | null;
  date: string;
  todayLocalDate: string;
}): ScheduleCellKind | null {
  if (dateInRange(input.date, input.baselineStart, input.baselineEnd)) {
    return "baseline";
  }
  return null;
}

function isoDateWeekdayColumn(value: string): number {
  const day = new Date(`${value}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function formatScheduleCellDetail(
  kind: ScheduleCellKind,
  scheduledCell?: BrowserVaultExperimentScheduleResult["cells"][number],
): string | undefined {
  switch (kind) {
    case "completed":
      return "Done";
    case "partial":
      return "Partial";
    case "missed":
      return "Not logged";
    case "failed":
      return "Not met";
    case "unknown":
      return "Unknown";
    case "scheduled":
      return scheduledCell?.localTime ?? undefined;
    default:
      return undefined;
  }
}

function summarizeScheduleWeek(cells: readonly ScheduleCell[]): string | undefined {
  if (cells.length === 0) {
    return undefined;
  }

  if (cells.every((cell) => cell.kind === "baseline")) {
    return "Baseline window";
  }

  const parts = [
    formatCount(countScheduleCells(cells, "completed"), "done"),
    formatCount(countScheduleCells(cells, "partial"), "partial"),
    formatCount(countScheduleCells(cells, "missed"), "not logged"),
    formatCount(countScheduleCells(cells, "failed"), "not met"),
    formatCount(countScheduleCells(cells, "unknown"), "unknown"),
    formatCount(countScheduleCells(cells, "scheduled"), "scheduled"),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function readTargetCountPerDay(
  calendar: BrowserVaultExperimentResultsView["experiment"]["runPlan"]["adherenceTargets"][number]["calendar"],
): number {
  switch (calendar.kind) {
    case "daily":
    case "weekdays":
      return calendar.targetCountPerDay ?? 1;
    case "explicitDates":
      return Math.max(1, ...calendar.dates.map((date) => date.targetCount ?? 1));
  }
}

function formatScheduleCadence(results: BrowserVaultExperimentResultsView): string {
  const adherenceTarget = results.experiment.runPlan.adherenceTargets[0];
  if (adherenceTarget) {
    const targetCount = readTargetCountPerDay(adherenceTarget.calendar);
    const countPrefix = targetCount > 1 ? `${targetCount}x ` : "";
    if (adherenceTarget.calendar.kind === "daily") {
      return `${countPrefix}Daily${adherenceTarget.calendar.localTime ? ` at ${adherenceTarget.calendar.localTime}` : ""}`;
    }
    if (adherenceTarget.calendar.kind === "weekdays") {
      return `${countPrefix}${adherenceTarget.calendar.weekdays.map(formatWeekdayName).join(", ")}${
        adherenceTarget.calendar.localTime ? ` at ${adherenceTarget.calendar.localTime}` : ""
      }`;
    }
    return `${adherenceTarget.label} target`;
  }

  const schedule = results.experiment.runPlan.schedule;
  if (!schedule) {
    return "Logged days";
  }

  if (schedule.kind === "dailyLocal") {
    return `Daily at ${schedule.localTime}`;
  }

  const cron = parseSimpleCronSchedule(schedule.expression);
  if (cron) {
    return `${cron.weekdays.join(", ")} at ${cron.localTime}`;
  }

  return "Structured run schedule";
}

function formatScheduleDose(results: BrowserVaultExperimentResultsView): string | undefined {
  const schedule = results.schedule;
  const adherenceTarget = results.experiment.runPlan.adherenceTargets[0];
  const target =
    adherenceTarget?.rollup?.targetCompletions ??
    results.experiment.runPlan.targetSessions;
  const minimum =
    adherenceTarget?.rollup?.minimumUsefulCompletions ??
    results.experiment.runPlan.minimumUsefulSessions;

  if (!schedule && target === null && minimum === null) {
    return undefined;
  }

  const parts = [
    target !== null ? `${target} planned` : undefined,
    minimum !== null ? `${minimum} minimum useful` : undefined,
    schedule ? formatCount(schedule.completedSessions, "done") : undefined,
    schedule ? formatCount(schedule.partialSessions, "partial") : undefined,
    schedule ? formatCount(schedule.missedSessions, "not logged") : undefined,
    schedule ? formatCount(schedule.failedSessions, "not met") : undefined,
    schedule ? formatCount(schedule.unknownSessions, "unknown") : undefined,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function buildRunSummary(
  results: BrowserVaultExperimentResultsView,
  status: Exclude<ExperimentStatus, "upcoming">,
): string | undefined {
  const primary = firstRenderableBiomarker(results.biomarkers);

  if (status === "finished") {
    if (!primary || primary.deltaAbs === null || primary.completeness !== "good") {
      return "Private run recorded";
    }

    return `${primary.label} changed by ${formatDelta(primary.deltaAbs, primary.unit ?? undefined)}.`;
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
    ? ` with ${adherence.loggedSessions} logged target${adherence.loggedSessions === 1 ? "" : "s"}`
    : "";

  return `${phaseLabel}${adherencePart}: ${primary.label} is ${formatDelta(primary.deltaAbs, primary.unit ?? undefined)} from baseline.`;
}

function buildRunSummaryDetail(
  results: BrowserVaultExperimentResultsView,
  status: Exclude<ExperimentStatus, "upcoming">,
): string | undefined {
  const caveats = buildBiomarkerCaveats(results.biomarkers);
  const coverage = results.progress?.dataCoverage;
  const adherence = results.progress?.adherence;
  const outcome = results.outcome;
  const details: string[] = [];

  if (status === "finished") {
    if (outcome) {
      details.push(`Outcome confidence is ${outcome.confidence.level}.`);
      details.push(...outcome.confidence.reasons);
    } else {
      details.push("The browser-vault snapshot has the finished run, but no outcome window is ready yet.");
    }
  } else if (coverage) {
    details.push(`Coverage is ${coverage.status.replaceAll("_", " ")} for the primary signal.`);
  }

  if (adherence) {
    details.push(formatAdherenceDetail(adherence));
  }

  details.push(...caveats);

  return details.filter(Boolean).join(" ");
}

function buildConclusions(
  results: BrowserVaultExperimentResultsView,
): ExperimentRunProjection["conclusions"] {
  const primary = firstRenderableBiomarker(results.biomarkers);
  const outcome = results.outcome;
  const caveats = buildBiomarkerCaveats(results.biomarkers);
  const sections: NonNullable<ExperimentRunProjection["conclusions"]> = [];

  if (primary && primary.deltaAbs !== null && primary.completeness === "good") {
    sections.push({
      title: "What changed",
      variant: primary.movedAsExpected === false ? "neutral" : "positive",
      items: [{
        icon: primary.movedAsExpected === false ? "→" : "check",
        text: `${primary.label} moved ${formatDelta(primary.deltaAbs, primary.unit ?? undefined)} from the baseline window.`,
      }],
    });
  }

  const limits = [
    ...(outcome?.confidence.reasons ?? []),
    ...caveats,
  ];
  if (limits.length > 0) {
    sections.push({
      title: "What limits the read",
      variant: "insight",
      items: limits.map((text) => ({ icon: "→", text })),
    });
  }

  if (sections.length === 0) {
    sections.push({
      title: "What we can say right now",
      variant: "insight",
      items: [{
        icon: "→",
        text: "The private run is present, but the browser-vault snapshot does not contain enough metric data for a before-and-after conclusion yet.",
      }],
    });
  }

  sections.push({
    title: "What to do with this",
    variant: "recommendation",
    items: [{
      icon: "arrow",
      text: outcome?.status === "enough_data"
        ? "Use this as an N-of-1 result tied to this protocol revision; repeat or extend only if the burden still fits ordinary life."
        : "Treat this run as context, not a conclusion; repeat with steadier measurement if this protocol still seems worth testing.",
    }],
  });

  return sections;
}

function buildBiomarkerCaveats(
  biomarkers: readonly BrowserVaultExperimentBiomarkerResult[],
): string[] {
  return biomarkers
    .filter((biomarker) => biomarker.status !== "available")
    .map((biomarker) => `${biomarker.label}: ${biomarker.statusReason}`);
}

function firstRenderableBiomarker(
  biomarkers: readonly BrowserVaultExperimentBiomarkerResult[],
): BrowserVaultExperimentBiomarkerResult | null {
  return biomarkers.find(isRenderableBiomarker) ?? null;
}

function isRenderableBiomarker(
  biomarker: BrowserVaultExperimentBiomarkerResult,
): boolean {
  return biomarker.status === "available" && readCurrentBiomarkerValue(biomarker) !== null;
}

function readCurrentBiomarkerValue(
  biomarker: BrowserVaultExperimentBiomarkerResult,
): number | null {
  const latestPoint = biomarker.points.at(-1);
  return biomarker.intervention.mean ?? latestPoint?.value ?? biomarker.baseline.mean;
}

function normalizePrivateRunStatus(
  results: BrowserVaultExperimentResultsView,
): ReturnType<typeof normalizeExperimentRunStatus> {
  return normalizeExperimentRunStatus({
    phase: results.experiment.phase,
    startedOn: results.experiment.startedOn,
    status: results.experiment.status,
  });
}

function buildRunNextStep(input: {
  baselineDays: number;
  day: number | undefined;
  progress: BrowserVaultExperimentResultsView["progress"];
  protocol: BrowserVaultExperimentProtocol;
  status: "active" | "paused";
}): ExperimentRunProjection["nextStep"] {
  const day = input.day ?? 1;
  const inBaseline = input.baselineDays > 0 && day <= input.baselineDays;
  const adherence = input.progress?.adherence;

  if (input.status === "paused") {
    const activeDay = Math.max(1, day - input.baselineDays);

    return {
      title: inBaseline ? "Resume when ready" : "Resume the protocol",
      when: inBaseline
        ? `Paused during baseline day ${day} of ${input.baselineDays}`
        : `Paused on day ${activeDay}`,
      instructions: inBaseline
        ? "Resume the run when you're ready. Keeping the baseline steady makes the later comparison easier to trust."
        : input.protocol.protocol.find((step) => /session|protocol|complete/iu.test(step.detail))?.detail
          ?? input.protocol.protocol[0]?.detail
          ?? "Resume the protocol when you're ready and keep the rest of the week ordinary.",
      context: inBaseline
        ? "The run exists in your browser vault, but the active protocol window has not started yet."
        : "Murph kept the private run state, but the protocol is paused until you resume it.",
    };
  }

  if (inBaseline) {
    return {
      title: "Keep the baseline clean",
      when: `Baseline day ${day} of ${input.baselineDays}`,
      instructions: "Avoid adding a second new protocol so the before-and-after comparison stays readable.",
      context: "The protocol instructions are ready below; the private run is still gathering baseline context.",
    };
  }

  return {
    title: adherence?.status === "behind" ? "Recover the cadence" : "Continue the protocol",
    when: `Day ${day}`,
    instructions: input.protocol.protocol.find((step) => /session|protocol|complete/iu.test(step.detail))?.detail
      ?? input.protocol.protocol[0]?.detail
      ?? "Follow the protocol steps and keep the rest of the week ordinary.",
    context: adherence
      ? formatAdherenceDetail(adherence)
      : "Personal outcome analysis becomes useful after the protocol window closes and enough follow-up evidence is available.",
  };
}

function resolveResultBaselineDays(
  results: BrowserVaultExperimentResultsView,
  protocol: BrowserVaultExperimentProtocol,
): number {
  const baselineStart = results.experiment.windows.baselineStart;
  const baselineEnd = results.experiment.windows.baselineEnd;
  const protocolDurationDays = normalizeDayCount(protocol.durationDays, 1);

  if (baselineStart && baselineEnd) {
    return Math.max(0, Math.min(daysBetweenInclusive(baselineStart, baselineEnd), protocolDurationDays - 1));
  }

  return Math.min(
    normalizeDayCount(protocol.baselineDays, 0),
    Math.max(0, protocolDurationDays - 1),
  );
}

function buildPrivateRunTimeline(input: {
  analysisAvailableOn: string | undefined;
  baselineDays: number;
  day: number | undefined;
  phase: BrowserVaultExperimentResultsView["experiment"]["phase"];
  interventionStart: string | null;
  referenceDate: string;
  startedOn: string | null;
  status: Exclude<ExperimentStatus, "upcoming">;
}): TimelineEvent[] {
  if (!input.startedOn) {
    return [];
  }

  const events: TimelineEvent[] = [{
    date: formatShortDate(input.startedOn),
    label: "Start",
    title: input.baselineDays > 0 ? "Baseline started" : "Experiment started",
    description: input.baselineDays > 0
      ? `${input.baselineDays} baseline days before the protocol window.`
      : "The private run is linked to this protocol.",
    variant: "primary",
  }];

  if (input.baselineDays > 0) {
    const protocolStart = input.interventionStart ?? addDaysToIsoDate(input.startedOn, input.baselineDays);
    events.push({
      date: formatShortDate(protocolStart),
      label: "Protocol",
      title: "Protocol window starts",
      description: "Begin the protocol while keeping other variables as steady as practical.",
      variant: input.referenceDate >= protocolStart ? "primary" : "outline",
      upcoming: input.referenceDate < protocolStart,
    });
  }

  if (input.status === "active") {
    events.push({
      date: formatShortDate(input.referenceDate),
      label: input.day ? `Day ${input.day}` : "Now",
      title: formatProgressPhase(input.phase),
      description: "Murph has the private run state; Results update from the current browser-vault snapshot.",
      variant: "default",
    });

    if (input.analysisAvailableOn) {
      events.push({
        date: formatShortDate(input.analysisAvailableOn),
        label: "Review",
        title: "Analysis window",
        description: "Compare baseline and protocol periods after the window closes.",
        upcoming: true,
        variant: "outline",
      });
    }
  } else if (input.status === "paused") {
    events.push({
      date: formatShortDate(input.referenceDate),
      label: input.day ? `Day ${input.day}` : "Paused",
      title: "Private run paused",
      description: "The run is still present in your browser vault, but the protocol is paused for now.",
      variant: "muted",
    });
  } else if (input.status === "stopped") {
    events.push({
      date: formatShortDate(input.referenceDate),
      label: "Stopped",
      title: "Private run stopped",
      description: "The run remains in your browser vault, but it was marked stopped before a browser-vault outcome comparison was ready.",
      variant: "muted",
    });
  } else if (input.analysisAvailableOn) {
    events.push({
      date: formatShortDate(input.analysisAvailableOn),
      label: "Finished",
      title: "Experiment window complete",
      description: "The private run is marked finished in the browser-vault snapshot.",
      variant: "primary",
    });
  }

  return events.map((event, index) => ({
    ...event,
    last: index === events.length - 1,
  }));
}

function lookupExperimentTags(
  client: BrowserVaultQueryClient,
  id: string,
  slug: string | null,
): string[] {
  const entity = client.entities.get(id) ?? (slug ? client.entities.get(slug) : null);
  return entity?.tags.slice() ?? [];
}

function formatStatusLabel(
  sourceStatus: string | null,
  normalizedStatus: Exclude<ExperimentStatus, "upcoming">,
  phase: BrowserVaultExperimentResultsView["experiment"]["phase"],
): string {
  const normalizedLabel = formatNormalizedStatusLabel(normalizedStatus, phase);

  if (!sourceStatus) {
    return normalizedLabel;
  }

  if (isOpenSourceStatus(sourceStatus) && normalizedStatus !== "active") {
    return normalizedLabel;
  }

  return sourceStatus
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^./u, (match) => match.toUpperCase());
}

function formatNormalizedStatusLabel(
  normalizedStatus: Exclude<ExperimentStatus, "upcoming">,
  phase: BrowserVaultExperimentResultsView["experiment"]["phase"],
): string {
  if (normalizedStatus === "active") {
    return "Active";
  }

  if (normalizedStatus === "paused") {
    return "Paused";
  }

  if (normalizedStatus === "stopped") {
    return "Stopped";
  }

  return phase === "review_due" ? "Review due" : "Finished";
}

function isOpenSourceStatus(sourceStatus: string): boolean {
  return /^(active|in[\s_-]*progress|running|ongoing|open)$/u.test(
    sourceStatus.trim().toLowerCase(),
  );
}

function formatProgressPhase(
  phase: BrowserVaultExperimentResultsView["experiment"]["phase"],
): string {
  switch (phase) {
    case "planned":
      return "Planned";
    case "baseline":
      return "Baseline";
    case "intervention":
      return "Protocol";
    case "review_due":
      return "Review due";
    case "completed":
      return "Completed";
    case "paused":
      return "Paused";
    case "abandoned":
      return "Stopped";
  }
}

function formatAdherenceDetail(
  adherence: NonNullable<BrowserVaultExperimentResultsView["progress"]>["adherence"],
): string {
  const parts = [
    `${adherence.loggedSessions} logged`,
    formatCount(adherence.partialSessions, "partial"),
    formatCount(adherence.missedSessions, "not logged"),
    adherence.targetSessions !== null ? `${adherence.targetSessions} target` : undefined,
  ].filter((part): part is string => Boolean(part));

  return `Adherence is ${adherence.status.replaceAll("_", " ")} (${parts.join(" · ")}).`;
}

function formatExpectedSignalText(
  biomarker: BrowserVaultExperimentBiomarkerResult,
): string | undefined {
  const range = biomarker.expectedEffect.expectedRange;
  if (range && range.sourceKeys.length > 0) {
    const measuredUnit = biomarker.unit ?? biomarker.intervention.unit ?? biomarker.baseline.unit;
    return formatExpectedRange(range, biomarker.baseline.mean, measuredUnit);
  }

  return biomarker.expectedEffect.description ?? undefined;
}

function formatExpectedRange(
  range: BrowserVaultExperimentExpectedRange,
  baselineMean: number | null,
  measuredUnit: string | null,
): string {
  const low = convertExpectedRangeValue(range.low, range, baselineMean);
  const high = convertExpectedRangeValue(range.high, range, baselineMean);

  if (low === null || high === null) {
    return `${formatSignedNumber(range.low)} to ${formatSignedNumber(range.high)} ${range.unit ?? ""}`.trim();
  }

  const unit = range.scale === "absolute" ? range.unit : measuredUnit;
  return [
    `${formatMetricValue(Math.min(low, high))} to ${formatMetricValue(Math.max(low, high))}`,
    unit ?? "",
  ].join(" ").trim();
}

function resolveSignalDirection(
  deltaAbs: number | null,
): "up" | "down" | "neutral" {
  if (deltaAbs === null || deltaAbs === 0) {
    return "neutral";
  }

  return deltaAbs > 0 ? "up" : "down";
}

function resolveSignalSentiment(
  direction: "up" | "down" | "neutral",
  desiredDirection: HealthCommonsBiomarkerDesiredDirection | null,
): "positive" | "negative" | "neutral" {
  if (direction === "neutral" || !desiredDirection) {
    return "neutral";
  }

  if (desiredDirection === "mixed_or_contextual" || desiredDirection === "stable") {
    return "neutral";
  }

  const movingInDesiredDirection =
    (direction === "up" && (desiredDirection === "higher" || desiredDirection === "higher_or_stable")) ||
    (direction === "down" && (desiredDirection === "lower" || desiredDirection === "lower_or_stable"));

  return movingInDesiredDirection ? "positive" : "negative";
}

function formatDelta(value: number, unit: string | null | undefined): string {
  return `${formatSignedNumber(roundMetric(value))}${unit ? ` ${unit}` : ""}`;
}

function formatValueWithUnit(value: number, unit: string | null | undefined): string {
  return `${formatMetricValue(value)}${unit ? ` ${unit}` : ""}`;
}

function formatMetricValue(value: number | null): string {
  if (value === null) {
    return "—";
  }

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
  }).format(roundMetric(value));
}

function formatSignedNumber(value: number): string {
  const formatted = formatMetricValue(Math.abs(value));
  if (value > 0) {
    return `+${formatted}`;
  }

  if (value < 0) {
    return `-${formatted}`;
  }

  return formatted;
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10;
}

function parseSimpleCronSchedule(expression: string): { localTime: string; weekdays: string[] } | null {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = expression.trim().split(/\s+/u);

  if (
    minute === undefined ||
    hour === undefined ||
    dayOfMonth !== "*" ||
    month !== "*" ||
    dayOfWeek === undefined ||
    !/^\d+$/u.test(minute) ||
    !/^\d+$/u.test(hour)
  ) {
    return null;
  }

  const parsedMinute = Number(minute);
  const parsedHour = Number(hour);
  if (
    !Number.isInteger(parsedMinute) ||
    !Number.isInteger(parsedHour) ||
    parsedMinute < 0 ||
    parsedMinute > 59 ||
    parsedHour < 0 ||
    parsedHour > 23
  ) {
    return null;
  }

  const weekdays = dayOfWeek.split(",").flatMap((value) => {
    if (!/^[0-7]$/u.test(value)) {
      return [];
    }

    return [formatWeekdayName(Number(value) === 7 ? 0 : Number(value))];
  });

  return weekdays.length > 0
    ? { localTime: `${pad2(parsedHour)}:${pad2(parsedMinute)}`, weekdays }
    : null;
}

function formatWeekdayName(day: number): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day] ?? "Day";
}

function formatCount(count: number, label: string): string | undefined {
  return count > 0 ? `${count} ${label}` : undefined;
}

function countScheduleCells(cells: readonly ScheduleCell[], kind: ScheduleCellKind): number {
  return cells.filter((cell) => cell.kind === kind).length;
}

function extractIsoDate(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const normalized = value.trim();
  const directMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})/u);
  if (directMatch) {
    return directMatch[1];
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveResultsReferenceDate(
  results: BrowserVaultExperimentResultsView,
  client: BrowserVaultQueryClient,
): string {
  const timeZone = results.schedule?.timeZone ?? results.experiment.runPlan.schedule?.timeZone ?? null;

  if (timeZone) {
    return formatIsoDateInTimeZone(results.asOf, timeZone);
  }

  return extractIsoDate(results.asOf) ?? extractIsoDate(client.replica.generatedAt) ?? todayIsoDate();
}

function daysBetweenInclusive(startDate: string, endDate: string): number {
  const start = parseIsoDateAsUtcNoon(startDate);
  const end = parseIsoDateAsUtcNoon(endDate);
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function dateRange(startDate: string, endDate: string): string[] {
  const values: string[] = [];

  for (
    let cursor = startDate;
    cursor <= endDate;
    cursor = addDaysToIsoDate(cursor, 1)
  ) {
    values.push(cursor);
  }

  return values;
}

function addDaysToIsoDate(value: string, days: number): string {
  const date = parseIsoDateAsUtcNoon(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseIsoDateAsUtcNoon(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

function normalizeDayCount(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.trunc(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dateInRange(date: string | null, start: string | null, end: string | null): boolean {
  if (!date || !start || !end) {
    return false;
  }

  return date >= start && date <= end;
}

function minIsoDate(...values: Array<string | null | undefined>): string | null {
  const dates = values.filter((value): value is string => typeof value === "string" && value.length > 0);
  return dates.length > 0 ? dates.reduce((min, value) => value < min ? value : min) : null;
}

function maxIsoDate(...values: Array<string | null | undefined>): string | null {
  const dates = values.filter((value): value is string => typeof value === "string" && value.length > 0);
  return dates.length > 0 ? dates.reduce((max, value) => value > max ? value : max) : null;
}

function formatDateRange(startDate: string, endDate: string): string {
  const start = formatShortDate(startDate);
  const end = formatShortDate(endDate);

  return start === end ? start : `${start} – ${end}`;
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(parseIsoDateAsUtcNoon(value));
}

function formatWeekday(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
  }).format(parseIsoDateAsUtcNoon(value));
}

function formatIsoDateInTimeZone(value: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return extractIsoDate(value) ?? todayIsoDate();
  }

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

  if (!year || !month || !day) {
    return extractIsoDate(value) ?? todayIsoDate();
  }

  return `${year}-${month}-${day}`;
}

function normalizeLookupKey(value: string | null | undefined): string {
  return typeof value === "string"
    ? value.trim().toLowerCase()
    : "";
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
