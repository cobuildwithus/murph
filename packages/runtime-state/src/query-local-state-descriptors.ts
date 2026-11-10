import {
  defineLocalStateFileDescriptor,
  type VaultLocalStatePathDescriptor,
} from "./local-state-descriptor-helpers.ts";

const QUERY_OWNER = "query";

// Literal paths: the descriptor manifest loads before `runtime-paths.ts`, which
// names the same three files in `QUERY_PROJECTION_SECTION_RELATIVE_PATHS`.
const QUERY_PROJECTION_SECTION_DESCRIPTIONS = {
  ".runtime/projections/query-entities.sqlite": "canonical vault entities and lexical search documents",
  ".runtime/projections/query-metrics.sqlite": "metric points and goal targets",
  ".runtime/projections/query-wearables.sqlite": "per-provider wearable day summaries",
};

export const queryLocalStateDescriptors: readonly VaultLocalStatePathDescriptor[] =
  Object.entries(QUERY_PROJECTION_SECTION_DESCRIPTIONS).map(([relativePath, description]) =>
    defineLocalStateFileDescriptor({
      classification: "projection",
      description: `Query owns the rebuildable local read projection of ${description}.`,
      owner: QUERY_OWNER,
      portability: "machine_local",
      rebuildable: true,
      relativePath,
    }));
