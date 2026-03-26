import path from "node:path";

import {
  allergyFrontmatterSchema,
  assessmentResponseSchema,
  conditionFrontmatterSchema,
  auditRecordSchema,
  type ContractSchema,
  type VaultMetadata,
  coreFrontmatterSchema,
  eventRecordSchema,
  experimentFrontmatterSchema,
  familyMemberFrontmatterSchema,
  foodFrontmatterSchema,
  geneticVariantFrontmatterSchema,
  goalFrontmatterSchema,
  journalDayFrontmatterSchema,
  profileCurrentFrontmatterSchema,
  profileSnapshotSchema,
  rawImportManifestSchema,
  recipeFrontmatterSchema,
  regimenFrontmatterSchema,
  safeParseContract,
  sampleRecordSchema,
  vaultMetadataSchema,
} from "@healthybob/contracts";

import {
  DEFAULT_TIMEZONE,
  FRONTMATTER_SCHEMA_VERSIONS,
  REQUIRED_DIRECTORIES,
  VAULT_LAYOUT,
} from "./constants.js";
import { emitAuditRecord } from "./audit.js";
import {
  ensureDirectory,
  ensureVaultDirectory,
  pathExists,
  readJsonFile,
  readUtf8File,
  walkVaultFiles,
} from "./fs.js";
import { VaultError } from "./errors.js";
import { parseFrontmatterDocument, stringifyFrontmatterDocument } from "./frontmatter.js";
import { generateVaultId } from "./ids.js";
import { readJsonlRecords } from "./jsonl.js";
import { normalizeVaultRoot, resolveVaultPath } from "./path-safety.js";
import {
  isTerminalWriteOperationStatus,
  listWriteOperationMetadataPaths,
  readStoredWriteOperation,
  runCanonicalWrite,
} from "./operations/write-batch.js";
import { buildCurrentProfileMarkdown, listProfileSnapshots } from "./profile/storage.js";
import { toIsoTimestamp } from "./time.js";
import { buildVaultMetadata, loadVaultMetadata } from "./vault-metadata.js";

import type { DateInput, UnknownRecord, ValidationIssue } from "./types.js";
import { isPlainRecord } from "./types.js";

interface BuildCoreDocumentInput {
  vaultId: string;
  title: string;
  timezone: string;
  updatedAt: string;
}

interface InitializeVaultInput {
  vaultRoot?: string;
  title?: string;
  timezone?: string;
  createdAt?: DateInput;
}

interface LoadVaultInput {
  vaultRoot?: string;
}

interface RepairVaultResult {
  metadataFile: string;
  title: string;
  timezone: string;
  repairedFields: string[];
  createdDirectories: string[];
  updated: boolean;
  auditPath: string | null;
}

interface ValidateFrontmatterFileInput {
  vaultRoot: string;
  relativePath: string;
  schema: ContractSchema;
  code: string;
}

interface ValidateFrontmatterDirectoryInput {
  vaultRoot: string;
  relativeDirectory: string;
  schema: ContractSchema;
  code: string;
}

interface ValidateJsonlFamilyInput {
  vaultRoot: string;
  relativeDirectory: string;
  schema: ContractSchema;
  code: string;
  postValidateRecord?: (
    record: UnknownRecord,
    context: {
      relativePath: string;
      index: number;
    },
  ) => Promise<ValidationIssue[]>;
}

interface LoadedVault {
  vaultRoot: string;
  metadata: VaultMetadata;
  layout: typeof VAULT_LAYOUT;
  compatibilityRepairs: string[];
}

interface InitializedVault extends LoadedVault {
  created: true;
  auditPath: string;
}

interface ValidateVaultResult {
  valid: boolean;
  issues: ValidationIssue[];
  metadata: VaultMetadata | null;
}

function assertContractShape<T>(
  schema: ContractSchema<T>,
  value: unknown,
  code: string,
  message: string,
): asserts value is T {
  const result = safeParseContract(schema, value);

  if (!result.success) {
    throw new VaultError(code, message, { errors: result.errors });
  }
}

