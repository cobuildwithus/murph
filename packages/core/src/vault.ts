import path from "node:path";

import {
  collectEventRawReferencePaths,
  rawImportManifestSchema,
  safeParseContract,
  type ContractSchema,
  inboxAttachmentRetentionRecordSchema,
  inboxCaptureRecordSchema,
  type InboxAttachmentRetentionRecord,
  type InboxCaptureRecord,
  type RawImportManifest,
  type VaultFamilyId,
  type VaultFrontmatterFamilyDescriptor,
  type VaultJsonValidationFamilyDescriptor,
  type VaultJsonlValidationFamilyDescriptor,
  type VaultMetadata,
  VAULT_FRONTMATTER_FAMILIES,
  VAULT_JSON_VALIDATION_FAMILIES,
  VAULT_JSONL_VALIDATION_FAMILIES,
  vaultMetadataSchema,
} from "@murphai/contracts";

import {
  DEFAULT_TIMEZONE,
  REQUIRED_DIRECTORIES,
  VAULT_LAYOUT,
} from "./constants.ts";
import { emitAuditRecord } from "./audit.ts";
import {
  ensureDirectory,
  ensureVaultDirectory,
  pathExists,
  readJsonFile,
  readUtf8File,
  walkVaultFiles,
} from "./fs.ts";
import { VaultError } from "./errors.ts";
import { parseFrontmatterDocument } from "./frontmatter.ts";
import { generateVaultId } from "./ids.ts";
import { readJsonlRecords } from "./jsonl.ts";
import { stageMarkdownDocumentWrite } from "./markdown-documents.ts";
import { isRawManifestFileName } from "./operations/raw-manifests.ts";
import { normalizeRelativeVaultPath, normalizeVaultRoot, resolveVaultPath } from "./path-safety.ts";
import { safeStatAndHashVaultFile } from "./raw-artifact-integrity.ts";
import { rawDirectoryMatchesOwner } from "./raw.ts";
import {
  isTerminalWriteOperationStatus,
  listWriteOperationMetadataPaths,
  readStoredWriteOperation,
  runCanonicalWrite,
} from "./operations/write-batch.ts";
import { toIsoTimestamp } from "./time.ts";
import { buildVaultCoreDocument } from "./vault-core-document.ts";
import {
  buildVaultMetadata,
  loadVaultMetadata,
} from "./vault-metadata.ts";

import type { DateInput, UnknownRecord, ValidationIssue } from "./types.ts";
import { isPlainRecord } from "./types.ts";

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
  createdDirectories: string[];
  updated: boolean;
  auditPath: string | null;
}

interface ValidateFrontmatterFileInput {
  vaultRoot: string;
  relativePath: string;
  schema: ContractSchema;
  code: string;
  optional?: boolean;
}

interface ValidateFrontmatterDirectoryInput {
  vaultRoot: string;
  relativeDirectory: string;
  schema: ContractSchema;
  code: string;
}

