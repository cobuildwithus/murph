import {
  createProjectedRegistryQueries,
  protocolRecordFromEntity,
  protocolRegistryDefinition,
  type RegistryListOptions,
} from "./registries.js";

const protocolQueries = createProjectedRegistryQueries(
  protocolRegistryDefinition,
  "protocol",
  protocolRecordFromEntity,
);

export async function listProtocols(
  vaultRoot: string,
  options: RegistryListOptions = {},
): ReturnType<typeof protocolQueries.list> {
  return protocolQueries.list(vaultRoot, options);
}

export async function readProtocol(
  vaultRoot: string,
  protocolId: string,
): ReturnType<typeof protocolQueries.read> {
  return protocolQueries.read(vaultRoot, protocolId);
}

export async function showProtocol(
  vaultRoot: string,
  lookup: string,
): ReturnType<typeof protocolQueries.show> {
  return protocolQueries.show(vaultRoot, lookup);
}
