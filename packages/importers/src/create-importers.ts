import * as coreRuntime from "@murphai/core";

import { importAssessmentResponse } from "./assessment/import-assessment-response.ts";
import { importCsvSamples, profileCsvSampleFile } from "./csv-sample-importer.ts";
import { importDocument } from "./document-importer.ts";
import {
  createDeviceProviderRegistry,
  defaultDeviceProviderAdapters,
  importDeviceProviderSnapshot,
  resolveDeviceProviderSnapshotDefaultTimeZone,
} from "./device-providers/index.ts";
import { addMeal } from "./meal-importer.ts";

import type { DeviceProviderRegistry } from "./device-providers/index.ts";

export interface CreateImportersOptions {
  corePort?: unknown;
  deviceProviderRegistry?: DeviceProviderRegistry;
}

export function createImporters({
  corePort,
  deviceProviderRegistry,
}: CreateImportersOptions = {}) {
  const providers = deviceProviderRegistry ?? createDeviceProviderRegistry(defaultDeviceProviderAdapters);
  const writer = corePort ?? coreRuntime;

  return {
    deviceProviderRegistry: providers,
    withDeviceImportPass<T>(work: () => Promise<T>): Promise<T> {
      return coreRuntime.withDeviceBatchImportPass(work);
    },
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
      return importCsvSamples(input, { corePort: writer });
    },
    profileCsvSampleFile(input: unknown) {
      return profileCsvSampleFile(input);
    },
    importDeviceProviderSnapshot(
      input: unknown,
      options: {
        signal?: AbortSignal | null;
      } = {},
    ) {
      return importDeviceProviderSnapshot(input, {
        corePort: writer,
        ...options,
        providerRegistry: providers,
      });
    },
    resolveDeviceProviderSnapshotDefaultTimeZone(input: { vaultRoot?: string }) {
      return resolveDeviceProviderSnapshotDefaultTimeZone(input, writer);
    },
  };
}
