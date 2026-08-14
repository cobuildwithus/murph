import { DEFAULT_TIMEZONE, loadVault } from "@murphai/core";
import {
  formatTimeZoneDateTimeParts,
  normalizeStrictIsoTimestamp,
  type SampleStream,
} from "@murphai/contracts";

import type {
  SampleImportBatchProvenance,
  SampleImportPayload,
  SampleImportRecord,
} from "./core-port.ts";
import type { SamplePresetRegistry } from "./preset-registry.ts";
import { resolveSampleImportConfig } from "./preset-registry.ts";
import {
  summarizeSampleSeries,
  type SampleSummaryProfile,
  type SampleWindowSummary,
} from "./sample-series-summary.ts";
import {
  assertPlainObject,
  inspectFileAsset,
  normalizeOptionalString,
  normalizeRequiredString,
  readUtf8File,
  stripUndefined,
} from "./shared.ts";

export interface CsvSampleImportInput {
  filePath: string;
  vaultRoot?: string;
  presetId?: string;
  source?: string;
  stream?: string;
  tsColumn?: string;
  valueColumn?: string;
  unit?: string;
  delimiter?: string;
  metadataColumns?: string[];
}

export interface CsvSampleFileProfileInput extends CsvSampleImportInput {
  includeSummary?: boolean;
  summaryProfile?: SampleSummaryProfile;
  thresholdBelow?: number[];
  gapSeconds?: number;
}

export interface CsvSampleImportSkipReasonCount {
  count: number;
  reason: string;
}

export interface PreparedCsvSampleImportPayload extends Omit<SampleImportPayload, "samples"> {
  samples: SampleImportRecord[];
}

export interface CsvSampleImportBatchPlan {
  stream: SampleStream;
  unit: string;
  valueColumn: string;
  importedCount: number;
  skippedCount: number;
  skipReasons: CsvSampleImportSkipReasonCount[];
  payload: PreparedCsvSampleImportPayload;
}

export interface CsvSampleImportPlan {
  vaultRoot?: string;
  sourcePath: string;
  sourceFileName: string;
  byteSize: number;
  delimiter: string;
  timeZone: string;
  tsColumn: string;
  columns: string[];
  rowCount: number;
  dataRowCount: number;
  blankRowCount: number;
  metadataColumns?: string[];
  imports: CsvSampleImportBatchPlan[];
}

export interface CsvSampleFileColumnProfile {
  name: string;
  index: number;
  role: "timestamp" | "sample_value" | "metadata" | "ignored";
  stream?: SampleStream;
  unit?: string;
}

export interface CsvSampleFileSourceHint {
  id: string;
  label: string;
  confidence: number;
}

export interface CsvSampleFileSeriesProfile {
  stream: SampleStream;
  unit: string;
  valueColumn: string;
  importableCount: number;
  skippedCount: number;
  skipReasons: CsvSampleImportSkipReasonCount[];
  minValue: number | null;
  maxValue: number | null;
  averageValue: number | null;
  confidence: number;
}

export interface CsvSampleFileProfile {
  vaultRoot?: string;
  sourcePath: string;
  sourceFileName: string;
  file: {
    kind: "csv";
    fileName: string;
    byteSize: number;
    delimiter: string;
    rowCount: number;
    dataRowCount: number;
    blankRowCount: number;
  };
  columns: CsvSampleFileColumnProfile[];
  time: {
    timeZone: string;
    timestampColumn: string;
    firstRecordedAt: string | null;
    lastRecordedAt: string | null;
    sampleIntervalSeconds: number | null;
    gapCount: number;
    gaps: Array<{ from: string; to: string; durationSeconds: number }>;
  };
  series: CsvSampleFileSeriesProfile[];
  sourceHints: CsvSampleFileSourceHint[];
  warnings: string[];
  summaries?: SampleWindowSummary[];
}

export interface CsvSampleImportWriteResult {
  count: number;
  manifestPath: string;
  records: Array<{ id: string }>;
  shardPaths: string[];
  transformId: string;
}

export interface CsvSampleImportBatchResult {
  stream: SampleStream;
  unit: string;
  timeZone: string;
  tsColumn: string;
  valueColumn: string;
  importedCount: number;
  skippedCount: number;
  skipReasons: CsvSampleImportSkipReasonCount[];
  transformId: string | null;
  manifestPath: string | null;
  lookupIds: string[];
  ledgerFiles: string[];
}

