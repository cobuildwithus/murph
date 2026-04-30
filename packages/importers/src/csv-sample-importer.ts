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

  for (const importPlan of plan.imports) {
    const result = importPlan.payload.samples.length === 0
      ? createSkippedBatchResult(plan, importPlan)
      : await writePlannedBatch(writer.importSamples, plan, importPlan);

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
): Promise<CsvSampleImportBatchResult> {
  const rawResult = await writeImport(importPlan.payload);
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
