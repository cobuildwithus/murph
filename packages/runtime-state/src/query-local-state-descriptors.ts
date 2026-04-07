import {
  defineLocalStateFileDescriptor,
  type VaultLocalStatePathDescriptor,
} from "./local-state-descriptor-helpers.ts";

const QUERY_OWNER = "query";

export const queryLocalStateDescriptors: readonly VaultLocalStatePathDescriptor[] = [
  defineLocalStateFileDescriptor({
    classification: "projection",
    description:
      "Query owns the rebuildable local read projection over canonical vault entities and lexical search documents.",
    owner: QUERY_OWNER,
    portability: "machine_local",
    rebuildable: true,
    relativePath: ".runtime/projections/query.sqlite",
  }),
] as const;
