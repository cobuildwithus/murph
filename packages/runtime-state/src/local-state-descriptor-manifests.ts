import { assistantLocalStateDescriptors } from "./assistant-local-state-descriptors.ts";
import { clinicalRecordsLocalStateDescriptors } from "./clinical-records-local-state-descriptors.ts";
import { deviceSyncLocalStateDescriptors } from "./device-sync-local-state-descriptors.ts";
import { inboxLocalStateDescriptors } from "./inbox-local-state-descriptors.ts";
import { parserLocalStateDescriptors } from "./parser-local-state-descriptors.ts";
import { queryLocalStateDescriptors } from "./query-local-state-descriptors.ts";
import { defineLocalStateSubtreeDescriptor, type VaultLocalStatePathDescriptor } from "./local-state-descriptor-helpers.ts";
import { writeOperationLocalStateDescriptors } from "./write-operation-local-state-descriptors.ts";

export const vaultLocalStatePathDescriptors: readonly VaultLocalStatePathDescriptor[] = [
  defineLocalStateSubtreeDescriptor({
    classification: "operational", portability: "portable", rebuildable: false,
    owner: "assistant-runtime-meal-name-repair",
    relativePath: ".runtime/operations/meal-name-repair",
    description: "One-time meal-name repair cursor, pending revision-checked write and cumulative count receipts.",
  }),
  ...assistantLocalStateDescriptors,
  ...clinicalRecordsLocalStateDescriptors,
  ...inboxLocalStateDescriptors,
  ...deviceSyncLocalStateDescriptors,
  ...parserLocalStateDescriptors,
  ...queryLocalStateDescriptors,
  ...writeOperationLocalStateDescriptors,
] as const;
