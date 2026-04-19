import { DEFAULT_TIMEZONE, loadVault } from "@murphai/core";
import {
  formatTimeZoneDateTimeParts,
  normalizeStrictIsoTimestamp,
  type SampleStream,
} from "@murphai/contracts";

import { assertCanonicalWritePort } from "./core-port.ts";
import type {
  SampleImportPayload,
  SampleImportRecord,
  SampleImportRowProvenance,
} from "./core-port.ts";
import type { SamplePresetRegistry } from "./preset-registry.ts";
import { resolveSampleImportConfig } from "./preset-registry.ts";
import {
  assertPlainObject,
  inspectFileAsset,
  normalizeOptionalString,
  normalizeRequiredString,
  readUtf8File,
  stripEmptyObject,
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

export interface CsvSampleImporterOptions {
  corePort?: unknown;
  presetRegistry?: Pick<SamplePresetRegistry, "get">;
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

export async function prepareCsvSampleImport(
  input: unknown,
  { presetRegistry }: Pick<CsvSampleImporterOptions, "presetRegistry"> = {},
): Promise<SampleImportPayload> {
  const request = assertPlainObject(input, "sample import input");
  const config = resolveSampleImportConfig(request, presetRegistry);
  const delimiter = normalizeRequiredString(config.delimiter, "delimiter");
  const vaultRoot = normalizeOptionalString(request.vaultRoot, "vaultRoot");
  const rawArtifact = await inspectFileAsset(request.filePath);
  const csvText = await readUtf8File(rawArtifact.sourcePath);
  const rows = parseDelimitedRows(csvText, delimiter);

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
  const stream = resolveSampleStream(config.stream, config.valueColumn, header, recognizedSampleColumns);
  const unit = normalizeRequiredString(
    config.unit ?? DEFAULT_SAMPLE_UNITS[stream],
    "unit",
  );
  const tsColumn = resolveTimestampColumnName(header, config.tsColumn);
  const valueColumn = resolveValueColumnName(
    header,
    config.valueColumn,
    stream,
    recognizedSampleColumns,
  );
  const metadataColumns = config.metadataColumns;
  const tsIndex = requireColumn(header, tsColumn);
  const valueIndex = requireColumn(header, valueColumn);
  const metadataColumnIndexes = new Map<string, number>();

  for (const column of metadataColumns) {
    metadataColumnIndexes.set(column, requireColumn(header, column));
  }

  const samples: SampleImportRecord[] = [];
  const batchRows: SampleImportRowProvenance[] = [];

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];

    if (!row || row.every((cell) => cell.trim() === "")) {
      continue;
    }

    const sourceRow = index + 1;
    const metadata = Object.fromEntries(
      metadataColumns
        .map((column) => [column, row[metadataColumnIndexes.get(column) ?? -1]?.trim() ?? ""] as const)
        .filter(([, entry]) => entry.length > 0),
    );
    const rawRecordedAt = String(row[tsIndex] ?? "");
    const rawValue = String(row[valueIndex] ?? "");
    const recordedAt = normalizeFlexibleTimestamp(rawRecordedAt, timeZone);
    const value = normalizeOptionalNumber(rawValue);

    if (!recordedAt || value === undefined) {
      const skipReasons = [
        !recordedAt ? "unparseable timestamp" : null,
        value === undefined ? "non-numeric value" : null,
      ].filter((entry): entry is string => entry !== null);

      batchRows.push(
        stripUndefined({
          rowNumber: sourceRow,
          rawRecordedAt,
          rawValue,
          metadata: stripEmptyObject(metadata),
          skipped: true,
          skipReason: skipReasons.join("; "),
        }),
      );
      continue;
    }

    samples.push({
      recordedAt,
      value,
    });
    batchRows.push(
      stripUndefined({
        rowNumber: sourceRow,
        recordedAt,
        value,
        rawRecordedAt,
        rawValue,
        metadata: stripEmptyObject(metadata),
      }),
    );
  }

  if (samples.length === 0) {
    throw new Error("sample CSV did not contain any importable sample rows");
  }

  return stripUndefined({
    vaultRoot,
    stream,
    unit,
    source: config.source,
    sourcePath: rawArtifact.sourcePath,
    importConfig: {
      presetId: config.presetId,
      delimiter,
      tsColumn,
      valueColumn,
      metadataColumns: metadataColumns.length === 0 ? undefined : metadataColumns,
    },
    samples,
    batchProvenance: {
      sourceFileName: rawArtifact.fileName,
      importConfig: {
        presetId: config.presetId,
        delimiter,
        tsColumn,
        valueColumn,
        metadataColumns: metadataColumns.length === 0 ? undefined : metadataColumns,
      },
      rows: batchRows,
    },
  });
}

