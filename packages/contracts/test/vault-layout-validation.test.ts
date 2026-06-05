import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { CURRENT_VAULT_FORMAT_VERSION, ID_PREFIXES } from "../src/constants.ts";
import { preferencesDocumentRelativePath } from "../src/preferences.ts";
import {
  detectVaultMetadataFormatVersion,
  resolveVaultMetadataFormatVersion,
  validateCurrentVaultMetadata,
} from "../src/vault.ts";
import {
  ASSESSMENT_LEDGER_DIRECTORY,
  AUDIT_DIRECTORY,
  AUTOMATIONS_DIRECTORY,
  BANK_DIRECTORY,
  CORE_DOCUMENT_RELATIVE_PATH,
  DERIVED_DIRECTORY,
  DERIVED_KNOWLEDGE_DIRECTORY,
  DERIVED_KNOWLEDGE_INDEX_FILE,
  DERIVED_KNOWLEDGE_LOG_FILE,
  DERIVED_KNOWLEDGE_PAGES_DIRECTORY,
  EVENT_LEDGER_DIRECTORY,
  EXPORT_PACKS_DIRECTORY,
  EXPERIMENTS_DIRECTORY,
  HEALTH_LIBRARY_DIRECTORY,
  INBOX_CAPTURE_LEDGER_DIRECTORY,
  JOURNAL_DIRECTORY,
  METRIC_SAMPLE_LEDGER_DIRECTORY,
  PROTOCOLS_DIRECTORY,
  RAW_ASSESSMENTS_DIRECTORY,
  RAW_CAPTURES_DIRECTORY,
  RAW_DIRECTORY,
  RAW_DOCUMENTS_DIRECTORY,
  RAW_INBOX_DIRECTORY,
  RAW_INTEGRATIONS_DIRECTORY,
  RAW_MEALS_DIRECTORY,
  RAW_MEASUREMENTS_DIRECTORY,
  RAW_SAMPLES_DIRECTORY,
  RAW_WORKOUTS_DIRECTORY,
  REQUIRED_VAULT_DIRECTORIES,
  SAMPLE_LEDGER_DIRECTORY,
  SCHEDULED_LOGS_DIRECTORY,
  VAULT_FAMILY_BY_ID,
  VAULT_FAMILY_DESCRIPTORS,
  VAULT_FAMILY_IDS,
  VAULT_FRONTMATTER_FAMILIES,
  VAULT_JSONL_VALIDATION_FAMILIES,
  VAULT_JSON_VALIDATION_FAMILIES,
  VAULT_LAYOUT,
  VAULT_METADATA_FILE,
  VAULT_QUERY_SOURCE,
  VAULT_SHARDS,
  getVaultFamily,
  isVaultFrontmatterFamily,
  isVaultJsonlDirectoryFamily,
  isVaultJsonlValidationFamily,
  isVaultJsonValidationFamily,
  type VaultFamilyDescriptor,
} from "../src/vault-families.ts";

const VALID_ULID = "0123456789ABCDEFGHJKMNPQRS";
const VALID_VAULT_ID = `${ID_PREFIXES.vault}_${VALID_ULID}`;
const VALID_METADATA = Object.freeze({
  formatVersion: CURRENT_VAULT_FORMAT_VERSION,
  vaultId: VALID_VAULT_ID,
  createdAt: "2026-04-08T10:11:12.000Z",
  title: "Deterministic test vault",
  timezone: "Australia/Sydney",
});

const VAULT_LAYOUT_DOC_URL = new URL("../../../docs/contracts/01-vault-layout.md", import.meta.url);

