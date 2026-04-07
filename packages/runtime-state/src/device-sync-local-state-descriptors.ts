import {
  defineLocalStateSubtreeDescriptor,
  type VaultLocalStatePathDescriptor,
} from "./local-state-descriptor-helpers.ts";

export const deviceSyncLocalStateDescriptors: readonly VaultLocalStatePathDescriptor[] = [
  defineLocalStateSubtreeDescriptor({
    classification: "operational",
    description:
      "Device-sync runtime state, credentials, launcher metadata, and logs are machine-local operational state.",
    owner: "device-sync-runtime",
    portability: "machine_local",
    rebuildable: false,
    relativePath: ".runtime/operations/device-sync",
  }),
] as const;
