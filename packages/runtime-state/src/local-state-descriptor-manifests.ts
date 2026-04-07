import { assistantLocalStateDescriptors } from "./assistant-local-state-descriptors.ts";
import { deviceSyncLocalStateDescriptors } from "./device-sync-local-state-descriptors.ts";
import { gatewayLocalStateDescriptors } from "./gateway-local-state-descriptors.ts";
import { inboxLocalStateDescriptors } from "./inbox-local-state-descriptors.ts";
import { parserLocalStateDescriptors } from "./parser-local-state-descriptors.ts";
import { queryLocalStateDescriptors } from "./query-local-state-descriptors.ts";
import type { VaultLocalStatePathDescriptor } from "./local-state-descriptor-helpers.ts";
import { writeOperationLocalStateDescriptors } from "./write-operation-local-state-descriptors.ts";

export const vaultLocalStatePathDescriptors: readonly VaultLocalStatePathDescriptor[] = [
  ...assistantLocalStateDescriptors,
  ...inboxLocalStateDescriptors,
  ...deviceSyncLocalStateDescriptors,
  ...parserLocalStateDescriptors,
  ...queryLocalStateDescriptors,
  ...gatewayLocalStateDescriptors,
  ...writeOperationLocalStateDescriptors,
] as const;