export interface CsvSampleImportResult {
  metadataColumns: string[];
  timeZone: string;
  tsColumn: string;
  importedCount: number;
  skippedCount: number;
  lookupIds: string[];
  ledgerFiles: string[];
  imports: CsvSampleImportBatchResult[];
}

const TIMESTAMP_COLUMN_ALIASES = Object.freeze([
  "timestamp",
  "time",
  "datetime",
  "date time",
  "date_time",
  "recorded at",
  "recorded_at",
  "recorded time",
  "recorded_time",
  "occurred at",
  "occurred_at",
] as const);

const SAMPLE_STREAM_COLUMN_ALIASES = Object.freeze({
  glucose: ["glucose", "blood glucose", "glucose level"],
  heart_rate: ["heart_rate", "heart rate", "heartrate", "pulse", "pulse rate", "bpm", "hr"],
  spo2: [
    "spo2",
    "spo2%",
    "sp o2",
    "blood oxygen",
    "blood oxygen saturation",
    "oxygen",
    "oxygen level",
    "oxygen saturation",
    "o2",
    "o2 saturation",
  ],
  hrv: ["hrv", "heart rate variability"],
  respiratory_rate: ["respiratory_rate", "respiratory rate", "breathing rate", "breaths per minute"],
  sleep_stage: ["sleep_stage", "sleep stage", "stage"],
  steps: ["steps", "step count", "count"],
  temperature: ["temperature", "body temperature", "temp"],
} as const satisfies Record<SampleStream, readonly string[]>);

const DEFAULT_SAMPLE_UNITS = Object.freeze({
  glucose: "mg_dL",
  heart_rate: "bpm",
  spo2: "%",
  hrv: "ms",
  respiratory_rate: "breaths_per_minute",
  sleep_stage: "stage",
  steps: "count",
  temperature: "celsius",
} as const satisfies Record<SampleStream, string>);

const SAMPLE_VALUE_SUFFIX_ALIASES = Object.freeze({
  glucose: ["mg/dl", "mg dl", "mg_dl", "mmol/l", "mmol l", "mmol_l"],
  heart_rate: ["bpm", "beats/min", "beats per minute", "beat/min", "beat per minute", "hr"],
  spo2: ["%", "percent", "percentage"],
  hrv: ["ms", "millisecond", "milliseconds"],
  respiratory_rate: ["rpm", "breaths/min", "breaths per minute", "breaths/minute"],
  sleep_stage: [],
  steps: ["steps", "step", "count"],
  temperature: ["c", "celsius", "f", "fahrenheit", "deg c", "deg f"],
} as const satisfies Record<SampleStream, readonly string[]>);

const MONTH_NUMBERS = Object.freeze({
  apr: 4,
  april: 4,
  aug: 8,
  august: 8,
  dec: 12,
  december: 12,
  feb: 2,
  february: 2,
  jan: 1,
  january: 1,
  jul: 7,
  july: 7,
  jun: 6,
  june: 6,
  mar: 3,
  march: 3,
  may: 5,
  nov: 11,
  november: 11,
  oct: 10,
  october: 10,
  sep: 9,
  sept: 9,
  september: 9,
} as const satisfies Record<string, number>);

const MONTH_NUMBERS_LOOKUP: Readonly<Record<string, number>> = MONTH_NUMBERS;

interface NaiveTimestampParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

interface RecognizedSampleColumn {
  columnName: string;
  stream: SampleStream;
}

interface PlannedImportColumn {
  stream: SampleStream;
  unit: string;
  valueColumn: string;
}

interface ImportCollector extends PlannedImportColumn {
  payload: PreparedCsvSampleImportPayload;
  skipReasonCounts: Map<string, number>;
  rowCount: number;
  valueIndex: number;
}

