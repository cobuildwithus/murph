import {
  automationFrontmatterSchema,
} from "./automation.ts";
import {
  familyBankEntityDefinition,
  allergyBankEntityDefinition,
  conditionBankEntityDefinition,
  foodBankEntityDefinition,
  geneticsBankEntityDefinition,
  goalBankEntityDefinition,
  protocolBankEntityDefinition,
  providerBankEntityDefinition,
  recipeBankEntityDefinition,
  workoutFormatBankEntityDefinition,
} from "./bank-entities.ts";
import {
  memoryDocumentFrontmatterSchema,
  memoryDocumentRelativePath,
} from "./memory.ts";
import type { ContractSchema } from "./validate.ts";
import {
  assessmentResponseSchema,
  auditRecordSchema,
  coreFrontmatterSchema,
  eventRecordSchema,
  experimentFrontmatterSchema,
  inboxCaptureRecordSchema,
  journalDayFrontmatterSchema,
  profileCurrentFrontmatterSchema,
  profileSnapshotSchema,
  sampleRecordSchema,
  vaultMetadataSchema,
} from "./zod.ts";

export const BANK_DIRECTORY = "bank" as const;
export const PROFILE_DIRECTORY = "bank/profile" as const;
export const LEDGER_DIRECTORY = "ledger" as const;
export const RAW_DIRECTORY = "raw" as const;
export const EXPORTS_DIRECTORY = "exports" as const;

export const VAULT_METADATA_FILE = "vault.json" as const;
export const CORE_DOCUMENT_RELATIVE_PATH = "CORE.md" as const;
export const AUTOMATIONS_DIRECTORY = "bank/automations" as const;
export const EXPERIMENTS_DIRECTORY = "bank/experiments" as const;
export const JOURNAL_DIRECTORY = "journal" as const;
export const PROFILE_CURRENT_DOCUMENT_RELATIVE_PATH = "bank/profile/current.md" as const;
export const ASSESSMENT_LEDGER_DIRECTORY = "ledger/assessments" as const;
export const EVENT_LEDGER_DIRECTORY = "ledger/events" as const;
export const PROFILE_SNAPSHOTS_LEDGER_DIRECTORY = "ledger/profile-snapshots" as const;
export const SAMPLE_LEDGER_DIRECTORY = "ledger/samples" as const;
export const AUDIT_DIRECTORY = "audit" as const;
export const INBOX_CAPTURE_LEDGER_DIRECTORY = "ledger/inbox-captures" as const;
export const RAW_INBOX_DIRECTORY = "raw/inbox" as const;
export const RAW_INTEGRATIONS_DIRECTORY = "raw/integrations" as const;
export const RAW_ASSESSMENTS_DIRECTORY = "raw/assessments" as const;
export const RAW_DOCUMENTS_DIRECTORY = "raw/documents" as const;
export const RAW_MEASUREMENTS_DIRECTORY = "raw/measurements" as const;
export const RAW_MEALS_DIRECTORY = "raw/meals" as const;
export const RAW_SAMPLES_DIRECTORY = "raw/samples" as const;
export const RAW_WORKOUTS_DIRECTORY = "raw/workouts" as const;
export const EXPORT_PACKS_DIRECTORY = "exports/packs" as const;

export const VAULT_FAMILY_IDS = Object.freeze({
  metadata: "metadata",
  coreDocument: "coreDocument",
  memoryDocument: "memoryDocument",
  automations: "automations",
  experiments: "experiments",
  journal: "journal",
  currentProfileDocument: "currentProfileDocument",
  goals: "goals",
  conditions: "conditions",
  allergies: "allergies",
  protocols: "protocols",
  familyMembers: "familyMembers",
  geneticVariants: "geneticVariants",
  foods: "foods",
  recipes: "recipes",
  providers: "providers",
  workoutFormats: "workoutFormats",
  assessments: "assessments",
  events: "events",
  profileSnapshots: "profileSnapshots",
  samples: "samples",
  audits: "audits",
  inboxCaptures: "inboxCaptures",
  rawAssessments: "rawAssessments",
  rawDocuments: "rawDocuments",
  rawInbox: "rawInbox",
  rawIntegrations: "rawIntegrations",
  rawMeasurements: "rawMeasurements",
  rawMeals: "rawMeals",
  rawSamples: "rawSamples",
  rawWorkouts: "rawWorkouts",
  exportPacks: "exportPacks",
} as const);

