import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  DocumentImportPayload,
  MealImportPayload,
  SampleImportPayload,
} from "../src/core-port.ts";

export async function createTempFile(
  name: string,
  contents: string,
  directoryPrefix = "murph-importers-",
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), directoryPrefix));
  const filePath = join(directory, name);
  await writeFile(filePath, contents);
  return filePath;
}

export interface CorePortSpyCalls {
  documents: DocumentImportPayload[];
  meals: MealImportPayload[];
  sampleValidations: SampleImportPayload[];
  samples: SampleImportPayload[];
}

export function createCorePortSpy() {
  const calls: CorePortSpyCalls = {
    documents: [],
    meals: [],
    sampleValidations: [],
    samples: [],
  };

  return {
    calls,
    corePort: {
      async importDocument(payload: DocumentImportPayload) {
        calls.documents.push(payload);
        return { ok: true, kind: "document" as const };
      },
      async addMeal(payload: MealImportPayload) {
        calls.meals.push(payload);
        return { ok: true, kind: "meal" as const };
      },
      async validateSampleImport(payload: SampleImportPayload) {
        calls.sampleValidations.push(payload);
      },
      async importSamples(payload: SampleImportPayload) {
        calls.samples.push(payload);
        return {
          count: payload.samples.length,
          manifestPath: `raw/samples/${payload.stream}/import_spy/manifest.json`,
          records: payload.samples.map((_, index) => ({
            id: `smp_spy_${index + 1}`,
          })),
          shardPaths: ["ledger/samples/2026/2026-03.jsonl"],
          transformId: "xfm_spy",
        };
      },
    },
  };
}
