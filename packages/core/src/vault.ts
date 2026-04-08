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
  protocolFrontmatterSchema,
  safeParseContract,
  sampleRecordSchema,
  vaultMetadataSchema,
  workoutFormatFrontmatterSchema,
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
import { parseRawImportManifestWithLegacySupport } from "./operations/raw-manifests.ts";
import { normalizeVaultRoot, resolveVaultPath } from "./path-safety.ts";
import { rawDirectoryMatchesOwner } from "./raw.ts";
import {
  isTerminalWriteOperationStatus,
  listWriteOperationMetadataPaths,
  readStoredWriteOperation,
  runCanonicalWrite,
} from "./operations/write-batch.ts";
import {
  buildCurrentProfileMarkdown,
  listProfileSnapshots,
  readCurrentProfileMarkdown,
  stageCurrentProfileMaterialization,
} from "./profile/storage.ts";
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
  const currentState = await readCurrentProfileMarkdown(absoluteRoot);
  let latestSnapshot: Awaited<ReturnType<typeof listProfileSnapshots>>[number] | null | undefined;

  try {
    latestSnapshot = (await listProfileSnapshots({ vaultRoot: absoluteRoot })).at(-1) ?? null;
  } catch {
    latestSnapshot = undefined;
  }

  const currentProfileNeedsRepair =
    latestSnapshot === undefined
      ? false
      : latestSnapshot === null
        ? currentState.exists
        : currentState.markdown !== buildCurrentProfileMarkdown(latestSnapshot);

  if (createdDirectories.length === 0 && !currentProfileNeedsRepair) {
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

      if (latestSnapshot !== undefined) {
        const materialized = await stageCurrentProfileMaterialization(
          batch,
          currentState,
          latestSnapshot,
        );

        if (materialized.updated) {
          const rebuildAudit = materialized.rebuildAudit;
          const rebuildChanges = rebuildAudit.changes ?? [];
          const rebuildTargetIds = rebuildAudit.targetIds ?? [];

          repairSummaries.push(
            rebuildAudit.summary ?? "Rebuilt current profile from snapshot.",
          );
          if (rebuildChanges.length > 0) {
            repairFiles.push(...rebuildChanges.map((change) => change.path));
          }
          if (rebuildTargetIds.length > 0) {
            repairTargetIds.push(...rebuildTargetIds);
          }
        }
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

function isEnvelopeBasedInboxRawPath(relativePath: string): boolean {
  return relativePath.startsWith(`${VAULT_LAYOUT.rawDirectory}/inbox/`);
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
    "RAW_REFERENCE_MISSING",
    `Assessment raw payload "${record.rawPath}" is missing.`,
  );

  issues.push(
    ...(await validateExistingVaultFile(
      vaultRoot,
      rawManifestPathForArtifact(record.rawPath),
      "RAW_MANIFEST_INVALID",
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

  const mediaLists = [
    Array.isArray((record as { media?: unknown }).media)
      ? ((record as { media: unknown[] }).media)
      : [],
    Array.isArray((record as { workout?: { media?: unknown } }).workout?.media)
      ? (((record as { workout: { media: unknown[] } }).workout.media))
      : [],
  ];

  for (const mediaList of mediaLists) {
    for (const media of mediaList) {
      if (
        media &&
        typeof media === "object" &&
        typeof (media as { relativePath?: unknown }).relativePath === "string"
      ) {
        referencedPaths.add((media as { relativePath: string }).relativePath);
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
        "RAW_REFERENCE_MISSING",
        `Referenced raw artifact "${referencedPath}" is missing.`,
      )),
    );

    if (
      referencedPath.startsWith(`${VAULT_LAYOUT.rawDirectory}/`) &&
      !isEnvelopeBasedInboxRawPath(referencedPath)
    ) {
      manifestPaths.add(rawManifestPathForArtifact(referencedPath));
    }
  }

  for (const manifestPath of [...manifestPaths].sort()) {
    issues.push(
      ...(await validateExistingVaultFile(
        vaultRoot,
        manifestPath,
        "RAW_MANIFEST_INVALID",
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
  const contractResult = (() => {
    try {
      return {
        success: true as const,
        data: parseRawImportManifestWithLegacySupport(manifest),
      };
    } catch {
      return safeParseContract(rawImportManifestSchema, manifest);
    }
  })();

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

    if (path.posix.dirname(artifact.relativePath) !== expectedRawDirectory) {
      issues.push(
        validationIssue(
          "RAW_MANIFEST_INVALID",
          `artifact ${index + 1} must remain inside "${expectedRawDirectory}".`,
          relativePath,
        ),
      );
    }

    issues.push(
      ...(await validateExistingVaultFile(
        vaultRoot,
        artifact.relativePath,
        "RAW_REFERENCE_MISSING",
        `Manifest artifact "${artifact.relativePath}" is missing.`,
      )),
    );
  }

  return issues;
}

async function validateRawImportManifests(vaultRoot: string): Promise<ValidationIssue[]> {
  const rawFiles = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.rawDirectory);
  const artifactDirectories = new Set<string>();
  const inboxCaptureDirectories = new Set<string>();
  const inboxAttachmentManifestFiles = new Set<string>();
  const manifestFiles: string[] = [];

  for (const relativePath of rawFiles) {
    const inboxCaptureDirectory = inboxCaptureRootForRawPath(relativePath);

    if (inboxCaptureDirectory !== null) {
      inboxCaptureDirectories.add(inboxCaptureDirectory);
    }

    if (path.posix.basename(relativePath) === "manifest.json") {
      if (isEnvelopeBasedInboxRawPath(relativePath)) {
        if (relativePath === inboxAttachmentManifestPathForCaptureDirectory(path.posix.dirname(path.posix.dirname(relativePath)))) {
          inboxAttachmentManifestFiles.add(relativePath);
        }

        continue;
      }

      manifestFiles.push(relativePath);
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
    const manifestPath = path.posix.join(directory, "manifest.json");

    if (!(await pathExists(resolveVaultPath(vaultRoot, manifestPath).absolutePath))) {
      issues.push(
        validationIssue(
          "RAW_MANIFEST_INVALID",
          `Raw import directory "${directory}" is missing manifest.json.`,
          manifestPath,
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
            "PROFILE_CURRENT_STALE",
            "Current profile exists even though no profile snapshots are present.",
            VAULT_LAYOUT.profileCurrentDocument,
          ),
        ]
      : [];
  }

  if (!exists) {
    return [
      validationIssue(
        "PROFILE_CURRENT_STALE",
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
          "PROFILE_CURRENT_STALE",
          "Current profile markdown does not match the latest profile snapshot.",
          VAULT_LAYOUT.profileCurrentDocument,
        ),
      ];
    }
  } catch (error) {
    return [
      validationIssue(
        error instanceof VaultError ? error.code : "PROFILE_CURRENT_STALE",
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

  issues.push(
    ...(await validateFrontmatterFile({
      vaultRoot: absoluteRoot,
      relativePath: VAULT_LAYOUT.coreDocument,
      schema: coreFrontmatterSchema,
      code: "FRONTMATTER_INVALID",
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
        code: "FRONTMATTER_INVALID",
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
        code: "FRONTMATTER_INVALID",
      })),
    );
  }

  issues.push(
    ...(await validateFrontmatterDirectory({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.goalsDirectory,
      schema: goalFrontmatterSchema,
      code: "FRONTMATTER_INVALID",
    })),
  );
  issues.push(
    ...(await validateFrontmatterDirectory({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.conditionsDirectory,
      schema: conditionFrontmatterSchema,
      code: "FRONTMATTER_INVALID",
    })),
  );
  issues.push(
    ...(await validateFrontmatterDirectory({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.allergiesDirectory,
      schema: allergyFrontmatterSchema,
      code: "FRONTMATTER_INVALID",
    })),
  );
  issues.push(
    ...(await validateFrontmatterDirectory({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.protocolsDirectory,
      schema: protocolFrontmatterSchema,
      code: "FRONTMATTER_INVALID",
    })),
  );
  issues.push(
    ...(await validateFrontmatterDirectory({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.foodsDirectory,
      schema: foodFrontmatterSchema,
      code: "FRONTMATTER_INVALID",
    })),
  );
  issues.push(
    ...(await validateFrontmatterDirectory({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.recipesDirectory,
      schema: recipeFrontmatterSchema,
      code: "FRONTMATTER_INVALID",
    })),
  );
  issues.push(
    ...(await validateFrontmatterDirectory({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.workoutFormatsDirectory,
      schema: workoutFormatFrontmatterSchema,
      code: "FRONTMATTER_INVALID",
    })),
  );
  issues.push(
    ...(await validateFrontmatterDirectory({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.familyDirectory,
      schema: familyMemberFrontmatterSchema,
      code: "FRONTMATTER_INVALID",
    })),
  );
  issues.push(
    ...(await validateFrontmatterDirectory({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.geneticsDirectory,
      schema: geneticVariantFrontmatterSchema,
      code: "FRONTMATTER_INVALID",
    })),
  );

  const currentProfilePath = resolveVaultPath(absoluteRoot, VAULT_LAYOUT.profileCurrentDocument);
  if (await pathExists(currentProfilePath.absolutePath)) {
    issues.push(
      ...(await validateFrontmatterFile({
        vaultRoot: absoluteRoot,
        relativePath: VAULT_LAYOUT.profileCurrentDocument,
        schema: profileCurrentFrontmatterSchema,
        code: "FRONTMATTER_INVALID",
      })),
    );
  }

  issues.push(
    ...(await validateJsonlFamily({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.assessmentLedgerDirectory,
      schema: assessmentResponseSchema,
      code: "CONTRACT_INVALID",
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
      code: "EVENT_INVALID",
      postValidateRecord: async (record) => validateEventRecordReferences(absoluteRoot, record),
    })),
  );
  issues.push(
    ...(await validateJsonlFamily({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.profileSnapshotsDirectory,
      schema: profileSnapshotSchema,
      code: "CONTRACT_INVALID",
    })),
  );
  issues.push(
    ...(await validateJsonlFamily({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.sampleLedgerDirectory,
      schema: sampleRecordSchema,
      code: "SAMPLE_INVALID",
    })),
  );
  issues.push(
    ...(await validateJsonlFamily({
      vaultRoot: absoluteRoot,
      relativeDirectory: VAULT_LAYOUT.auditDirectory,
      schema: auditRecordSchema,
      code: "AUDIT_INVALID",
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