export type VaultFamilyId = (typeof VAULT_FAMILY_IDS)[keyof typeof VAULT_FAMILY_IDS];
export type VaultFamilyOwner = "core" | "inboxd" | "query";
export type VaultFamilyQuerySourceKind = "none" | "optional-file" | "markdown-root" | "jsonl-root";

export interface VaultFamilyValidationBase {
  issueCode: string;
  optional?: boolean;
  schema: ContractSchema;
}

export interface VaultFrontmatterValidationDescriptor extends VaultFamilyValidationBase {
  kind: "frontmatter";
}

export interface VaultJsonValidationDescriptor extends VaultFamilyValidationBase {
  kind: "json";
}

export interface VaultJsonlValidationDescriptor extends VaultFamilyValidationBase {
  kind: "jsonl";
}

export type VaultFamilyValidationDescriptor =
  | VaultFrontmatterValidationDescriptor
  | VaultJsonValidationDescriptor
  | VaultJsonlValidationDescriptor;

export interface VaultFamilyDescriptorBase {
  description: string;
  id: VaultFamilyId;
  owner: VaultFamilyOwner;
  querySource: VaultFamilyQuerySourceKind;
  validation?: VaultFamilyValidationDescriptor;
}

export interface VaultSingletonFileFamilyDescriptor extends VaultFamilyDescriptorBase {
  fileFormat: "json" | "markdown";
  relativePath: string;
  storageKind: "singleton-file";
}

export interface VaultMarkdownDirectoryFamilyDescriptor extends VaultFamilyDescriptorBase {
  directory: string;
  fileExtension: ".md";
  naming: "dated" | "slug";
  storageKind: "markdown-directory";
}

export interface VaultJsonlDirectoryFamilyDescriptor extends VaultFamilyDescriptorBase {
  directory: string;
  fileExtension: ".jsonl";
  shardPattern: string;
  storageKind: "jsonl-directory";
}

export interface VaultOpaqueDirectoryFamilyDescriptor extends VaultFamilyDescriptorBase {
  directory: string;
  storageKind: "directory";
}

export type VaultFamilyDescriptor =
  | VaultSingletonFileFamilyDescriptor
  | VaultMarkdownDirectoryFamilyDescriptor
  | VaultJsonlDirectoryFamilyDescriptor
  | VaultOpaqueDirectoryFamilyDescriptor;

export type VaultFrontmatterFamilyDescriptor =
  | (VaultSingletonFileFamilyDescriptor & {
      validation: VaultFrontmatterValidationDescriptor;
    })
  | (VaultMarkdownDirectoryFamilyDescriptor & {
      validation: VaultFrontmatterValidationDescriptor;
    });

export type VaultJsonValidationFamilyDescriptor = VaultSingletonFileFamilyDescriptor & {
  validation: VaultJsonValidationDescriptor;
};

export type VaultJsonlValidationFamilyDescriptor = VaultJsonlDirectoryFamilyDescriptor & {
  validation: VaultJsonlValidationDescriptor;
};

