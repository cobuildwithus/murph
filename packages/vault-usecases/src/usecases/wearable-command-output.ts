import type { JsonValue } from "@murphai/contracts"
import { resolveWearableMetricCatalogEntry } from "@murphai/health-metrics"

import type { JsonObject } from "../health-cli-method-types.js"

// Agent-facing wearable command output. The query layer keeps its full
// provenance shape; this projection is the CLI boundary, so every byte here is
// re-read by the assistant on later model calls. A family metric is a bare
// number when it is a high-confidence value from the family `provider` in the
// result's `units` legend, and an object only for what differs.

const PUBLIC_WEARABLE_PROVENANCE_KEYS = new Set([
  "candidateId",
  "candidates",
  "dataOrigin",
  "externalRef",
  "paths",
  "recordIds",
])
// Inputs echoed by `filters`, or replaced by the compact confidence fields.
const METRIC_SUMMARY_DROPPED_KEYS = new Set([
  "confidence",
  "notes",
  "points",
  "requestedMetric",
  "resolvedAlias",
  "windowDays",
])
const KEEP_EMPTY_ARRAY_KEYS = new Set(["providers", "signals", "points", "splits"])
// Day-level source health keeps coverage, freshness, conflicts, and notes; the
// families already show which provider supplied each metric.
const DAY_SOURCE_HEALTH_DROPPED_KEYS = new Set([
  "candidateMetrics",
  "exactDuplicatesSuppressed",
  "metricsContributed",
  "providerDisplayName",
  "selectedMetrics",
])
const OMIT_COMPACT_WEARABLE_VALUE = Symbol("omit compact wearable value")
const COMPACT_WEARABLE_ARRAY_LIMIT = 8
const COMPACT_WEARABLE_STRING_LENGTH = 160
const COMPACT_WEARABLE_VALUE_DECIMALS = 1e4
// Notes that only restate a value, provider, or window the output already carries.
const RESTATEMENT_NOTE_PATTERNS: readonly RegExp[] = [
  /^Selected evidence came from [^.]+\.$/u,
  /^Selected (?:sleep|nap) window from .+ spanning \S+ to \S+\.$/u,
  /^Selected total sleep: \d+ min\.$/u,
  /^Selected \d+ activity sessions? covering \d+ min\.$/u,
  /^Selected activity types: [^.]+\.$/u,
  /^Selected (?:recovery|readiness) score: -?\d+%\.$/u,
  /^Selected weight: -?[\d.]+ kg\.$/u,
  /^Selected body-fat percentage: -?\d+%\.$/u,
  /^Latest wearable summary is joined on local day \d{4}-\d{2}-\d{2}\.$/u,
  /^Compared recent \d+ .+ days? \(\S+ to \S+\) against prior \d+ days? \(\S+ to \S+\)\.$/u,
]

type CompactWearableValue = JsonValue | typeof OMIT_COMPACT_WEARABLE_VALUE
type Units = Map<string, string>

interface ResolvedMetricFields {
  conflictingProviders: string[]
  fallbackFromMetric: string | null
  fallbackReason: string | null
  level: string
  provider: string | null
  unit: string | null
  value: number | null
}

export interface CompactWearableResult<T> {
  units?: JsonObject
  value: T
}

export interface CompactWearableList {
  items: JsonObject[]
  notes?: string[]
  units?: JsonObject
}

export function compactWearableDaySummary(value: unknown): CompactWearableResult<JsonObject | null> {
  const units: Units = new Map()
  return withUnits(compactWearableDay(value, units), units)
}

export function compactWearableLatestSummary(value: unknown): CompactWearableResult<JsonObject | null> {
  const units: Units = new Map()
  if (!isRecord(value)) {
    return { value: null }
  }

  const day = compactWearableDay(value.day, units)
  if (day === null) {
    return { value: null }
  }

  const latest: JsonObject = { day }
  copyDefined(latest, "latestDate", compactWearableValue(value.latestDate, units))
  copyDefined(latest, "providers", compactWearableValue(value.providers, units))
  setNotes(latest, compactNotes(readStrings(value.notes), collectNotes(day)))
  return withUnits(latest, units)
}

export function compactWearableMetricSummary(value: unknown): JsonObject | null {
  return isRecord(value) ? compactMetricSummary(value, { trendPoints: true }) : null
}

