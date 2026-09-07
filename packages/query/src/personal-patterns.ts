import {
  isValidIanaTimeZone,
  JUNCTION_WEARABLE_TAG_EXTERNAL_REF_FACET,
  JUNCTION_WEARABLE_TAG_NOTE_TYPE,
  normalizeActivityKindToken,
} from "@murphai/contracts";

import type { CanonicalEntity } from "./canonical-entities.ts";
import {
  resolveAdherenceObservationActivityKind,
  resolveActivityEvidenceLocalDate,
  resolveInterventionSessionLocalDate,
} from "./experiment-adherence.ts";
import { selectMetricSeries, type MetricPoint } from "./metrics/index.ts";
import { matchPersonalPatternDates } from "./personal-pattern-matching.ts";
import type { VaultReadModel } from "./read-model.ts";
import { buildWearableSummaryBundle } from "./wearables.ts";
import type {
  WearableResolvedMetric,
  WearableSummaryBundle,
} from "./wearables.ts";
import {
  isWearableSleepPatternEligibleNight,
  resolveWearableSleepAnalysisDate,
} from "./wearables/sleep-pattern.ts";

const DEFAULT_WINDOW_DAYS = 120;
const MAX_REPORT_FACTORS = 100;
export const PERSONAL_PATTERN_VOCABULARY_SLUG =
  "journal-pattern-vocabulary";
const MIN_OUTCOME_DAYS = 2;
const COMPARISON_SEARCH_DAYS = 35;
// Product-owned and intentionally fail-closed. A new provider tag requires
// explicit product evidence before it can acquire action semantics here.
const PERSONAL_PATTERN_OURA_ACTION_TAG = "sauna";
const JUNCTION_NOTE_RESOURCE_TYPE_PATTERN =
  /^junction-[a-z0-9]+(?:-[a-z0-9]+)*-note$/u;
const OUTCOME_LIKE_FACTOR_TOKENS = new Set([
  "heart-rate-variability",
  "hrv",
  "deep-sleep",
  "deep-sleep-minutes",
  "readiness",
  "readiness-score",
  "recovery",
  "recovery-score",
  "resting-heart-rate",
  "respiratory-rate",
  "rem-sleep",
  "rem-sleep-minutes",
  "rhr",
  "sleep",
  "sleep-efficiency",
  "sleep-score",
  "spo2",
  "total-sleep",
]);
const BOUNDED_FACTOR_DETAIL_TAGS = new Set([
  "amount-high",
  "amount-low",
  "amount-moderate",
  "timing-afternoon",
  "timing-evening",
  "timing-late",
  "timing-morning",
]);

export type PersonalPatternStage =
  | "insufficient"
  | "no_clear_pattern"
  | "new_clue"
  | "seen_again"
  | "worth_testing";

export type PersonalPatternGrade = "A" | "B" | "C" | "D" | "E";
export type PersonalPatternClassification =
  | "observation"
  | "early_signal"
  | "pattern";

export interface PersonalPatternFactor {
  id: string;
  icon?: PersonalPatternIcon;
  kind: "activity" | "intervention" | "mixed";
  label: string;
  observedDays: number;
  confirmedAbsentDays?: number;
  episodeCount?: number;
}

export type PersonalPatternIcon =
  | "activity"
  | "alcohol"
  | "bed"
  | "caffeine"
  | "cycling"
  | "dance"
  | "meal"
  | "medication"
  | "mind-body"
  | "recovery"
  | "red-light"
  | "running"
  | "strength"
  | "swimming"
  | "travel"
  | "walking"
  | "wellness";

export interface PersonalPatternVocabularyConcept {
  aliases: string[];
  icon: PersonalPatternIcon;
  id: string;
  label: string;
}

export interface PersonalPatternVocabulary {
  concepts: PersonalPatternVocabularyConcept[];
  version: 1;
}

export interface PersonalPatternOutcome {
  id: string;
  label: string;
  lagDays?: 0 | 1;
  unit: string;
}

export interface PersonalPatternCell {
  classification?: PersonalPatternClassification | null;
  comparisonBasis?: "confirmed_absence" | "unobserved_baseline";
  comparisonDates?: string[];
  comparisonDays: number;
  comparisonMean: number | null;
  delta: number | null;
  deltaPercent: number | null;
  direction: "higher" | "lower" | "flat";
  exposedDays: number;
  exposedMean: number | null;
  factorId: string;
  firstExposedDate: string | null;
  grade?: PersonalPatternGrade | null;
  lastExposedDate: string | null;
  outcomeId: string;
  exposedDates?: string[];
  repeatedDirection: boolean;
  stage: PersonalPatternStage;
}

export interface PersonalPatternReport {
  asOfDate: string;
  cells: PersonalPatternCell[];
  factors: PersonalPatternFactor[];
  lagDays: 1;
  notes: string[];
  outcomes: PersonalPatternOutcome[];
  repeatableCellCount: number;
  testedCellCount: number;
  windowDays: number;
}

interface FactorAccumulator {
  absentDates: Set<string>;
  dates: Set<string>;
  episodeDates: Map<string, Set<string>>;
  implicitAbsenceAllowed: boolean;
  kinds: Set<"activity" | "intervention">;
  token: string;
}

interface FactorCandidate {
  date: string;
  episodeId: string;
  implicitAbsenceAllowed: boolean;
  kind: "activity" | "intervention";
  state: "absent" | "observed";
  token: string;
}

interface OutcomeSeries extends PersonalPatternOutcome {
  lagDays: 0 | 1;
  values: Map<string, number>;
  meaningfulAbsoluteDelta: number;
  meaningfulRelativeDelta: number;
}

interface MatchedPair {
  comparisonDates: string[];
  comparisonValue: number;
  exposedDates: string[];
  exposedValue: number;
}

interface PatternWindow {
  fromDate: string;
  outcomeToDate: string;
}

export function buildPersonalPatternReport(
  vault: VaultReadModel,
  options: {
    asOf?: Date | string;
    vocabulary?: PersonalPatternVocabulary | null;
    windowDays?: number;
  } = {},
): PersonalPatternReport {
  return buildPersonalPatternReportFromWearableBundle(
    vault,
    buildWearableSummaryBundle(vault),
    options,
  );
}