const vaultFamilyDescriptors = [
  {
    id: VAULT_FAMILY_IDS.metadata,
    description: "Vault metadata JSON.",
    owner: "core",
    storageKind: "singleton-file",
    fileFormat: "json",
    relativePath: VAULT_METADATA_FILE,
    querySource: "optional-file",
    validation: {
      kind: "json",
      issueCode: "VAULT_INVALID_METADATA",
      schema: vaultMetadataSchema,
    },
  },
  {
    id: VAULT_FAMILY_IDS.coreDocument,
    description: "Vault core summary markdown.",
    owner: "core",
    storageKind: "singleton-file",
    fileFormat: "markdown",
    relativePath: CORE_DOCUMENT_RELATIVE_PATH,
    querySource: "optional-file",
    validation: {
      kind: "frontmatter",
      issueCode: "FRONTMATTER_INVALID",
      schema: coreFrontmatterSchema,
    },
  },
  {
    id: VAULT_FAMILY_IDS.memoryDocument,
    description: "Canonical assistant memory markdown.",
    owner: "core",
    storageKind: "singleton-file",
    fileFormat: "markdown",
    relativePath: memoryDocumentRelativePath,
    querySource: "none",
    validation: {
      kind: "frontmatter",
      issueCode: "FRONTMATTER_INVALID",
      optional: true,
      schema: memoryDocumentFrontmatterSchema,
    },
  },
  {
    id: VAULT_FAMILY_IDS.automations,
    description: "Canonical assistant automation markdown documents.",
    owner: "core",
    storageKind: "markdown-directory",
    naming: "slug",
    directory: AUTOMATIONS_DIRECTORY,
    fileExtension: ".md",
    querySource: "none",
    validation: {
      kind: "frontmatter",
      issueCode: "FRONTMATTER_INVALID",
      schema: automationFrontmatterSchema,
    },
  },
  {
    id: VAULT_FAMILY_IDS.experiments,
    description: "Canonical experiment markdown documents.",
    owner: "core",
    storageKind: "markdown-directory",
    naming: "slug",
    directory: EXPERIMENTS_DIRECTORY,
    fileExtension: ".md",
    querySource: "markdown-root",
    validation: {
      kind: "frontmatter",
      issueCode: "FRONTMATTER_INVALID",
      schema: experimentFrontmatterSchema,
    },
  },
  {
    id: VAULT_FAMILY_IDS.journal,
    description: "Dated journal markdown documents.",
    owner: "core",
    storageKind: "markdown-directory",
    naming: "dated",
    directory: JOURNAL_DIRECTORY,
    fileExtension: ".md",
    querySource: "markdown-root",
    validation: {
      kind: "frontmatter",
      issueCode: "FRONTMATTER_INVALID",
      schema: journalDayFrontmatterSchema,
    },
  },
  {
    id: VAULT_FAMILY_IDS.currentProfileDocument,
    description: "Current profile materialization markdown.",
    owner: "core",
    storageKind: "singleton-file",
    fileFormat: "markdown",
    relativePath: PROFILE_CURRENT_DOCUMENT_RELATIVE_PATH,
    querySource: "optional-file",
    validation: {
      kind: "frontmatter",
      issueCode: "FRONTMATTER_INVALID",
      optional: true,
      schema: profileCurrentFrontmatterSchema,
    },
  },
  {
    id: VAULT_FAMILY_IDS.goals,
    description: "Goal registry markdown documents.",
    owner: "core",
    storageKind: "markdown-directory",
    naming: "slug",
    directory: goalBankEntityDefinition.registry.directory,
    fileExtension: ".md",
    querySource: "markdown-root",
    validation: {
      kind: "frontmatter",
      issueCode: "FRONTMATTER_INVALID",
      schema: goalBankEntityDefinition.registry.frontmatterSchema!,
    },
  },
  {
    id: VAULT_FAMILY_IDS.conditions,
    description: "Condition registry markdown documents.",
    owner: "core",
    storageKind: "markdown-directory",
    naming: "slug",
    directory: conditionBankEntityDefinition.registry.directory,
    fileExtension: ".md",
    querySource: "markdown-root",
    validation: {
      kind: "frontmatter",
      issueCode: "FRONTMATTER_INVALID",
      schema: conditionBankEntityDefinition.registry.frontmatterSchema!,
    },
  },
  {
    id: VAULT_FAMILY_IDS.allergies,
    description: "Allergy registry markdown documents.",
    owner: "core",
    storageKind: "markdown-directory",
    naming: "slug",
    directory: allergyBankEntityDefinition.registry.directory,
    fileExtension: ".md",
    querySource: "markdown-root",
    validation: {
      kind: "frontmatter",
      issueCode: "FRONTMATTER_INVALID",
      schema: allergyBankEntityDefinition.registry.frontmatterSchema!,
    },
  },
  {
    id: VAULT_FAMILY_IDS.protocols,
    description: "Protocol registry markdown documents.",
    owner: "core",
    storageKind: "markdown-directory",
    naming: "slug",
    directory: protocolBankEntityDefinition.registry.directory,
    fileExtension: ".md",
    querySource: "markdown-root",
    validation: {
      kind: "frontmatter",
      issueCode: "FRONTMATTER_INVALID",
      schema: protocolBankEntityDefinition.registry.frontmatterSchema!,
    },
  },
  {
    id: VAULT_FAMILY_IDS.familyMembers,
    description: "Family-member registry markdown documents.",
    owner: "core",
    storageKind: "markdown-directory",
    naming: "slug",
    directory: familyBankEntityDefinition.registry.directory,
    fileExtension: ".md",
    querySource: "markdown-root",
    validation: {
      kind: "frontmatter",
      issueCode: "FRONTMATTER_INVALID",
      schema: familyBankEntityDefinition.registry.frontmatterSchema!,
    },
  },
  {
    id: VAULT_FAMILY_IDS.geneticVariants,
    description: "Genetic-variant registry markdown documents.",
    owner: "core",
    storageKind: "markdown-directory",
    naming: "slug",
    directory: geneticsBankEntityDefinition.registry.directory,
    fileExtension: ".md",
    querySource: "markdown-root",
    validation: {
      kind: "frontmatter",
      issueCode: "FRONTMATTER_INVALID",
      schema: geneticsBankEntityDefinition.registry.frontmatterSchema!,
    },
  },
  {
    id: VAULT_FAMILY_IDS.foods,
    description: "Food registry markdown documents.",
    owner: "core",
    storageKind: "markdown-directory",
    naming: "slug",
    directory: foodBankEntityDefinition.registry.directory,
    fileExtension: ".md",
    querySource: "markdown-root",
    validation: {
      kind: "frontmatter",
      issueCode: "FRONTMATTER_INVALID",
      schema: foodBankEntityDefinition.registry.frontmatterSchema!,
    },
  },
  {
    id: VAULT_FAMILY_IDS.recipes,
    description: "Recipe registry markdown documents.",
    owner: "core",
    storageKind: "markdown-directory",
    naming: "slug",
    directory: recipeBankEntityDefinition.registry.directory,
    fileExtension: ".md",
    querySource: "markdown-root",
    validation: {
      kind: "frontmatter",
      issueCode: "FRONTMATTER_INVALID",
      schema: recipeBankEntityDefinition.registry.frontmatterSchema!,
    },
  },
  {
    id: VAULT_FAMILY_IDS.providers,
    description: "Provider registry markdown documents.",
    owner: "core",
    storageKind: "markdown-directory",
    naming: "slug",
    directory: providerBankEntityDefinition.registry.directory,
    fileExtension: ".md",
    querySource: "markdown-root",
    validation: {
      kind: "frontmatter",
      issueCode: "FRONTMATTER_INVALID",
      schema: providerBankEntityDefinition.registry.frontmatterSchema!,
    },
  },
  {
    id: VAULT_FAMILY_IDS.workoutFormats,
    description: "Workout-format registry markdown documents.",
    owner: "core",
    storageKind: "markdown-directory",
    naming: "slug",
    directory: workoutFormatBankEntityDefinition.registry.directory,
    fileExtension: ".md",
    querySource: "markdown-root",
    validation: {
      kind: "frontmatter",
      issueCode: "FRONTMATTER_INVALID",
      schema: workoutFormatBankEntityDefinition.registry.frontmatterSchema!,
    },
  },
  {
    id: VAULT_FAMILY_IDS.assessments,
    description: "Assessment-response ledger shards.",
    owner: "core",
    storageKind: "jsonl-directory",
    directory: ASSESSMENT_LEDGER_DIRECTORY,
    fileExtension: ".jsonl",
    shardPattern: "ledger/assessments/YYYY/YYYY-MM.jsonl",
    querySource: "jsonl-root",
    validation: {
      kind: "jsonl",
      issueCode: "CONTRACT_INVALID",
      schema: assessmentResponseSchema,
    },
  },
  {
    id: VAULT_FAMILY_IDS.events,
    description: "Event ledger shards.",
    owner: "core",
    storageKind: "jsonl-directory",
    directory: EVENT_LEDGER_DIRECTORY,
    fileExtension: ".jsonl",
    shardPattern: "ledger/events/YYYY/YYYY-MM.jsonl",
    querySource: "jsonl-root",
    validation: {
      kind: "jsonl",
      issueCode: "EVENT_INVALID",
      schema: eventRecordSchema,
    },
  },
  {
    id: VAULT_FAMILY_IDS.profileSnapshots,
    description: "Profile snapshot ledger shards.",
    owner: "core",
    storageKind: "jsonl-directory",
    directory: PROFILE_SNAPSHOTS_LEDGER_DIRECTORY,
    fileExtension: ".jsonl",
    shardPattern: "ledger/profile-snapshots/YYYY/YYYY-MM.jsonl",
    querySource: "jsonl-root",
    validation: {
      kind: "jsonl",
      issueCode: "CONTRACT_INVALID",
      schema: profileSnapshotSchema,
    },
  },
  {
    id: VAULT_FAMILY_IDS.samples,
    description: "Sample ledger shards.",
    owner: "core",
    storageKind: "jsonl-directory",
    directory: SAMPLE_LEDGER_DIRECTORY,
    fileExtension: ".jsonl",
    shardPattern: "ledger/samples/<stream>/YYYY/YYYY-MM.jsonl",
    querySource: "jsonl-root",
    validation: {
      kind: "jsonl",
      issueCode: "SAMPLE_INVALID",
      schema: sampleRecordSchema,
    },
  },
  {
    id: VAULT_FAMILY_IDS.audits,
    description: "Audit ledger shards.",
    owner: "core",
    storageKind: "jsonl-directory",
    directory: AUDIT_DIRECTORY,
    fileExtension: ".jsonl",
    shardPattern: "audit/YYYY/YYYY-MM.jsonl",
    querySource: "jsonl-root",
    validation: {
      kind: "jsonl",
      issueCode: "AUDIT_INVALID",
      schema: auditRecordSchema,
    },
  },
  {
    id: VAULT_FAMILY_IDS.inboxCaptures,
    description: "Inbox capture ledger shards.",
    owner: "inboxd",
    storageKind: "jsonl-directory",
    directory: INBOX_CAPTURE_LEDGER_DIRECTORY,
    fileExtension: ".jsonl",
    shardPattern: "ledger/inbox-captures/YYYY/YYYY-MM.jsonl",
    querySource: "none",
    validation: {
      kind: "jsonl",
      issueCode: "CONTRACT_INVALID",
      schema: inboxCaptureRecordSchema,
    },
  },
  {
    id: VAULT_FAMILY_IDS.rawAssessments,
    description: "Immutable raw assessment imports.",
    owner: "core",
    storageKind: "directory",
    directory: RAW_ASSESSMENTS_DIRECTORY,
    querySource: "none",
  },
  {
    id: VAULT_FAMILY_IDS.rawDocuments,
    description: "Immutable raw document imports.",
    owner: "core",
    storageKind: "directory",
    directory: RAW_DOCUMENTS_DIRECTORY,
    querySource: "none",
  },
  {
    id: VAULT_FAMILY_IDS.rawInbox,
    description: "Immutable raw inbox evidence.",
    owner: "inboxd",
    storageKind: "directory",
    directory: RAW_INBOX_DIRECTORY,
    querySource: "none",
  },
  {
    id: VAULT_FAMILY_IDS.rawIntegrations,
    description: "Immutable raw provider integration snapshots.",
    owner: "core",
    storageKind: "directory",
    directory: RAW_INTEGRATIONS_DIRECTORY,
    querySource: "none",
  },
  {
    id: VAULT_FAMILY_IDS.rawMeasurements,
    description: "Immutable raw measurement imports.",
    owner: "core",
    storageKind: "directory",
    directory: RAW_MEASUREMENTS_DIRECTORY,
    querySource: "none",
  },
  {
    id: VAULT_FAMILY_IDS.rawMeals,
    description: "Immutable raw meal artifacts.",
    owner: "core",
    storageKind: "directory",
    directory: RAW_MEALS_DIRECTORY,
    querySource: "none",
  },
  {
    id: VAULT_FAMILY_IDS.rawSamples,
    description: "Immutable raw sample imports.",
    owner: "core",
    storageKind: "directory",
    directory: RAW_SAMPLES_DIRECTORY,
    querySource: "none",
  },
  {
    id: VAULT_FAMILY_IDS.rawWorkouts,
    description: "Immutable raw workout imports.",
    owner: "core",
    storageKind: "directory",
    directory: RAW_WORKOUTS_DIRECTORY,
    querySource: "none",
  },
  {
    id: VAULT_FAMILY_IDS.exportPacks,
    description: "Generated export packs.",
    owner: "query",
    storageKind: "directory",
    directory: EXPORT_PACKS_DIRECTORY,
    querySource: "none",
  },
] as const satisfies readonly VaultFamilyDescriptor[];