function buildCoreDocument({
  vaultId,
  title,
  timezone,
  updatedAt,
}: BuildCoreDocumentInput): string {
  return stringifyFrontmatterDocument({
    attributes: {
      schemaVersion: FRONTMATTER_SCHEMA_VERSIONS.core,
      docType: "core",
      vaultId,
      title,
      timezone,
      updatedAt,
    },
    body: `# ${title}\n\n## Notes\n\n`,
  });
}

function validationIssue(
  code: string,
  message: string,
  path?: string,
  severity = "error",
): ValidationIssue {
  return path ? { code, message, path, severity } : { code, message, severity };
}

export async function initializeVault({
  vaultRoot,
  title = "Healthy Bob Vault",
  timezone = DEFAULT_TIMEZONE,
  createdAt = new Date(),
}: InitializeVaultInput = {}): Promise<InitializedVault> {
  const absoluteRoot = normalizeVaultRoot(vaultRoot);
  const metadataPath = resolveVaultPath(absoluteRoot, VAULT_LAYOUT.metadata);

  if (await pathExists(metadataPath.absolutePath)) {
    throw new VaultError("VAULT_ALREADY_EXISTS", "Vault already exists at the requested root.");
  }

  await ensureDirectory(absoluteRoot);

  for (const relativeDirectory of REQUIRED_DIRECTORIES) {
    await ensureVaultDirectory(absoluteRoot, relativeDirectory);
  }

  const createdTimestamp = toIsoTimestamp(createdAt, "createdAt");
  const metadata = buildVaultMetadata({
    vaultId: generateVaultId(),
    createdAt: createdTimestamp,
    title,
    timezone,
  });
  assertContractShape<VaultMetadata>(
    vaultMetadataSchema,
    metadata,
    "VAULT_INVALID_METADATA",
    "Generated vault metadata failed contract validation.",
  );
  const coreDocument = buildCoreDocument({
    vaultId: metadata.vaultId,
    title,
    timezone,
    updatedAt: createdTimestamp,
  });
  const auditPath = await runCanonicalWrite({
    vaultRoot: absoluteRoot,
    operationType: "vault_init",
    summary: `Initialize vault ${metadata.vaultId}`,
    occurredAt: createdTimestamp,
    mutate: async ({ batch }) => {
      await batch.stageTextWrite(VAULT_LAYOUT.metadata, `${JSON.stringify(metadata, null, 2)}\n`, {
        overwrite: false,
      });
      await batch.stageTextWrite(VAULT_LAYOUT.coreDocument, coreDocument, {
        overwrite: false,
      });
      const audit = await emitAuditRecord({
        vaultRoot: absoluteRoot,
        batch,
        action: "vault_init",
        commandName: "core.initializeVault",
        summary: "Initialized vault metadata and core document.",
        occurredAt: createdTimestamp,
        files: [VAULT_LAYOUT.metadata, VAULT_LAYOUT.coreDocument],
        targetIds: [metadata.vaultId],
      });

      return audit.relativePath;
    },
  });

  const vault = await loadVault({ vaultRoot: absoluteRoot });

  return {
    ...vault,
    created: true,
    auditPath,
  };
}

export async function loadVault({ vaultRoot }: LoadVaultInput = {}): Promise<LoadedVault> {
  const absoluteRoot = normalizeVaultRoot(vaultRoot);
  const { metadata, repairedFields } = await loadVaultMetadata(
    absoluteRoot,
    "VAULT_INVALID_METADATA",
    "Vault metadata failed contract validation.",
  );

  return {
    vaultRoot: absoluteRoot,
    metadata,
    layout: {
      ...VAULT_LAYOUT,
    },
    compatibilityRepairs: repairedFields,
  };
}