export async function prepareCsvSampleImport(
  input: unknown,
  { presetRegistry }: { presetRegistry?: Pick<SamplePresetRegistry, "get"> } = {},
): Promise<CsvSampleImportPlan> {
  const request = assertPlainObject(input, "sample import input");
  const config = resolveSampleImportConfig(request, presetRegistry);
  const delimiter = normalizeRequiredString(config.delimiter, "delimiter");
  const vaultRoot = normalizeOptionalString(request.vaultRoot, "vaultRoot");
  const rawArtifact = await inspectFileAsset(request.filePath);
  const csvText = await readUtf8File(rawArtifact.sourcePath);
  const rows = parseDelimitedRows(csvText, delimiter);
  const blankRowCount = countBlankDataRows(rows);

  if (rows.length < 2) {
    throw new Error("sample CSV must include a header row and at least one data row");
  }

  const headerRow = rows[0];

  if (!headerRow) {
    throw new Error("sample CSV must include a header row");
  }

  const header = headerRow.map((cell) => cell.trim());
  const timeZone = await resolveCsvImportTimeZone(vaultRoot);
  const recognizedSampleColumns = detectRecognizedSampleColumns(header);
  const tsColumn = resolveTimestampColumnName(header, config.tsColumn);
  const metadataColumns = config.metadataColumns;
  const plannedImports = resolvePlannedImports(config, header, recognizedSampleColumns);
  const tsIndex = requireColumn(header, tsColumn);
  for (const column of metadataColumns) {
    requireColumn(header, column);
  }

  const collectors = plannedImports.map((entry) => createImportCollector({
    payloadInput: {
      batchProvenance: {
        sourceFileName: rawArtifact.fileName,
      },
      importConfig: {
        delimiter,
        metadataColumns: metadataColumns.length === 0 ? undefined : metadataColumns,
        presetId: config.presetId,
        tsColumn,
        valueColumn: entry.valueColumn,
      },
      source: config.source,
      sourcePath: rawArtifact.sourcePath,
      stream: entry.stream,
      unit: entry.unit,
      vaultRoot,
    },
    valueIndex: requireColumn(header, entry.valueColumn),
    valueColumn: entry.valueColumn,
  }));

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];

    if (!row || row.every((cell) => cell.trim() === "")) {
      continue;
    }

    const rawRecordedAt = String(row[tsIndex] ?? "");
    const recordedAt = normalizeFlexibleTimestamp(rawRecordedAt, timeZone);

    for (const collector of collectors) {
      collector.rowCount += 1;
      const rawValue = String(row[collector.valueIndex] ?? "");
      const value = normalizeOptionalNumber(rawValue, collector.stream);

      if (!recordedAt || value === undefined) {
        const skipReason = resolveSkipReason(recordedAt, value);
        collector.skipReasonCounts.set(skipReason, (collector.skipReasonCounts.get(skipReason) ?? 0) + 1);
        continue;
      }

      collector.payload.samples.push({
        recordedAt,
        value,
      });
    }
  }

  const imports = collectors.map((collector) => finalizeImportCollector(collector));

  if (imports.every((entry) => entry.importedCount === 0)) {
    throw new Error("sample CSV did not contain any importable sample rows");
  }

  return stripUndefined({
    vaultRoot,
    sourceFileName: rawArtifact.fileName,
    sourcePath: rawArtifact.sourcePath,
    byteSize: rawArtifact.byteSize,
    delimiter,
    timeZone,
    tsColumn,
    columns: header,
    rowCount: rows.length,
    dataRowCount: Math.max(0, rows.length - 1 - blankRowCount),
    blankRowCount,
    metadataColumns: metadataColumns.length === 0 ? undefined : metadataColumns,
    imports,
  });
}

