import { z } from "zod";

import { assertCanonicalWritePort } from "../core-port.js";
import type { DeviceBatchImportPayload } from "../core-port.js";
import {
  optionalTrimmedStringSchema,
  parseInputObject,
  requiredTrimmedStringSchema,
  stripUndefined,
} from "../shared.js";

import { defaultDeviceProviderAdapters } from "./defaults.js";
import { createDeviceProviderRegistry } from "./registry.js";

import type { DeviceProviderRegistry } from "./registry.js";

export interface DeviceProviderImporterExecutionOptions {
  corePort?: unknown;
  providerRegistry?: DeviceProviderRegistry;
}

export interface DeviceProviderSnapshotImportInput {
  provider: string;
  snapshot: unknown;
  vaultRoot?: string;
  vault?: string;
}

const deviceProviderSnapshotImportSchema = z
  .object({
    provider: requiredTrimmedStringSchema("provider"),
    snapshot: z.unknown(),
    vaultRoot: optionalTrimmedStringSchema("vaultRoot"),
    vault: optionalTrimmedStringSchema("vault"),
  })
  .passthrough();

function resolveRegistry(registry?: DeviceProviderRegistry): DeviceProviderRegistry {
  return registry ?? createDeviceProviderRegistry(defaultDeviceProviderAdapters);
}

export async function prepareDeviceProviderSnapshotImport(
  input: unknown,
  { providerRegistry }: Pick<DeviceProviderImporterExecutionOptions, "providerRegistry"> = {},
): Promise<DeviceBatchImportPayload> {
  const request = parseInputObject(
    input,
    "device provider snapshot import input",
    deviceProviderSnapshotImportSchema,
  );
  const registry = resolveRegistry(providerRegistry);
  const adapter = registry.get(request.provider);

  if (!adapter) {
    throw new TypeError(`device provider "${request.provider}" is not registered`);
  }

  const normalized = await adapter.normalizeSnapshot(request.snapshot);

  return stripUndefined({
    vaultRoot: request.vaultRoot ?? request.vault,
    ...normalized,
  });
}

export async function importDeviceProviderSnapshot<TResult = unknown>(
  input: unknown,
  { corePort, providerRegistry }: DeviceProviderImporterExecutionOptions = {},
): Promise<TResult> {
  const writer = assertCanonicalWritePort(corePort, ["importDeviceBatch"]);
  const payload = await prepareDeviceProviderSnapshotImport(input, { providerRegistry });
  return (await writer.importDeviceBatch(payload)) as TResult;
}