export async function repairVault({ vaultRoot }: LoadVaultInput = {}): Promise<RepairVaultResult> {
  const absoluteRoot = normalizeVaultRoot(vaultRoot);
  const { metadata, repairedFields } = await loadVaultMetadata(
    absoluteRoot,
    "VAULT_INVALID_METADATA",
    "Vault metadata failed contract validation.",
  );
  const createdDirectories = await ensureMissingRequiredDirectories(absoluteRoot);

  if (repairedFields.length === 0 && createdDirectories.length === 0) {
    return {
      metadataFile: VAULT_LAYOUT.metadata,
      title: metadata.title,
      timezone: metadata.timezone,
      repairedFields,
      createdDirectories,
      updated: false,
      auditPath: null,
    };
  }

  let auditPath: string | null = null;
  const occurredAt = new Date().toISOString();

  if (repairedFields.length > 0 || createdDirectories.length > 0) {
    auditPath = await runCanonicalWrite({
      vaultRoot: absoluteRoot,
      operationType: "vault_repair",
      summary: `Repair vault ${metadata.vaultId}`,
      occurredAt,
      mutate: async ({ batch }) => {
        if (repairedFields.length > 0) {
          await batch.stageTextWrite(
            VAULT_LAYOUT.metadata,
            `${JSON.stringify(metadata, null, 2)}\n`,
            {
              overwrite: true,
            },
          );
        }

        const audit = await emitAuditRecord({
          vaultRoot: absoluteRoot,
          batch,
          action: "vault_repair",
          commandName: "core.repairVault",
          summary: "Repaired vault metadata and additive scaffold directories.",
          occurredAt,
          files: repairedFields.length > 0 ? [VAULT_LAYOUT.metadata, ...createdDirectories] : createdDirectories,
          targetIds: [metadata.vaultId],
        });

        return audit.relativePath;
      },
    });
  }

  return {
    metadataFile: VAULT_LAYOUT.metadata,
    title: metadata.title,
    timezone: metadata.timezone,
    repairedFields,
    createdDirectories,
    updated: true,
    auditPath,
  };
}

async function ensureMissingRequiredDirectories(vaultRoot: string): Promise<string[]> {
  const createdDirectories: string[] = [];

  for (const relativeDirectory of REQUIRED_DIRECTORIES) {
    const directoryPath = resolveVaultPath(vaultRoot, relativeDirectory);

    if (await pathExists(directoryPath.absolutePath)) {
      continue;
    }

    await ensureVaultDirectory(vaultRoot, relativeDirectory);
    createdDirectories.push(relativeDirectory);
  }

  return createdDirectories;
}

async function validateFrontmatterFile({
  vaultRoot,
  relativePath,
  schema,
  code,
}: ValidateFrontmatterFileInput): Promise<ValidationIssue[]> {
  try {
    const content = await readUtf8File(vaultRoot, relativePath);
    const parsed = parseFrontmatterDocument(content);
    const result = safeParseContract(schema, parsed.attributes);

    if (!result.success) {
      return [validationIssue(code, result.errors.join("; "), relativePath)];
    }
  } catch (error) {
    return [
      validationIssue(
        error instanceof VaultError && error.code === "VAULT_FILE_MISSING" ? error.code : code,
        error instanceof Error ? error.message : String(error),
        relativePath,
      ),
    ];
  }

  return [];
}

async function validateFrontmatterDirectory({
  vaultRoot,
  relativeDirectory,
  schema,
  code,
}: ValidateFrontmatterDirectoryInput): Promise<ValidationIssue[]> {
  const relativePaths = await walkVaultFiles(vaultRoot, relativeDirectory, {
    extension: ".md",
  });
  const issues: ValidationIssue[] = [];

  for (const relativePath of relativePaths) {
    issues.push(
      ...(await validateFrontmatterFile({
        vaultRoot,
        relativePath,
        schema,
        code,
      })),
    );
  }

  return issues;
}

async function validateJsonlFamily({
  vaultRoot,
  relativeDirectory,
  schema,
  code,
  postValidateRecord,
}: ValidateJsonlFamilyInput): Promise<ValidationIssue[]> {
  const jsonlFiles = await walkVaultFiles(vaultRoot, relativeDirectory, {
    extension: ".jsonl",
  });
  const issues: ValidationIssue[] = [];

  for (const relativePath of jsonlFiles) {
    let records: UnknownRecord[];

    try {
      records = await readJsonlRecords({
        vaultRoot,
        relativePath,
      });
    } catch (error) {
      issues.push(
        validationIssue(
          error instanceof VaultError ? error.code : code,
          error instanceof Error ? error.message : String(error),
          relativePath,
        ),
      );
      continue;
    }

    for (const [index, record] of records.entries()) {
      const result = safeParseContract(schema, record);

      if (!result.success) {
        issues.push(validationIssue(code, `record ${index + 1}: ${result.errors.join("; ")}`, relativePath));
        continue;
      }

      if (postValidateRecord) {
        issues.push(
          ...(await postValidateRecord(result.data as UnknownRecord, {
            relativePath,
            index,
          })),
        );
      }
    }
  }

  return issues;
}

