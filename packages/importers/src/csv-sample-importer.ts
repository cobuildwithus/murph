import { assertCanonicalWritePort } from "./core-port.ts";
import type { SampleImportPayload } from "./core-port.ts";
import type { SamplePresetRegistry } from "./preset-registry.ts";
import {
  type CsvSampleImportBatchPlan,
  type CsvSampleImportBatchResult,
  type CsvSampleImportInput,
  type CsvSampleImportPlan,
  type CsvSampleImportResult,
  type CsvSampleImportWriteResult,
  CsvSampleImportError,
  parseDelimitedRows,
  prepareCsvSampleImport,
  profileCsvSampleFile,
} from "./csv-sample-import-planner.ts";

export type {
  CsvSampleFileColumnProfile,
  CsvSampleFileProfile,
  CsvSampleFileProfileInput,
  CsvSampleFileSeriesProfile,
  CsvSampleFileSourceHint,
  CsvSampleImportBatchPlan,
  CsvSampleImportBatchResult,
  CsvSampleImportInput,
  CsvSampleImportPlan,
  CsvSampleImportResult,
  CsvSampleImportSkipReasonCount,
  CsvSampleImportWriteResult,
  PreparedCsvSampleImportPayload,
} from "./csv-sample-import-planner.ts";
export { CsvSampleImportError } from "./csv-sample-import-planner.ts";
export type {
  CsvSampleImportRepair,
  CsvSampleImportRepairField,
} from "./csv-sample-import-planner.ts";
export type {
  SampleSeriesInputRecord,
  SampleSeriesSummaryInput,
  SampleSummaryProfile,
  SampleThresholdSummary,
  SampleWindowGap,
  SampleWindowScreen,
  SampleWindowSummary,
} from "./sample-series-summary.ts";
export { summarizeSampleSeries } from "./sample-series-summary.ts";

export interface CsvSampleImporterOptions {
  corePort?: unknown;
  presetRegistry?: Pick<SamplePresetRegistry, "get">;
}

export async function importCsvSamples(
  input: unknown,
  { corePort, presetRegistry }: CsvSampleImporterOptions = {},
): Promise<CsvSampleImportResult> {
  const writer = assertCanonicalWritePort(corePort, ["importSamples"]);
  const plan = await prepareCsvSampleImport(input, { presetRegistry });
  const imports: CsvSampleImportBatchResult[] = [];
  const lookupIds: string[] = [];
  const ledgerFileSet = new Set<string>();
  let importedCount = 0;
  let skippedCount = 0;

  for (const [importIndex, importPlan] of plan.imports.entries()) {
    const result = importPlan.payload.samples.length === 0
      ? createSkippedBatchResult(plan, importPlan)
      : await writePlannedBatch(
        writer.importSamples,
        plan,
        importPlan,
        importIndex,
      );

    imports.push(result);
    importedCount += result.importedCount;
    skippedCount += result.skippedCount;

    for (const lookupId of result.lookupIds) {
      lookupIds.push(lookupId);
    }

    for (const ledgerFile of result.ledgerFiles) {
      ledgerFileSet.add(ledgerFile);
    }
  }

  return {
    metadataColumns: plan.metadataColumns ?? [],
    timeZone: plan.timeZone,
    tsColumn: plan.tsColumn,
    importedCount,
    skippedCount,
    lookupIds,
    ledgerFiles: [...ledgerFileSet],
    imports,
  };
}

function createSkippedBatchResult(
  plan: CsvSampleImportPlan,
  importPlan: CsvSampleImportBatchPlan,
): CsvSampleImportBatchResult {
  return {
    stream: importPlan.stream,
    unit: importPlan.unit,
    timeZone: plan.timeZone,
    tsColumn: plan.tsColumn,
    valueColumn: importPlan.valueColumn,
    importedCount: 0,
    skippedCount: importPlan.skippedCount,
    skipReasons: importPlan.skipReasons,
    transformId: null,
    manifestPath: null,
    lookupIds: [],
    ledgerFiles: [],
  };
}

async function writePlannedBatch(
  writeImport: (payload: SampleImportPayload) => unknown,
  plan: CsvSampleImportPlan,
  importPlan: CsvSampleImportBatchPlan,
  importIndex: number,
): Promise<CsvSampleImportBatchResult> {
  let rawResult: unknown;
  try {
    rawResult = await writeImport(importPlan.payload);
  } catch (error) {
    throw toCsvSampleWriteError(error, importIndex, importPlan.stream);
  }
  const result = normalizeWriteResult(rawResult);

  return {
    stream: importPlan.stream,
    unit: importPlan.unit,
    timeZone: plan.timeZone,
    tsColumn: plan.tsColumn,
    valueColumn: importPlan.valueColumn,
    importedCount: importPlan.importedCount,
    skippedCount: importPlan.skippedCount,
    skipReasons: importPlan.skipReasons,
    transformId: result.transformId,
    manifestPath: result.manifestPath,
    lookupIds: result.records.map((record) => record.id),
    ledgerFiles: result.shardPaths,
  };
}

function toCsvSampleWriteError(
  error: unknown,
  importIndex: number,
  stream: CsvSampleImportBatchPlan["stream"],
): unknown {
  if (
    !Number.isSafeInteger(importIndex)
    || importIndex < 0
    || !isRecord(error)
    || !isRecord(error.details)
  ) {
    return error;
  }

  const sampleIndex = error.details.sampleIndex;
  const sampleField = error.details.sampleField;
  if (
    typeof sampleIndex !== "number"
    || !Number.isSafeInteger(sampleIndex)
    || sampleIndex < 0
    || typeof sampleField !== "string"
  ) {
    return error;
  }

  return new CsvSampleImportError(
    "invalid_sample",
    "Sample CSV contains an invalid sample field.",
    {
      stage: "validation",
      fields: [
        {
          path: ["imports", importIndex, "samples"],
          code: "invalid_sample",
          message: "Planned samples failed semantic validation.",
          expected: "samples valid for the planned stream",
          sampleField,
          stream,
        },
      ],
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeWriteResult(value: unknown): CsvSampleImportWriteResult {
  if (!value || typeof value !== "object") {
    throw new TypeError("sample CSV import returned an invalid core result");
  }

  const candidate = value as Partial<CsvSampleImportWriteResult>;

  if (
    typeof candidate.count !== "number" ||
    typeof candidate.transformId !== "string" ||
    typeof candidate.manifestPath !== "string" ||
    !Array.isArray(candidate.records) ||
    !Array.isArray(candidate.shardPaths)
  ) {
    throw new TypeError("sample CSV import returned an invalid core result");
  }

  return {
    count: candidate.count,
    transformId: candidate.transformId,
    manifestPath: candidate.manifestPath,
    records: candidate.records.map((record) => {
      if (!record || typeof record !== "object" || typeof record.id !== "string") {
        throw new TypeError("sample CSV import returned a malformed record list");
      }

      return { id: record.id };
    }),
    shardPaths: candidate.shardPaths.map((entry) => {
      if (typeof entry !== "string") {
        throw new TypeError("sample CSV import returned malformed shard paths");
      }

      return entry;
    }),
  };
}

export { parseDelimitedRows, prepareCsvSampleImport, profileCsvSampleFile };