export function buildPersonalPatternReportFromWearableBundle(
  vault: VaultReadModel,
  wearableBundle: Pick<WearableSummaryBundle, "recoveryDays" | "sleepNights">,
  options: {
    asOf?: Date | string;
    vocabulary?: PersonalPatternVocabulary | null;
    windowDays?: number;
  } = {},
): PersonalPatternReport {
  const window = resolveWindow(options);
  return buildPersonalPatternReportFromOutcomeSeries(
    vault,
    [
      ...collectOutcomeSeries(wearableBundle, window, readVaultTimeZone(vault)),
      ...collectJournalOutcomeSeries(vault.events, window),
    ],
    options,
  );
}

export function buildPersonalPatternReportFromWearableBundleAndMetricPoints(
  vault: VaultReadModel,
  wearableBundle: Pick<WearableSummaryBundle, "recoveryDays" | "sleepNights">,
  metricPoints: readonly MetricPoint[],
  options: {
    asOf?: Date | string;
    vocabulary?: PersonalPatternVocabulary | null;
    windowDays?: number;
  } = {},
): PersonalPatternReport {
  const window = resolveWindow(options);
  const wearableOutcomes = collectOutcomeSeries(
    wearableBundle,
    window,
    readVaultTimeZone(vault),
  );
  const wearableOutcomeIds = new Set(
    wearableOutcomes.map((outcome) => outcome.id),
  );
  const fallbackOutcomes = collectMetricPointRecoveryOutcomeSeries(
    metricPoints,
    window,
  ).filter((outcome) => !wearableOutcomeIds.has(outcome.id));
  const journalOutcomes = collectJournalOutcomeSeries(
    vault.events,
    window,
  ).filter((outcome) => !wearableOutcomeIds.has(outcome.id));

  return buildPersonalPatternReportFromOutcomeSeries(
    vault,
    [...wearableOutcomes, ...fallbackOutcomes, ...journalOutcomes],
    options,
  );
}

function buildPersonalPatternReportFromOutcomeSeries(
  vault: VaultReadModel,
  outcomes: readonly OutcomeSeries[],
  options: {
    asOf?: Date | string;
    vocabulary?: PersonalPatternVocabulary | null;
    windowDays?: number;
  },
): PersonalPatternReport {
  const asOfDate = resolveAsOfDate(options.asOf);
  const windowDays = normalizeWindowDays(options.windowDays);
  const fromDate = addDays(asOfDate, -(windowDays - 1));
  const vocabulary = buildPersonalPatternVocabularyIndex(options.vocabulary);
  const factorAccumulators = pruneRedundantFactorDetails(
    collectFactorAccumulators(vault.events, fromDate, asOfDate, vocabulary),
  );
  const candidateFactors = collectFactors(factorAccumulators, vocabulary);
  const candidateCells = candidateFactors.flatMap((factor) =>
    outcomes.map((outcome) =>
      buildPatternCell(
        factor,
        factorAccumulators.get(factor.id),
        outcome,
        fromDate,
        asOfDate,
      ),
    ),
  );
  const factors = candidateFactors
    .sort(
      (left, right) =>
        bestFactorGradeRank(candidateCells, right.id) -
          bestFactorGradeRank(candidateCells, left.id) ||
        right.observedDays - left.observedDays ||
        left.label.localeCompare(right.label),
    )
    .slice(0, MAX_REPORT_FACTORS);
  const visibleFactorIds = new Set(factors.map((factor) => factor.id));
  const selectedCells = candidateCells.filter((cell) =>
    visibleFactorIds.has(cell.factorId),
  );
  const testedCells = selectedCells.filter(
    (cell) => cell.stage !== "insufficient",
  );

  return {
    asOfDate,
    cells: selectedCells,
    factors,
    lagDays: 1,
    notes: [
      "Each cell compares a factor case with a same-day or next-day outcome.",
      "Missing notes stay unknown. They are not treated as proof that a factor did not happen.",
      "Low-evidence observations can use an unobserved personal baseline. They cannot become a Pattern without stronger evidence.",
      "A repeated link is still an association, not proof that the action caused the change.",
    ],
    outcomes: outcomes.map(
      ({
        values: _values,
        meaningfulAbsoluteDelta: _absolute,
        meaningfulRelativeDelta: _relative,
        ...outcome
      }) => outcome,
    ),
    repeatableCellCount: testedCells.filter(
      (cell) =>
        cell.classification === "early_signal" ||
        cell.classification === "pattern",
    ).length,
    testedCellCount: testedCells.length,
    windowDays,
  };
}

export function emptyPersonalPatternReport(
  asOfDate: string,
): PersonalPatternReport {
  return {
    asOfDate,
    cells: [],
    factors: [],
    lagDays: 1,
    notes: [],
    outcomes: [],
    repeatableCellCount: 0,
    testedCellCount: 0,
    windowDays: DEFAULT_WINDOW_DAYS,
  };
}

function collectFactors(
  accumulators: ReadonlyMap<string, FactorAccumulator>,
  vocabulary: PersonalPatternVocabularyIndex,
): PersonalPatternFactor[] {
  return [...accumulators.values()].map((factor) => {
    const observedDays = factor.dates.size;
    const episodeCount = independentEpisodeDates(
      factor.dates,
      factor.episodeDates,
    ).length;
    const presentation = vocabulary.byId.get(factor.token);
    return {
      ...(factor.absentDates.size > 0
        ? { confirmedAbsentDays: factor.absentDates.size }
        : {}),
      ...(episodeCount !== observedDays ? { episodeCount } : {}),
      id: factor.token,
      ...(presentation ? { icon: presentation.icon } : {}),
      kind:
        factor.kinds.size === 2
          ? ("mixed" as const)
          : factor.kinds.has("activity")
          ? ("activity" as const)
          : ("intervention" as const),
      label: presentation?.label ?? humanizeFactorToken(factor.token),
      observedDays,
    };
  });
}