function rawManifestPathForArtifact(relativePath: string): string {
  return path.posix.join(path.posix.dirname(relativePath), "manifest.json");
}

async function validateExistingVaultFile(
  vaultRoot: string,
  relativePath: string,
  code: string,
  message: string,
): Promise<ValidationIssue[]> {
  try {
    const resolved = resolveVaultPath(vaultRoot, relativePath);

    if (!(await pathExists(resolved.absolutePath))) {
      return [validationIssue(code, message, relativePath)];
    }
  } catch (error) {
    return [
      validationIssue(
        error instanceof VaultError ? error.code : code,
        error instanceof Error ? error.message : String(error),
        relativePath,
      ),
    ];
  }

  return [];
}

async function validateAssessmentRecordReferences(
  vaultRoot: string,
  record: UnknownRecord & { rawPath: string },
): Promise<ValidationIssue[]> {
  const issues = await validateExistingVaultFile(
    vaultRoot,
    record.rawPath,
    "HB_RAW_REFERENCE_MISSING",
    `Assessment raw payload "${record.rawPath}" is missing.`,
  );

  issues.push(
    ...(await validateExistingVaultFile(
      vaultRoot,
      rawManifestPathForArtifact(record.rawPath),
      "HB_RAW_MANIFEST_INVALID",
      `Raw import manifest is missing for "${record.rawPath}".`,
    )),
  );

  return issues;
}

async function validateEventRecordReferences(
  vaultRoot: string,
  record: UnknownRecord,
): Promise<ValidationIssue[]> {
  const referencedPaths = new Set<string>();

  if (Array.isArray(record.rawRefs)) {
    for (const rawRef of record.rawRefs) {
      if (typeof rawRef === "string") {
        referencedPaths.add(rawRef);
      }
    }
  }

  if (typeof record.documentPath === "string") {
    referencedPaths.add(record.documentPath);
  }

  if (Array.isArray(record.photoPaths)) {
    for (const photoPath of record.photoPaths) {
      if (typeof photoPath === "string") {
        referencedPaths.add(photoPath);
      }
    }
  }

  if (Array.isArray(record.audioPaths)) {
    for (const audioPath of record.audioPaths) {
      if (typeof audioPath === "string") {
        referencedPaths.add(audioPath);
      }
    }
  }

  const issues: ValidationIssue[] = [];
  const manifestPaths = new Set<string>();

  for (const referencedPath of [...referencedPaths].sort()) {
    issues.push(
      ...(await validateExistingVaultFile(
        vaultRoot,
        referencedPath,
        "HB_RAW_REFERENCE_MISSING",
        `Referenced raw artifact "${referencedPath}" is missing.`,
      )),
    );

    if (referencedPath.startsWith(`${VAULT_LAYOUT.rawDirectory}/`)) {
      manifestPaths.add(rawManifestPathForArtifact(referencedPath));
    }
  }

  for (const manifestPath of [...manifestPaths].sort()) {
    issues.push(
      ...(await validateExistingVaultFile(
        vaultRoot,
        manifestPath,
        "HB_RAW_MANIFEST_INVALID",
        `Raw import manifest is missing for "${manifestPath}".`,
      )),
    );
  }

  return issues;
}

