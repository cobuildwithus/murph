import * as defaultCorePort from "@healthybob/core";

import type { SamplePresetRegistry } from "./preset-registry.js";
import { importCsvSamples } from "./csv-sample-importer.js";
import { importDocument } from "./document-importer.js";
import { importMeal } from "./meal-importer.js";
import { createSamplePresetRegistry } from "./preset-registry.js";

export interface CreateImportersOptions {
  corePort?: unknown;
  presetRegistry?: SamplePresetRegistry;
}

export function createImporters({ corePort, presetRegistry }: CreateImportersOptions = {}) {
  const registry = presetRegistry ?? createSamplePresetRegistry();
  const writer = corePort ?? defaultCorePort;

  return {
    presetRegistry: registry,
    importDocument(input: unknown) {
      return importDocument(input, { corePort: writer });
    },
    importMeal(input: unknown) {
      return importMeal(input, { corePort: writer });
    },
    importCsvSamples(input: unknown) {
      return importCsvSamples(input, {
        corePort: writer,
        presetRegistry: registry,
      });
    },
  };
}
