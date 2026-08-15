import {
  defineLocalStateDirectoryDescriptor,
  defineLocalStateFileDescriptor,
  defineLocalStateSubtreeDescriptor,
  type VaultLocalStatePathDescriptor,
} from "./local-state-descriptor-helpers.ts";
import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
} from "./assistant-generated-deliveries.ts";

const ASSISTANT_OWNER = "assistant-runtime";

function definePortableAssistantDirectory(
  relativePath: string,
  description: string,
): VaultLocalStatePathDescriptor {
  return defineLocalStateDirectoryDescriptor({
    classification: "operational",
    description,
    owner: ASSISTANT_OWNER,
    portability: "portable",
    rebuildable: false,
    relativePath,
  });
}

function definePortableAssistantFile(
  relativePath: string,
  description: string,
): VaultLocalStatePathDescriptor {
  return defineLocalStateFileDescriptor({
    classification: "operational",
    description,
    owner: ASSISTANT_OWNER,
    portability: "portable",
    rebuildable: false,
    relativePath,
  });
}

function definePortableAssistantSubtree(
  relativePath: string,
  description: string,
): VaultLocalStatePathDescriptor {
  return defineLocalStateSubtreeDescriptor({
    classification: "operational",
    description,
    owner: ASSISTANT_OWNER,
    portability: "portable",
    rebuildable: false,
    relativePath,
  });
}

function defineMachineLocalAssistantFile(
  relativePath: string,
  description: string,
): VaultLocalStatePathDescriptor {
  return defineLocalStateFileDescriptor({
    classification: "operational",
    description,
    owner: ASSISTANT_OWNER,
    portability: "machine_local",
    rebuildable: false,
    relativePath,
  });
}

function defineMachineLocalAssistantSubtree(
  relativePath: string,
  description: string,
): VaultLocalStatePathDescriptor {
  return defineLocalStateSubtreeDescriptor({
    classification: "operational",
    description,
    owner: ASSISTANT_OWNER,
    portability: "machine_local",
    rebuildable: false,
    relativePath,
  });
}