function collectFactorAccumulators(
  events: readonly CanonicalEntity[],
  fromDate: string,
  toDate: string,
  vocabulary: PersonalPatternVocabularyIndex,
): Map<string, FactorAccumulator> {
  const factors = new Map<string, FactorAccumulator>();

  for (const event of events) {
    for (const rawCandidate of readFactorCandidates(event)) {
      const candidate = applyFactorVocabulary(rawCandidate, vocabulary);
      if (candidate.date < fromDate || candidate.date > toDate) continue;

      const existing = factors.get(candidate.token);
      if (existing) {
        if (candidate.state === "observed") {
          existing.implicitAbsenceAllowed &&=
            candidate.implicitAbsenceAllowed;
          existing.dates.add(candidate.date);
          addEpisodeDate(
            existing.episodeDates,
            candidate.episodeId,
            candidate.date,
          );
        } else {
          existing.absentDates.add(candidate.date);
        }
        existing.kinds.add(candidate.kind);
        continue;
      }

      factors.set(candidate.token, {
        absentDates: new Set(
          candidate.state === "absent" ? [candidate.date] : [],
        ),
        dates: new Set(candidate.state === "observed" ? [candidate.date] : []),
        episodeDates: new Map(
          candidate.state === "observed"
            ? [[candidate.episodeId, new Set([candidate.date])]]
            : [],
        ),
        implicitAbsenceAllowed:
          candidate.state === "absent" || candidate.implicitAbsenceAllowed,
        kinds: new Set([candidate.kind]),
        token: candidate.token,
      });
    }
  }

  return factors;
}

function applyFactorVocabulary(
  candidate: FactorCandidate,
  vocabulary: PersonalPatternVocabularyIndex,
): FactorCandidate {
  const separatorIndex = candidate.token.indexOf("--");
  const baseToken =
    separatorIndex === -1
      ? candidate.token
      : candidate.token.slice(0, separatorIndex);
  const detailSuffix =
    separatorIndex === -1 ? "" : candidate.token.slice(separatorIndex);
  const canonicalBase = vocabulary.aliasToId.get(baseToken) ?? baseToken;
  if (canonicalBase === baseToken) return candidate;
  return {
    ...candidate,
    episodeId:
      candidate.episodeId === `${baseToken}:${candidate.date}`
        ? `${canonicalBase}:${candidate.date}`
        : candidate.episodeId,
    token: `${canonicalBase}${detailSuffix}`,
  };
}

function pruneRedundantFactorDetails(
  factors: Map<string, FactorAccumulator>,
): Map<string, FactorAccumulator> {
  const detailsByBase = new Map<string, FactorAccumulator[]>();

  for (const factor of factors.values()) {
    const separatorIndex = factor.token.indexOf("--");
    if (separatorIndex === -1) continue;
    const baseToken = factor.token.slice(0, separatorIndex);
    const details = detailsByBase.get(baseToken) ?? [];
    details.push(factor);
    detailsByBase.set(baseToken, details);
  }

  for (const [baseToken, details] of detailsByBase) {
    const base = factors.get(baseToken);
    const signatureCounts = new Map<string, number>();
    for (const detail of details) {
      const signature = factorExposureSignature(detail);
      signatureCounts.set(signature, (signatureCounts.get(signature) ?? 0) + 1);
    }

    for (const detail of details) {
      const signature = factorExposureSignature(detail);
      const duplicatesBase =
        base !== undefined && signature === factorExposureSignature(base);
      const isConfoundedDuplicate = (signatureCounts.get(signature) ?? 0) > 1;
      if (duplicatesBase || isConfoundedDuplicate) {
        factors.delete(detail.token);
      }
    }
  }

  return factors;
}

function factorExposureSignature(factor: FactorAccumulator): string {
  return `${[...factor.dates].sort().join(",")}|${[...factor.absentDates]
    .sort()
    .join(",")}`;
}

function readFactorCandidates(event: CanonicalEntity): FactorCandidate[] {
  if (event.kind === "activity_session") {
    const token = canonicalFactorToken(
      resolveAdherenceObservationActivityKind({
        attributes: event.attributes,
      }),
    );
    const date = resolveActivityEvidenceLocalDate(event);
    return token && date && !OUTCOME_LIKE_FACTOR_TOKENS.has(token)
      ? buildObservedFactorCandidates({ date, event, kind: "activity", token })
      : [];
  }

  if (event.kind === "intervention_session") {
    // PR #1673 emitted every Junction note tag as a completed intervention.
    // Those legacy rows have incorrect canonical meaning and must not remain
    // action factors while any explicit storage repair is evaluated separately.
    if (isLegacyJunctionNoteTagIntervention(event)) return [];

    const status = readString(event.attributes.sessionStatus);
    if (status === "missed" || status === "skipped") return [];
    const token = canonicalFactorToken(
      normalizeActivityKindToken(readString(event.attributes.interventionType)),
    );
    const date = resolveInterventionSessionLocalDate(event);
    return token && date && !OUTCOME_LIKE_FACTOR_TOKENS.has(token)
      ? buildObservedFactorCandidates({
          date,
          event,
          kind: "intervention",
          token,
        })
      : [];
  }

  const journalCandidates = readJournalNoteFactorCandidates(event);
  if (journalCandidates.length > 0) return journalCandidates;

  if (
    !isEligibleJunctionOuraWearableTagNote(event) ||
    !event.tags.includes(PERSONAL_PATTERN_OURA_ACTION_TAG)
  ) {
    return [];
  }

  const date = event.date ?? event.occurredAt?.slice(0, 10) ?? null;
  return date
    ? buildObservedFactorCandidates({
        date,
        event,
        kind: "intervention",
        token: PERSONAL_PATTERN_OURA_ACTION_TAG,
      })
    : [];
}