export const VAULT_FAMILY_DESCRIPTORS = Object.freeze(vaultFamilyDescriptors);

function resolveVaultFamilyTarget(family: VaultFamilyDescriptor): string {
  return family.storageKind === "singleton-file" ? family.relativePath : family.directory;
}

function buildVaultFamilyById(): Record<VaultFamilyId, VaultFamilyDescriptor> {
  const byId = {} as Record<VaultFamilyId, VaultFamilyDescriptor>;
  const targetOwners = new Map<string, VaultFamilyId>();

  for (const family of VAULT_FAMILY_DESCRIPTORS) {
    if (family.id in byId) {
      throw new Error(`Duplicate vault family id "${family.id}".`);
    }

    const target = resolveVaultFamilyTarget(family);
    const existingTargetOwner = targetOwners.get(target);
    if (existingTargetOwner) {
      throw new Error(
        `Vault families "${existingTargetOwner}" and "${family.id}" share the same canonical target "${target}".`,
      );
    }

    byId[family.id] = family;
    targetOwners.set(target, family.id);
  }

  return byId;
}

export const VAULT_FAMILY_BY_ID = Object.freeze(buildVaultFamilyById());

export function getVaultFamily(id: VaultFamilyId): VaultFamilyDescriptor {
  return VAULT_FAMILY_BY_ID[id];
}

