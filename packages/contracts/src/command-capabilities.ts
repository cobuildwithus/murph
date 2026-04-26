import type { HealthEntityKind } from "./health-entities.ts";

export type CommandCapability =
  | "show"
  | "list"
  | "scaffold"
  | "save"
  | "upsert"
  | "import-json"
  | "import"
  | "import-csv"
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
  | "rebuild"
  | "materialize"
  | "prune"
  | "validate"
  | "repair"
  | "tail"
  | "project"
  | "bootstrap"
  | "setup"
  | "doctor"
  | "parse"
  | "requeue"
  | "rename"
  | "schedule"
  | "unschedule"
  | "edit"
  | "add"
  | "format-save"
  | "format-show"
  | "format-list"
  | "format-log"
  | "compound-list"
  | "compound-show"
  | "attachment-list"
  | "attachment-inspect"
  | "attachment-show"
  | "attachment-status"
  | "attachment-show-status"
  | "attachment-decode"
  | "attachment-parse"
  | "attachment-reparse"
  | "promote"
  | "model-bundle"
  | "model-route"
  | "ask"
  | "chat"
  | "deliver"
  | "status"
  | "run"
  | "forget"
  | "session-list"
  | "session-show"
  | "provider-list"
  | "connect"
  | "account-list"
  | "account-show"
  | "account-reconcile"
  | "account-disconnect"
  | "daemon-status"
  | "daemon-start"
  | "daemon-stop";

export interface CommandCapabilityBundleDefinition {
  capabilities: readonly CommandCapability[];
  docSurface: string;
  summary: string;
}

const checkedCommandCapabilityBundles = {
  readable: {
    capabilities: ["show", "list"],
    docSurface: "show | list",
    summary: "Readable follow-up surface for direct noun lookups and filtered listing.",
  },
  payloadCrud: {
    capabilities: ["scaffold", "import-json", "show", "list"],
    docSurface: "scaffold | import-json | show | list",
    summary: "Explicit JSON import fallback plus readable follow-up surface for canonical noun records.",
  },
  artifactImport: {
    capabilities: ["import", "show", "list", "manifest"],
    docSurface: "import | show | list | manifest",
    summary: "Artifact-ingest surface for immutable raw evidence plus readable follow-up commands.",
  },
  batchInspection: {
    capabilities: ["batch-show", "batch-list"],
    docSurface: "batch show | batch list",
    summary: "Import-batch inspection surface for transform or ingest runs.",
  },
  lifecycle: {
    capabilities: ["create", "show", "list", "update", "checkpoint", "stop"],
    docSurface: "create | show | list | update | checkpoint | stop",
    summary: "Lifecycle-oriented noun flow with explicit phase mutations and follow-up reads.",
  },
  dateAddressedDoc: {
    capabilities: ["ensure", "show", "list", "append", "link", "unlink"],
    docSurface: "ensure | show | list | append | link | unlink",
    summary: "Date-addressed document flow for day pages with append and link maintenance.",
  },
  derivedAdmin: {
    capabilities: ["stats", "rebuild", "materialize", "prune", "validate"],
    docSurface: "stats | rebuild | materialize | prune | validate",
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
      "attachment-inspect",
      "attachment-show",
      "attachment-status",
      "attachment-show-status",
      "attachment-decode",
      "attachment-parse",
      "attachment-reparse",
      "promote",
      "model-bundle",
      "model-route",
    ],
    docSurface:
      "bootstrap | setup | doctor | parse | requeue | attachment list/inspect/show/status/show-status/decode/parse/reparse | promote | model bundle/route",
    summary:
      "Runtime-oriented operator controls for local services, queues, attachment workflows, and audited model-routing helpers.",
  },
  deviceControl: {
    capabilities: [
      "provider-list",
      "connect",
      "account-list",
      "account-show",
      "account-reconcile",
      "account-disconnect",
      "daemon-status",
      "daemon-start",
      "daemon-stop",
    ],
    docSurface: "provider list | connect | account list/show/reconcile/disconnect | daemon status/start/stop",
    summary: "Local device control-plane surface for provider discovery, account actions, and daemon lifecycle.",
  },
} as const satisfies Record<string, CommandCapabilityBundleDefinition>;

export const commandCapabilityBundles = Object.freeze(checkedCommandCapabilityBundles);

export type CommandCapabilityBundleId = keyof typeof commandCapabilityBundles;

