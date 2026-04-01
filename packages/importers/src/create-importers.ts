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

let defaultCorePortPromise: Promise<unknown> | null = null

async function loadDefaultCorePort() {
  if (!defaultCorePortPromise) {
    defaultCorePortPromise = import("@murphai/core")
  }

  return defaultCorePortPromise
}

function createDefaultCorePortProxy() {
  return {
    async importDocument(payload: unknown) {
      const corePort = await loadDefaultCorePort() as Record<string, (...args: unknown[]) => unknown>
      return corePort.importDocument(payload)
    },
    async addMeal(payload: unknown) {
      const corePort = await loadDefaultCorePort() as Record<string, (...args: unknown[]) => unknown>
      return corePort.addMeal(payload)
    },
    async importSamples(payload: unknown) {
      const corePort = await loadDefaultCorePort() as Record<string, (...args: unknown[]) => unknown>
      return corePort.importSamples(payload)
    },
    async importDeviceBatch(payload: unknown) {
      const corePort = await loadDefaultCorePort() as Record<string, (...args: unknown[]) => unknown>
      return corePort.importDeviceBatch(payload)
    },
    async importAssessmentResponse(payload: unknown) {
      const corePort = await loadDefaultCorePort() as Record<string, (...args: unknown[]) => unknown>
      return corePort.importAssessmentResponse(payload)
    },
  }
}

export function createImporters({
  corePort,
  presetRegistry,
  deviceProviderRegistry,
}: CreateImportersOptions = {}) {
  const registry = presetRegistry ?? createSamplePresetRegistry();
  const providers = deviceProviderRegistry ?? createDeviceProviderRegistry(defaultDeviceProviderAdapters);
  const writer = corePort ?? createDefaultCorePortProxy();

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
