import {
  defineLocalStatePrefixDescriptor,
  type VaultLocalStatePathDescriptor,
} from "./local-state-descriptor-helpers.ts";

export const writeOperationLocalStateDescriptors: readonly VaultLocalStatePathDescriptor[] = [
  defineLocalStatePrefixDescriptor({
    classification: "operational",
    description:
      "Committed write-operation receipts and staged payload artifacts must travel with recovery and idempotency context.",
    owner: "write-operations",
    portability: "portable",
    rebuildable: false,
    relativePath: ".runtime/operations/op_",
  }),
] as const;
