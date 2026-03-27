import { z } from "zod";

import { assertCanonicalWritePort } from "../core-port.ts";
import type { DeviceBatchImportPayload } from "../core-port.ts";
import {
  parseInputObject,
  requiredTrimmedStringSchema,
  resolveVaultRootAlias,
  stripUndefined,
  vaultRootAliasSchemaFields,
} from "../shared.ts";

import { defaultDeviceProviderAdapters } from "./defaults.ts";
import { createDeviceProviderRegistry } from "./registry.ts";

import type { DeviceProviderRegistry } from "./registry.ts";

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
    ...vaultRootAliasSchemaFields,
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
    vaultRoot: resolveVaultRootAlias(request),
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