export function compactWearableDriftSummary(value: unknown): JsonObject | null {
  if (!isRecord(value)) {
    return null
  }

  const latestNotes = isRecord(value.latest) ? readStrings(value.latest.notes) : []
  // Bounded upstream by the fixed default signal list, so every signal is kept.
  const signals = (Array.isArray(value.signals) ? value.signals : [])
    .filter(isRecord)
    .map((signal) => compactMetricSummary(signal, { trendPoints: false }))
  const ownNotes = compactNotes(readStrings(value.notes), new Set(latestNotes))
  const notes = uniqueStrings([...ownNotes, ...collectRepeatedSignalNotes(signals)])
  const hoisted = new Set(notes)
  for (const signal of signals) {
    setNotes(signal, compactNotes(readStrings(signal.notes), hoisted))
  }

  const drift: JsonObject = { notes, signals }
  if (typeof value.windowDays === "number") {
    drift.windowDays = value.windowDays
  }
  return drift
}

export function compactWearableList(values: readonly unknown[]): CompactWearableList {
  const units: Units = new Map()
  const items = values
    .map((value) => compactWearableValue(value, units))
    .filter((item): item is JsonObject => isRecord(item))
  const shared = collectNotesSharedByEveryItem(items)
  for (const item of items) {
    if (shared.size > 0) {
      setNotes(item, readStrings(item.notes).filter((note) => !shared.has(note)))
    }
  }

  const list: CompactWearableList = { items }
  if (shared.size > 0) {
    list.notes = [...shared]
  }
  const legend = unitsLegend(units)
  if (legend) {
    list.units = legend
  }
  return list
}

function compactWearableDay(value: unknown, units: Units): JsonObject | null {
  const compact = compactWearableValue(value, units)
  if (!isRecord(compact) || !isRecord(value)) {
    return null
  }

  const day = compact as JsonObject
  const date = typeof day.date === "string" ? day.date : null
  for (const family of ["activity", "bodyState", "recovery", "sleep"]) {
    const summary = day[family]
    if (isRecord(summary) && summary.date === date) {
      delete summary.date
    }
  }
  moveConfidence(day, "summaryConfidence")
  if (Array.isArray(day.sourceHealth)) {
    day.sourceHealth = day.sourceHealth.map(compactDaySourceHealth)
  }
  setNotes(day, compactNotes(readStrings(value.notes), collectChildNotes(day)))
  return day
}

function compactWearableValue(value: unknown, units: Units): CompactWearableValue {
  if (Array.isArray(value)) {
    return value
      .map((entry) => compactWearableValue(entry, units))
      .filter((entry): entry is JsonValue => entry !== OMIT_COMPACT_WEARABLE_VALUE)
  }

  if (!isRecord(value)) {
    return compactScalar(value)
  }

  if (isSummaryConfidence(value.summaryConfidence)) {
    return compactFamily(value, units)
  }

  if (isResolvedMetric(value)) {
    return compactMetric(readResolvedMetric(value), { familyProvider: null, key: null, units })
  }

  return compactObject(value, units, () => false)
}

function compactObject(
  value: Record<string, unknown>,
  units: Units,
  skip: (key: string, child: unknown) => boolean,
): JsonObject {
  const compact: JsonObject = {}

  for (const [key, child] of Object.entries(value)) {
    if (PUBLIC_WEARABLE_PROVENANCE_KEYS.has(key) || skip(key, child)) {
      continue
    }

    const compactChild = compactWearableValue(child, units)
    if (compactChild === OMIT_COMPACT_WEARABLE_VALUE || compactChild === null) {
      continue
    }

    if (Array.isArray(compactChild)) {
      if (compactChild.length === 0 && !KEEP_EMPTY_ARRAY_KEYS.has(key)) {
        continue
      }
      compact[key] = compactChild.slice(0, compactWearableArrayLimitForKey(key))
      continue
    }

    compact[key] = compactChild
  }

  return compact
}

function compactFamily(family: Record<string, unknown>, units: Units): JsonObject {
  const familyProvider = resolveFamilyProvider(family)
  const fallbackReasons: string[] = []
  const compact = compactObject(family, units, (key, child) => {
    if (key === "summaryConfidence" || key === "notes" || key === "provider") {
      return true
    }
    if (key === "sleepWindowProvider") {
      return child === familyProvider
    }
    return isResolvedMetric(child)
  })

  for (const [key, child] of Object.entries(family)) {
    if (!isResolvedMetric(child)) {
      continue
    }
    const fields = readResolvedMetric(child)
    const metric = compactMetric(fields, { familyProvider, key, units })
    if (metric !== OMIT_COMPACT_WEARABLE_VALUE) {
      compact[key] = metric
      if (fields.fallbackReason) {
        fallbackReasons.push(fields.fallbackReason)
      }
    }
  }

  if (familyProvider) {
    compact.provider = familyProvider
  }
  const summaryConfidence = family.summaryConfidence as Record<string, unknown>
  const level = typeof summaryConfidence.level === "string" ? summaryConfidence.level : "none"
  if (level !== "high") {
    compact.confidence = level
  }
  setNotes(compact, compactNotes([
    ...readStrings(family.notes),
    ...readStrings(summaryConfidence.notes),
    ...fallbackReasons,
  ]))
  return compact
}