function extractCodeBlockLinesAfterHeading(document: string, heading: string): string[] {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = document.match(new RegExp(`${escapedHeading}\\n\\n\`\`\`text\\n([\\s\\S]*?)\\n\`\`\``, "u"));
  if (!match?.[1]) {
    throw new Error(`Expected code block after heading "${heading}".`);
  }

  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractSectionCodeSpans(document: string, heading: string): string[] {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = document.match(new RegExp(`${escapedHeading}\\n\\n([\\s\\S]*?)(?:\\n## |$)`, "u"));
  if (!match?.[1]) {
    throw new Error(`Expected section "${heading}".`);
  }

  return [...match[1].matchAll(/`([^`]+)`/gu)].map(([, value]) => value);
}

function familyTarget(family: VaultFamilyDescriptor): string {
  return family.storageKind === "singleton-file" ? family.relativePath : family.directory;
}

describe("vault metadata validation", () => {
  it("resolves metadata format versions from present or absent metadata", () => {
    expect(resolveVaultMetadataFormatVersion(VALID_METADATA)).toBe(CURRENT_VAULT_FORMAT_VERSION);
    expect(resolveVaultMetadataFormatVersion(null)).toBeNull();
    expect(resolveVaultMetadataFormatVersion(undefined)).toBeNull();
  });

  it("rejects invalid metadata envelopes before schema validation", () => {
    expect(
      detectVaultMetadataFormatVersion(["not", "an", "object"], {
        relativePath: VAULT_METADATA_FILE,
      }),
    ).toEqual({
      success: false,
      error: {
        code: "VAULT_INVALID_METADATA",
        message: "Vault metadata must be a JSON object.",
        details: {
          relativePath: VAULT_METADATA_FILE,
        },
      },
    });

    expect(detectVaultMetadataFormatVersion({})).toEqual({
      success: false,
      error: {
        code: "VAULT_INVALID_METADATA",
        message: "Vault metadata formatVersion is required.",
        details: {},
      },
    });

    expect(detectVaultMetadataFormatVersion({ formatVersion: 1.5 })).toEqual({
      success: false,
      error: {
        code: "VAULT_INVALID_METADATA",
        message: "Vault metadata formatVersion must be a non-negative integer.",
        details: {},
      },
    });
  });

  it("requires supported current-format metadata before strict contract validation", () => {
    expect(
      validateCurrentVaultMetadata(["not", "an", "object"], {
        relativePath: VAULT_METADATA_FILE,
      }),
    ).toEqual({
      success: false,
      error: {
        code: "VAULT_INVALID_METADATA",
        message: "Vault metadata must be a JSON object.",
        details: {
          relativePath: VAULT_METADATA_FILE,
        },
      },
    });

    expect(validateCurrentVaultMetadata({ ...VALID_METADATA, formatVersion: 0 })).toEqual({
      success: false,
      error: {
        code: "VAULT_UNSUPPORTED_FORMAT",
        message:
          `Vault formatVersion 0 is unsupported; expected formatVersion ${CURRENT_VAULT_FORMAT_VERSION}.`,
        details: {
          storedFormatVersion: 0,
          supportedFormatVersion: CURRENT_VAULT_FORMAT_VERSION,
        },
      },
    });

    expect(validateCurrentVaultMetadata({ ...VALID_METADATA, formatVersion: CURRENT_VAULT_FORMAT_VERSION + 1 })).toEqual({
      success: false,
      error: {
        code: "VAULT_UNSUPPORTED_FORMAT",
        message:
          `Vault formatVersion ${CURRENT_VAULT_FORMAT_VERSION + 1} is unsupported; expected formatVersion ${CURRENT_VAULT_FORMAT_VERSION}.`,
        details: {
          storedFormatVersion: CURRENT_VAULT_FORMAT_VERSION + 1,
          supportedFormatVersion: CURRENT_VAULT_FORMAT_VERSION,
        },
      },
    });

    expect(
      validateCurrentVaultMetadata(
        {
          ...VALID_METADATA,
          title: "",
        },
        {
          invalidSchemaMessage: "metadata schema mismatch",
          relativePath: VAULT_METADATA_FILE,
        },
      ),
    ).toEqual({
      success: false,
      error: {
        code: "VAULT_INVALID_METADATA",
        message: "metadata schema mismatch",
        details: {
          relativePath: VAULT_METADATA_FILE,
          errors: expect.arrayContaining([
            expect.stringContaining("$.title"),
          ]),
        },
      },
    });
  });

  it("accepts current-format metadata and returns the parsed value", () => {
    expect(validateCurrentVaultMetadata(VALID_METADATA)).toEqual({
      success: true,
      data: {
        metadata: VALID_METADATA,
        storedFormatVersion: CURRENT_VAULT_FORMAT_VERSION,
      },
    });
  });
});

describe("vault family descriptors", () => {
  it("maps every family id to a unique descriptor and target", () => {
    expect(Object.keys(VAULT_FAMILY_BY_ID).sort()).toEqual(Object.values(VAULT_FAMILY_IDS).sort());

    const targets = new Set<string>();
    for (const family of VAULT_FAMILY_DESCRIPTORS) {
      expect(getVaultFamily(family.id)).toBe(family);
      expect(targets.has(familyTarget(family))).toBe(false);
      targets.add(familyTarget(family));
    }
  });

  it("exposes stable family type guards and filtered family collections", () => {
    const metadataFamily = getVaultFamily(VAULT_FAMILY_IDS.metadata);
    expect(isVaultJsonValidationFamily(metadataFamily)).toBe(true);
    expect(isVaultFrontmatterFamily(metadataFamily)).toBe(false);
    expect(isVaultJsonlDirectoryFamily(metadataFamily)).toBe(false);

    const experimentsFamily = getVaultFamily(VAULT_FAMILY_IDS.experiments);
    expect(isVaultFrontmatterFamily(experimentsFamily)).toBe(true);
    expect(isVaultJsonValidationFamily(experimentsFamily)).toBe(false);
    expect(isVaultJsonlDirectoryFamily(experimentsFamily)).toBe(false);

    const eventsFamily = getVaultFamily(VAULT_FAMILY_IDS.events);
    expect(isVaultJsonlDirectoryFamily(eventsFamily)).toBe(true);
    expect(isVaultJsonlValidationFamily(eventsFamily)).toBe(true);
    expect(isVaultFrontmatterFamily(eventsFamily)).toBe(false);

    const rawMealsFamily = getVaultFamily(VAULT_FAMILY_IDS.rawMeals);
    expect(isVaultFrontmatterFamily(rawMealsFamily)).toBe(false);
    expect(isVaultJsonValidationFamily(rawMealsFamily)).toBe(false);
    expect(isVaultJsonlDirectoryFamily(rawMealsFamily)).toBe(false);
    expect(isVaultJsonlValidationFamily(rawMealsFamily)).toBe(false);

    const preferencesFamily = getVaultFamily(VAULT_FAMILY_IDS.preferencesDocument);
    expect(isVaultJsonValidationFamily(preferencesFamily)).toBe(true);
    expect(preferencesFamily.storageKind).toBe("singleton-file");
    if (preferencesFamily.storageKind !== "singleton-file") {
      throw new Error("Expected singleton preferences family.");
    }
    expect(preferencesFamily.relativePath).toBe(preferencesDocumentRelativePath);

    expect(VAULT_FRONTMATTER_FAMILIES).toEqual(
      VAULT_FAMILY_DESCRIPTORS.filter((family) => isVaultFrontmatterFamily(family)),
    );
    expect(VAULT_JSON_VALIDATION_FAMILIES).toEqual(
      VAULT_FAMILY_DESCRIPTORS.filter((family) => isVaultJsonValidationFamily(family)),
    );
    expect(VAULT_JSONL_VALIDATION_FAMILIES).toEqual(
      VAULT_FAMILY_DESCRIPTORS.filter((family) => isVaultJsonlValidationFamily(family)),
    );
  });
});

describe("vault layout exports", () => {
  it("publishes the required ancestor directories in canonical order without duplicates", () => {
    expect(REQUIRED_VAULT_DIRECTORIES).toEqual([
      BANK_DIRECTORY,
      AUTOMATIONS_DIRECTORY,
      SCHEDULED_LOGS_DIRECTORY,
      EXPERIMENTS_DIRECTORY,
      JOURNAL_DIRECTORY,
      "bank/goals",
      "bank/conditions",
      "bank/allergies",
      "bank/regimens",
      "bank/family",
      "bank/genetics",
      "bank/foods",
      "bank/recipes",
      "bank/providers",
      "bank/workout-formats",
      "ledger",
      ASSESSMENT_LEDGER_DIRECTORY,
      EVENT_LEDGER_DIRECTORY,
      METRIC_SAMPLE_LEDGER_DIRECTORY,
      SAMPLE_LEDGER_DIRECTORY,
      AUDIT_DIRECTORY,
      INBOX_CAPTURE_LEDGER_DIRECTORY,
      RAW_DIRECTORY,
      RAW_ASSESSMENTS_DIRECTORY,
      RAW_CAPTURES_DIRECTORY,
      RAW_DOCUMENTS_DIRECTORY,
      RAW_INBOX_DIRECTORY,
      RAW_INTEGRATIONS_DIRECTORY,
      RAW_MEASUREMENTS_DIRECTORY,
      RAW_MEALS_DIRECTORY,
      RAW_SAMPLES_DIRECTORY,
      RAW_WORKOUTS_DIRECTORY,
    ]);
  });

  it("publishes stable query-source targets, layout aliases, and shard patterns", () => {
    expect(VAULT_QUERY_SOURCE).toEqual({
      optionalFiles: [VAULT_METADATA_FILE, CORE_DOCUMENT_RELATIVE_PATH],
      markdownRoots: [
        SCHEDULED_LOGS_DIRECTORY,
        EXPERIMENTS_DIRECTORY,
        PROTOCOLS_DIRECTORY,
        JOURNAL_DIRECTORY,
        "bank/goals",
        "bank/conditions",
        "bank/allergies",
        "bank/regimens",
        "bank/family",
        "bank/genetics",
        "bank/foods",
        "bank/recipes",
        "bank/providers",
        "bank/workout-formats",
      ],
      jsonlRoots: [
        ASSESSMENT_LEDGER_DIRECTORY,
        EVENT_LEDGER_DIRECTORY,
        METRIC_SAMPLE_LEDGER_DIRECTORY,
        AUDIT_DIRECTORY,
      ],
    });

    expect(VAULT_LAYOUT).toEqual({
      metadata: VAULT_METADATA_FILE,
      coreDocument: CORE_DOCUMENT_RELATIVE_PATH,
      memoryDocument: "bank/memory.md",
      preferencesDocument: preferencesDocumentRelativePath,
      bankDirectory: BANK_DIRECTORY,
      derivedDirectory: DERIVED_DIRECTORY,
      journalDirectory: JOURNAL_DIRECTORY,
      automationsDirectory: AUTOMATIONS_DIRECTORY,
      scheduledLogsDirectory: SCHEDULED_LOGS_DIRECTORY,
      allergiesDirectory: "bank/allergies",
      conditionsDirectory: "bank/conditions",
      experimentsDirectory: EXPERIMENTS_DIRECTORY,
      protocolsDirectory: PROTOCOLS_DIRECTORY,
      familyDirectory: "bank/family",
      foodsDirectory: "bank/foods",
      geneticsDirectory: "bank/genetics",
      goalsDirectory: "bank/goals",
      healthLibraryDirectory: HEALTH_LIBRARY_DIRECTORY,
      providersDirectory: "bank/providers",
      recipesDirectory: "bank/recipes",
      workoutFormatsDirectory: "bank/workout-formats",
      regimensDirectory: "bank/regimens",
      ledgerDirectory: "ledger",
      assessmentLedgerDirectory: ASSESSMENT_LEDGER_DIRECTORY,
      eventLedgerDirectory: EVENT_LEDGER_DIRECTORY,
      metricSampleLedgerDirectory: METRIC_SAMPLE_LEDGER_DIRECTORY,
      sampleLedgerDirectory: SAMPLE_LEDGER_DIRECTORY,
      inboxCaptureLedgerDirectory: INBOX_CAPTURE_LEDGER_DIRECTORY,
      rawDirectory: RAW_DIRECTORY,
      rawAssessmentsDirectory: RAW_ASSESSMENTS_DIRECTORY,
      rawCapturesDirectory: RAW_CAPTURES_DIRECTORY,
      rawDocumentsDirectory: RAW_DOCUMENTS_DIRECTORY,
      rawInboxDirectory: RAW_INBOX_DIRECTORY,
      rawIntegrationsDirectory: RAW_INTEGRATIONS_DIRECTORY,
      rawMeasurementsDirectory: RAW_MEASUREMENTS_DIRECTORY,
      rawMealsDirectory: RAW_MEALS_DIRECTORY,
      rawSamplesDirectory: RAW_SAMPLES_DIRECTORY,
      rawWorkoutsDirectory: RAW_WORKOUTS_DIRECTORY,
      auditDirectory: AUDIT_DIRECTORY,
      derivedKnowledgeDirectory: DERIVED_KNOWLEDGE_DIRECTORY,
      derivedKnowledgeIndex: DERIVED_KNOWLEDGE_INDEX_FILE,
      derivedKnowledgeLog: DERIVED_KNOWLEDGE_LOG_FILE,
      derivedKnowledgePagesDirectory: DERIVED_KNOWLEDGE_PAGES_DIRECTORY,
      exportsDirectory: "exports",
      exportPacksDirectory: EXPORT_PACKS_DIRECTORY,
    });

    expect(VAULT_SHARDS).toEqual({
      assessments: "ledger/assessments/YYYY/YYYY-MM.jsonl",
      events: "ledger/events/YYYY/YYYY-MM.jsonl",
      metricSamples: "ledger/metric-samples/<metric>/YYYY/YYYY-MM.jsonl",
      samples: "ledger/samples/<stream>/YYYY/YYYY-MM.jsonl",
      audit: "audit/YYYY/YYYY-MM.jsonl",
      inboxCaptures: "ledger/inbox-captures/YYYY/YYYY-MM.jsonl",
    });
  });

  it("keeps descriptive query-owned layout entries out of required scaffold directories", () => {
    expect(REQUIRED_VAULT_DIRECTORIES).not.toContain(HEALTH_LIBRARY_DIRECTORY);
    expect(REQUIRED_VAULT_DIRECTORIES).not.toContain(DERIVED_DIRECTORY);
    expect(REQUIRED_VAULT_DIRECTORIES).not.toContain(DERIVED_KNOWLEDGE_DIRECTORY);
    expect(REQUIRED_VAULT_DIRECTORIES).not.toContain(DERIVED_KNOWLEDGE_PAGES_DIRECTORY);
    expect(REQUIRED_VAULT_DIRECTORIES).not.toContain("exports");
    expect(REQUIRED_VAULT_DIRECTORIES).not.toContain(EXPORT_PACKS_DIRECTORY);
    expect(VAULT_LAYOUT.healthLibraryDirectory).toBe(HEALTH_LIBRARY_DIRECTORY);
    expect(VAULT_LAYOUT.derivedKnowledgeDirectory).toBe(DERIVED_KNOWLEDGE_DIRECTORY);
    expect(VAULT_LAYOUT.derivedKnowledgePagesDirectory).toBe(DERIVED_KNOWLEDGE_PAGES_DIRECTORY);
    expect(VAULT_LAYOUT.exportsDirectory).toBe("exports");
    expect(VAULT_LAYOUT.exportPacksDirectory).toBe(EXPORT_PACKS_DIRECTORY);
  });

  it("keeps the frozen vault-layout doc aligned with the exported registry", async () => {
    const document = await readFile(VAULT_LAYOUT_DOC_URL, "utf8");

    expect(extractCodeBlockLinesAfterHeading(document, "## Baseline Root")).toEqual([
      "vault/",
      VAULT_METADATA_FILE,
      CORE_DOCUMENT_RELATIVE_PATH,
      "journal/YYYY/YYYY-MM-DD.md",
      VAULT_LAYOUT.memoryDocument,
      VAULT_LAYOUT.preferencesDocument,
      `${VAULT_LAYOUT.automationsDirectory}/<slug>.md`,
      `${VAULT_LAYOUT.scheduledLogsDirectory}/<slug>.md`,
      `${VAULT_LAYOUT.experimentsDirectory}/<slug>.md`,
      `${VAULT_LAYOUT.goalsDirectory}/<slug>.md`,
      `${VAULT_LAYOUT.conditionsDirectory}/<slug>.md`,
      `${VAULT_LAYOUT.allergiesDirectory}/<slug>.md`,
      `${VAULT_LAYOUT.regimensDirectory}/<group>/<slug>.md`,
      `${VAULT_LAYOUT.protocolsDirectory}/<slug>.md`,
      `${VAULT_LAYOUT.familyDirectory}/<slug>.md`,
      `${VAULT_LAYOUT.geneticsDirectory}/<slug>.md`,
      `${VAULT_LAYOUT.foodsDirectory}/<slug>.md`,
      `${VAULT_LAYOUT.recipesDirectory}/<slug>.md`,
      `${VAULT_LAYOUT.providersDirectory}/<slug>.md`,
      `${VAULT_LAYOUT.workoutFormatsDirectory}/<slug>.md`,
      `${VAULT_LAYOUT.healthLibraryDirectory}/<slug>.md`,
      `${VAULT_LAYOUT.rawDocumentsDirectory}/YYYY/MM/<documentId>/<filename>`,
      `${VAULT_LAYOUT.rawDocumentsDirectory}/YYYY/MM/<documentId>/manifest.json`,
      `${VAULT_LAYOUT.rawAssessmentsDirectory}/YYYY/MM/<assessmentId>/source.json`,
      `${VAULT_LAYOUT.rawAssessmentsDirectory}/YYYY/MM/<assessmentId>/manifest.json`,
      `${VAULT_LAYOUT.rawCapturesDirectory}/YYYY/MM/<eventId>/<filename>`,
      `${VAULT_LAYOUT.rawCapturesDirectory}/YYYY/MM/<eventId>/manifest.json`,
      `${VAULT_LAYOUT.rawInboxDirectory}/<source>/<account>/YYYY/MM/<captureId>/envelope.json`,
      `${VAULT_LAYOUT.rawInboxDirectory}/<source>/<account>/YYYY/MM/<captureId>/attachments/<filename>`,
      `${VAULT_LAYOUT.rawMeasurementsDirectory}/YYYY/MM/<eventId>/<filename>`,
      `${VAULT_LAYOUT.rawMeasurementsDirectory}/YYYY/MM/<eventId>/manifest.json`,
      `${VAULT_LAYOUT.rawMealsDirectory}/YYYY/MM/<mealId>/<slot>-<filename>`,
      `${VAULT_LAYOUT.rawMealsDirectory}/YYYY/MM/<mealId>/manifest.json`,
      `${VAULT_LAYOUT.rawSamplesDirectory}/<stream>/YYYY/MM/<transformId>/<filename>.csv`,
      `${VAULT_LAYOUT.rawSamplesDirectory}/<stream>/YYYY/MM/<transformId>/manifest.json`,
      `${VAULT_LAYOUT.rawWorkoutsDirectory}/YYYY/MM/<eventId>/<filename>`,
      `${VAULT_LAYOUT.rawWorkoutsDirectory}/YYYY/MM/<eventId>/manifest.json`,
      `${VAULT_LAYOUT.rawIntegrationsDirectory}/<provider>/YYYY/MM/<transformId>/<filename>`,
      `${VAULT_LAYOUT.rawIntegrationsDirectory}/<provider>/YYYY/MM/<transformId>/manifest.json`,
      `${VAULT_LAYOUT.inboxCaptureLedgerDirectory}/YYYY/YYYY-MM.jsonl`,
      `${VAULT_LAYOUT.assessmentLedgerDirectory}/YYYY/YYYY-MM.jsonl`,
      `${VAULT_LAYOUT.eventLedgerDirectory}/YYYY/YYYY-MM.jsonl`,
      `${VAULT_LAYOUT.metricSampleLedgerDirectory}/<metric>/YYYY/YYYY-MM.jsonl`,
      `${VAULT_LAYOUT.sampleLedgerDirectory}/<stream>/YYYY/YYYY-MM.jsonl`,
      `${VAULT_LAYOUT.auditDirectory}/YYYY/YYYY-MM.jsonl`,
      VAULT_LAYOUT.derivedKnowledgeIndex,
      VAULT_LAYOUT.derivedKnowledgeLog,
      `${VAULT_LAYOUT.derivedKnowledgePagesDirectory}/<slug>.md`,
    ]);

    expect(extractSectionCodeSpans(document, "## Path Rules")).toEqual(
      expect.arrayContaining([
        "bank/memory.md",
        "bank/preferences.json",
        "bank/automations/*.md",
        "bank/scheduled-logs/*.md",
        "bank/recipes",
        "bank/providers",
        "bank/library/**/*.md",
        "bank/regimens/**/*.md",
        "bank/protocols/*.md",
        "derived/knowledge/index.md",
        "derived/knowledge/log.md",
        "derived/knowledge/pages/*.md",
      ]),
    );
  });
});