export type CommandSurfaceNoun =
  | HealthEntityKind
  | "protocol"
  | "supplement"
  | "food"
  | "provider"
  | "recipe"
  | "event"
  | "document"
  | "meal"
  | "workout"
  | "intervention"
  | "samples"
  | "experiment"
  | "journal"
  | "vault"
  | "export"
  | "audit"
  | "inbox"
  | "assistant"
  | "memory"
  | "automation"
  | "device"
  | "intake";

export type CommandSurfaceAlias = "chat" | "status" | "doctor" | "run" | "stop";

export interface CommandNounCapabilityDefinition {
  additionalCapabilities?: readonly CommandCapability[];
  bundles: readonly CommandCapabilityBundleId[];
  capabilities: readonly CommandCapability[];
  noun: CommandSurfaceNoun;
}

export interface CommandAliasDefinition {
  alias: CommandSurfaceAlias;
  capability: CommandCapability;
  targetCommand: string;
  targetNoun: "assistant";
}

const checkedCommandNounCapabilities = [
  {
    bundles: ["payloadCrud"],
    capabilities: ["scaffold", "save", "import-json", "show", "list"],
    noun: "goal",
    additionalCapabilities: ["save"],
  },
  {
    bundles: ["payloadCrud"],
    capabilities: ["scaffold", "save", "import-json", "show", "list"],
    noun: "condition",
    additionalCapabilities: ["save"],
  },
  {
    bundles: ["payloadCrud"],
    capabilities: ["scaffold", "save", "import-json", "show", "list"],
    noun: "allergy",
    additionalCapabilities: ["save"],
  },
  {
    bundles: ["payloadCrud"],
    capabilities: ["scaffold", "save", "import-json", "show", "list", "stop"],
    noun: "regimen",
    additionalCapabilities: ["save", "stop"],
  },
  {
    bundles: ["readable"],
    capabilities: ["import-json", "show", "list"],
    noun: "protocol",
    additionalCapabilities: ["import-json"],
  },
  {
    bundles: ["payloadCrud"],
    capabilities: ["scaffold", "save", "import-json", "show", "list"],
    noun: "blood_test",
    additionalCapabilities: ["save"],
  },
  {
    bundles: ["payloadCrud"],
    capabilities: ["scaffold", "save", "import-json", "show", "list"],
    noun: "family",
    additionalCapabilities: ["save"],
  },
  {
    bundles: ["payloadCrud"],
    capabilities: ["scaffold", "save", "import-json", "show", "list"],
    noun: "genetics",
    additionalCapabilities: ["save"],
  },
  {
    bundles: ["payloadCrud"],
    capabilities: ["scaffold", "save", "import-json", "rename", "schedule", "unschedule", "show", "list"],
    noun: "food",
    additionalCapabilities: ["save", "rename", "schedule", "unschedule"],
  },
  {
    bundles: ["payloadCrud"],
    capabilities: ["scaffold", "save", "import-json", "show", "list", "stop", "compound-list", "compound-show"],
    noun: "supplement",
    additionalCapabilities: ["save", "stop", "compound-list", "compound-show"],
  },
  {
    bundles: ["payloadCrud"],
    capabilities: ["scaffold", "save", "import-json", "show", "list"],
    noun: "provider",
    additionalCapabilities: ["save"],
  },
  {
    bundles: ["payloadCrud"],
    capabilities: ["scaffold", "save", "import-json", "show", "list"],
    noun: "recipe",
    additionalCapabilities: ["save"],
  },
  {
    bundles: ["payloadCrud"],
    capabilities: ["scaffold", "add", "import-json", "edit", "show", "list"],
    noun: "event",
    additionalCapabilities: ["add", "edit"],
  },
  {
    bundles: ["artifactImport"],
    capabilities: ["import", "edit", "show", "list", "manifest"],
    noun: "document",
    additionalCapabilities: ["edit"],
  },
  {
    bundles: ["artifactImport"],
    capabilities: ["add", "edit", "show", "list", "manifest"],
    noun: "meal",
    additionalCapabilities: ["add", "edit"],
  },
  {
    bundles: [],
    capabilities: ["add", "edit", "format-save", "format-show", "format-list", "format-log"],
    noun: "workout",
    additionalCapabilities: ["add", "edit", "format-save", "format-show", "format-list", "format-log"],
  },
  {
    bundles: [],
    capabilities: ["add", "edit"],
    noun: "intervention",
    additionalCapabilities: ["add", "edit"],
  },
  {
    bundles: ["artifactImport"],
    capabilities: ["import", "show", "list", "manifest", "raw", "project"],
    noun: "intake",
    additionalCapabilities: ["raw", "project"],
  },
  {
    bundles: ["artifactImport", "batchInspection"],
    capabilities: ["add", "import-json", "import-csv", "show", "list", "batch-show", "batch-list"],
    noun: "samples",
    additionalCapabilities: ["add", "import-json", "import-csv"],
  },
  {
    bundles: ["lifecycle"],
    capabilities: ["create", "show", "list", "update", "checkpoint", "stop"],
    noun: "experiment",
  },
  {
    bundles: ["dateAddressedDoc"],
    capabilities: ["ensure", "show", "list", "append", "link", "unlink"],
    noun: "journal",
  },
  {
    bundles: ["readable", "derivedAdmin"],
    capabilities: ["show", "stats", "repair", "update"],
    noun: "vault",
    additionalCapabilities: ["stats", "repair", "update"],
  },
  {
    bundles: ["readable", "derivedAdmin"],
    capabilities: ["create", "show", "list", "materialize", "prune"],
    noun: "export",
    additionalCapabilities: ["create", "materialize", "prune"],
  },
  {
    bundles: ["readable"],
    capabilities: ["show", "list", "tail"],
    noun: "audit",
    additionalCapabilities: ["tail"],
  },
  {
    bundles: ["runtimeControl"],
    capabilities: [
      "bootstrap",
      "setup",
      "doctor",
      "parse",
      "requeue",
      "attachment-list",
      "attachment-inspect",
      "attachment-show",
      "attachment-status",
      "attachment-show-status",
      "attachment-decode",
      "attachment-parse",
      "attachment-reparse",
      "promote",
      "model-bundle",
      "model-route",
    ],
    noun: "inbox",
  },
  {
    bundles: [],
    capabilities: ["ask", "chat", "deliver", "status", "doctor", "run", "stop", "session-list", "session-show"],
    noun: "assistant",
    additionalCapabilities: ["ask", "chat", "deliver", "status", "doctor", "run", "stop", "session-list", "session-show"],
  },
  {
    bundles: [],
    capabilities: ["show", "upsert", "update", "forget"],
    noun: "memory",
    additionalCapabilities: ["show", "upsert", "update", "forget"],
  },
  {
    bundles: ["payloadCrud"],
    capabilities: ["scaffold", "save", "show", "list", "import-json"],
    noun: "automation",
    additionalCapabilities: ["save"],
  },
  {
    bundles: ["deviceControl"],
    capabilities: [
      "provider-list",
      "connect",
      "account-list",
      "account-show",
      "account-reconcile",
      "account-disconnect",
      "daemon-status",
      "daemon-start",
      "daemon-stop",
    ],
    noun: "device",
  },
] as const satisfies readonly CommandNounCapabilityDefinition[];

