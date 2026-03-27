import {
  createProjectedRegistryQueries,
  protocolRecordFromEntity,
  protocolRegistryDefinition,
} from "./registries.ts";

const protocolQueries = createProjectedRegistryQueries(
  protocolRegistryDefinition,
  "protocol",
  protocolRecordFromEntity,
);
export const {
  list: listProtocols,
  read: readProtocol,
  show: showProtocol,
} = protocolQueries;