function compactMetric(
  fields: ResolvedMetricFields,
  context: { familyProvider: string | null; key: string | null; units: Units },
): CompactWearableValue {
  if (fields.value === null && fields.level === "none" && fields.conflictingProviders.length === 0) {
    return OMIT_COMPACT_WEARABLE_VALUE
  }

  const inlineUnit = recordUnit(fields.unit, context.key, context.units)
  const details: JsonObject = {}
  if (fields.provider && fields.provider !== context.familyProvider) {
    details.provider = fields.provider
  }
  if (fields.level !== "high") {
    details.confidence = fields.level
  }
  if (fields.conflictingProviders.length > 0) {
    details.conflictingProviders = fields.conflictingProviders
  }
  if (fields.fallbackFromMetric) {
    details.fallbackFromMetric = fields.fallbackFromMetric
  }
  if (inlineUnit) {
    details.unit = inlineUnit
  }

  return Object.keys(details).length === 0 && fields.value !== null
    ? fields.value
    : { value: fields.value, ...details }
}

/** Adds the metric's catalog unit to the legend, or returns a unit it does not cover. */
function recordUnit(unit: string | null, key: string | null, units: Units): string | null {
  const canonicalUnit = key === null ? null : resolveWearableMetricCatalogEntry(key)?.defaultUnit
  if (key === null || !canonicalUnit || (unit !== null && unit !== canonicalUnit)) {
    return unit
  }

  units.set(key, canonicalUnit)
  return null
}

function compactMetricSummary(
  summary: Record<string, unknown>,
  options: { trendPoints: boolean },
): JsonObject {
  const units: Units = new Map()
  const compact = compactObject(summary, units, (key) =>
    METRIC_SUMMARY_DROPPED_KEYS.has(key) || (!options.trendPoints && key === "recordedAt"))
  const confidence = isRecord(summary.confidence) ? summary.confidence : {}
  const level = typeof confidence.level === "string" ? confidence.level : "none"
  if (level !== "high") {
    compact.confidence = level
  }
  const conflictingProviders = readStrings(confidence.conflictingProviders)
  if (conflictingProviders.length > 0) {
    compact.conflictingProviders = conflictingProviders
  }
  setNotes(compact, compactNotes(readStrings(summary.notes)))
  if (options.trendPoints && Array.isArray(summary.points)) {
    // Bounded upstream by --window-days (at most 30), so every point is kept.
    compact.points = summary.points
      .filter(isRecord)
      .map((point) => compactTrendPoint(point, compact))
  }
  return compact
}

function compactTrendPoint(point: Record<string, unknown>, summary: JsonObject): JsonObject {
  const compact: JsonObject = {
    date: typeof point.date === "string" ? point.date : null,
    value: typeof point.value === "number" ? roundMetricValue(point.value) : null,
  }
  if (typeof point.provider === "string" && point.provider !== summary.provider) {
    compact.provider = point.provider
  }
  if (typeof point.confidence === "string" && point.confidence !== "high") {
    compact.confidence = point.confidence
  }
  if (typeof point.unit === "string" && point.unit !== summary.unit) {
    compact.unit = point.unit
  }
  return compact
}

function readResolvedMetric(metric: Record<string, unknown>): ResolvedMetricFields {
  const selection = metric.selection as Record<string, unknown>
  const confidence = metric.confidence as Record<string, unknown>
  return {
    conflictingProviders: readStrings(confidence.conflictingProviders),
    fallbackFromMetric: readString(selection.fallbackFromMetric),
    fallbackReason: readString(selection.fallbackReason),
    level: readString(confidence.level) ?? "none",
    provider: readString(selection.provider),
    unit: readString(selection.unit),
    value: typeof selection.value === "number" ? roundMetricValue(selection.value) : null,
  }
}

function resolveFamilyProvider(family: Record<string, unknown>): string | null {
  const declared = readString(family.provider)
  if (declared) {
    return declared
  }

  const counts = new Map<string, number>()
  for (const child of Object.values(family)) {
    if (!isResolvedMetric(child)) {
      continue
    }
    const fields = readResolvedMetric(child)
    if (fields.provider && fields.value !== null) {
      counts.set(fields.provider, (counts.get(fields.provider) ?? 0) + 1)
    }
  }

  let dominant: string | null = null
  for (const [provider, count] of counts) {
    if (dominant === null || count > (counts.get(dominant) ?? 0)) {
      dominant = provider
    }
  }
  return dominant
}