const checkedCommandAliasDefinitions = [
  {
    alias: "chat",
    capability: "chat",
    targetCommand: "assistant chat",
    targetNoun: "assistant",
  },
  {
    alias: "status",
    capability: "status",
    targetCommand: "assistant status",
    targetNoun: "assistant",
  },
  {
    alias: "doctor",
    capability: "doctor",
    targetCommand: "assistant doctor",
    targetNoun: "assistant",
  },
  {
    alias: "run",
    capability: "run",
    targetCommand: "assistant run",
    targetNoun: "assistant",
  },
  {
    alias: "stop",
    capability: "stop",
    targetCommand: "assistant stop",
    targetNoun: "assistant",
  },
] as const satisfies readonly CommandAliasDefinition[];

export const commandNounCapabilities: readonly CommandNounCapabilityDefinition[] =
  checkedCommandNounCapabilities;

export const commandAliasDefinitions: readonly CommandAliasDefinition[] =
  checkedCommandAliasDefinitions;

export const commandNounCapabilityByNoun = new Map<
  CommandSurfaceNoun,
  CommandNounCapabilityDefinition
>(
  commandNounCapabilities.map((definition) => [definition.noun, definition]),
);

export const commandAliasByAlias = new Map<CommandSurfaceAlias, CommandAliasDefinition>(
  commandAliasDefinitions.map((definition) => [definition.alias, definition]),
);

export const frozenHealthCommandNouns = Object.freeze([
  "goal",
  "condition",
  "allergy",
  "food",
  "supplement",
  "regimen",
  "protocol",
  "family",
  "genetics",
  "blood_test",
] as const satisfies readonly CommandSurfaceNoun[]);