export async function profileCsvSampleFile(
  input: unknown,
  { presetRegistry }: { presetRegistry?: Pick<SamplePresetRegistry, "get"> } = {},
): Promise<CsvSampleFileProfile> {
  const request = assertPlainObject(input, "sample CSV profile input");
  const includeSummary = Boolean(request.includeSummary);
  const summaryProfile = normalizeSummaryProfile(request.summaryProfile);
  const thresholdBelow = normalizeNumberList(request.thresholdBelow, "thresholdBelow");
  const gapSeconds = normalizeOptionalFiniteNumber(request.gapSeconds, "gapSeconds");
  const plan = await prepareCsvSampleImport(request, { presetRegistry });
  const summaries = includeSummary
    ? plan.imports.map((entry) =>
      summarizeSampleSeries({
        stream: entry.stream,
        unit: entry.unit,
        samples: entry.payload.samples,
        profile: summaryProfile,
        thresholdsBelow: thresholdBelow,
        gapSeconds,
      })
    )
    : undefined;
  const firstSummary = summaries?.[0] ?? (plan.imports[0]
    ? summarizeSampleSeries({
      stream: plan.imports[0].stream,
      unit: plan.imports[0].unit,
      samples: plan.imports[0].payload.samples,
      gapSeconds,
    })
    : undefined);

  return stripUndefined({
    vaultRoot: plan.vaultRoot,
    sourcePath: plan.sourcePath,
    sourceFileName: plan.sourceFileName,
    file: {
      kind: "csv" as const,
      fileName: plan.sourceFileName,
      byteSize: plan.byteSize,
      delimiter: plan.delimiter,
      rowCount: plan.rowCount,
      dataRowCount: plan.dataRowCount,
      blankRowCount: plan.blankRowCount,
    },
    columns: profileColumns(plan),
    time: {
      timeZone: plan.timeZone,
      timestampColumn: plan.tsColumn,
      firstRecordedAt: firstSummary?.firstSampleAt ?? null,
      lastRecordedAt: firstSummary?.lastSampleAt ?? null,
      sampleIntervalSeconds: firstSummary?.sampleIntervalSeconds ?? null,
      gapCount: firstSummary?.gaps.length ?? 0,
      gaps: firstSummary?.gaps ?? [],
    },
    series: plan.imports.map((entry) => profileSeries(entry)),
    sourceHints: detectSourceHints(plan),
    warnings: buildProfileWarnings(plan),
    summaries,
  });
}

function countBlankDataRows(rows: readonly (readonly string[])[]): number {
  return rows.slice(1).filter((row) => row.every((cell) => cell.trim() === "")).length;
}

function profileColumns(plan: CsvSampleImportPlan): CsvSampleFileColumnProfile[] {
  const metadataColumns = new Set(plan.metadataColumns ?? []);

  return plan.columns.map((name, index) => {
    if (name === plan.tsColumn) {
      return { name, index, role: "timestamp" };
    }

    const series = plan.imports.find((entry) => entry.valueColumn === name);
    if (series) {
      return {
        name,
        index,
        role: "sample_value",
        stream: series.stream,
        unit: series.unit,
      };
    }

    if (metadataColumns.has(name)) {
      return { name, index, role: "metadata" };
    }

    return { name, index, role: "ignored" };
  });
}

function profileSeries(entry: CsvSampleImportBatchPlan): CsvSampleFileSeriesProfile {
  const summary = summarizeSampleSeries({
    stream: entry.stream,
    unit: entry.unit,
    samples: entry.payload.samples,
  });

  return {
    stream: entry.stream,
    unit: entry.unit,
    valueColumn: entry.valueColumn,
    importableCount: entry.importedCount,
    skippedCount: entry.skippedCount,
    skipReasons: entry.skipReasons,
    minValue: summary.minValue,
    maxValue: summary.maxValue,
    averageValue: summary.averageValue,
    confidence: entry.importedCount > 0 ? 0.98 : 0,
  };
}

function detectSourceHints(plan: CsvSampleImportPlan): CsvSampleFileSourceHint[] {
  const comparableColumns = new Set(plan.columns.map((column) => normalizeComparableText(column)));
  const comparableFileName = normalizeComparableText(plan.sourceFileName);
  const hasO2RingColumns =
    comparableColumns.has("time") &&
    comparableColumns.has("oxygenlevel") &&
    comparableColumns.has("pulserate");

  if (hasO2RingColumns || comparableFileName.includes("o2ring")) {
    return [{
      id: "wellue-o2ring-csv",
      label: "O2Ring-style CSV",
      confidence: hasO2RingColumns ? 0.86 : 0.65,
    }];
  }

  return [];
}

function buildProfileWarnings(plan: CsvSampleImportPlan): string[] {
  const warnings: string[] = [];

  if (plan.blankRowCount > 0) {
    warnings.push(`${plan.blankRowCount} blank data row(s) were skipped.`);
  }

  for (const entry of plan.imports) {
    if (entry.skippedCount > 0) {
      warnings.push(`${entry.skippedCount} ${entry.stream} row(s) were skipped.`);
    }
  }

  return warnings;
}