function compactDaySourceHealth(entry: JsonValue): JsonValue {
  if (!isRecord(entry)) {
    return entry
  }
  return Object.fromEntries(
    Object.entries(entry).filter(([key, value]) => !DAY_SOURCE_HEALTH_DROPPED_KEYS.has(key) && value !== 0),
  ) as JsonObject
}

function moveConfidence(target: JsonObject, key: string): void {
  const level = target[key]
  delete target[key]
  if (typeof level === "string" && level !== "high") {
    target.confidence = level
  }
}

function compactNotes(notes: readonly string[], exclude: ReadonlySet<string> = new Set()): string[] {
  // Exclusions may hold raw or already-shortened notes, so test both forms.
  return uniqueStrings(
    notes
      .filter((note) => !exclude.has(note) && !isRestatementNote(note))
      .map((note) => compactScalar(note))
      .filter((note): note is string => typeof note === "string" && !exclude.has(note)),
  ).slice(0, COMPACT_WEARABLE_ARRAY_LIMIT)
}

function isRestatementNote(note: string): boolean {
  return RESTATEMENT_NOTE_PATTERNS.some((pattern) => pattern.test(note))
}

function collectRepeatedSignalNotes(signals: readonly JsonObject[]): string[] {
  const counts = new Map<string, number>()
  for (const signal of signals) {
    for (const note of readStrings(signal.notes)) {
      counts.set(note, (counts.get(note) ?? 0) + 1)
    }
  }
  return [...counts].filter(([, count]) => count > 1).map(([note]) => note)
}

function collectNotesSharedByEveryItem(items: readonly JsonObject[]): Set<string> {
  if (items.length < 2) {
    return new Set()
  }
  const [first, ...rest] = items.map((item) => new Set(readStrings(item.notes)))
  return new Set([...(first ?? [])].filter((note) => rest.every((notes) => notes.has(note))))
}

function collectChildNotes(value: JsonObject): Set<string> {
  const notes = new Set<string>()
  for (const [key, child] of Object.entries(value)) {
    if (key !== "notes") {
      for (const note of collectNotes(child)) {
        notes.add(note)
      }
    }
  }
  return notes
}

function collectNotes(value: unknown): Set<string> {
  const notes = new Set<string>()
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (!isRecord(node)) {
      return
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "notes") {
        readStrings(child).forEach((note) => notes.add(note))
      } else {
        visit(child)
      }
    }
  }
  visit(value)
  return notes
}

function setNotes(target: JsonObject | Record<string, unknown>, notes: readonly string[]): void {
  if (notes.length > 0) {
    target.notes = [...notes]
  } else {
    delete target.notes
  }
}

function withUnits(value: JsonObject | null, units: Units): CompactWearableResult<JsonObject | null> {
  const legend = value === null ? null : unitsLegend(units)
  return legend ? { units: legend, value } : { value }
}

function unitsLegend(units: Units): JsonObject | null {
  if (units.size === 0) {
    return null
  }
  return Object.fromEntries([...units].sort(([left], [right]) => left.localeCompare(right)))
}

function compactScalar(value: unknown): CompactWearableValue {
  if (typeof value === "string") {
    const normalized = value.trim()
    if (normalized.length === 0) {
      return null
    }

    return normalized.length <= COMPACT_WEARABLE_STRING_LENGTH
      ? normalized
      : `${normalized.slice(0, COMPACT_WEARABLE_STRING_LENGTH - 3).trimEnd()}...`
  }

  if (typeof value === "number" && !Number.isInteger(value)) {
    return roundMetricValue(value)
  }

  return isJsonScalar(value) ? value : null
}

function compactWearableArrayLimitForKey(key: string): number {
  if (key === "workoutFeatures") {
    return 32
  }

  if (key === "splits") {
    return 64
  }

  return COMPACT_WEARABLE_ARRAY_LIMIT
}

function roundMetricValue(value: number): number {
  return Math.round(value * COMPACT_WEARABLE_VALUE_DECIMALS) / COMPACT_WEARABLE_VALUE_DECIMALS
}

function copyDefined(target: JsonObject, key: string, value: CompactWearableValue): void {
  if (value !== OMIT_COMPACT_WEARABLE_VALUE && value !== null) {
    target[key] = value
  }
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : []
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function isResolvedMetric(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && "metric" in value
    && isRecord(value.selection)
    && isRecord(value.confidence)
}

function isSummaryConfidence(value: unknown): boolean {
  return isRecord(value)
    && "conflictingMetrics" in value
    && "lowConfidenceMetrics" in value
    && "selectedProviders" in value
    && "level" in value
    && "notes" in value
}

function isJsonScalar(value: unknown): value is JsonValue {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
