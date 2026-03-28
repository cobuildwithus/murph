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
  normalizeNumber,
  normalizeOptionalString,
  normalizeRequiredString,
  normalizeTimestamp,
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

export async function prepareCsvSampleImport(
  input: unknown,
  { presetRegistry }: Pick<CsvSampleImporterOptions, "presetRegistry"> = {},
): Promise<SampleImportPayload> {
  const request = assertPlainObject(input, "sample import input");
  const config = resolveSampleImportConfig(request, presetRegistry);
  const stream = normalizeRequiredString(config.stream, "stream");
  const tsColumn = normalizeRequiredString(config.tsColumn, "tsColumn");
  const valueColumn = normalizeRequiredString(config.valueColumn, "valueColumn");
  const unit = normalizeRequiredString(config.unit, "unit");
  const delimiter = normalizeRequiredString(config.delimiter, "delimiter");
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
  const columnIndex = new Map(header.map((name, index) => [name, index]));
  const metadataColumns = config.metadataColumns;
  const tsIndex = requireColumn(columnIndex, tsColumn);
  const valueIndex = requireColumn(columnIndex, valueColumn);
  const metadataColumnIndexes = new Map<string, number>();

  for (const column of metadataColumns) {
    metadataColumnIndexes.set(column, requireColumn(columnIndex, column));
  }

  const samples: SampleImportRecord[] = [];
  const batchRows: SampleImportRowProvenance[] = [];

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];

    if (!row || row.every((cell) => cell.trim() === "")) {
      continue;
    }

    const sourceRow = index + 1;
    const recordedAt = normalizeTimestamp(row[tsIndex], `row ${sourceRow} ${tsColumn}`)!;
    const value = normalizeNumber(row[valueIndex], `row ${sourceRow} ${valueColumn}`);
    const metadata = Object.fromEntries(
      metadataColumns
        .map((column) => [column, row[metadataColumnIndexes.get(column) ?? -1]?.trim() ?? ""] as const)
        .filter(([, entry]) => entry.length > 0),
    );

    samples.push({
      recordedAt,
      value,
    });
    batchRows.push(
      stripUndefined({
        rowNumber: sourceRow,
        recordedAt,
        value,
        rawRecordedAt: String(row[tsIndex] ?? ""),
        rawValue: String(row[valueIndex] ?? ""),
        metadata: stripEmptyObject(metadata),
      }),
    );
  }

  if (samples.length === 0) {
    throw new Error("sample CSV did not contain any importable sample rows");
  }

  return stripUndefined({
    vaultRoot: normalizeOptionalString(request.vaultRoot, "vaultRoot"),
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

function requireColumn(columnIndex: ReadonlyMap<string, number>, columnName: string): number {
  const index = columnIndex.get(columnName);

  if (index === undefined) {
    throw new Error(`sample CSV is missing required column "${columnName}"`);
  }

  return index;
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
