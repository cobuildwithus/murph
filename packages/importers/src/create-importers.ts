import * as coreRuntime from "@murphai/core";

import type { SamplePresetRegistry } from "./preset-registry.ts";
import { importAssessmentResponse } from "./assessment/import-assessment-response.ts";
import { importCsvSamples } from "./csv-sample-importer.ts";
import { importDocument } from "./document-importer.ts";
import {
  createDeviceProviderRegistry,
  defaultDeviceProviderAdapters,
  importDeviceProviderSnapshot,
} from "./device-providers/index.ts";
import { addMeal } from "./meal-importer.ts";
import { createSamplePresetRegistry } from "./preset-registry.ts";

import type { DeviceProviderRegistry } from "./device-providers/index.ts";

export interface CreateImportersOptions {
  corePort?: unknown;
  presetRegistry?: SamplePresetRegistry;
  deviceProviderRegistry?: DeviceProviderRegistry;
}

export function createImporters({
  corePort,
  presetRegistry,
  deviceProviderRegistry,
}: CreateImportersOptions = {}) {
  const registry = presetRegistry ?? createSamplePresetRegistry();
  const providers = deviceProviderRegistry ?? createDeviceProviderRegistry(defaultDeviceProviderAdapters);
  const writer = corePort ?? coreRuntime;

  return {
    presetRegistry: registry,
    deviceProviderRegistry: providers,
    importDocument(input: unknown) {
      return importDocument(input, { corePort: writer });
    },
    addMeal(input: unknown) {
      return addMeal(input, { corePort: writer });
    },
    importAssessmentResponse(input: unknown) {
      return importAssessmentResponse(input, { corePort: writer });
    },
    importCsvSamples(input: unknown) {
      return importCsvSamples(input, {
        corePort: writer,
        presetRegistry: registry,
      });
    },
    importDeviceProviderSnapshot(input: unknown) {
      return importDeviceProviderSnapshot(input, {
        corePort: writer,
        providerRegistry: providers,
      });
    },
  };
}
