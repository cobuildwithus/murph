import type { HealthEntityKind } from "./health-entities.js";

export type CommandCapability =
  | "show"
  | "list"
  | "scaffold"
  | "upsert"
  | "import"
  | "manifest"
  | "raw"
  | "batch-show"
  | "batch-list"
  | "create"
  | "update"
  | "checkpoint"
  | "stop"
  | "ensure"
  | "append"
  | "link"
  | "unlink"
  | "stats"
  | "paths"
  | "rebuild"
  | "materialize"
  | "prune"
  | "validate"
  | "tail"
  | "project"
  | "bootstrap"
  | "setup"
  | "doctor"
  | "parse"
  | "requeue"
  | "attachment-list"
  | "attachment-show"
  | "attachment-show-status"
  | "attachment-parse"
  | "attachment-reparse"
  | "promote";

export interface CommandCapabilityBundleDefinition {
  capabilities: readonly CommandCapability[];
  id: string;
  summary: string;
}

const checkedCommandCapabilityBundles = {
  readable: {
    capabilities: ["show", "list"],
    id: "readable",
    summary: "Readable follow-up surface for direct noun lookups and filtered listing.",
  },
  payloadCrud: {
    capabilities: ["scaffold", "upsert", "show", "list"],
    id: "payloadCrud",
    summary: "Payload-driven CRUD surface for canonical noun records.",
  },
  artifactImport: {
    capabilities: ["import", "show", "list", "manifest"],
    id: "artifactImport",
    summary: "Artifact-ingest surface for immutable raw evidence plus readable follow-up commands.",
  },
  batchInspection: {
    capabilities: ["batch-show", "batch-list"],
    id: "batchInspection",
    summary: "Import-batch inspection surface for transform or ingest runs.",
  },
  lifecycle: {
    capabilities: ["create", "show", "list", "update", "checkpoint", "stop"],
    id: "lifecycle",
    summary: "Lifecycle-oriented noun flow with explicit phase mutations and follow-up reads.",
  },
  dateAddressedDoc: {
    capabilities: ["ensure", "show", "list", "append", "link", "unlink"],
    id: "dateAddressedDoc",
    summary: "Date-addressed document flow for day pages with append and link maintenance.",
  },
  derivedAdmin: {
    capabilities: ["stats", "paths", "rebuild", "materialize", "prune", "validate"],
    id: "derivedAdmin",
    summary: "Derived-output and admin-maintenance surface for rebuildable or operator-facing commands.",
  },
  runtimeControl: {
    capabilities: [
      "bootstrap",
      "setup",
      "doctor",
      "parse",
      "requeue",
      "attachment-list",
      "attachment-show",
      "attachment-show-status",
      "attachment-parse",
      "attachment-reparse",
      "promote",
    ],
    id: "runtimeControl",
    summary: "Runtime-oriented operator controls for local services, queues, and attachment workflows.",
  },
} as const satisfies Record<string, CommandCapabilityBundleDefinition>;

export const commandCapabilityBundles = Object.freeze(checkedCommandCapabilityBundles);

export type CommandCapabilityBundleId = keyof typeof commandCapabilityBundles;

export type CommandSurfaceNoun =
  | HealthEntityKind
  | "provider"
  | "event"
  | "document"
  | "meal"
  | "samples"
  | "experiment"
  | "journal"
  | "vault"
  | "export"
  | "audit"
  | "inbox"
  | "intake";

export interface CommandNounCapabilityDefinition {
  additionalCapabilities?: readonly CommandCapability[];
  bundles: readonly CommandCapabilityBundleId[];
  noun: CommandSurfaceNoun;
}

const checkedCommandNounCapabilities = [
  {
    bundles: ["artifactImport"],
    noun: "assessment",
    additionalCapabilities: ["raw", "project"],
  },
  {
    bundles: ["payloadCrud"],
    noun: "profile",
    additionalCapabilities: ["rebuild"],
  },
  {
    bundles: ["payloadCrud"],
    noun: "goal",
  },
  {
    bundles: ["payloadCrud"],
    noun: "condition",
  },
  {
    bundles: ["payloadCrud"],
    noun: "allergy",
  },
  {
    bundles: ["payloadCrud"],
    noun: "regimen",
    additionalCapabilities: ["stop"],
  },
  {
    bundles: ["payloadCrud"],
    noun: "history",
  },
  {
    bundles: ["payloadCrud"],
    noun: "family",
  },
  {
    bundles: ["payloadCrud"],
    noun: "genetics",
  },
  {
    bundles: ["payloadCrud"],
    noun: "provider",
  },
  {
    bundles: ["payloadCrud"],
    noun: "event",
  },
  {
    bundles: ["artifactImport"],
    noun: "document",
  },
  {
    bundles: ["artifactImport"],
    noun: "meal",
  },
  {
    bundles: ["artifactImport"],
    noun: "intake",
    additionalCapabilities: ["raw", "project"],
  },
  {
    bundles: ["artifactImport", "batchInspection"],
    noun: "samples",
  },
  {
    bundles: ["lifecycle"],
    noun: "experiment",
  },
  {
    bundles: ["dateAddressedDoc"],
    noun: "journal",
  },
  {
    bundles: ["readable", "derivedAdmin"],
    noun: "vault",
    additionalCapabilities: ["update"],
  },
  {
    bundles: ["readable", "derivedAdmin"],
    noun: "export",
  },
  {
    bundles: ["readable"],
    noun: "audit",
    additionalCapabilities: ["tail"],
  },
  {
    bundles: ["runtimeControl"],
    noun: "inbox",
  },
] as const satisfies readonly CommandNounCapabilityDefinition[];

export const commandNounCapabilities: readonly CommandNounCapabilityDefinition[] =
  checkedCommandNounCapabilities;

export const commandNounCapabilityByNoun = new Map<
  CommandSurfaceNoun,
  CommandNounCapabilityDefinition
>(
  commandNounCapabilities.map((definition) => [definition.noun, definition]),
);