export async function importCsvSamples<TResult = unknown>(
  input: unknown,
  { corePort, presetRegistry }: CsvSampleImporterOptions = {},
): Promise<TResult> {
  const writer = assertCanonicalWritePort(corePort, ["importSamples"]);
  const payload = await prepareCsvSampleImport(input, { presetRegistry });
  return (await writer.importSamples(payload)) as TResult;
}

function resolveTimestampColumnName(header: readonly string[], requestedColumn: string | undefined): string {
  if (requestedColumn) {
    const exactMatch = findHeaderName(header, [requestedColumn]);

    if (exactMatch) {
      return exactMatch;
    }
  }

  const inferred = findHeaderName(header, TIMESTAMP_COLUMN_ALIASES);

  if (inferred) {
    return inferred;
  }

  if (requestedColumn) {
    throw new Error(`sample CSV is missing required column "${requestedColumn}"`);
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

  const streamMatch = findHeaderName(header, SAMPLE_STREAM_COLUMN_ALIASES[stream]);

  if (streamMatch) {
    return streamMatch;
  }

  const uniqueColumns = recognizedSampleColumns.filter((candidate) => candidate.stream === stream);

  if (uniqueColumns.length === 1) {
    return uniqueColumns[0]!.columnName;
  }

  if (uniqueColumns.length > 1) {
    throw new Error(
      `sample CSV contains multiple candidate columns for stream "${stream}": ${uniqueColumns
        .map((candidate) => candidate.columnName)
        .join(", ")}`,
    );
  }

  throw new Error(`sample CSV is missing a recognizable value column for stream "${stream}"`);
}

function resolveSampleStream(
  requestedStream: string | undefined,
  requestedValueColumn: string | undefined,
  header: readonly string[],
  recognizedSampleColumns: readonly RecognizedSampleColumn[],
): SampleStream {
  if (requestedStream && !normalizeSampleStreamAlias(requestedStream)) {
    throw new Error(`Unsupported sample stream "${requestedStream}"`);
  }

  const explicitStream = normalizeSampleStreamAlias(requestedStream);

  if (explicitStream) {
    return explicitStream;
  }

  const valueColumnStream = normalizeSampleStreamAlias(requestedValueColumn);

  if (valueColumnStream) {
    return valueColumnStream;
  }

  if (requestedValueColumn) {
    const matchedHeader = findHeaderName(header, [requestedValueColumn]);
    const matchedColumn = matchedHeader
      ? recognizedSampleColumns.find((candidate) => candidate.columnName === matchedHeader)
      : undefined;

    if (matchedColumn) {
      return matchedColumn.stream;
    }
  }

  const uniqueStreams = [...new Set(recognizedSampleColumns.map((candidate) => candidate.stream))];

  if (uniqueStreams.length === 1) {
    return uniqueStreams[0]!;
  }

  if (uniqueStreams.length === 0) {
    throw new Error("sample CSV does not contain a recognizable sample value column");
  }

  throw new Error(
    `sample CSV contains multiple importable sample columns: ${recognizedSampleColumns
      .map((candidate) => `${candidate.columnName} (${candidate.stream})`)
      .join(", ")}. Pass --stream or --value-column to choose one.`,
  );
}

function requireColumn(header: readonly string[], columnName: string): number {
  const index = header.findIndex((candidate) => normalizeComparableText(candidate) === normalizeComparableText(columnName));

  if (index < 0) {
    throw new Error(`sample CSV is missing required column "${columnName}"`);
  }

  return index;
}

interface RecognizedSampleColumn {
  columnName: string;
  stream: SampleStream;
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
  const normalizedCandidates = new Set(
    candidateNames.map((candidate) => normalizeComparableText(candidate)),
  );

  return header.find((columnName) => normalizedCandidates.has(normalizeComparableText(columnName)));
}

function normalizeComparableText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/%/gu, " percent ")
    .replace(/[^a-z0-9]+/gu, "");
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = String(value).trim();

  if (trimmed.length === 0 || /^(?:--+|n\/a|na|null|none|nan)$/iu.test(trimmed)) {
    return undefined;
  }

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function normalizeFlexibleTimestamp(value: unknown, timeZone: string): string | undefined {
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
