import {
  createProjectedRegistryQueries,
  protocolRecordFromEntity,
  protocolRegistryDefinition,
} from "./registries.js";

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