export const assistantLocalStateDescriptors: readonly VaultLocalStatePathDescriptor[] = [
  definePortableAssistantDirectory(
    ".runtime/operations/assistant",
    "Assistant runtime residue root. The directory itself may travel in hosted snapshots, but descendant portability is descriptor-driven.",
  ),
  definePortableAssistantFile(
    ".runtime/operations/assistant/automation-state.json",
    "Assistant runtime automation execution state that must move with hosted continuity.",
  ),
  definePortableAssistantFile(
    ".runtime/operations/assistant/context-snapshot.json",
    "Assistant private context snapshot that moves with hosted continuity.",
  ),
  definePortableAssistantSubtree(
    ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
    "Assistant-generated one-time delivery files that must move with active hosted delivery continuity.",
  ),
  definePortableAssistantSubtree(
    ".runtime/operations/assistant/auto-reply",
    "Assistant auto-reply terminal evidence plus exact-route consumption watermark and pending-claim state that must move with hosted reply replay, restore, and cleanup continuity.",
  ),
  definePortableAssistantFile(
    ".runtime/operations/assistant/hosted-provider-cleanup.json",
    "Hosted provider-visible cleanup retry state that must move with hosted post-commit finalization.",
  ),
  definePortableAssistantFile(
    ".runtime/operations/assistant/hosted-mailbox.json",
    "Hosted mailbox import watermarks and compact quarantine status that must move with hosted runtime continuity.",
  ),
  definePortableAssistantFile(
    ".runtime/operations/assistant/hosted-system-mailbox.json",
    "Hosted system mailbox pending item state that must move with hosted runtime continuity.",
  ),
  definePortableAssistantDirectory(
    ".runtime/operations/assistant/cron",
    "Assistant cron container for portable scheduling and automation continuity descendants.",
  ),
  definePortableAssistantSubtree(
    ".runtime/operations/assistant/outbox",
    "Assistant outbox intents that must move with hosted delivery continuity.",
  ),
  definePortableAssistantSubtree(
    ".runtime/operations/assistant/state/accepted-turn-inputs",
    "Assistant active-turn accepted input journals that must move with hosted execution continuity.",
  ),
  defineMachineLocalAssistantSubtree(
    ".runtime/operations/assistant/outbox/.quarantine",
    "Assistant outbox quarantine artifacts that are local repair residue only.",
  ),
  definePortableAssistantSubtree(
    ".runtime/operations/assistant/receipts",
    "Assistant turn receipts that provide hosted execution continuity and idempotency context.",
  ),
  definePortableAssistantSubtree(
    ".runtime/operations/assistant/sessions",
    "Assistant session metadata that supports hosted resume and provider-session continuity.",
  ),
  definePortableAssistantDirectory(
    ".runtime/operations/assistant/state",
    "Assistant state container used for portable onboarding continuity descendants.",
  ),
  definePortableAssistantSubtree(
    ".runtime/operations/assistant/state/session-routing",
    "Assistant exact alias and conversation-key routing records that must move with hosted session continuity.",
  ),
  definePortableAssistantDirectory(
    ".runtime/operations/assistant/state/onboarding",
    "Assistant onboarding state container used for portable conversation lifecycle and first-contact continuity descendants.",
  ),
  definePortableAssistantFile(
    ".runtime/operations/assistant/state/onboarding/conversation.json",
    "Assistant Murph onboarding lifecycle state that must move with hosted resume.",
  ),
  definePortableAssistantSubtree(
    ".runtime/operations/assistant/state/onboarding/first-contact",
    "Assistant first-contact onboarding continuity state that must move with hosted resume.",
  ),
  definePortableAssistantSubtree(
    ".runtime/operations/assistant/transcripts",
    "Assistant transcript tails kept for audit, receipts, and active-turn transcript references.",
  ),
  definePortableAssistantFile(
    ".runtime/operations/assistant/cron/automation-runtime.json",
    "Assistant cron automation runtime state that must follow hosted execution continuity.",
  ),
  definePortableAssistantFile(
    ".runtime/operations/assistant/cron/jobs.json",
    "Assistant cron job scheduling state that must follow hosted execution continuity.",
  ),
  definePortableAssistantSubtree(
    ".runtime/operations/assistant/cron/runs",
    "Assistant cron run history is bounded runtime observability that moves with hosted debugging continuity.",
  ),
  definePortableAssistantSubtree(
    ".runtime/operations/assistant/diagnostics",
    "Assistant diagnostics summary state moves with hosted debugging continuity; event logs are machine-local debugging residue.",
  ),
  defineMachineLocalAssistantFile(
    ".runtime/operations/assistant/diagnostics/events.jsonl",
    "Assistant diagnostic event log is bounded local debugging residue; diagnostics snapshot carries portable counters and recent warnings.",
  ),
  definePortableAssistantFile(
    ".runtime/operations/assistant/indexes.json",
    "Assistant bounded recent-session index and routing format marker that keep hosted resume available without rebuilding session files.",
  ),
  definePortableAssistantSubtree(
    ".runtime/operations/assistant/journals",
    "Assistant journals move with hosted debugging continuity; runtime event logs are machine-local debugging residue.",
  ),
  defineMachineLocalAssistantFile(
    ".runtime/operations/assistant/journals/runtime-events.jsonl",
    "Assistant runtime event log is bounded local debugging residue and is excluded from hosted workspace snapshots.",
  ),
  definePortableAssistantDirectory(
    ".runtime/operations/assistant/issues",
    "Assistant anonymized runtime issue container for portable hosted issue export descendants.",
  ),
  definePortableAssistantSubtree(
    ".runtime/operations/assistant/issues/pending",
    "Assistant anonymized pending runtime issue records that must move with hosted issue export continuity.",
  ),
  defineMachineLocalAssistantSubtree(
    ".runtime/operations/assistant/quarantine",
    "Assistant quarantine artifacts are machine-local repair residue.",
  ),
  definePortableAssistantFile(
    ".runtime/operations/assistant/runtime-budgets.json",
    "Assistant runtime budget snapshots move with hosted runtime continuity.",
  ),
  defineMachineLocalAssistantSubtree(
    ".runtime/operations/assistant/secrets",
    "Assistant local secret sidecars never travel in hosted snapshots.",
  ),
  definePortableAssistantFile(
    ".runtime/operations/assistant/status.json",
    "Assistant status snapshots move with hosted debugging continuity.",
  ),
] as const;
