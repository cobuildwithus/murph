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
  samples: SampleImportPayload[];
}

export function createCorePortSpy() {
  const calls: CorePortSpyCalls = {
    documents: [],
    meals: [],
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
      async importSamples(payload: SampleImportPayload) {
        calls.samples.push(payload);
        return { ok: true, kind: "samples" as const };
      },
    },
  };
}