interface ValidateJsonFileInput {
  vaultRoot: string;
  relativePath: string;
  schema: ContractSchema;
  code: string;
  optional?: boolean;
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

interface AssertValidVaultInput {
  vaultRoot?: string;
  errorCode?: string;
  message?: string;
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
  title = "Murph Vault",
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
  const coreDocument = buildVaultCoreDocument({
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
      await stageMarkdownDocumentWrite(
        batch,
        {
          relativePath: VAULT_LAYOUT.coreDocument,
          created: true,
        },
        coreDocument,
        {
          overwrite: false,
        },
      );
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
  const { metadata } = await loadVaultMetadata(
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
  };
}

export async function repairVault({ vaultRoot }: LoadVaultInput = {}): Promise<RepairVaultResult> {
  const absoluteRoot = normalizeVaultRoot(vaultRoot);
  const { metadata } = await loadVaultMetadata(
    absoluteRoot,
    "VAULT_INVALID_METADATA",
    "Vault metadata failed contract validation.",
  );
  const createdDirectories = await ensureMissingRequiredDirectories(absoluteRoot);
  if (createdDirectories.length === 0) {
    return {
      metadataFile: VAULT_LAYOUT.metadata,
      title: metadata.title,
      timezone: metadata.timezone,
      createdDirectories,
      updated: false,
      auditPath: null,
    };
  }

  let auditPath: string | null = null;
  const occurredAt = new Date().toISOString();

  auditPath = await runCanonicalWrite({
    vaultRoot: absoluteRoot,
    operationType: "vault_repair",
    summary: `Repair vault ${metadata.vaultId}`,
    occurredAt,
    mutate: async ({ batch }) => {
      const repairSummaries: string[] = [];
      const repairFiles = [...createdDirectories];
      const repairTargetIds = [metadata.vaultId];

      if (createdDirectories.length > 0) {
        repairSummaries.push("Created missing required scaffold directories.");
      }

      const audit = await emitAuditRecord({
        vaultRoot: absoluteRoot,
        batch,
        action: "vault_repair",
        commandName: "core.repairVault",
        summary: repairSummaries.join(" "),
        occurredAt,
        files: repairFiles,
        targetIds: repairTargetIds,
      });

      return audit.relativePath;
    },
  });

  return {
    metadataFile: VAULT_LAYOUT.metadata,
    title: metadata.title,
    timezone: metadata.timezone,
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
  optional = false,
}: ValidateFrontmatterFileInput): Promise<ValidationIssue[]> {
  try {
    const content = await readUtf8File(vaultRoot, relativePath);
    const parsed = parseFrontmatterDocument(content);
    const result = safeParseContract(schema, parsed.attributes);

    if (!result.success) {
      return [validationIssue(code, result.errors.join("; "), relativePath)];
    }
  } catch (error) {
    if (optional && error instanceof VaultError && error.code === "VAULT_FILE_MISSING") {
      return [];
    }

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

async function validateJsonFile({
  vaultRoot,
  relativePath,
  schema,
  code,
  optional = false,
}: ValidateJsonFileInput): Promise<ValidationIssue[]> {
  try {
    const value = await readJsonFile(vaultRoot, relativePath);
    const result = safeParseContract(schema, value);

    if (!result.success) {
      return [validationIssue(code, result.errors.join("; "), relativePath)];
    }
  } catch (error) {
    if (optional && error instanceof VaultError && error.code === "VAULT_FILE_MISSING") {
      return [];
    }

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

async function validateFrontmatterFamily(
  vaultRoot: string,
  family: VaultFrontmatterFamilyDescriptor,
): Promise<ValidationIssue[]> {
  if (family.storageKind === "singleton-file") {
    return validateFrontmatterFile({
      vaultRoot,
      relativePath: family.relativePath,
      schema: family.validation.schema,
      code: family.validation.issueCode,
      optional: family.validation.optional ?? false,
    });
  }

  return validateFrontmatterDirectory({
    vaultRoot,
    relativeDirectory: family.directory,
    schema: family.validation.schema,
    code: family.validation.issueCode,
  });
}

async function validateJsonValidationFamily(
  vaultRoot: string,
  family: VaultJsonValidationFamilyDescriptor,
): Promise<ValidationIssue[]> {
  return validateJsonFile({
    vaultRoot,
    relativePath: family.relativePath,
    schema: family.validation.schema,
    code: family.validation.issueCode,
    optional: family.validation.optional ?? false,
  });
}

async function validateJsonlValidationFamily(
  vaultRoot: string,
  family: VaultJsonlValidationFamilyDescriptor,
): Promise<ValidationIssue[]> {
  const postValidateRecord = resolveJsonlFamilyPostValidator(vaultRoot, family.id);
  return validateJsonlFamily({
    vaultRoot,
    relativeDirectory: family.directory,
    schema: family.validation.schema,
    code: family.validation.issueCode,
    postValidateRecord,
  });
}

export async function validateJsonlRecordAgainstVault(input: {
  familyId: VaultFamilyId;
  index: number;
  record: UnknownRecord;
  relativePath: string;
  vaultRoot: string;
}): Promise<ValidationIssue[]> {
  const postValidateRecord = resolveJsonlFamilyPostValidator(input.vaultRoot, input.familyId);
  if (!postValidateRecord) {
    return [];
  }

  return postValidateRecord(input.record, {
    relativePath: input.relativePath,
    index: input.index,
  });
}

function resolveJsonlFamilyPostValidator(
  vaultRoot: string,
  familyId: VaultFamilyId,
): ValidateJsonlFamilyInput["postValidateRecord"] {
  switch (familyId) {
    case "assessments":
      return async (record) =>
        validateAssessmentRecordReferences(
          vaultRoot,
          record as UnknownRecord & { rawPath: string },
        );
    case "events":
      return async (record) => validateEventRecordReferences(vaultRoot, record);
    case "inboxCaptures":
      {
        let retentionIndexPromise: Promise<ReadonlySet<string>> | null = null;
        const readRetentionIndex = () => {
          retentionIndexPromise ??= readInboxAttachmentRetentionIndex(vaultRoot);
          return retentionIndexPromise;
        };
        return async (record) => validateInboxCaptureRecordReferences(
          vaultRoot,
          record,
          readRetentionIndex,
        );
      }
    default:
      return undefined;
  }
}

function rawManifestDirectoryForArtifact(relativePath: string): string {
  return path.posix.dirname(relativePath);
}

function isEnvelopeBasedInboxRawPath(relativePath: string): boolean {
  return relativePath.startsWith(`${VAULT_LAYOUT.rawInboxDirectory}/`);
}

function inboxCaptureRootForRawPath(relativePath: string): string | null {
  if (!isEnvelopeBasedInboxRawPath(relativePath)) {
    return null;
  }

  if (path.posix.basename(relativePath) === "envelope.json") {
    return path.posix.dirname(relativePath);
  }

  const attachmentsMarker = "/attachments/";
  const attachmentIndex = relativePath.indexOf(attachmentsMarker);

  if (attachmentIndex !== -1) {
    return relativePath.slice(0, attachmentIndex);
  }

  return null;
}

function inboxAttachmentManifestPathForCaptureDirectory(captureDirectory: string): string {
  return path.posix.join(captureDirectory, "attachments", "manifest.json");
}

async function listRawManifestPathsForDirectory(
  vaultRoot: string,
  rawDirectory: string,
): Promise<string[]> {
  const rawFiles = await walkVaultFiles(vaultRoot, rawDirectory);

  return rawFiles.filter((relativePath) =>
    path.posix.dirname(relativePath) === rawDirectory
    && isRawManifestFileName(path.posix.basename(relativePath)),
  );
}

async function validateRawManifestDirectory(
  vaultRoot: string,
  rawDirectory: string,
  code: string,
  message: string,
): Promise<ValidationIssue[]> {
  const manifestPaths = await listRawManifestPathsForDirectory(vaultRoot, rawDirectory);

  if (manifestPaths.length > 0) {
    return [];
  }

  return [validationIssue(code, message, rawDirectory)];
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

function buildInboxAttachmentRetentionIndexKey(input: {
  attachmentId: string;
  captureId: string;
  storedPath: string;
}): string | null {
  let normalizedRelativePath: string;
  try {
    normalizedRelativePath = normalizeRelativeVaultPath(input.storedPath);
  } catch {
    return null;
  }

  if (!normalizedRelativePath.startsWith(`${VAULT_LAYOUT.rawInboxDirectory}/`)) {
    return null;
  }

  return [
    input.captureId,
    input.attachmentId,
    normalizedRelativePath,
  ].join("\u0000");
}

async function readInboxAttachmentRetentionIndex(
  vaultRoot: string,
): Promise<ReadonlySet<string>> {
  const index = new Set<string>();

  const retentionLedgerPaths = await walkVaultFiles(
    vaultRoot,
    VAULT_LAYOUT.inboxAttachmentRetentionLedgerDirectory,
    { extension: ".jsonl" },
  );
  for (const retentionLedgerPath of retentionLedgerPaths) {
    let records: UnknownRecord[];
    try {
      records = await readJsonlRecords({ vaultRoot, relativePath: retentionLedgerPath });
    } catch {
      continue;
    }

    for (const record of records) {
      const result = safeParseContract<InboxAttachmentRetentionRecord>(
        inboxAttachmentRetentionRecordSchema,
        record,
      );
      if (
        result.success &&
        result.data.reason === "inbox_media_retention"
      ) {
        const key = buildInboxAttachmentRetentionIndexKey({
          attachmentId: result.data.attachmentId,
          captureId: result.data.captureId,
          storedPath: result.data.storedPath,
        });
        if (key) {
          index.add(key);
        }
      }
    }
  }

  return index;
}

async function validateInboxCaptureRecordReferences(
  vaultRoot: string,
  record: UnknownRecord,
  readRetentionIndex: () => Promise<ReadonlySet<string>>,
): Promise<ValidationIssue[]> {
  const result = safeParseContract<InboxCaptureRecord>(inboxCaptureRecordSchema, record);
  if (!result.success) {
    return [];
  }

  const capture = result.data;
  const issues: ValidationIssue[] = [];
  for (const attachment of capture.attachments) {
    if (!attachment.storedPath) {
      continue;
    }

    const referenceIssues = await validateExistingVaultFile(
      vaultRoot,
      attachment.storedPath,
      "RAW_REFERENCE_MISSING",
      `Inbox capture attachment "${attachment.storedPath}" is missing.`,
    );
    if (referenceIssues.length === 0) {
      continue;
    }
    const retentionKey = buildInboxAttachmentRetentionIndexKey({
      attachmentId: attachment.attachmentId,
      captureId: capture.captureId,
      storedPath: attachment.storedPath,
    });
    if (retentionKey && (await readRetentionIndex()).has(retentionKey)) {
      continue;
    }

    issues.push(...referenceIssues);
  }

  return issues;
}

async function validateAssessmentRecordReferences(
  vaultRoot: string,
  record: UnknownRecord & { rawPath: string },
): Promise<ValidationIssue[]> {
  const issues = await validateExistingVaultFile(
    vaultRoot,
    record.rawPath,
    "RAW_REFERENCE_MISSING",
    `Assessment raw payload "${record.rawPath}" is missing.`,
  );

  issues.push(
    ...(await validateRawManifestDirectory(
      vaultRoot,
      rawManifestDirectoryForArtifact(record.rawPath),
      "RAW_MANIFEST_INVALID",
      `Raw import directory "${rawManifestDirectoryForArtifact(record.rawPath)}" is missing a raw import manifest.`,
    )),
  );

  return issues;
}

async function validateEventRecordReferences(
  vaultRoot: string,
  record: UnknownRecord,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const manifestDirectories = new Set<string>();

  for (const referencedPath of collectEventRawReferencePaths(record)) {
    issues.push(
      ...(await validateExistingVaultFile(
        vaultRoot,
        referencedPath,
        "RAW_REFERENCE_MISSING",
        `Referenced raw artifact "${referencedPath}" is missing.`,
      )),
    );

    if (
      referencedPath.startsWith(`${VAULT_LAYOUT.rawDirectory}/`) &&
      !isEnvelopeBasedInboxRawPath(referencedPath)
    ) {
      manifestDirectories.add(rawManifestDirectoryForArtifact(referencedPath));
    }
  }

  for (const rawDirectory of [...manifestDirectories].sort()) {
    issues.push(
      ...(await validateRawManifestDirectory(
        vaultRoot,
        rawDirectory,
        "RAW_MANIFEST_INVALID",
        `Raw import directory "${rawDirectory}" is missing a raw import manifest.`,
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
        error instanceof VaultError ? error.code : "RAW_MANIFEST_INVALID",
        error instanceof Error ? error.message : String(error),
        relativePath,
      ),
    ];
  }

  if (!isPlainRecord(manifest)) {
    return [validationIssue("RAW_MANIFEST_INVALID", "Raw import manifest must be a JSON object.", relativePath)];
  }

  const issues: ValidationIssue[] = [];
  const expectedRawDirectory = path.posix.dirname(relativePath);
  const isInboxAttachmentRecoveryManifest =
    isEnvelopeBasedInboxRawPath(relativePath)
    && expectedRawDirectory.endsWith("/attachments");
  const contractResult = safeParseContract<RawImportManifest>(rawImportManifestSchema, manifest);

  if (!contractResult.success && !isInboxAttachmentRecoveryManifest) {
    issues.push(
      ...contractResult.errors.map((error: string) =>
        validationIssue(
          "RAW_MANIFEST_INVALID",
          `Raw import manifest ${error}.`,
          relativePath,
        ),
      ),
    );
  }

  if (typeof manifest.schemaVersion !== "string" || manifest.schemaVersion.trim().length === 0) {
    issues.push(validationIssue("RAW_MANIFEST_INVALID", "Raw import manifest is missing schemaVersion.", relativePath));
  }

  if (manifest.rawDirectory !== expectedRawDirectory) {
    issues.push(
      validationIssue(
        "RAW_MANIFEST_INVALID",
        `Raw import manifest rawDirectory must equal "${expectedRawDirectory}".`,
        relativePath,
      ),
    );
  }

  if (
    contractResult.success
    && !isInboxAttachmentRecoveryManifest
    && !rawDirectoryMatchesOwner(contractResult.data.rawDirectory, contractResult.data.owner)
  ) {
    issues.push(
      validationIssue(
        "RAW_MANIFEST_INVALID",
        `Raw import manifest rawDirectory "${contractResult.data.rawDirectory}" does not match owner ${contractResult.data.owner.kind}:${contractResult.data.owner.id}.`,
        relativePath,
      ),
    );
  }

  if (!Array.isArray(manifest.artifacts)) {
    issues.push(validationIssue("RAW_MANIFEST_INVALID", "Raw import manifest must provide an artifacts array.", relativePath));
    return issues;
  }

  for (const [index, artifact] of manifest.artifacts.entries()) {
    if (!isPlainRecord(artifact) || typeof artifact.relativePath !== "string") {
      issues.push(
        validationIssue(
          "RAW_MANIFEST_INVALID",
          `artifact ${index + 1} is missing a valid relativePath.`,
          relativePath,
        ),
      );
      continue;
    }

    const artifactInsideExpectedRawDirectory =
      path.posix.dirname(artifact.relativePath) === expectedRawDirectory;
    if (!artifactInsideExpectedRawDirectory) {
      issues.push(
        validationIssue(
          "RAW_MANIFEST_INVALID",
          `artifact ${index + 1} must remain inside "${expectedRawDirectory}".`,
          relativePath,
        ),
      );
    }

    const artifactReferenceIssues = await validateExistingVaultFile(
      vaultRoot,
      artifact.relativePath,
      "RAW_REFERENCE_MISSING",
      `Manifest artifact "${artifact.relativePath}" is missing.`,
    );
    issues.push(...artifactReferenceIssues);

    if (
      artifactInsideExpectedRawDirectory
      && artifactReferenceIssues.length === 0
      && typeof artifact.byteSize === "number"
      && Number.isFinite(artifact.byteSize)
      && typeof artifact.sha256 === "string"
      && artifact.sha256.length > 0
    ) {
      const actual = await safeStatAndHashVaultFile(vaultRoot, artifact.relativePath);
      if (actual.kind === "invalid") {
        issues.push(
          validationIssue(
            actual.code,
            actual.message,
            artifact.relativePath,
          ),
        );
      } else if (
        actual.kind === "ok"
        && (
          actual.integrity.byteSize !== artifact.byteSize
          || actual.integrity.sha256 !== artifact.sha256
        )
      ) {
        issues.push(
          validationIssue(
            "RAW_MANIFEST_INVALID",
            `artifact ${index + 1} bytes or sha256 do not match "${artifact.relativePath}".`,
            relativePath,
          ),
        );
      }
    }
  }

  return issues;
}

async function validateRawImportManifests(vaultRoot: string): Promise<ValidationIssue[]> {
  const rawFiles = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.rawDirectory);
  const artifactDirectories = new Set<string>();
  const inboxCaptureDirectories = new Set<string>();
  const inboxAttachmentManifestFiles = new Set<string>();
  const manifestFiles: string[] = [];
  const manifestDirectories = new Set<string>();

  for (const relativePath of rawFiles) {
    const inboxCaptureDirectory = inboxCaptureRootForRawPath(relativePath);

    if (inboxCaptureDirectory !== null) {
      inboxCaptureDirectories.add(inboxCaptureDirectory);
    }

    if (isRawManifestFileName(path.posix.basename(relativePath))) {
      if (isEnvelopeBasedInboxRawPath(relativePath)) {
        if (relativePath === inboxAttachmentManifestPathForCaptureDirectory(path.posix.dirname(path.posix.dirname(relativePath)))) {
          inboxAttachmentManifestFiles.add(relativePath);
        }

        continue;
      }

      manifestFiles.push(relativePath);
      manifestDirectories.add(path.posix.dirname(relativePath));
      continue;
    }

    const directory = path.posix.dirname(relativePath);

    if (isEnvelopeBasedInboxRawPath(directory)) {
      continue;
    }

    artifactDirectories.add(directory);
  }

  const issues: ValidationIssue[] = [];

  for (const captureDirectory of [...inboxCaptureDirectories].sort()) {
    const envelopePath = path.posix.join(captureDirectory, "envelope.json");
    const attachmentManifestPath = inboxAttachmentManifestPathForCaptureDirectory(captureDirectory);

    const hasEnvelope = await pathExists(resolveVaultPath(vaultRoot, envelopePath).absolutePath);
    const hasAttachmentManifest = await pathExists(
      resolveVaultPath(vaultRoot, attachmentManifestPath).absolutePath,
    );

    if (!hasEnvelope && !hasAttachmentManifest) {
      issues.push(
        validationIssue(
          "RAW_REFERENCE_MISSING",
          `Inbox capture directory "${captureDirectory}" is missing envelope.json and has no attachment recovery manifest.`,
          envelopePath,
        ),
      );
    }
  }

  for (const directory of [...artifactDirectories].sort()) {
    if (!manifestDirectories.has(directory)) {
      issues.push(
        validationIssue(
          "RAW_MANIFEST_INVALID",
          `Raw import directory "${directory}" is missing a raw import manifest.`,
          directory,
        ),
      );
    }
  }

  for (const manifestPath of manifestFiles.sort()) {
    issues.push(...(await validateRawManifestFile(vaultRoot, manifestPath)));
  }

  for (const manifestPath of [...inboxAttachmentManifestFiles].sort()) {
    issues.push(...(await validateRawManifestFile(vaultRoot, manifestPath)));
  }

  return issues;
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
          "OPERATION_UNRESOLVED",
          `Write operation "${operation.operationId}" is ${operation.status}.${errorSuffix}`,
          relativePath,
        ),
      );
    } catch (error) {
      issues.push(
        validationIssue(
          error instanceof VaultError ? error.code : "OPERATION_INVALID",
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
    const loadedVault = await loadVaultMetadata(
      absoluteRoot,
      "VAULT_INVALID_METADATA",
      "Vault metadata failed contract validation.",
    );
    metadata = loadedVault.metadata;
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

  for (const family of VAULT_FRONTMATTER_FAMILIES) {
    issues.push(...(await validateFrontmatterFamily(absoluteRoot, family)));
  }

  for (const family of VAULT_JSON_VALIDATION_FAMILIES) {
    if (family.relativePath === VAULT_LAYOUT.metadata) {
      continue;
    }

    issues.push(...(await validateJsonValidationFamily(absoluteRoot, family)));
  }

  for (const family of VAULT_JSONL_VALIDATION_FAMILIES) {
    issues.push(...(await validateJsonlValidationFamily(absoluteRoot, family)));
  }

  issues.push(...(await validateRawImportManifests(absoluteRoot)));
  issues.push(...(await validateWriteOperations(absoluteRoot)));

  return {
    valid: issues.every((issue) => issue.severity !== "error"),
    issues,
    metadata,
  };
}

export async function assertValidVault({
  vaultRoot,
  errorCode = "VAULT_VALIDATION_FAILED",
  message = "Vault failed canonical validation.",
}: AssertValidVaultInput = {}): Promise<ValidateVaultResult> {
  const result = await validateVault({ vaultRoot });

  if (!result.valid) {
    throw new VaultError(errorCode, message, {
      issues: result.issues.map((issue) => ({ ...issue })),
    });
  }

  return result;
}