function buildObservedFactorCandidates(input: {
  date: string;
  event: CanonicalEntity;
  kind: "activity" | "intervention";
  token: string;
}): FactorCandidate[] {
  const base: FactorCandidate = {
    date: input.date,
    episodeId: readEpisodeId(input.event) ?? `${input.token}:${input.date}`,
    implicitAbsenceAllowed:
      readString(input.event.attributes.source) === "device",
    kind: input.kind,
    state: "observed",
    token: input.token,
  };
  const detailTokens = readBoundedFactorDetailTokens(input.event, input.token);
  return [
    base,
    ...detailTokens.map((detail) => ({
      ...base,
      token: `${input.token}--${detail}`,
    })),
  ];
}

function readJournalNoteFactorCandidates(
  event: CanonicalEntity,
): FactorCandidate[] {
  if (event.kind !== "note") return [];
  const noteType = readString(event.attributes.noteType);
  if (noteType !== "journal-factor" && noteType !== "journal-context")
    return [];

  const token = canonicalFactorToken(readPrefixedTag(event.tags, "key-"));
  const date = event.date ?? event.occurredAt?.slice(0, 10) ?? null;
  if (!token || !date || OUTCOME_LIKE_FACTOR_TOKENS.has(token)) return [];

  const state = event.tags.includes("did-not-happen") ? "absent" : "observed";
  if (event.tags.includes("planned") && state !== "absent") return [];
  const base: FactorCandidate = {
    date,
    episodeId: readEpisodeId(event) ?? `${token}:${date}`,
    implicitAbsenceAllowed: false,
    kind: "intervention",
    state,
    token,
  };
  return [
    base,
    ...readBoundedFactorDetailTokens(event, token).map((detail) => ({
      ...base,
      token: `${token}--${detail}`,
    })),
  ];
}

function readEpisodeId(event: CanonicalEntity): string | null {
  return readPrefixedTag(event.tags, "episode-");
}

function readBoundedFactorDetailTokens(
  event: CanonicalEntity,
  factorToken: string,
): string[] {
  const details: string[] = [];
  const temperature =
    readFiniteNumber(event.attributes.temperatureC) ??
    readNumericTag(event.tags, "temperature-c-");
  if (temperature !== null && factorToken === "sauna") {
    details.push(
      temperature >= 90 ? "temperature-hot" : "temperature-moderate",
    );
  }

  details.push(
    ...event.tags.filter((tag) => BOUNDED_FACTOR_DETAIL_TAGS.has(tag)),
  );

  return [...new Set(details)].slice(0, 2);
}

function readPrefixedTag(
  tags: readonly string[],
  prefix: string,
): string | null {
  const value =
    tags.find((tag) => tag.startsWith(prefix))?.slice(prefix.length) ?? "";
  return canonicalFactorToken(value.trim() || null);
}

function readNumericTag(
  tags: readonly string[],
  prefix: string,
): number | null {
  const value = tags
    .find((tag) => tag.startsWith(prefix))
    ?.slice(prefix.length);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isEligibleJunctionOuraWearableTagNote(
  event: CanonicalEntity,
): boolean {
  if (event.kind !== "note") return false;
  if (readString(event.attributes.noteType) !== JUNCTION_WEARABLE_TAG_NOTE_TYPE)
    return false;

  const externalRef = readRecord(event.attributes.externalRef);
  const dataOrigin = readRecord(event.attributes.dataOrigin);
  return (
    readString(event.attributes.source) === "device" &&
    readString(externalRef?.system) === "junction" &&
    readString(externalRef?.resourceType) === "junction-oura-note" &&
    readString(externalRef?.facet) ===
      JUNCTION_WEARABLE_TAG_EXTERNAL_REF_FACET &&
    readString(dataOrigin?.sourceProviderSlug) === "oura"
  );
}

function isLegacyJunctionNoteTagIntervention(event: CanonicalEntity): boolean {
  const externalRef = readRecord(event.attributes.externalRef);
  const resourceType = readString(externalRef?.resourceType);
  const facet = readString(externalRef?.facet);
  return (
    readString(event.attributes.source) === "device" &&
    readString(externalRef?.system) === "junction" &&
    resourceType !== null &&
    JUNCTION_NOTE_RESOURCE_TYPE_PATTERN.test(resourceType) &&
    facet?.startsWith("tag-") === true
  );
}

function collectJournalOutcomeSeries(
  events: readonly CanonicalEntity[],
  window: PatternWindow,
): OutcomeSeries[] {
  const valuesByOutcome = new Map<string, Map<string, number>>();

  for (const event of events) {
    if (
      event.kind !== "note" ||
      readString(event.attributes.noteType) !== "journal-outcome"
    )
      continue;
    const date = event.date ?? event.occurredAt?.slice(0, 10) ?? null;
    if (!date || date < window.fromDate || date > window.outcomeToDate)
      continue;

    const key = readPrefixedTag(event.tags, "key-");
    const rawValue =
      event.tags.find((tag) => tag.startsWith("value-"))?.slice(6) ?? null;
    const value = readSubjectiveOutcomeValue(rawValue);
    if (!key || value === null) continue;

    const outcomeId = `subjective-${key}`;
    const values = valuesByOutcome.get(outcomeId) ?? new Map<string, number>();
    values.set(date, value);
    valuesByOutcome.set(outcomeId, values);
  }

  return [...valuesByOutcome.entries()]
    .filter(([, values]) => values.size >= 2)
    .map(([id, values]) => ({
      id,
      label: humanizeFactorToken(id.slice("subjective-".length)),
      lagDays: 0,
      meaningfulAbsoluteDelta: 0.75,
      meaningfulRelativeDelta: 0.2,
      unit: "level",
      values,
    }));
}

function readSubjectiveOutcomeValue(value: string | null): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 10) return numeric;
  switch (value) {
    case "awful":
    case "bad":
    case "low":
    case "poor":
      return 1;
    case "fair":
    case "medium":
    case "okay":
      return 2;
    case "good":
    case "high":
      return 3;
    case "excellent":
    case "great":
      return 4;
    default:
      return null;
  }
}

