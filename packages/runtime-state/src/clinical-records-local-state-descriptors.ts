import {
  defineLocalStateSubtreeDescriptor,
  type VaultLocalStatePathDescriptor,
} from "./local-state-descriptor-helpers.ts";

export const clinicalRecordsLocalStateDescriptors: readonly VaultLocalStatePathDescriptor[] = [
  defineLocalStateSubtreeDescriptor({
    classification: "operational",
    description:
      "Bounded in-progress Clinical Records retrieval evidence must travel with hosted checkpoint recovery until canonical import terminalizes.",
    owner: "vault-usecases-clinical-records",
    portability: "portable",
    rebuildable: false,
    relativePath: ".runtime/operations/clinical-records",
  }),
] as const;