async function validateRawManifestFile(
  vaultRoot: string,
  relativePath: string,
): Promise<ValidationIssue[]> {
  let manifest: unknown;

  try {
    manifest = await readJsonFile(vaultRoot, relativePath);
  } catch (error) {
    return [
      validationIssue(
        error instanceof VaultError ? error.code : "HB_RAW_MANIFEST_INVALID",
        error instanceof Error ? error.message : String(error),
        relativePath,
      ),
    ];
  }

  if (!isPlainRecord(manifest)) {
    return [validationIssue("HB_RAW_MANIFEST_INVALID", "Raw import manifest must be a JSON object.", relativePath)];
  }

  const issues: ValidationIssue[] = [];
  const expectedRawDirectory = path.posix.dirname(relativePath);
  const contractResult = safeParseContract(rawImportManifestSchema, manifest);

  if (!contractResult.success) {
    issues.push(
      ...contractResult.errors.map((error: string) =>
        validationIssue(
          "HB_RAW_MANIFEST_INVALID",
          `Raw import manifest ${error}.`,
          relativePath,
        ),
      ),
    );
  }

  if (typeof manifest.schemaVersion !== "string" || manifest.schemaVersion.trim().length === 0) {
    issues.push(validationIssue("HB_RAW_MANIFEST_INVALID", "Raw import manifest is missing schemaVersion.", relativePath));
  }

  if (manifest.rawDirectory !== expectedRawDirectory) {
    issues.push(
      validationIssue(
        "HB_RAW_MANIFEST_INVALID",
        `Raw import manifest rawDirectory must equal "${expectedRawDirectory}".`,
        relativePath,
      ),
    );
  }

  if (!Array.isArray(manifest.artifacts)) {
    issues.push(validationIssue("HB_RAW_MANIFEST_INVALID", "Raw import manifest must provide an artifacts array.", relativePath));
    return issues;
  }

  for (const [index, artifact] of manifest.artifacts.entries()) {
    if (!isPlainRecord(artifact) || typeof artifact.relativePath !== "string") {
      issues.push(
        validationIssue(
          "HB_RAW_MANIFEST_INVALID",
          `artifact ${index + 1} is missing a valid relativePath.`,
          relativePath,
        ),
      );
      continue;
    }

    if (path.posix.dirname(artifact.relativePath) !== expectedRawDirectory) {
      issues.push(
        validationIssue(
          "HB_RAW_MANIFEST_INVALID",
          `artifact ${index + 1} must remain inside "${expectedRawDirectory}".`,
          relativePath,
        ),
      );
    }

    issues.push(
      ...(await validateExistingVaultFile(
        vaultRoot,
        artifact.relativePath,
        "HB_RAW_REFERENCE_MISSING",
        `Manifest artifact "${artifact.relativePath}" is missing.`,
      )),
    );
  }

  return issues;
}

async function validateRawImportManifests(vaultRoot: string): Promise<ValidationIssue[]> {
  const rawFiles = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.rawDirectory);
  const artifactDirectories = new Set<string>();
  const manifestFiles: string[] = [];

  for (const relativePath of rawFiles) {
    if (path.posix.basename(relativePath) === "manifest.json") {
      manifestFiles.push(relativePath);
      continue;
    }

    artifactDirectories.add(path.posix.dirname(relativePath));
  }

  const issues: ValidationIssue[] = [];

  for (const directory of [...artifactDirectories].sort()) {
    const manifestPath = path.posix.join(directory, "manifest.json");

    if (!(await pathExists(resolveVaultPath(vaultRoot, manifestPath).absolutePath))) {
      issues.push(
        validationIssue(
          "HB_RAW_MANIFEST_INVALID",
          `Raw import directory "${directory}" is missing manifest.json.`,
          manifestPath,
        ),
      );
    }
  }

  for (const manifestPath of manifestFiles.sort()) {
    issues.push(...(await validateRawManifestFile(vaultRoot, manifestPath)));
  }

  return issues;
}

async function validateCurrentProfileConsistency(vaultRoot: string): Promise<ValidationIssue[]> {
  let snapshots;

  try {
    snapshots = await listProfileSnapshots({ vaultRoot });
  } catch {
    return [];
  }

  const latestSnapshot = snapshots.at(-1) ?? null;
  const currentProfilePath = resolveVaultPath(vaultRoot, VAULT_LAYOUT.profileCurrentDocument);
  const exists = await pathExists(currentProfilePath.absolutePath);

  if (!latestSnapshot) {
    return exists
      ? [
          validationIssue(
            "HB_PROFILE_CURRENT_STALE",
            "Current profile exists even though no profile snapshots are present.",
            VAULT_LAYOUT.profileCurrentDocument,
          ),
        ]
      : [];
  }

  if (!exists) {
    return [
      validationIssue(
        "HB_PROFILE_CURRENT_STALE",
        "Current profile is missing for the latest profile snapshot.",
        VAULT_LAYOUT.profileCurrentDocument,
      ),
    ];
  }

  try {
    const currentMarkdown = await readUtf8File(vaultRoot, VAULT_LAYOUT.profileCurrentDocument);
    const expectedMarkdown = buildCurrentProfileMarkdown(latestSnapshot);

    if (currentMarkdown !== expectedMarkdown) {
      return [
        validationIssue(
          "HB_PROFILE_CURRENT_STALE",
          "Current profile markdown does not match the latest profile snapshot.",
          VAULT_LAYOUT.profileCurrentDocument,
        ),
      ];
    }
  } catch (error) {
    return [
      validationIssue(
        error instanceof VaultError ? error.code : "HB_PROFILE_CURRENT_STALE",
        error instanceof Error ? error.message : String(error),
        VAULT_LAYOUT.profileCurrentDocument,
      ),
    ];
  }

  return [];
}