function collectOutcomeSeries(
  wearableBundle: Pick<WearableSummaryBundle, "recoveryDays" | "sleepNights">,
  window: PatternWindow,
  fallbackTimeZone: string | null,
): OutcomeSeries[] {
  const { fromDate, outcomeToDate: toDate } = window;
  const sleep = wearableBundle.sleepNights
    .filter(isWearableSleepPatternEligibleNight)
    .filter((day) => {
      const outcomeDate = resolveWearableSleepAnalysisDate(
        day,
        fallbackTimeZone,
      );
      return outcomeDate >= fromDate && outcomeDate <= toDate;
    });
  const recovery = wearableBundle.recoveryDays.filter(
    (day) => day.date >= fromDate && day.date <= toDate,
  );

  return [
    outcome(
      "total-sleep",
      "Total sleep",
      "min",
      15,
      0.03,
      sleep,
      (day) => day.totalSleepMinutes,
      (day) => resolveWearableSleepAnalysisDate(day, fallbackTimeZone),
    ),
    outcome(
      "sleep-score",
      "Sleep score",
      "score",
      3,
      0.03,
      sleep,
      (day) => day.sleepScore,
      (day) => resolveWearableSleepAnalysisDate(day, fallbackTimeZone),
    ),
    outcome(
      "sleep-efficiency",
      "Sleep efficiency",
      "%",
      2,
      0.02,
      sleep,
      (day) => day.sleepEfficiency,
      (day) => resolveWearableSleepAnalysisDate(day, fallbackTimeZone),
    ),
    outcome(
      "deep-sleep",
      "Deep sleep",
      "min",
      5,
      0.05,
      sleep,
      (day) => day.deepMinutes,
      (day) => resolveWearableSleepAnalysisDate(day, fallbackTimeZone),
    ),
    outcome(
      "rem-sleep",
      "REM sleep",
      "min",
      5,
      0.05,
      sleep,
      (day) => day.remMinutes,
      (day) => resolveWearableSleepAnalysisDate(day, fallbackTimeZone),
    ),
    outcome(
      "recovery-score",
      "Recovery score",
      "score",
      3,
      0.03,
      recovery,
      (day) => day.recoveryScore,
    ),
    outcome(
      "readiness-score",
      "Readiness score",
      "score",
      3,
      0.03,
      recovery,
      (day) => day.readinessScore,
    ),
    outcome("hrv", "HRV", "ms", 2, 0.05, recovery, (day) => day.hrv),
    outcome(
      "resting-heart-rate",
      "Resting heart rate",
      "bpm",
      2,
      0.03,
      recovery,
      (day) => day.restingHeartRate,
    ),
    outcome(
      "respiratory-rate",
      "Respiratory rate",
      "breaths/min",
      0.5,
      0.03,
      recovery,
      (day) => day.respiratoryRate,
    ),
    outcome("spo2", "SpO₂", "%", 1, 0.01, recovery, (day) => day.spo2),
  ].filter((series) => series.values.size >= MIN_OUTCOME_DAYS);
}

function collectMetricPointRecoveryOutcomeSeries(
  metricPoints: readonly MetricPoint[],
  window: PatternWindow,
): OutcomeSeries[] {
  const explicitMetricKeys = new Set(
    metricPoints.map((point) => point.metricKey),
  );

  return [
    metricPointOutcome(
      "total-sleep",
      "Total sleep",
      "min",
      15,
      0.03,
      ["total-sleep", "total-sleep-minutes", "sleep-total-minutes"],
      metricPoints,
      window,
    ),
    metricPointOutcome(
      "sleep-score",
      "Sleep score",
      "score",
      3,
      0.03,
      "sleep-score",
      metricPoints,
      window,
    ),
    metricPointOutcome(
      "sleep-efficiency",
      "Sleep efficiency",
      "%",
      2,
      0.02,
      "sleep-efficiency",
      metricPoints,
      window,
    ),
    metricPointOutcome(
      "deep-sleep",
      "Deep sleep",
      "min",
      5,
      0.05,
      ["deep-sleep-minutes", "sleep-deep-minutes"],
      metricPoints,
      window,
    ),
    metricPointOutcome(
      "rem-sleep",
      "REM sleep",
      "min",
      5,
      0.05,
      ["rem-sleep-minutes", "sleep-rem-minutes"],
      metricPoints,
      window,
    ),
    metricPointOutcome(
      "recovery-score",
      "Recovery score",
      "score",
      3,
      0.03,
      "recovery-score",
      metricPoints,
      window,
    ),
    metricPointOutcome(
      "readiness-score",
      "Readiness score",
      "score",
      3,
      0.03,
      "readiness-score",
      metricPoints,
      window,
    ),
    metricPointOutcome(
      "hrv",
      "HRV",
      "ms",
      2,
      0.05,
      ["hrv-rmssd", "hrv"],
      metricPoints,
      window,
    ),
    metricPointOutcome(
      "respiratory-rate",
      "Respiratory rate",
      "breaths/min",
      0.5,
      0.03,
      "respiratory-rate",
      metricPoints,
      window,
    ),
    metricPointOutcome(
      "spo2",
      "SpO₂",
      "%",
      1,
      0.01,
      "spo2",
      metricPoints,
      window,
    ),
    metricPointOutcome(
      "resting-heart-rate",
      "Resting heart rate",
      "bpm",
      2,
      0.03,
      "resting-heart-rate",
      metricPoints,
      window,
    ),
  ]
    .filter((series) => series.values.size >= MIN_OUTCOME_DAYS)
    .filter((series) => {
      if (series.id === "recovery-score") {
        return explicitMetricKeys.has("recovery-score");
      }
      if (series.id === "readiness-score") {
        return explicitMetricKeys.has("readiness-score");
      }
      return true;
    });
}

function metricPointOutcome(
  id: string,
  label: string,
  unit: string,
  meaningfulAbsoluteDelta: number,
  meaningfulRelativeDelta: number,
  metricKey: string | readonly string[],
  metricPoints: readonly MetricPoint[],
  window: PatternWindow,
): OutcomeSeries {
  const metricKeys = typeof metricKey === "string" ? [metricKey] : metricKey;
  const values = new Map<string, number>();
  for (const key of metricKeys) {
    const rows = selectMetricSeries({
      from: window.fromDate,
      metricKey: key,
      points: metricPoints,
      to: window.outcomeToDate,
    }).rows;
    for (const row of rows) {
      if (
        row.confidence !== "none" &&
        row.value !== null &&
        !values.has(row.date)
      ) {
        values.set(row.date, row.value);
      }
    }
  }
  return {
    id,
    label,
    lagDays: 1,
    meaningfulAbsoluteDelta,
    meaningfulRelativeDelta,
    unit,
    values,
  };
}