export function isVaultFrontmatterFamily(
  family: VaultFamilyDescriptor,
): family is VaultFrontmatterFamilyDescriptor {
  return Boolean(
    family.validation &&
      family.validation.kind === "frontmatter" &&
      (family.storageKind === "singleton-file" || family.storageKind === "markdown-directory"),
  );
}

export function isVaultJsonValidationFamily(
  family: VaultFamilyDescriptor,
): family is VaultJsonValidationFamilyDescriptor {
  return Boolean(
    family.validation && family.validation.kind === "json" && family.storageKind === "singleton-file",
  );
}

export function isVaultJsonlDirectoryFamily(
  family: VaultFamilyDescriptor,
): family is VaultJsonlDirectoryFamilyDescriptor {
  return family.storageKind === "jsonl-directory";
}

export function isVaultJsonlValidationFamily(
  family: VaultFamilyDescriptor,
): family is VaultJsonlValidationFamilyDescriptor {
  return Boolean(
    family.validation && family.validation.kind === "jsonl" && family.storageKind === "jsonl-directory",
  );
}

function dirnamePosix(relativePath: string): string | null {
  const separatorIndex = relativePath.lastIndexOf("/");
  return separatorIndex === -1 ? null : relativePath.slice(0, separatorIndex);
}

function expandAncestorDirectories(directory: string | null): string[] {
  if (!directory) {
    return [];
  }

  const segments = directory.split("/").filter(Boolean);
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

function familyDirectories(family: VaultFamilyDescriptor): string[] {
  return expandAncestorDirectories(
    family.storageKind === "singleton-file"
      ? dirnamePosix(family.relativePath)
      : family.directory,
  );
}

function collectVaultDirectories(): string[] {
  const seen = new Set<string>();
  const directories: string[] = [];

  for (const family of VAULT_FAMILY_DESCRIPTORS) {
    for (const directory of familyDirectories(family)) {
      if (seen.has(directory)) {
        continue;
      }

      seen.add(directory);
      directories.push(directory);
    }
  }

  return directories;
}

function listQuerySourceEntries(kind: Exclude<VaultFamilyQuerySourceKind, "none">): string[] {
  return VAULT_FAMILY_DESCRIPTORS
    .filter((family) => family.querySource === kind)
    .map((family) => (
      family.storageKind === "singleton-file"
        ? family.relativePath
        : family.directory
    ));
}

function getVaultShardPattern(id: VaultFamilyId): string {
  const family = getVaultFamily(id);

  if (!isVaultJsonlDirectoryFamily(family)) {
    throw new Error(`Vault family "${id}" does not define a JSONL shard pattern.`);
  }

  return family.shardPattern;
}

function collectVaultFrontmatterFamilies(): VaultFrontmatterFamilyDescriptor[] {
  const families: VaultFrontmatterFamilyDescriptor[] = [];

  for (const family of VAULT_FAMILY_DESCRIPTORS) {
    if (isVaultFrontmatterFamily(family)) {
      families.push(family);
    }
  }

  return families;
}

function collectVaultJsonValidationFamilies(): VaultJsonValidationFamilyDescriptor[] {
  const families: VaultJsonValidationFamilyDescriptor[] = [];

  for (const family of VAULT_FAMILY_DESCRIPTORS) {
    if (isVaultJsonValidationFamily(family)) {
      families.push(family);
    }
  }

  return families;
}

function collectVaultJsonlValidationFamilies(): VaultJsonlValidationFamilyDescriptor[] {
  const families: VaultJsonlValidationFamilyDescriptor[] = [];

  for (const family of VAULT_FAMILY_DESCRIPTORS) {
    if (isVaultJsonlValidationFamily(family)) {
      families.push(family);
    }
  }

  return families;
}

export const REQUIRED_VAULT_DIRECTORIES = Object.freeze(collectVaultDirectories());

export const VAULT_FRONTMATTER_FAMILIES: readonly VaultFrontmatterFamilyDescriptor[] = Object.freeze(
  collectVaultFrontmatterFamilies(),
);

export const VAULT_JSON_VALIDATION_FAMILIES: readonly VaultJsonValidationFamilyDescriptor[] = Object.freeze(
  collectVaultJsonValidationFamilies(),
);

export const VAULT_JSONL_VALIDATION_FAMILIES: readonly VaultJsonlValidationFamilyDescriptor[] = Object.freeze(
  collectVaultJsonlValidationFamilies(),
);

export const VAULT_QUERY_SOURCE = Object.freeze({
  optionalFiles: listQuerySourceEntries("optional-file"),
  markdownRoots: listQuerySourceEntries("markdown-root"),
  jsonlRoots: listQuerySourceEntries("jsonl-root"),
});

export const VAULT_LAYOUT = Object.freeze({
  metadata: VAULT_METADATA_FILE,
  coreDocument: CORE_DOCUMENT_RELATIVE_PATH,
  memoryDocument: memoryDocumentRelativePath,
  bankDirectory: BANK_DIRECTORY,
  journalDirectory: JOURNAL_DIRECTORY,
  automationsDirectory: AUTOMATIONS_DIRECTORY,
  allergiesDirectory: allergyBankEntityDefinition.registry.directory,
  conditionsDirectory: conditionBankEntityDefinition.registry.directory,
  experimentsDirectory: EXPERIMENTS_DIRECTORY,
  familyDirectory: familyBankEntityDefinition.registry.directory,
  foodsDirectory: foodBankEntityDefinition.registry.directory,
  geneticsDirectory: geneticsBankEntityDefinition.registry.directory,
  goalsDirectory: goalBankEntityDefinition.registry.directory,
  profileDirectory: PROFILE_DIRECTORY,
  profileCurrentDocument: PROFILE_CURRENT_DOCUMENT_RELATIVE_PATH,
  providersDirectory: providerBankEntityDefinition.registry.directory,
  recipesDirectory: recipeBankEntityDefinition.registry.directory,
  workoutFormatsDirectory: workoutFormatBankEntityDefinition.registry.directory,
  protocolsDirectory: protocolBankEntityDefinition.registry.directory,
  ledgerDirectory: LEDGER_DIRECTORY,
  assessmentLedgerDirectory: ASSESSMENT_LEDGER_DIRECTORY,
  eventLedgerDirectory: EVENT_LEDGER_DIRECTORY,
  profileSnapshotsDirectory: PROFILE_SNAPSHOTS_LEDGER_DIRECTORY,
  sampleLedgerDirectory: SAMPLE_LEDGER_DIRECTORY,
  inboxCaptureLedgerDirectory: INBOX_CAPTURE_LEDGER_DIRECTORY,
  rawDirectory: RAW_DIRECTORY,
  rawAssessmentsDirectory: RAW_ASSESSMENTS_DIRECTORY,
  rawDocumentsDirectory: RAW_DOCUMENTS_DIRECTORY,
  rawInboxDirectory: RAW_INBOX_DIRECTORY,
  rawIntegrationsDirectory: RAW_INTEGRATIONS_DIRECTORY,
  rawMeasurementsDirectory: RAW_MEASUREMENTS_DIRECTORY,
  rawMealsDirectory: RAW_MEALS_DIRECTORY,
  rawSamplesDirectory: RAW_SAMPLES_DIRECTORY,
  rawWorkoutsDirectory: RAW_WORKOUTS_DIRECTORY,
  auditDirectory: AUDIT_DIRECTORY,
  exportsDirectory: EXPORTS_DIRECTORY,
  exportPacksDirectory: EXPORT_PACKS_DIRECTORY,
});

export const VAULT_SHARDS = Object.freeze({
  assessments: getVaultShardPattern(VAULT_FAMILY_IDS.assessments),
  events: getVaultShardPattern(VAULT_FAMILY_IDS.events),
  profileSnapshots: getVaultShardPattern(VAULT_FAMILY_IDS.profileSnapshots),
  samples: getVaultShardPattern(VAULT_FAMILY_IDS.samples),
  audit: getVaultShardPattern(VAULT_FAMILY_IDS.audits),
  inboxCaptures: getVaultShardPattern(VAULT_FAMILY_IDS.inboxCaptures),
});
