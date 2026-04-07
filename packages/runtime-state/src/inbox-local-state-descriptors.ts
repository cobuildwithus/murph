import {
  defineLocalStateFileDescriptor,
  type VaultLocalStatePathDescriptor,
} from "./local-state-descriptor-helpers.ts";

const INBOX_OWNER = "inbox-runtime";

function defineInboxStateFile(
  relativePath: string,
  portability: "portable" | "machine_local",
  description: string,
): VaultLocalStatePathDescriptor {
  return defineLocalStateFileDescriptor({
    classification: "operational",
    description,
    owner: INBOX_OWNER,
    portability,
    rebuildable: false,
    relativePath,
  });
}

export const inboxLocalStateDescriptors: readonly VaultLocalStatePathDescriptor[] = [
  defineInboxStateFile(
    ".runtime/operations/inbox/config.json",
    "machine_local",
    "Inbox daemon and connector configuration is machine-local operational state.",
  ),
  defineInboxStateFile(
    ".runtime/operations/inbox/state.json",
    "machine_local",
    "Inbox daemon state is machine-local operational residue.",
  ),
  defineInboxStateFile(
    ".runtime/operations/inbox/promotions.json",
    "portable",
    "Inbox promotion ledger must travel with recovery and hosted idempotency context.",
  ),
] as const;