function outcome<T extends { date: string }>(
  id: string,
  label: string,
  unit: string,
  meaningfulAbsoluteDelta: number,
  meaningfulRelativeDelta: number,
  days: readonly T[],
  select: (day: T) => WearableResolvedMetric,
  selectDate: (day: T) => string = (day) => day.date,
): OutcomeSeries {
  const values = new Map<string, number>();
  for (const day of days) {
    const metric = select(day);
    const value = metric.selection.value;
    if (value === null || metric.confidence.level === "none") continue;
    values.set(selectDate(day), value);
  }
  return {
    id,
    label,
    lagDays: 1,
    meaningfulAbsoluteDelta,
    meaningfulRelativeDelta,
    unit,
    values,
  };
}

function readVaultTimeZone(vault: VaultReadModel): string | null {
  const value = vault.metadata?.timezone;
  return typeof value === "string" && isValidIanaTimeZone(value) ? value : null;
}

function buildPatternCell(
  factor: PersonalPatternFactor,
  accumulator: FactorAccumulator | undefined,
  outcome: OutcomeSeries,
  fromDate: string,
  toDate: string,
): PersonalPatternCell {
  const factorDates = accumulator?.dates ?? new Set<string>();
  const confirmedAbsentDates = accumulator?.absentDates ?? new Set<string>();
  const comparisonBasis = comparisonBasisForDates(confirmedAbsentDates);
  const pairs = matchComparisonDays(
    factorDates,
    accumulator?.episodeDates ?? new Map(),
    outcome.values,
    outcome.lagDays,
    comparisonBasis === "confirmed_absence" ? confirmedAbsentDates : null,
    fromDate,
    toDate,
  );
  const exposedDates = [
    ...new Set(pairs.flatMap((pair) => pair.exposedDates)),
  ].sort();
  const comparisonDates = [
    ...new Set(pairs.flatMap((pair) => pair.comparisonDates)),
  ].sort();
  const base = buildPatternCellBase({
    comparisonBasis,
    comparisonDates,
    exposedDates,
    factorId: factor.id,
    outcomeId: outcome.id,
    pairCount: pairs.length,
  });

  if (pairs.length === 0 || !base.firstExposedDate || !base.lastExposedDate) {
    return {
      ...base,
      comparisonMean: null,
      delta: null,
      deltaPercent: null,
      direction: "flat",
      exposedMean: null,
      repeatedDirection: false,
      stage: "insufficient",
    };
  }

  const exposedMean = mean(pairs.map((pair) => pair.exposedValue));
  const comparisonMean = mean(pairs.map((pair) => pair.comparisonValue));
  const delta = exposedMean - comparisonMean;
  const deltaPercent =
    comparisonMean === 0 ? null : (delta / Math.abs(comparisonMean)) * 100;
  const meaningfulDelta = Math.max(
    outcome.meaningfulAbsoluteDelta,
    Math.abs(comparisonMean) * outcome.meaningfulRelativeDelta,
  );
  const typicalDelta = median(
    pairs.map((pair) => pair.exposedValue - pair.comparisonValue),
  );
  const repeatedDirection = hasRepeatedDirection(
    pairs,
    delta,
    typicalDelta,
    meaningfulDelta,
  );
  const direction = patternDirection(delta, meaningfulDelta);
  const spanDays = daysBetween(base.firstExposedDate, base.lastExposedDate);
  const initialGrade = patternGrade({
    typicalDelta,
    direction,
    meaningfulDelta,
    pairCount: pairs.length,
    repeatedDirection,
    spanDays,
  });
  const grade = boundedPatternGrade({
    comparisonBasis,
    grade: initialGrade,
    implicitAbsenceAllowed: accumulator?.implicitAbsenceAllowed === true,
  });
  const stage = patternStageForGrade(grade);

  return {
    ...base,
    classification: grade ? classificationForGrade(grade) : null,
    comparisonMean: round(comparisonMean),
    delta: round(delta),
    deltaPercent: deltaPercent === null ? null : round(deltaPercent),
    direction,
    exposedMean: round(exposedMean),
    grade,
    repeatedDirection,
    stage,
  };
}

function comparisonBasisForDates(
  confirmedAbsentDates: ReadonlySet<string>,
): PersonalPatternCell["comparisonBasis"] {
  return confirmedAbsentDates.size > 0
    ? "confirmed_absence"
    : "unobserved_baseline";
}

function buildPatternCellBase(input: {
  comparisonBasis: PersonalPatternCell["comparisonBasis"];
  comparisonDates: string[];
  exposedDates: string[];
  factorId: string;
  outcomeId: string;
  pairCount: number;
}) {
  return {
    classification: null,
    comparisonBasis: input.comparisonBasis,
    comparisonDates: input.comparisonDates,
    comparisonDays: input.pairCount,
    exposedDays: input.pairCount,
    exposedDates: input.exposedDates,
    factorId: input.factorId,
    firstExposedDate: input.exposedDates[0] ?? null,
    grade: null,
    lastExposedDate: input.exposedDates.at(-1) ?? null,
    outcomeId: input.outcomeId,
  };
}

function patternDirection(
  delta: number,
  meaningfulDelta: number,
): PersonalPatternCell["direction"] {
  if (Math.abs(delta) < meaningfulDelta) return "flat";
  return delta > 0 ? "higher" : "lower";
}