function normalizeSummaryProfile(value: unknown): SampleSummaryProfile | undefined {
  const normalized = normalizeOptionalString(value, "summaryProfile");
  if (normalized === undefined) {
    return undefined;
  }

  if (normalized !== "oxygen-night") {
    throw new Error(`Unsupported sample summary profile "${normalized}"`);
  }

  return normalized;
}

function normalizeNumberList(value: unknown, label: string): number[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array of numbers when provided`);
  }

  return value.map((entry, index) => normalizeFiniteNumber(entry, `${label}[${index}]`));
}

function normalizeOptionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return normalizeFiniteNumber(value, label);
}

function normalizeFiniteNumber(value: unknown, label: string): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new TypeError(`${label} must be a finite number`);
  }

  return numeric;
}

function createImportCollector(input: {
  payloadInput: {
    batchProvenance: Pick<SampleImportBatchProvenance, "sourceFileName">;
    importConfig: PreparedCsvSampleImportPayload["importConfig"];
    source?: string;
    sourcePath: string;
    stream: SampleStream;
    unit: string;
    vaultRoot?: string;
  };
  valueIndex: number;
  valueColumn: string;
}): ImportCollector {
  const { payloadInput } = input;

  return {
    stream: payloadInput.stream,
    unit: payloadInput.unit,
    valueColumn: input.valueColumn,
    payload: stripUndefined({
      vaultRoot: payloadInput.vaultRoot,
      stream: payloadInput.stream,
      unit: payloadInput.unit,
      source: payloadInput.source,
      sourcePath: payloadInput.sourcePath,
      importConfig: payloadInput.importConfig,
      samples: [],
      batchProvenance: {
        sourceFileName: payloadInput.batchProvenance.sourceFileName,
        importConfig: payloadInput.importConfig,
      },
    }),
    skipReasonCounts: new Map<string, number>(),
    rowCount: 0,
    valueIndex: input.valueIndex,
  };
}

function finalizeImportCollector(collector: ImportCollector): CsvSampleImportBatchPlan {
  const skipReasons = [...collector.skipReasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => left.reason.localeCompare(right.reason));
  const skippedCount = skipReasons.reduce((sum, entry) => sum + entry.count, 0);
  const batchProvenance = collector.payload.batchProvenance;

  if (batchProvenance) {
    batchProvenance.rowCount = collector.rowCount;
    batchProvenance.skippedCount = skippedCount;
    batchProvenance.skipReasons = skipReasons;
  }

  return {
    stream: collector.stream,
    unit: collector.unit,
    valueColumn: collector.valueColumn,
    importedCount: collector.payload.samples.length,
    skippedCount,
    skipReasons,
    payload: collector.payload,
  };
}

function resolvePlannedImports(
  config: {
    stream?: string;
    unit?: string;
    valueColumn?: string;
  },
  header: readonly string[],
  recognizedSampleColumns: readonly RecognizedSampleColumn[],
): PlannedImportColumn[] {
  const explicitStream = config.stream ? resolveRequestedStream(config.stream) : undefined;

  if (explicitStream) {
    return [{
      stream: explicitStream,
      unit: normalizeRequiredString(config.unit ?? DEFAULT_SAMPLE_UNITS[explicitStream], "unit"),
      valueColumn: resolveValueColumnName(
        header,
        config.valueColumn,
        explicitStream,
        recognizedSampleColumns,
      ),
    }];
  }

  if (config.valueColumn) {
    const stream = resolveStreamForRequestedValueColumn(config.valueColumn, header, recognizedSampleColumns);
    return [{
      stream,
      unit: normalizeRequiredString(config.unit ?? DEFAULT_SAMPLE_UNITS[stream], "unit"),
      valueColumn: resolveValueColumnName(header, config.valueColumn, stream, recognizedSampleColumns),
    }];
  }

  const groups = new Map<SampleStream, string[]>();

  for (const candidate of recognizedSampleColumns) {
    const columns = groups.get(candidate.stream) ?? [];
    columns.push(candidate.columnName);
    groups.set(candidate.stream, columns);
  }

  if (groups.size === 0) {
    throw new Error("sample CSV does not contain a recognizable sample value column");
  }

  for (const [stream, columns] of groups) {
    if (columns.length > 1) {
      throw new Error(
        `sample CSV contains multiple candidate columns for stream "${stream}": ${columns.join(", ")}. Pass --value-column to choose one.`,
      );
    }
  }

  if (config.unit && groups.size > 1) {
    throw new Error("sample CSV imports multiple streams; pass --stream or --value-column to apply a unit override.");
  }

  return [...groups.entries()].map(([stream, columns]) => ({
    stream,
    unit: normalizeRequiredString(config.unit ?? DEFAULT_SAMPLE_UNITS[stream], "unit"),
    valueColumn: columns[0] as string,
  }));
}

function resolveRequestedStream(value: string): SampleStream {
  const stream = normalizeSampleStreamAlias(value);

  if (!stream) {
    throw new Error(`Unsupported sample stream "${value}"`);
  }

  return stream;
}

function resolveTimestampColumnName(header: readonly string[], requestedColumn: string | undefined): string {
  if (requestedColumn) {
    const exactMatch = findHeaderName(header, [requestedColumn]);

    if (exactMatch) {
      return exactMatch;
    }

    throw new Error(`sample CSV is missing required column "${requestedColumn}"`);
  }

  const inferredMatches = header.filter((columnName) =>
    TIMESTAMP_COLUMN_ALIASES.some((alias) => normalizeComparableText(alias) === normalizeComparableText(columnName))
  );

  if (inferredMatches.length === 1) {
    return inferredMatches[0] as string;
  }

  if (inferredMatches.length > 1) {
    throw new Error(
      `sample CSV contains multiple candidate timestamp columns: ${inferredMatches.join(", ")}. Pass --ts-column to choose one.`,
    );
  }

  throw new Error("sample CSV is missing a recognizable timestamp column");
}

function resolveValueColumnName(
  header: readonly string[],
  requestedColumn: string | undefined,
  stream: SampleStream,
  recognizedSampleColumns: readonly RecognizedSampleColumn[],
): string {
  if (requestedColumn) {
    const exactMatch = findHeaderName(header, [requestedColumn]);

    if (exactMatch) {
      return exactMatch;
    }

    const aliasedMatch = findHeaderName(header, SAMPLE_STREAM_COLUMN_ALIASES[stream]);

    if (aliasedMatch) {
      return aliasedMatch;
    }

    throw new Error(`sample CSV is missing required column "${requestedColumn}"`);
  }

  const streamMatches = recognizedSampleColumns
    .filter((candidate) => candidate.stream === stream)
    .map((candidate) => candidate.columnName);

  if (streamMatches.length === 1) {
    return streamMatches[0] as string;
  }

  if (streamMatches.length > 1) {
    throw new Error(
      `sample CSV contains multiple candidate columns for stream "${stream}": ${streamMatches.join(", ")}. Pass --value-column to choose one.`,
    );
  }

  throw new Error(`sample CSV is missing a recognizable value column for stream "${stream}"`);
}

function resolveStreamForRequestedValueColumn(
  requestedValueColumn: string,
  header: readonly string[],
  recognizedSampleColumns: readonly RecognizedSampleColumn[],
): SampleStream {
  const requestedStream = normalizeSampleStreamAlias(requestedValueColumn);

  if (requestedStream) {
    return requestedStream;
  }

  const matchedHeader = findHeaderName(header, [requestedValueColumn]);
  const matchedColumn = matchedHeader
    ? recognizedSampleColumns.find((candidate) => candidate.columnName === matchedHeader)
    : undefined;

  if (matchedColumn) {
    return matchedColumn.stream;
  }

  throw new Error(
    `sample CSV could not infer a stream for value column "${requestedValueColumn}". Pass --stream to choose one.`,
  );
}

function requireColumn(header: readonly string[], columnName: string): number {
  const index = header.findIndex((candidate) => normalizeComparableText(candidate) === normalizeComparableText(columnName));

  if (index < 0) {
    throw new Error(`sample CSV is missing required column "${columnName}"`);
  }

  return index;
}

function detectRecognizedSampleColumns(header: readonly string[]): RecognizedSampleColumn[] {
  return header.flatMap((columnName) => {
    const stream = detectStreamForHeader(columnName);
    return stream ? [{ columnName, stream }] : [];
  });
}

function detectStreamForHeader(columnName: string): SampleStream | undefined {
  const normalized = normalizeComparableText(columnName);

  for (const [stream, aliases] of Object.entries(SAMPLE_STREAM_COLUMN_ALIASES) as Array<
    [SampleStream, readonly string[]]
  >) {
    if (aliases.some((alias) => normalizeComparableText(alias) === normalized)) {
      return stream;
    }
  }

  return undefined;
}

function normalizeSampleStreamAlias(value: string | undefined): SampleStream | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeComparableText(value);

  for (const [stream, aliases] of Object.entries(SAMPLE_STREAM_COLUMN_ALIASES) as Array<
    [SampleStream, readonly string[]]
  >) {
    if (
      normalizeComparableText(stream) === normalized ||
      aliases.some((alias) => normalizeComparableText(alias) === normalized)
    ) {
      return stream;
    }
  }

  return undefined;
}

function findHeaderName(
  header: readonly string[],
  candidateNames: readonly string[],
): string | undefined {
  const normalizedCandidates = new Set(candidateNames.map((candidate) => normalizeComparableText(candidate)));

  return header.find((columnName) => normalizedCandidates.has(normalizeComparableText(columnName)));
}

function normalizeComparableText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/%/gu, " percent ")
    .replace(/[^a-z0-9]+/gu, "");
}

function resolveSkipReason(recordedAt: string | undefined, value: number | undefined): string {
  const reasons = [
    !recordedAt ? "unparseable timestamp" : null,
    value === undefined ? "non-numeric value" : null,
  ].filter((entry): entry is string => entry !== null);

  return reasons.join("; ");
}

function normalizeOptionalNumber(value: unknown, stream: SampleStream): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = String(value).trim();

  if (trimmed.length === 0 || /^(?:--+|n\/a|na|null|none|nan)$/iu.test(trimmed)) {
    return undefined;
  }

  const normalizedBase = trimmed
    .replace(/[°]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const candidates = new Set([normalizedBase, normalizedBase.toLowerCase()]);

  for (const suffix of SAMPLE_VALUE_SUFFIX_ALIASES[stream]) {
    candidates.add(stripNumericSuffix(normalizedBase, suffix));
  }

  for (const candidate of candidates) {
    const numeric = Number(candidate);

    if (Number.isFinite(numeric)) {
      return numeric;
    }

    const groupedNumeric = normalizeGroupedNumberCandidate(candidate);
    if (groupedNumeric !== null) {
      const grouped = Number(groupedNumeric);
      if (Number.isFinite(grouped)) {
        return grouped;
      }
    }
  }

  return undefined;
}

function normalizeGroupedNumberCandidate(value: string): string | null {
  if (!value.includes(",")) {
    return null;
  }

  const parts = value.split(".");
  if (parts.length > 2) {
    return null;
  }

  const [integerPart = "", fractionalPart] = parts;
  const sign = /^[+-]/u.test(integerPart) ? integerPart.slice(0, 1) : "";
  const unsignedInteger = sign ? integerPart.slice(1) : integerPart;
  if (!/^\d{1,3}(?:,\d{3})+$/u.test(unsignedInteger)) {
    return null;
  }
  if (fractionalPart !== undefined && !/^\d+$/u.test(fractionalPart)) {
    return null;
  }

  return `${sign}${unsignedInteger.replace(/,/gu, "")}${fractionalPart === undefined ? "" : `.${fractionalPart}`}`;
}

function stripNumericSuffix(value: string, suffix: string): string {
  const escapedSuffix = escapeRegex(suffix.trim().replace(/[°]/gu, ""));
  return value.replace(new RegExp(`\\s*${escapedSuffix}\\s*$`, "iu"), "").trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function normalizeFlexibleTimestamp(value: unknown, timeZone: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const strict = normalizeStrictIsoTimestamp(
    typeof value === "string" ? value.trim() : (value as string | number | Date),
  );

  if (strict) {
    return strict;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  const unixTimestamp = normalizeUnixTimestamp(trimmed);

  if (unixTimestamp) {
    return unixTimestamp;
  }

  const naiveParts = parseNaiveTimestampParts(trimmed);

  if (naiveParts) {
    return naiveTimestampPartsToIso(naiveParts, timeZone);
  }

  if (/(?:z|gmt|utc|[+-]\d{2}:?\d{2})$/iu.test(trimmed)) {
    const parsedMilliseconds = Date.parse(trimmed);

    if (!Number.isNaN(parsedMilliseconds)) {
      return new Date(parsedMilliseconds).toISOString();
    }
  }

  return undefined;
}

function normalizeUnixTimestamp(value: string): string | undefined {
  if (!/^\d{10}(?:\d{3})?$/u.test(value)) {
    return undefined;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  const milliseconds = value.length === 10 ? numeric * 1000 : numeric;
  return new Date(milliseconds).toISOString();
}

function parseNaiveTimestampParts(value: string): NaiveTimestampParts | undefined {
  const isoLikeMatch =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u.exec(value);

  if (isoLikeMatch) {
    return finalizeNaiveTimestampParts({
      year: Number(isoLikeMatch[1]),
      month: Number(isoLikeMatch[2]),
      day: Number(isoLikeMatch[3]),
      hour: Number(isoLikeMatch[4]),
      minute: Number(isoLikeMatch[5]),
      second: Number(isoLikeMatch[6] ?? "0"),
      millisecond: Number((isoLikeMatch[7] ?? "").padEnd(3, "0") || "0"),
    });
  }

  const timeFirstMatch =
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})$/u.exec(value);

  if (timeFirstMatch) {
    const month = MONTH_NUMBERS_LOOKUP[timeFirstMatch[4]!.toLowerCase()];

    if (!month) {
      return undefined;
    }

    return finalizeNaiveTimestampParts({
      year: Number(timeFirstMatch[6]),
      month,
      day: Number(timeFirstMatch[5]),
      hour: Number(timeFirstMatch[1]),
      minute: Number(timeFirstMatch[2]),
      second: Number(timeFirstMatch[3] ?? "0"),
      millisecond: 0,
    });
  }

  return undefined;
}

function finalizeNaiveTimestampParts(parts: NaiveTimestampParts): NaiveTimestampParts | undefined {
  const candidate = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond,
    ),
  );

  if (
    Number.isNaN(candidate.valueOf()) ||
    candidate.getUTCFullYear() !== parts.year ||
    candidate.getUTCMonth() + 1 !== parts.month ||
    candidate.getUTCDate() !== parts.day ||
    candidate.getUTCHours() !== parts.hour ||
    candidate.getUTCMinutes() !== parts.minute ||
    candidate.getUTCSeconds() !== parts.second ||
    candidate.getUTCMilliseconds() !== parts.millisecond
  ) {
    return undefined;
  }

  return parts;
}

function naiveTimestampPartsToIso(parts: NaiveTimestampParts, timeZone: string): string {
  let guessMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  const targetMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0,
  );

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const zoned = formatTimeZoneDateTimeParts(guessMs, timeZone);
    const observedMs = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second,
      0,
    );
    const delta = targetMs - observedMs;

    if (delta === 0) {
      return new Date(guessMs).toISOString();
    }

    guessMs += delta;
  }

  return new Date(guessMs).toISOString();
}

async function resolveCsvImportTimeZone(vaultRoot: string | undefined): Promise<string> {
  if (!vaultRoot) {
    return DEFAULT_TIMEZONE;
  }

  const vault = await loadVault({ vaultRoot });
  return vault.metadata.timezone ?? DEFAULT_TIMEZONE;
}

export function parseDelimitedRows(text: string, delimiter = ","): string[][] {
  const normalizedDelimiter = normalizeRequiredString(delimiter, "delimiter");

  if (normalizedDelimiter.length !== 1) {
    throw new TypeError("delimiter must be a single character");
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === "\"") {
        if (text[index + 1] === "\"") {
          field += "\"";
          index += 1;
          continue;
        }

        inQuotes = false;
        continue;
      }

      field += character;
      continue;
    }

    if (character === "\"") {
      inQuotes = true;
      continue;
    }

    if (character === normalizedDelimiter) {
      row.push(field);
      field = "";
      continue;
    }

    if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (character === "\r") {
      continue;
    }

    field += character;
  }

  if (inQuotes) {
    throw new Error("sample CSV contains an unterminated quoted field");
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