async function validateWriteOperations(vaultRoot: string): Promise<ValidationIssue[]> {
  const operationPaths = await listWriteOperationMetadataPaths(vaultRoot);
  const issues: ValidationIssue[] = [];

  for (const relativePath of operationPaths.sort()) {
    try {
      const operation = await readStoredWriteOperation(vaultRoot, relativePath);

      if (isTerminalWriteOperationStatus(operation.status)) {
        continue;
      }

      const errorSuffix = operation.error?.message ? ` Last error: ${operation.error.message}` : "";
      issues.push(
        validationIssue(
          "HB_OPERATION_UNRESOLVED",
          `Write operation "${operation.operationId}" is ${operation.status}.${errorSuffix}`,
          relativePath,
        ),
      );
    } catch (error) {
      issues.push(
        validationIssue(
          error instanceof VaultError ? error.code : "HB_OPERATION_INVALID",
          error instanceof Error ? error.message : String(error),
          relativePath,
        ),
      );
    }
  }

  return issues;
}

export async function validateVault({ vaultRoot }: LoadVaultInput = {}): Promise<ValidateVaultResult> {
  const absoluteRoot = normalizeVaultRoot(vaultRoot);
  const issues: ValidationIssue[] = [];
  let metadata: VaultMetadata | null = null;

  try {
    const loadedVault = await loadVault({ vaultRoot: absoluteRoot });
    metadata = loadedVault.metadata;
    issues.push(
      ...loadedVault.compatibilityRepairs.map((fieldPath) =>
        validationIssue(
          "VAULT_METADATA_REPAIR_RECOMMENDED",
          `Vault metadata is missing additive field "${fieldPath}". Run \`vault repair\` to persist the current scaffold.`,
          VAULT_LAYOUT.metadata,
          "warning",
        ),
      ),
    );
  } catch (error) {
    issues.push(
      validationIssue(
        error instanceof VaultError ? error.code : "VAULT_LOAD_FAILED",
        error instanceof Error ? error.message : String(error),
        VAULT_LAYOUT.metadata,
      ),
    );

    return {
      valid: false,
      issues,
      metadata,
    };
  }

  for (const relativeDirectory of REQUIRED_DIRECTORIES) {
    const directoryPath = resolveVaultPath(absoluteRoot, relativeDirectory);

    if (!(await pathExists(directoryPath.absolutePath))) {
      issues.push(
        validationIssue(
          "VAULT_MISSING_DIRECTORY",
          `Missing required directory "${relativeDirectory}".`,
          relativeDirectory,
        ),
      );
    }
  }

  issues.push(
    ...(await validateFrontmatterFile({
      vaultRoot: absoluteRoot,
      relativePath: VAULT_LAYOUT.coreDocument,
      schema: coreFrontmatterSchema,
      code: "HB_FRONTMATTER_INVALID",
    })),
  );

  const experimentFiles = await walkVaultFiles(absoluteRoot, VAULT_LAYOUT.experimentsDirectory, {
    extension: ".md",
  });
  for (const relativePath of experimentFiles) {
    issues.push(
      ...(await validateFrontmatterFile({
        vaultRoot: absoluteRoot,
        relativePath,
        schema: experimentFrontmatterSchema,
        code: "HB_FRONTMATTER_INVALID",
      })),
    );
  }

  const journalFiles = await walkVaultFiles(absoluteRoot, VAULT_LAYOUT.journalDirectory, {
    extension: ".md",
  });
  for (const relativePath of journalFiles) {
    issues.push(
      ...(await validateFrontmatterFile({
        vaultRoot: absoluteRoot,
        relativePath,
        schema: journalDayFrontmatterSchema,
        code: "HB_FRONTMATTER_INVALID",
      })),
    );
  }

  issues.push(
    ...(await validateFrontmatterDirectory({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.goalsDirectory,
      schema: goalFrontmatterSchema,
      code: "HB_FRONTMATTER_INVALID",
    })),
  );
  issues.push(
    ...(await validateFrontmatterDirectory({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.conditionsDirectory,
      schema: conditionFrontmatterSchema,
      code: "HB_FRONTMATTER_INVALID",
    })),
  );
  issues.push(
    ...(await validateFrontmatterDirectory({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.allergiesDirectory,
      schema: allergyFrontmatterSchema,
      code: "HB_FRONTMATTER_INVALID",
    })),
  );
  issues.push(
    ...(await validateFrontmatterDirectory({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.regimensDirectory,
      schema: regimenFrontmatterSchema,
      code: "HB_FRONTMATTER_INVALID",
    })),
  );
  issues.push(
    ...(await validateFrontmatterDirectory({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.foodsDirectory,
      schema: foodFrontmatterSchema,
      code: "HB_FRONTMATTER_INVALID",
    })),
  );
  issues.push(
    ...(await validateFrontmatterDirectory({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.recipesDirectory,
      schema: recipeFrontmatterSchema,
      code: "HB_FRONTMATTER_INVALID",
    })),
  );
  issues.push(
    ...(await validateFrontmatterDirectory({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.familyDirectory,
      schema: familyMemberFrontmatterSchema,
      code: "HB_FRONTMATTER_INVALID",
    })),
  );
  issues.push(
    ...(await validateFrontmatterDirectory({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.geneticsDirectory,
      schema: geneticVariantFrontmatterSchema,
      code: "HB_FRONTMATTER_INVALID",
    })),
  );

  const currentProfilePath = resolveVaultPath(absoluteRoot, VAULT_LAYOUT.profileCurrentDocument);
  if (await pathExists(currentProfilePath.absolutePath)) {
    issues.push(
      ...(await validateFrontmatterFile({
        vaultRoot: absoluteRoot,
        relativePath: VAULT_LAYOUT.profileCurrentDocument,
        schema: profileCurrentFrontmatterSchema,
        code: "HB_FRONTMATTER_INVALID",
      })),
    );
  }

  issues.push(
    ...(await validateJsonlFamily({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.assessmentLedgerDirectory,
      schema: assessmentResponseSchema,
      code: "HB_CONTRACT_INVALID",
      postValidateRecord: async (record) =>
        validateAssessmentRecordReferences(
          absoluteRoot,
          record as UnknownRecord & { rawPath: string },
        ),
    })),
  );
  issues.push(
    ...(await validateJsonlFamily({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.eventLedgerDirectory,
      schema: eventRecordSchema,
      code: "HB_EVENT_INVALID",
      postValidateRecord: async (record) => validateEventRecordReferences(absoluteRoot, record),
    })),
  );
  issues.push(
    ...(await validateJsonlFamily({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.profileSnapshotsDirectory,
      schema: profileSnapshotSchema,
      code: "HB_CONTRACT_INVALID",
    })),
  );
  issues.push(
    ...(await validateJsonlFamily({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.sampleLedgerDirectory,
      schema: sampleRecordSchema,
      code: "HB_SAMPLE_INVALID",
    })),
  );
  issues.push(
    ...(await validateJsonlFamily({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.auditDirectory,
      schema: auditRecordSchema,
      code: "HB_AUDIT_INVALID",
    })),
  );
  issues.push(...(await validateRawImportManifests(absoluteRoot)));
  issues.push(...(await validateCurrentProfileConsistency(absoluteRoot)));
  issues.push(...(await validateWriteOperations(absoluteRoot)));

  return {
    valid: issues.every((issue) => issue.severity !== "error"),
    issues,
    metadata,
  };
}