function patternGrade(input: {
  typicalDelta: number;
  direction: PersonalPatternCell["direction"];
  meaningfulDelta: number;
  pairCount: number;
  repeatedDirection: boolean;
  spanDays: number;
}): PersonalPatternGrade | null {
  if (input.direction === "flat") return null;
  if (
    input.pairCount >= 12 &&
    input.spanDays >= 56 &&
    input.repeatedDirection &&
    Math.abs(input.typicalDelta) >= input.meaningfulDelta * 1.5
  ) {
    return "A";
  }
  if (input.pairCount >= 8 && input.spanDays >= 42 && input.repeatedDirection) {
    return "B";
  }
  if (input.pairCount >= 5 && input.spanDays >= 21 && input.repeatedDirection) {
    return "C";
  }
  if (input.pairCount >= 2 && input.repeatedDirection) return "D";
  return input.pairCount === 1 ? "E" : null;
}

function boundedPatternGrade(input: {
  comparisonBasis: PersonalPatternCell["comparisonBasis"];
  grade: PersonalPatternGrade | null;
  implicitAbsenceAllowed: boolean;
}): PersonalPatternGrade | null {
  if (
    input.grade &&
    input.comparisonBasis === "unobserved_baseline" &&
    !input.implicitAbsenceAllowed &&
    gradeRank(input.grade) > gradeRank("D")
  ) {
    return "D";
  }
  return input.grade;
}

function patternStageForGrade(
  grade: PersonalPatternGrade | null,
): PersonalPatternStage {
  if (grade === "A") return "worth_testing";
  if (grade === "B" || grade === "C") return "seen_again";
  if (grade === "D" || grade === "E") return "new_clue";
  return "no_clear_pattern";
}

function matchComparisonDays(
  factorDates: ReadonlySet<string>,
  episodeDates: ReadonlyMap<string, ReadonlySet<string>>,
  outcomeValues: ReadonlyMap<string, number>,
  lagDays: 0 | 1,
  confirmedAbsentDates: ReadonlySet<string> | null,
  fromDate: string,
  toDate: string,
): MatchedPair[] {
  const eligibleComparisonDates = [...outcomeValues.keys()]
    .map((outcomeDate) => addDays(outcomeDate, -lagDays))
    .filter((date) => date >= fromDate && date <= toDate)
    .filter((date) => !factorDates.has(date))
    .filter(
      (date) => confirmedAbsentDates === null || confirmedAbsentDates.has(date),
    );
  const matchedDates = matchPersonalPatternDates(
    [...factorDates].filter((date) => outcomeValues.has(addDays(date, lagDays))),
    eligibleComparisonDates,
    COMPARISON_SEARCH_DAYS,
  );
  const pairs: MatchedPair[] = [];
  const episodes = independentEpisodeDates(factorDates, episodeDates);

  for (const dates of episodes) {
    const episodePairs: Array<{
      comparisonDate: string;
      comparisonValue: number;
      exposedDate: string;
      exposedValue: number;
    }> = [];
    for (const exposedDate of [...dates].sort()) {
      const exposedValue = outcomeValues.get(addDays(exposedDate, lagDays));
      if (exposedValue === undefined) continue;

      const comparisonDate = matchedDates.get(exposedDate);
      if (!comparisonDate) continue;

      const comparisonValue = outcomeValues.get(
        addDays(comparisonDate, lagDays),
      );
      if (comparisonValue === undefined) continue;
      episodePairs.push({
        comparisonDate,
        comparisonValue,
        exposedDate,
        exposedValue,
      });
    }
    if (episodePairs.length > 0) {
      pairs.push({
        comparisonDates: episodePairs.map((pair) => pair.comparisonDate),
        comparisonValue: mean(episodePairs.map((pair) => pair.comparisonValue)),
        exposedDates: episodePairs.map((pair) => pair.exposedDate),
        exposedValue: mean(episodePairs.map((pair) => pair.exposedValue)),
      });
    }
  }

  return pairs;
}

function independentEpisodeDates(
  factorDates: ReadonlySet<string>,
  episodeDates: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string>[] {
  const byDate = new Map<string, Set<string>>();
  for (const dates of episodeDates.values()) {
    const merged = new Set(dates);
    for (const date of dates) {
      for (const overlappingDate of byDate.get(date) ?? []) {
        merged.add(overlappingDate);
      }
    }
    for (const date of merged) byDate.set(date, merged);
  }
  for (const date of factorDates) {
    if (!byDate.has(date)) byDate.set(date, new Set([date]));
  }
  return [...new Set(byDate.values())]
    .map((dates) => new Set([...dates].sort()))
    .sort((left, right) => [...left][0].localeCompare([...right][0]));
}

function addEpisodeDate(
  episodeDates: Map<string, Set<string>>,
  episodeId: string,
  date: string,
): void {
  const dates = episodeDates.get(episodeId) ?? new Set<string>();
  dates.add(date);
  episodeDates.set(episodeId, dates);
}

function hasRepeatedDirection(
  pairs: readonly MatchedPair[],
  fullDelta: number,
  typicalDelta: number,
  meaningfulDelta: number,
): boolean {
  if (pairs.length < 2 || fullDelta === 0) return false;
  const direction = Math.sign(fullDelta);
  const deltas = pairs.map(
    (pair) => (pair.exposedValue - pair.comparisonValue) * direction,
  );
  const agreeingCases = deltas.filter((delta) => delta > 0).length;
  if (agreeingCases < Math.ceil(pairs.length * 0.75)) return false;
  // A large mean alone can come from a few unusual readings. The typical
  // paired difference must also clear the existing meaningful-effect floor.
  if (typicalDelta * direction < meaningfulDelta) return false;
  if (pairs.length < 4) return agreeingCases === pairs.length;
  const midpoint = Math.floor(pairs.length / 2);
  const first = pairs.slice(0, midpoint);
  const second = pairs.slice(midpoint);
  const firstDelta = mean(
    first.map((pair) => pair.exposedValue - pair.comparisonValue),
  );
  const secondDelta = mean(
    second.map((pair) => pair.exposedValue - pair.comparisonValue),
  );
  return (
    Math.sign(firstDelta) === Math.sign(fullDelta) &&
    Math.sign(secondDelta) === Math.sign(fullDelta)
  );
}

function classificationForGrade(
  grade: PersonalPatternGrade,
): PersonalPatternClassification {
  if (grade === "E") return "observation";
  if (grade === "D") return "early_signal";
  return "pattern";
}

function gradeRank(grade: PersonalPatternGrade): number {
  switch (grade) {
    case "A":
      return 5;
    case "B":
      return 4;
    case "C":
      return 3;
    case "D":
      return 2;
    case "E":
      return 1;
  }
}

function bestFactorGradeRank(
  cells: readonly PersonalPatternCell[],
  factorId: string,
): number {
  return cells.reduce(
    (best, cell) =>
      cell.factorId === factorId && cell.grade
        ? Math.max(best, gradeRank(cell.grade))
        : best,
    0,
  );
}

function resolveWindow(options: {
  asOf?: Date | string;
  windowDays?: number;
}): PatternWindow {
  const asOfDate = resolveAsOfDate(options.asOf);
  const windowDays = normalizeWindowDays(options.windowDays);
  return {
    fromDate: addDays(asOfDate, -(windowDays - 1)),
    outcomeToDate: addDays(asOfDate, 1),
  };
}

function resolveAsOfDate(value: Date | string | undefined): string {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.valueOf()))
    throw new TypeError("Personal Patterns asOf must be a valid date.");
  return date.toISOString().slice(0, 10);
}

