import {
  defineLocalStateDirectoryDescriptor,
  defineLocalStateFileDescriptor,
  defineLocalStateSubtreeDescriptor,
  type VaultLocalStatePathDescriptor,
} from "./local-state-descriptor-helpers.ts";

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
    ".runtime/operations/assistant/failover.json",
    "Assistant provider failover cooldown state that must survive hosted resume.",
  ),
  definePortableAssistantDirectory(
    ".runtime/operations/assistant/cron",
    "Assistant cron container for portable scheduling and automation continuity descendants.",
  ),
  definePortableAssistantSubtree(
    ".runtime/operations/assistant/outbox",
    "Assistant outbox intents that must move with hosted delivery continuity.",
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
  definePortableAssistantDirectory(
    ".runtime/operations/assistant/state/onboarding",
    "Assistant onboarding state container used for portable first-contact continuity descendants.",
  ),
  definePortableAssistantSubtree(
    ".runtime/operations/assistant/state/onboarding/first-contact",
    "Assistant first-contact onboarding continuity state that must move with hosted resume.",
  ),
  definePortableAssistantSubtree(
    ".runtime/operations/assistant/transcripts",
    "Assistant transcript tails used for hosted continuity and replay context.",
  ),
  definePortableAssistantFile(
    ".runtime/operations/assistant/cron/automation-runtime.json",
    "Assistant cron automation runtime state that must follow hosted execution continuity.",
  ),
  definePortableAssistantFile(
    ".runtime/operations/assistant/cron/jobs.json",
    "Assistant cron job scheduling state that must follow hosted execution continuity.",
  ),
  defineMachineLocalAssistantSubtree(
    ".runtime/operations/assistant/cron/runs",
    "Assistant cron run artifacts are local observability residue only.",
  ),
  defineMachineLocalAssistantSubtree(
    ".runtime/operations/assistant/diagnostics",
    "Assistant diagnostics snapshots and events are local observability residue only.",
  ),
  defineMachineLocalAssistantFile(
    ".runtime/operations/assistant/indexes.json",
    "Assistant local indexes are machine-local runtime repair metadata.",
  ),
  defineMachineLocalAssistantSubtree(
    ".runtime/operations/assistant/journals",
    "Assistant journals and runtime event logs are machine-local operational residue.",
  ),
  defineMachineLocalAssistantSubtree(
    ".runtime/operations/assistant/provider-route-recovery",
    "Assistant provider-route recovery state is machine-local operational residue.",
  ),
  defineMachineLocalAssistantSubtree(
    ".runtime/operations/assistant/quarantine",
    "Assistant quarantine artifacts are machine-local repair residue.",
  ),
  defineMachineLocalAssistantFile(
    ".runtime/operations/assistant/runtime-budgets.json",
    "Assistant runtime budget snapshots are machine-local operational residue.",
  ),
  defineMachineLocalAssistantSubtree(
    ".runtime/operations/assistant/secrets",
    "Assistant local secret sidecars never travel in hosted snapshots.",
  ),
  defineMachineLocalAssistantFile(
    ".runtime/operations/assistant/status.json",
    "Assistant status snapshots are local observability residue only.",
  ),
  definePortableAssistantDirectory(
    ".runtime/operations/assistant/usage",
    "Assistant usage container for portable pending usage descendants.",
  ),
  definePortableAssistantSubtree(
    ".runtime/operations/assistant/usage/pending",
    "Assistant pending usage records that must move with hosted usage import continuity.",
  ),
] as const;
