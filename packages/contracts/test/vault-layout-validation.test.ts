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
  EVENT_LEDGER_DIRECTORY,
  EXPORT_PACKS_DIRECTORY,
  EXPERIMENTS_DIRECTORY,
  INBOX_CAPTURE_LEDGER_DIRECTORY,
  JOURNAL_DIRECTORY,
  RAW_ASSESSMENTS_DIRECTORY,
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
        code: "VAULT_UPGRADE_REQUIRED",
        message:
          `Vault formatVersion 0 must be upgraded to ${CURRENT_VAULT_FORMAT_VERSION} before current-format operations can continue. Run "vault upgrade" first.`,
        details: {
          storedFormatVersion: 0,
          targetFormatVersion: CURRENT_VAULT_FORMAT_VERSION,
        },
      },
    });

    expect(validateCurrentVaultMetadata({ ...VALID_METADATA, formatVersion: CURRENT_VAULT_FORMAT_VERSION + 1 })).toEqual({
      success: false,
      error: {
        code: "VAULT_UPGRADE_UNSUPPORTED",
        message:
          `Vault formatVersion ${CURRENT_VAULT_FORMAT_VERSION + 1} is newer than supported formatVersion ${CURRENT_VAULT_FORMAT_VERSION}.`,
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
      EXPERIMENTS_DIRECTORY,
      JOURNAL_DIRECTORY,
      "bank/goals",
      "bank/conditions",
      "bank/allergies",
      "bank/protocols",
      "bank/family",
      "bank/genetics",
      "bank/foods",
      "bank/recipes",
      "bank/providers",
      "bank/workout-formats",
      "ledger",
      ASSESSMENT_LEDGER_DIRECTORY,
      EVENT_LEDGER_DIRECTORY,
      SAMPLE_LEDGER_DIRECTORY,
      AUDIT_DIRECTORY,
      INBOX_CAPTURE_LEDGER_DIRECTORY,
      RAW_DIRECTORY,
      RAW_ASSESSMENTS_DIRECTORY,
      RAW_DOCUMENTS_DIRECTORY,
      RAW_INBOX_DIRECTORY,
      RAW_INTEGRATIONS_DIRECTORY,
      RAW_MEASUREMENTS_DIRECTORY,
      RAW_MEALS_DIRECTORY,
      RAW_SAMPLES_DIRECTORY,
      RAW_WORKOUTS_DIRECTORY,
      "exports",
      EXPORT_PACKS_DIRECTORY,
    ]);
  });

  it("publishes stable query-source targets, layout aliases, and shard patterns", () => {
    expect(VAULT_QUERY_SOURCE).toEqual({
      optionalFiles: [VAULT_METADATA_FILE, CORE_DOCUMENT_RELATIVE_PATH],
      markdownRoots: [
        EXPERIMENTS_DIRECTORY,
        JOURNAL_DIRECTORY,
        "bank/goals",
        "bank/conditions",
        "bank/allergies",
        "bank/protocols",
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
        SAMPLE_LEDGER_DIRECTORY,
        AUDIT_DIRECTORY,
      ],
    });

    expect(VAULT_LAYOUT).toEqual({
      metadata: VAULT_METADATA_FILE,
      coreDocument: CORE_DOCUMENT_RELATIVE_PATH,
      memoryDocument: "bank/memory.md",
      preferencesDocument: preferencesDocumentRelativePath,
      bankDirectory: BANK_DIRECTORY,
      journalDirectory: JOURNAL_DIRECTORY,
      automationsDirectory: AUTOMATIONS_DIRECTORY,
      allergiesDirectory: "bank/allergies",
      conditionsDirectory: "bank/conditions",
      experimentsDirectory: EXPERIMENTS_DIRECTORY,
      familyDirectory: "bank/family",
      foodsDirectory: "bank/foods",
      geneticsDirectory: "bank/genetics",
      goalsDirectory: "bank/goals",
      providersDirectory: "bank/providers",
      recipesDirectory: "bank/recipes",
      workoutFormatsDirectory: "bank/workout-formats",
      protocolsDirectory: "bank/protocols",
      ledgerDirectory: "ledger",
      assessmentLedgerDirectory: ASSESSMENT_LEDGER_DIRECTORY,
      eventLedgerDirectory: EVENT_LEDGER_DIRECTORY,
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
      exportsDirectory: "exports",
      exportPacksDirectory: EXPORT_PACKS_DIRECTORY,
    });

    expect(VAULT_SHARDS).toEqual({
      assessments: "ledger/assessments/YYYY/YYYY-MM.jsonl",
      events: "ledger/events/YYYY/YYYY-MM.jsonl",
      samples: "ledger/samples/<stream>/YYYY/YYYY-MM.jsonl",
      audit: "audit/YYYY/YYYY-MM.jsonl",
      inboxCaptures: "ledger/inbox-captures/YYYY/YYYY-MM.jsonl",
    });
  });
});