function normalizeWindowDays(value: number | undefined): number {
  if (value === undefined) return DEFAULT_WINDOW_DAYS;
  if (!Number.isInteger(value) || value < 28 || value > 366) {
    throw new RangeError(
      "Personal Patterns windowDays must be an integer from 28 through 366.",
    );
  }
  return value;
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function daysBetween(left: string, right: string): number {
  return Math.round(
    (Date.parse(`${right}T00:00:00.000Z`) -
      Date.parse(`${left}T00:00:00.000Z`)) /
      86400000,
  );
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function canonicalFactorToken(value: string | null): string | null {
  switch (value) {
    case "run":
      return "running";
    case "walk":
      return "walking";
    case "bike":
    case "biking":
    case "cycle":
    case "ride":
      return "cycling";
    case "swim":
      return "swimming";
    case "hike":
      return "hiking";
    case "row":
      return "rowing";
    case "strength-training":
    case "weightlifting":
    case "weights":
      return "strength";
    default:
      return value;
  }
}

export function humanizeFactorToken(value: string): string {
  const readableValue =
    value === "yardwork"
      ? "yard-work"
      : value === "housework"
      ? "house-work"
      : value === "strength"
      ? "strength-training"
      : value;
  const words = readableValue.replace(/--/gu, " · ").replace(/[-_]+/gu, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

interface PersonalPatternVocabularyIndex {
  aliasToId: ReadonlyMap<string, string>;
  byId: ReadonlyMap<string, PersonalPatternVocabularyConcept>;
}

const EMPTY_PERSONAL_PATTERN_VOCABULARY_INDEX: PersonalPatternVocabularyIndex = {
  aliasToId: new Map(),
  byId: new Map(),
};

export function parsePersonalPatternVocabulary(
  body: string | null | undefined,
): PersonalPatternVocabulary | null {
  if (!body || body.length > 16_000) return null;
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  const record = readRecord(value);
  if (record?.version !== 1 || !Array.isArray(record.concepts)) return null;
  if (record.concepts.length > 50) return null;

  const concepts: PersonalPatternVocabularyConcept[] = [];
  const claimedTokens = new Set<string>();
  for (const value of record.concepts) {
    const concept = readRecord(value);
    const id = readVocabularyToken(concept?.id, 80);
    const label = readVocabularyLabel(concept?.label);
    const icon = parsePersonalPatternIcon(concept?.icon);
    const aliases = readVocabularyAliases(concept?.aliases);
    if (!id || !label || !icon || !aliases) return null;
    const tokens = [id, ...aliases];
    if (tokens.some((token) => claimedTokens.has(token))) return null;
    tokens.forEach((token) => claimedTokens.add(token));
    concepts.push({ aliases, icon, id, label });
  }

  return { concepts, version: 1 };
}

export function resolvePersonalPatternVocabularyConcept(
  vocabulary: PersonalPatternVocabulary | null | undefined,
  token: string,
): PersonalPatternVocabularyConcept | null {
  if (!vocabulary) return null;
  return vocabulary.concepts.find(
    (concept) => concept.id === token || concept.aliases.includes(token),
  ) ?? null;
}

function buildPersonalPatternVocabularyIndex(
  vocabulary: PersonalPatternVocabulary | null | undefined,
): PersonalPatternVocabularyIndex {
  if (!vocabulary) return EMPTY_PERSONAL_PATTERN_VOCABULARY_INDEX;
  const byId = new Map(
    vocabulary.concepts.map((concept) => [concept.id, concept]),
  );
  const aliasToId = new Map<string, string>();
  for (const concept of vocabulary.concepts) {
    aliasToId.set(concept.id, concept.id);
    for (const alias of concept.aliases) aliasToId.set(alias, concept.id);
  }
  return { aliasToId, byId };
}

function readVocabularyAliases(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const aliases = value.map((alias) => readVocabularyToken(alias, 240));
  return aliases.every((alias): alias is string => alias !== null)
    ? [...new Set(aliases)]
    : null;
}

function readVocabularyToken(value: unknown, maxLength: number): string | null {
  const token = readString(value);
  return token &&
    token.length <= maxLength &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(token)
    ? token
    : null;
}

function readVocabularyLabel(value: unknown): string | null {
  const label = readString(value);
  return label && label.length <= 80 && !/[\u0000-\u001f\u007f]/u.test(label)
    ? label
    : null;
}

export function parsePersonalPatternIcon(
  value: unknown,
): PersonalPatternIcon | null {
  const icon = readString(value);
  switch (icon) {
    case "activity":
    case "alcohol":
    case "bed":
    case "caffeine":
    case "cycling":
    case "dance":
    case "meal":
    case "medication":
    case "mind-body":
    case "recovery":
    case "red-light":
    case "running":
    case "strength":
    case "swimming":
    case "travel":
    case "walking":
    case "wellness":
      return icon;
    default:
      return null;
  }
}
