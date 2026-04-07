import {
  defineLocalStateSubtreeDescriptor,
  type VaultLocalStatePathDescriptor,
} from "./local-state-descriptor-helpers.ts";

export const parserLocalStateDescriptors: readonly VaultLocalStatePathDescriptor[] = [
  defineLocalStateSubtreeDescriptor({
    classification: "operational",
    description:
      "Parser toolchain overrides and parser runtime state are machine-local operational state.",
    owner: "parser-runtime",
    portability: "machine_local",
    rebuildable: false,
    relativePath: ".runtime/operations/parsers",
  }),
] as const;
