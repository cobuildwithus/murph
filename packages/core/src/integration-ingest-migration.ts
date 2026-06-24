import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import {
  CURRENT_VAULT_FORMAT_VERSION,
  LEGACY_VAULT_FORMAT_VERSION,
  eventRecordSchema,
  type EventRecord,
  type IntegrationEvidencePart,
  type IntegrationIngestEventOutput,
  type IntegrationIngestRecord,
  type RawImportManifest,
  type RawImportManifestArtifact,
} from "@murphai/contracts";

import { emitAuditRecord } from "./audit.ts";
import { REQUIRED_DIRECTORIES, VAULT_LAYOUT } from "./constants.ts";
import { VaultError } from "./errors.ts";
import { ensureVaultDirectory, pathExists, walkVaultFiles } from "./fs.ts";
import {
  MAX_INTEGRATION_EVIDENCE_PART_BYTES,
  MAX_INTEGRATION_INGEST_BYTES,
  MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES,
  buildIntegrationEvidencePart,
  buildIntegrationIngestAppendPlan,
  buildIntegrationIngestRecord,
  compactIntegrationIngestReceipt,
  readIntegrationIngestEntries,
  stableSerializeIntegrationIngest,
  stageIntegrationIngestAppendPlan,
} from "./integration-ingests.ts";
import {
  isRawManifestFileName,
  parseRawImportManifest,
} from "./operations/raw-manifests.ts";
import { parseFrontmatterDocument, stringifyFrontmatterDocument } from "./frontmatter.ts";
import {
  acquireCanonicalWriteLock,
  withCanonicalWriteLockScope,
} from "./operations/canonical-write-lock.ts";
import { runCanonicalWrite } from "./operations/write-batch.ts";
import {
  normalizeRelativeVaultPath,
  resolveVaultPath,
  resolveVaultPathOnDisk,
} from "./path-safety.ts";
import { assertValidVault } from "./vault.ts";

const LEGACY_INTEGRATION_ROOT = "raw/integrations";
const DEFAULT_MAX_BUNDLES = 25;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const MAX_BLOCKER_EXAMPLES = 20;

export type IntegrationIngestMigrationBlockerCode =
  | "LEGACY_ARTIFACT_HASH_MISMATCH"
  | "LEGACY_ARTIFACT_MISSING"
  | "LEGACY_ARTIFACT_NOT_REGULAR"
  | "LEGACY_BUNDLE_PATH_INVALID"
  | "LEGACY_MANIFEST_CONFLICT"
  | "LEGACY_MANIFEST_INVALID"
  | "LEGACY_MANIFEST_MISSING"
  | "LEGACY_RECEIPT_INVALID"
  | "LEGACY_REFERENCE_UNRESOLVED"
  | "LEGACY_UNMANIFESTED_FILE"
  | "MIGRATION_EVIDENCE_TOO_LARGE"
  | "MIGRATION_READ_BUDGET_EXCEEDED"
  | "MIGRATION_UNSUPPORTED_CONTENT"
  | "JOURNAL_ROW_CONFLICT";

export interface IntegrationIngestMigrationBlocker {
  code: IntegrationIngestMigrationBlockerCode;
  relativePath?: string;
  message: string;
}

export interface DetectIntegrationIngestMigrationInput {
  vaultRoot: string;
  maxBytes?: number;
  maxBundles?: number;
}

export interface IntegrationIngestMigrationDetection {
  storedFormatVersion: number;
  candidateBundleCount: number;
  copiedBundleCount: number;
  detachedBundleCount: number;
  deletableFileCount: number;
  sourceBytes: number;
  journalBytes: number;
  blockerCount: number;
  blockersByCode: Record<string, number>;
  blockerExamples: IntegrationIngestMigrationBlocker[];
  hasWork: boolean;
  hasMore: boolean;
}

export interface RunIntegrationIngestMigrationInput extends DetectIntegrationIngestMigrationInput {
  apply?: boolean;
  finalize?: boolean;
}

export interface IntegrationIngestMigrationResult extends IntegrationIngestMigrationDetection {
  mode: "apply" | "dry-run";
  mutated: boolean;
  appendedBundleCount: number;
  detachedEventRowCount: number;
  deletedFileCount: number;
  finalized: boolean;
  auditPaths: string[];
}

interface LegacyManifestSnapshot {
  manifest: RawImportManifest;
  relativePath: string;
}

interface LegacyArtifactSnapshot {
  artifact: RawImportManifestArtifact;
  content: string;
  metadata?: Record<string, unknown>;
}

interface LegacyIntegrationBundle {
  importId: string;
  provider: string;
  rawDirectory: string;
  manifestPaths: string[];
  manifest: RawImportManifest;
  artifacts: LegacyArtifactSnapshot[];
  allFilePaths: string[];
  sourceBytes: number;
  eventOutputs: IntegrationIngestEventOutput[];
  eventIdsComplete: boolean;
  sampleCount: number;
  row: IntegrationIngestRecord;
  journalState: "absent" | "equal" | "conflict";
  referencedEventRowCount: number;
}

interface EventShardSnapshot {
  relativePath: string;
  records: EventRecord[];
}

interface EventShardMigrationScanInput {
  allLegacyFileSet: ReadonlySet<string>;
  rawRefBundleByPath: ReadonlyMap<string, LegacyIntegrationBundle>;
  state: MutableDetectionState;
  vaultRoot: string;
}

interface EventShardMigrationScanResult {
  eventShards: EventShardSnapshot[];
  outputRolesByBundle: Map<string, Map<string, Set<string>>>;
  referencedRowsByBundle: Map<string, Set<string>>;
}

interface LegacyAutomationRouteNormalization {
  relativePath: string;
  content: string;
}

interface DetectionDetails {
  public: IntegrationIngestMigrationDetection;
  bundles: LegacyIntegrationBundle[];
  eventShards: EventShardSnapshot[];
  rawRefBundleByPath: Map<string, LegacyIntegrationBundle>;
}

interface MutableDetectionState {
  blockers: IntegrationIngestMigrationBlocker[];
  blockersByCode: Record<string, number>;
  sourceBytes: number;
  journalBytes: number;
  budgetExceeded: boolean;
}

export async function detectIntegrationIngestMigration(
  input: DetectIntegrationIngestMigrationInput,
): Promise<IntegrationIngestMigrationDetection> {
  return (await detectIntegrationIngestMigrationDetails(input)).public;
}

export async function runIntegrationIngestMigration(
  input: RunIntegrationIngestMigrationInput,
): Promise<IntegrationIngestMigrationResult> {
  const apply = input.apply === true;
  if (!apply) {
    const initial = await detectIntegrationIngestMigrationDetails(input);
    return {
      ...initial.public,
      mode: "dry-run",
      mutated: false,
      appendedBundleCount: 0,
      detachedEventRowCount: 0,
      deletedFileCount: 0,
      finalized: false,
      auditPaths: [],
    };
  }

  let appendedBundleCount = 0;
  let detachedEventRowCount = 0;
  let deletedFileCount = 0;
  let mutated = false;
  const auditPaths: string[] = [];

  const phaseB = await withMigrationLock(input.vaultRoot, async () => {
    const fresh = await detectIntegrationIngestMigrationDetails(input);
    if (fresh.public.storedFormatVersion === CURRENT_VAULT_FORMAT_VERSION || fresh.public.blockerCount > 0) {
      return { kind: "early" as const, detection: fresh.public };
    }
    const maxBundles = Math.max(1, Math.trunc(input.maxBundles ?? DEFAULT_MAX_BUNDLES));
    const candidates = fresh.bundles.filter((bundle) =>
      bundle.journalState === "absent" || bundle.referencedEventRowCount > 0
    ).slice(0, maxBundles);
    if (candidates.length === 0) {
      return { kind: "applied" as const, appended: 0, detachedRows: 0, auditPath: null as string | null };
    }

    const candidateIds = new Set(candidates.map((bundle) => bundle.importId));
    const appendPlan = await buildIntegrationIngestAppendPlan(
      input.vaultRoot,
      candidates.map((bundle) => bundle.row),
    );
    const rewritten = rewriteEventShardsForBundles(
      fresh.eventShards,
      fresh.rawRefBundleByPath,
      candidateIds,
    );
    const summary =
      `Migrated ${candidates.length} legacy integration bundle(s) into monthly ingest journals; `
      + `detached ${rewritten.detachedRowCount} historical event row(s).`;

    const result = await runCanonicalWrite({
      vaultRoot: input.vaultRoot,
      operationType: "integration_ingest_migration_copy",
      summary,
      hostedCanonicalWritePort: null,
      hostedCanonicalWriteReceiptDirectory: null,
      mutate: async ({ batch }) => {
        await stageIntegrationIngestAppendPlan(batch, appendPlan);
        for (const shard of rewritten.shards) {
          await batch.stageTextWrite(
            shard.relativePath,
            serializeEventShard(shard.records),
            { allowAppendOnlyJsonl: true, overwrite: true },
          );
        }
        const audit = await emitAuditRecord({
          vaultRoot: input.vaultRoot,
          batch,
          action: "vault_repair",
          commandName: "core.runIntegrationIngestMigration.copy",
          summary,
          files: [
            ...appendPlan.targetShardPaths,
            ...rewritten.shards.map((shard) => shard.relativePath),
          ],
          targetIds: candidates.map((bundle) => bundle.importId).slice(0, 50),
        });
        return { auditPath: audit.relativePath };
      },
    });

    return {
      kind: "applied" as const,
      appended: appendPlan.appendedIds.length,
      detachedRows: rewritten.detachedRowCount,
      auditPath: result.auditPath,
    };
  });
  if (phaseB.kind === "early") {
    return {
      ...phaseB.detection,
      mode: "apply",
      mutated: false,
      appendedBundleCount: 0,
      detachedEventRowCount: 0,
      deletedFileCount: 0,
      finalized: false,
      auditPaths: [],
    };
  }
  appendedBundleCount += phaseB.appended;
  detachedEventRowCount += phaseB.detachedRows;
  if (phaseB.auditPath) auditPaths.push(phaseB.auditPath);
  mutated ||= phaseB.appended > 0 || phaseB.detachedRows > 0;

  const phaseC = await withMigrationLock(input.vaultRoot, async () => {
    const fresh = await detectIntegrationIngestMigrationDetails(input);
    assertNoMigrationBlockers(fresh.public);
    const maxBundles = Math.max(1, Math.trunc(input.maxBundles ?? DEFAULT_MAX_BUNDLES));
    const candidates = fresh.bundles.filter((bundle) =>
      bundle.journalState === "equal" && bundle.referencedEventRowCount === 0
    ).slice(0, maxBundles);
    if (candidates.length === 0) {
      return { deleted: 0, auditPath: null as string | null, hasKnownMoreWork: fresh.public.hasMore };
    }
    const journalById = new Map(
      (await readIntegrationIngestEntries(input.vaultRoot)).map((entry) => [entry.record.id, entry.record] as const),
    );
    for (const bundle of candidates) {
      await reverifyLegacyBundle(input.vaultRoot, bundle, journalById.get(bundle.importId));
    }
    const filePaths = [...new Set(candidates.flatMap((bundle) => bundle.allFilePaths))].sort();
    const summary = `Deleted ${filePaths.length} verified legacy integration file(s) after journal migration.`;
    const result = await runCanonicalWrite({
      vaultRoot: input.vaultRoot,
      operationType: "integration_ingest_migration_prune",
      summary,
      hostedCanonicalWritePort: null,
      hostedCanonicalWriteReceiptDirectory: null,
      mutate: async ({ batch }) => {
        for (const relativePath of filePaths) {
          await batch.stageDelete(relativePath, { allowRaw: true });
        }
        const audit = await emitAuditRecord({
          vaultRoot: input.vaultRoot,
          batch,
          action: "vault_repair",
          commandName: "core.runIntegrationIngestMigration.prune",
          summary,
          files: filePaths,
          targetIds: candidates.map((bundle) => bundle.importId).slice(0, 50),
        });
        return { auditPath: audit.relativePath };
      },
    });
    return { deleted: filePaths.length, auditPath: result.auditPath, hasKnownMoreWork: fresh.public.hasMore };
  });
  deletedFileCount += phaseC.deleted;
  if (phaseC.auditPath) auditPaths.push(phaseC.auditPath);
  mutated ||= phaseC.deleted > 0;
  if (phaseC.deleted > 0) {
    await removeEmptyLegacyIntegrationDirectories(input.vaultRoot);
  }

  let finalized = false;
  if (input.finalize !== false && !phaseC.hasKnownMoreWork) {
    const finalizeResult = await finalizeIntegrationIngestMigration(input.vaultRoot);
    if (finalizeResult) {
      auditPaths.push(finalizeResult.auditPath);
      finalized = true;
      mutated = true;
    }
  }

  const finalDetection = finalized
    ? emptyFinalizedDetection()
    : (await detectIntegrationIngestMigrationDetails(input)).public;
  return {
    ...finalDetection,
    storedFormatVersion: finalized ? CURRENT_VAULT_FORMAT_VERSION : finalDetection.storedFormatVersion,
    mode: "apply",
    mutated,
    appendedBundleCount,
    detachedEventRowCount,
    deletedFileCount,
    finalized,
    auditPaths,
  };
}

async function finalizeIntegrationIngestMigration(vaultRoot: string): Promise<{ auditPath: string } | null> {
  return withMigrationLock(vaultRoot, async () => {
    const beforeFinalize = await detectIntegrationIngestMigrationDetails({ vaultRoot });
    if (
      beforeFinalize.public.blockerCount !== 0
      || beforeFinalize.bundles.length !== 0
      || (await hasLegacyIntegrationFiles(vaultRoot))
      || (await hasLegacyIntegrationEventReferences(vaultRoot))
    ) {
      return null;
    }

    const metadata = await readLegacyVaultMetadata(vaultRoot);
    const createdDirectories = await ensureMissingRequiredDirectories(vaultRoot);
    const automationNormalizations = await readLegacyAutomationRouteNormalizations(vaultRoot);
    const summary = "Finalize integration ingest journal migration and advance vault format to v2.";
    try {
      const finalizeResult = await runCanonicalWrite({
        vaultRoot,
        operationType: "integration_ingest_migration_finalize",
        summary,
        hostedCanonicalWritePort: null,
        hostedCanonicalWriteReceiptDirectory: null,
        mutate: async ({ batch }) => {
          for (const normalization of automationNormalizations) {
            await batch.stageTextWrite(normalization.relativePath, normalization.content, { overwrite: true });
          }
          await batch.stageTextWrite(
            VAULT_LAYOUT.metadata,
            `${JSON.stringify({ ...metadata, formatVersion: CURRENT_VAULT_FORMAT_VERSION }, null, 2)}\n`,
            { overwrite: true },
          );
          const audit = await emitAuditRecord({
            vaultRoot,
            batch,
            action: "vault_repair",
            commandName: "core.runIntegrationIngestMigration.finalize",
            summary,
            files: [
              VAULT_LAYOUT.metadata,
              ...automationNormalizations.map((normalization) => normalization.relativePath),
              ...createdDirectories,
            ],
          });
          return { auditPath: audit.relativePath };
        },
      });

      await assertValidVault({
        vaultRoot,
        errorCode: "INTEGRATION_INGEST_MIGRATION_INVALID_VAULT",
        message: "Integration ingest migration produced an invalid v2 vault.",
      });
      return finalizeResult;
    } catch (error) {
      await restoreLegacyVaultMetadataAfterFailedFinalization(vaultRoot, metadata, error);
      throw error;
    }
  });
}

async function restoreLegacyVaultMetadataAfterFailedFinalization(
  vaultRoot: string,
  metadata: Record<string, unknown> & { formatVersion: 1 },
  finalizeError: unknown,
): Promise<void> {
  const current = await readMigrationVaultMetadata(vaultRoot).catch(() => null);
  if (current?.formatVersion !== CURRENT_VAULT_FORMAT_VERSION) {
    return;
  }

  try {
    await runCanonicalWrite({
      vaultRoot,
      operationType: "integration_ingest_migration_finalize_rollback",
      summary: "Restore legacy vault metadata after failed integration ingest migration finalization.",
      hostedCanonicalWritePort: null,
      hostedCanonicalWriteReceiptDirectory: null,
      mutate: async ({ batch }) => {
        await batch.stageTextWrite(
          VAULT_LAYOUT.metadata,
          `${JSON.stringify(metadata, null, 2)}\n`,
          { overwrite: true },
        );
        await emitAuditRecord({
          vaultRoot,
          batch,
          action: "vault_repair",
          commandName: "core.runIntegrationIngestMigration.finalize.rollback",
          summary: "Restored legacy vault metadata after failed integration ingest migration finalization.",
          files: [VAULT_LAYOUT.metadata],
        });
      },
    });
  } catch (rollbackError) {
    throw new VaultError(
      "INTEGRATION_INGEST_MIGRATION_FINALIZE_ROLLBACK_FAILED",
      "Integration ingest migration finalization failed, and restoring legacy vault metadata also failed.",
      {
        finalizeError: summarizeMigrationError(finalizeError),
        rollbackError: summarizeMigrationError(rollbackError),
      },
    );
  }
}

async function readLegacyAutomationRouteNormalizations(
  vaultRoot: string,
): Promise<LegacyAutomationRouteNormalization[]> {
  const relativePaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.automationsDirectory, { extension: ".md" });
  const normalizations: LegacyAutomationRouteNormalization[] = [];

  for (const relativePath of relativePaths.sort()) {
    const absolutePath = resolveVaultPath(vaultRoot, relativePath).absolutePath;
    const markdown = await fs.readFile(absolutePath, "utf8");
    const document = parseFrontmatterDocument(markdown);
    const route = isRecord(document.attributes.route) ? document.attributes.route : null;
    if (!route || route.channel !== "telegram") {
      continue;
    }

    const deliveryTarget = route.deliveryTarget;
    if (typeof deliveryTarget !== "number" || !Number.isSafeInteger(deliveryTarget)) {
      continue;
    }

    const content = stringifyFrontmatterDocument({
      attributes: {
        ...document.attributes,
        route: {
          ...route,
          deliveryTarget: String(deliveryTarget),
        },
      },
      body: document.body,
    });
    if (content !== markdown) {
      normalizations.push({ relativePath, content });
    }
  }

  return normalizations;
}

function summarizeMigrationError(error: unknown): string {
  if (error instanceof VaultError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function detectIntegrationIngestMigrationDetails(
  input: DetectIntegrationIngestMigrationInput,
): Promise<DetectionDetails> {
  const metadata = await readMigrationVaultMetadata(input.vaultRoot);
  if (metadata.formatVersion === CURRENT_VAULT_FORMAT_VERSION) {
    return {
      public: emptyFinalizedDetection(),
      bundles: [],
      eventShards: [],
      rawRefBundleByPath: new Map(),
    };
  }
  if (metadata.formatVersion !== LEGACY_VAULT_FORMAT_VERSION) {
    throw new VaultError(
      "VAULT_UNSUPPORTED_FORMAT",
      `Integration ingest migration supports formatVersion ${LEGACY_VAULT_FORMAT_VERSION}; found ${metadata.formatVersion}.`,
    );
  }

  const maxBundles = Math.max(1, Math.trunc(input.maxBundles ?? DEFAULT_MAX_BUNDLES));
  const state: MutableDetectionState = {
    blockers: [],
    blockersByCode: {},
    sourceBytes: 0,
    journalBytes: 0,
    budgetExceeded: false,
  };
  const allLegacyFiles = (await walkVaultFiles(input.vaultRoot, LEGACY_INTEGRATION_ROOT)).sort();
  const manifestPaths = allLegacyFiles
    .filter((relativePath) => isRawManifestFileName(path.posix.basename(relativePath)))
    .sort();
  const manifestPathsByDirectory = new Map<string, string[]>();
  for (const manifestPath of manifestPaths) {
    const directory = path.posix.dirname(manifestPath);
    const paths = manifestPathsByDirectory.get(directory) ?? [];
    paths.push(manifestPath);
    manifestPathsByDirectory.set(directory, paths);
  }
  const directories = [...manifestPathsByDirectory.keys()].sort();
  for (const relativePath of allLegacyFiles) {
    const containingBundle = directories.find((directory) =>
      relativePath === directory || relativePath.startsWith(`${directory}/`)
    );
    if (!containingBundle) {
      addBlocker(state, {
        code: "LEGACY_MANIFEST_MISSING",
        relativePath,
        message: "Legacy integration file is not contained in a bundle with a manifest.",
      });
    }
  }
  const selectedDirectories = directories.slice(0, maxBundles);
  const hasMore = directories.length > maxBundles;
  const allLegacyFileSet = new Set(allLegacyFiles);
  const bundles: LegacyIntegrationBundle[] = [];

  for (const rawDirectory of selectedDirectories) {
    const manifestFiles = manifestPathsByDirectory.get(rawDirectory) ?? [];
    const bundle = await readLegacyIntegrationBundle({
      vaultRoot: input.vaultRoot,
      allowBudgetBoundary: bundles.length > 0,
      rawDirectory,
      manifestPaths: manifestFiles,
      maxBytes: input.maxBytes ?? DEFAULT_MAX_BYTES,
      state,
    });
    if (bundle) bundles.push(bundle);
    if (state.budgetExceeded) break;
  }

  const journalById = new Map(
    (await readIntegrationIngestEntries(input.vaultRoot)).map((entry) => [entry.record.id, entry.record] as const),
  );
  const rawRefBundleByPath = new Map<string, LegacyIntegrationBundle>();
  for (const bundle of bundles) {
    for (const relativePath of bundle.allFilePaths) {
      rawRefBundleByPath.set(relativePath, bundle);
    }
  }
  const {
    eventShards,
    outputRolesByBundle,
    referencedRowsByBundle,
  } = await scanEventShardsForMigration({
    allLegacyFileSet,
    rawRefBundleByPath,
    state,
    vaultRoot: input.vaultRoot,
  });

  for (const bundle of bundles) {
    const eventRoles = outputRolesByBundle.get(bundle.importId) ?? new Map();
    bundle.eventOutputs = [...eventRoles.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, roles]) => ({ id, roles: [...roles].sort() }));
    const eventCount = readManifestCount(bundle.manifest, "eventCount") ?? bundle.eventOutputs.length;
    bundle.eventIdsComplete = eventCount === bundle.eventOutputs.length;
    bundle.referencedEventRowCount = referencedRowsByBundle.get(bundle.importId)?.size ?? 0;
    bundle.row = rebuildBundleRow(bundle);
    if (!validateMigratedJournalRowSize(state, bundle.rawDirectory, bundle.row)) {
      bundle.journalState = "conflict";
      continue;
    }
    const existing = journalById.get(bundle.importId);
    if (!existing) {
      bundle.journalState = "absent";
    } else if (stableSerializeIntegrationIngest(existing) === stableSerializeIntegrationIngest(bundle.row)) {
      bundle.journalState = "equal";
    } else {
      const detachedRow = rebuildBundleRowWithExistingOutputs(bundle, existing);
      if (stableSerializeIntegrationIngest(existing) === stableSerializeIntegrationIngest(detachedRow)) {
        bundle.row = existing;
        bundle.eventOutputs = existing.outputs.events;
        bundle.eventIdsComplete = existing.outputs.eventIdsComplete;
        bundle.journalState = "equal";
      } else {
        bundle.journalState = "conflict";
      }
    }
    if (bundle.journalState === "conflict") {
      addBlocker(state, {
        code: "JOURNAL_ROW_CONFLICT",
        message: `Integration ingest "${bundle.importId}" already exists with different content.`,
      });
    }
    state.journalBytes += Buffer.byteLength(`${JSON.stringify(bundle.row)}\n`, "utf8");
  }

  const copiedBundleCount = bundles.filter((bundle) => bundle.journalState === "equal").length;
  const detachedBundleCount = bundles.filter((bundle) =>
    bundle.journalState === "equal" && bundle.referencedEventRowCount === 0
  ).length;
  const deletableFileCount = bundles
    .filter((bundle) => bundle.journalState === "equal" && bundle.referencedEventRowCount === 0)
    .reduce((total, bundle) => total + bundle.allFilePaths.length, 0);
  const blockerCount = Object.values(state.blockersByCode).reduce((total, count) => total + count, 0);
  return {
    public: {
      storedFormatVersion: metadata.formatVersion,
      candidateBundleCount: bundles.length,
      copiedBundleCount,
      detachedBundleCount,
      deletableFileCount,
      sourceBytes: state.sourceBytes,
      journalBytes: state.journalBytes,
      blockerCount,
      blockersByCode: state.blockersByCode,
      blockerExamples: state.blockers.slice(0, MAX_BLOCKER_EXAMPLES),
      hasWork: bundles.length > 0 || await hasLegacyIntegrationFiles(input.vaultRoot),
      hasMore: hasMore || state.budgetExceeded,
    },
    bundles,
    eventShards,
    rawRefBundleByPath,
  };
}

async function readLegacyIntegrationBundle(input: {
  allowBudgetBoundary: boolean;
  vaultRoot: string;
  rawDirectory: string;
  manifestPaths: string[];
  maxBytes: number;
  state: MutableDetectionState;
}): Promise<LegacyIntegrationBundle | null> {
  if (!/^raw\/integrations\/[^/]+\/\d{4}\/\d{2}\/xfm_[0-9A-Za-z]+$/u.test(input.rawDirectory)) {
    addBlocker(input.state, {
      code: "LEGACY_BUNDLE_PATH_INVALID",
      relativePath: input.rawDirectory,
      message: "Legacy integration bundle path does not match the expected provider/year/month/xfm layout.",
    });
    return null;
  }
  if (input.manifestPaths.length === 0) {
    addBlocker(input.state, {
      code: "LEGACY_MANIFEST_MISSING",
      relativePath: input.rawDirectory,
      message: "Legacy integration bundle has no raw import manifest.",
    });
    return null;
  }

  const manifests: LegacyManifestSnapshot[] = [];
  for (const relativePath of input.manifestPaths) {
    try {
      const text = await fs.readFile((await resolveVaultPathOnDisk(input.vaultRoot, relativePath)).absolutePath, "utf8");
      manifests.push({ relativePath, manifest: parseRawImportManifest(JSON.parse(text)) });
    } catch (error) {
      addBlocker(input.state, {
        code: "LEGACY_MANIFEST_INVALID",
        relativePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (manifests.length !== input.manifestPaths.length) return null;
  const [first] = manifests;
  if (!first) return null;
  const signature = stableManifestSignature(first.manifest);
  if (manifests.some((snapshot) => stableManifestSignature(snapshot.manifest) !== signature)) {
    addBlocker(input.state, {
      code: "LEGACY_MANIFEST_CONFLICT",
      relativePath: input.rawDirectory,
      message: "Legacy integration bundle contains conflicting manifests.",
    });
    return null;
  }
  const manifest = first.manifest;
  const pathSegments = input.rawDirectory.split("/");
  const provider = pathSegments[2] ?? "";
  const importId = pathSegments.at(-1) ?? "";
  if (
    manifest.importKind !== "device_batch"
    || manifest.rawDirectory !== input.rawDirectory
    || manifest.owner.kind !== "device_batch"
    || manifest.owner.id !== importId
    || manifest.owner.partition !== provider
  ) {
    addBlocker(input.state, {
      code: "LEGACY_MANIFEST_INVALID",
      relativePath: first.relativePath,
      message: "Legacy device-batch manifest owner or rawDirectory does not match its bundle path.",
    });
    return null;
  }

  const allFilePaths = (await walkVaultFiles(input.vaultRoot, input.rawDirectory)).sort();
  const declaredPaths = new Set([...input.manifestPaths, ...manifest.artifacts.map((artifact) => artifact.relativePath)]);
  for (const relativePath of allFilePaths) {
    if (!declaredPaths.has(relativePath)) {
      addBlocker(input.state, {
        code: "LEGACY_UNMANIFESTED_FILE",
        relativePath,
        message: "Legacy integration bundle contains a file not declared by its manifest.",
      });
    }
  }
  if (allFilePaths.some((relativePath) => !declaredPaths.has(relativePath))) return null;

  const metadataByRole = readArtifactMetadataByRole(manifest);
  const artifacts: LegacyArtifactSnapshot[] = [];
  let sourceBytes = 0;
  const seenRoles = new Map<string, string>();
  for (const artifact of manifest.artifacts) {
    if (path.posix.dirname(artifact.relativePath) !== input.rawDirectory) {
      addBlocker(input.state, {
        code: "LEGACY_MANIFEST_INVALID",
        relativePath: artifact.relativePath,
        message: "Legacy artifact is outside its bundle directory.",
      });
      continue;
    }
    const priorPath = seenRoles.get(artifact.role);
    if (priorPath && priorPath !== artifact.relativePath) {
      addBlocker(input.state, {
        code: "LEGACY_MANIFEST_CONFLICT",
        relativePath: artifact.relativePath,
        message: `Legacy evidence role "${artifact.role}" is declared by multiple files.`,
      });
      continue;
    }
    seenRoles.set(artifact.role, artifact.relativePath);
    try {
      const resolved = await resolveVaultPathOnDisk(input.vaultRoot, artifact.relativePath);
      const stats = await fs.lstat(resolved.absolutePath);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        addBlocker(input.state, {
          code: "LEGACY_ARTIFACT_NOT_REGULAR",
          relativePath: artifact.relativePath,
          message: "Legacy integration artifact must be a regular non-symlink file.",
        });
        continue;
      }
      if (input.state.sourceBytes + stats.size > input.maxBytes) {
        input.state.budgetExceeded = true;
        if (!input.allowBudgetBoundary) {
          addBlocker(input.state, {
            code: "MIGRATION_READ_BUDGET_EXCEEDED",
            relativePath: artifact.relativePath,
            message: "Integration migration read budget was exhausted.",
          });
        }
        break;
      }
      const bytes = await fs.readFile(resolved.absolutePath);
      input.state.sourceBytes += bytes.byteLength;
      sourceBytes += bytes.byteLength;
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (bytes.byteLength !== artifact.byteSize || sha256 !== artifact.sha256) {
        addBlocker(input.state, {
          code: "LEGACY_ARTIFACT_HASH_MISMATCH",
          relativePath: artifact.relativePath,
          message: "Legacy integration artifact byte size or SHA-256 does not match its manifest.",
        });
        continue;
      }
      const isReceipt = artifact.role.startsWith("wearable-raw-receipt:");
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: !isReceipt }).decode(bytes);
      } catch {
        addBlocker(input.state, {
          code: "MIGRATION_UNSUPPORTED_CONTENT",
          relativePath: artifact.relativePath,
          message: "Legacy device evidence is not valid UTF-8 text.",
        });
        continue;
      }
      artifacts.push({ artifact, content, metadata: metadataByRole.get(artifact.role) });
    } catch (error) {
      addBlocker(input.state, {
        code: "LEGACY_ARTIFACT_MISSING",
        relativePath: artifact.relativePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (artifacts.length !== manifest.artifacts.length || input.state.budgetExceeded) return null;

  const receiptCandidates = artifacts.filter((entry) => entry.artifact.role.startsWith("wearable-raw-receipt:"));
  let receipt: ReturnType<typeof compactIntegrationIngestReceipt>;
  if (receiptCandidates.length > 0) {
    try {
      const compacted = receiptCandidates.map((entry) => compactIntegrationIngestReceipt(JSON.parse(entry.content)));
      const serialized = new Set(compacted.map((entry) => JSON.stringify(entry)));
      if (serialized.size !== 1) {
        throw new Error("Legacy integration bundle contains conflicting wearable receipts.");
      }
      receipt = compacted[0];
    } catch (error) {
      addBlocker(input.state, {
        code: "LEGACY_RECEIPT_INVALID",
        relativePath: receiptCandidates[0]?.artifact.relativePath,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
  const parts = buildLegacyEvidenceParts({
    artifacts,
    rawDirectory: input.rawDirectory,
    state: input.state,
  });
  if (!parts) return null;
  const eventCount = readManifestCount(manifest, "eventCount") ?? 0;
  const sampleCount = readManifestCount(manifest, "sampleCount") ?? 0;
  const row = buildIntegrationIngestRecord({
    id: importId,
    provider,
    accountId: readManifestString(manifest, "accountId") ?? undefined,
    source: normalizeEventSource(manifest.source),
    importedAt: normalizeIsoTimestamp(manifest.importedAt),
    receipt,
    parts,
    eventOutputs: [],
    eventIdsComplete: eventCount === 0,
    sampleIds: [],
    sampleIdsComplete: sampleCount === 0,
    eventCount,
    sampleCount,
    provenance: readManifestOperatorMetadata(manifest),
  });
  if (!validateMigratedJournalRowSize(input.state, input.rawDirectory, row)) return null;
  return {
    importId,
    provider,
    rawDirectory: input.rawDirectory,
    manifestPaths: [...input.manifestPaths],
    manifest,
    artifacts,
    allFilePaths,
    sourceBytes,
    eventOutputs: [],
    eventIdsComplete: eventCount === 0,
    sampleCount,
    row,
    journalState: "absent",
    referencedEventRowCount: 0,
  };
}

function buildLegacyEvidenceParts(input: {
  artifacts: readonly LegacyArtifactSnapshot[];
  rawDirectory: string;
  state: MutableDetectionState;
}): IntegrationEvidencePart[] | null {
  const evidenceArtifacts = input.artifacts.filter((entry) =>
    !entry.artifact.role.startsWith("wearable-raw-receipt:")
  );
  let totalBytes = 0;
  let valid = true;
  for (const entry of evidenceArtifacts) {
    const byteSize = Buffer.byteLength(entry.content, "utf8");
    if (byteSize > MAX_INTEGRATION_EVIDENCE_PART_BYTES) {
      valid = false;
      addBlocker(input.state, {
        code: "MIGRATION_EVIDENCE_TOO_LARGE",
        relativePath: entry.artifact.relativePath,
        message:
          `Legacy evidence role "${entry.artifact.role}" exceeds the `
          + `${MAX_INTEGRATION_EVIDENCE_PART_BYTES}-byte v2 evidence part limit.`,
      });
    }
    totalBytes += byteSize;
  }
  if (totalBytes > MAX_INTEGRATION_INGEST_BYTES) {
    valid = false;
    addBlocker(input.state, {
      code: "MIGRATION_EVIDENCE_TOO_LARGE",
      relativePath: input.rawDirectory,
      message:
        `Legacy integration bundle exceeds the ${MAX_INTEGRATION_INGEST_BYTES}-byte v2 evidence limit.`,
    });
  }
  if (!valid) return null;

  return evidenceArtifacts.map((entry) => buildIntegrationEvidencePart({
    role: entry.artifact.role,
    fileName: entry.artifact.originalFileName,
    mediaType: entry.artifact.mediaType,
    content: entry.content,
    metadata: entry.metadata,
  }));
}

function validateMigratedJournalRowSize(
  state: MutableDetectionState,
  relativePath: string,
  row: IntegrationIngestRecord,
): boolean {
  const rowBytes = Buffer.byteLength(`${JSON.stringify(row)}\n`, "utf8");
  if (rowBytes <= MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES) return true;
  addBlocker(state, {
    code: "MIGRATION_EVIDENCE_TOO_LARGE",
    relativePath,
    message:
      `Migrated integration ingest row would exceed the `
      + `${MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES}-byte v2 journal row limit.`,
  });
  return false;
}

function rebuildBundleRow(bundle: LegacyIntegrationBundle): IntegrationIngestRecord {
  return buildBundleRow(bundle, {
    eventOutputs: bundle.eventOutputs,
    eventIdsComplete: bundle.eventIdsComplete,
    sampleIds: [],
    sampleIdsComplete: bundle.sampleCount === 0,
  });
}

function rebuildBundleRowWithExistingOutputs(
  bundle: LegacyIntegrationBundle,
  existing: IntegrationIngestRecord,
): IntegrationIngestRecord {
  return buildBundleRow(bundle, {
    eventOutputs: existing.outputs.events,
    eventIdsComplete: existing.outputs.eventIdsComplete,
    sampleIds: [],
    sampleIdsComplete: bundle.sampleCount === 0,
  });
}

function buildBundleRow(
  bundle: LegacyIntegrationBundle,
  outputs: {
    eventOutputs: IntegrationIngestEventOutput[];
    eventIdsComplete: boolean;
    sampleIds: string[];
    sampleIdsComplete: boolean;
  },
): IntegrationIngestRecord {
  const receiptEntry = bundle.artifacts.find((entry) => entry.artifact.role.startsWith("wearable-raw-receipt:"));
  const receipt = receiptEntry ? compactIntegrationIngestReceipt(JSON.parse(receiptEntry.content)) : undefined;
  const parts: IntegrationEvidencePart[] = bundle.artifacts
    .filter((entry) => !entry.artifact.role.startsWith("wearable-raw-receipt:"))
    .map((entry) => buildIntegrationEvidencePart({
      role: entry.artifact.role,
      fileName: entry.artifact.originalFileName,
      mediaType: entry.artifact.mediaType,
      content: entry.content,
      metadata: entry.metadata,
    }));
  return buildIntegrationIngestRecord({
    id: bundle.importId,
    provider: bundle.provider,
    accountId: readManifestString(bundle.manifest, "accountId") ?? undefined,
    source: normalizeEventSource(bundle.manifest.source),
    importedAt: normalizeIsoTimestamp(bundle.manifest.importedAt),
    receipt,
    parts,
    eventOutputs: outputs.eventOutputs,
    eventIdsComplete: outputs.eventIdsComplete,
    sampleIds: outputs.sampleIds,
    sampleIdsComplete: outputs.sampleIdsComplete,
    eventCount: readManifestCount(bundle.manifest, "eventCount") ?? outputs.eventOutputs.length,
    sampleCount: bundle.sampleCount,
    provenance: readManifestOperatorMetadata(bundle.manifest),
  });
}

function rewriteEventShardsForBundles(
  shards: readonly EventShardSnapshot[],
  bundleByPath: ReadonlyMap<string, LegacyIntegrationBundle>,
  candidateIds: ReadonlySet<string>,
): { shards: EventShardSnapshot[]; detachedRowCount: number } {
  const rewritten: EventShardSnapshot[] = [];
  let detachedRowCount = 0;
  for (const shard of shards) {
    let changed = false;
    const records = shard.records.map((record) => {
      if (!record.rawRefs?.some((rawRef) => {
        const bundle = bundleByPath.get(rawRef);
        return bundle ? candidateIds.has(bundle.importId) : false;
      })) {
        return record;
      }
      const rawRefs = record.rawRefs.filter((rawRef) => {
        const bundle = bundleByPath.get(rawRef);
        return !bundle || !candidateIds.has(bundle.importId);
      });
      const candidate = { ...record, ...(rawRefs.length > 0 ? { rawRefs } : {}) } as Record<string, unknown>;
      if (rawRefs.length === 0) delete candidate.rawRefs;
      const parsed = eventRecordSchema.safeParse(candidate);
      if (!parsed.success) {
        throw new VaultError(
          "INTEGRATION_INGEST_EVENT_REWRITE_INVALID",
          `Rewritten event "${record.id}" failed contract validation.`,
          { errors: parsed.error.issues.map((issue) => issue.message) },
        );
      }
      changed = true;
      detachedRowCount += 1;
      return parsed.data;
    });
    if (changed) rewritten.push({ relativePath: shard.relativePath, records });
  }
  return { shards: rewritten, detachedRowCount };
}

async function reverifyLegacyBundle(
  vaultRoot: string,
  bundle: LegacyIntegrationBundle,
  existingJournalRecord: IntegrationIngestRecord | undefined,
): Promise<void> {
  for (const entry of bundle.artifacts) {
    const resolved = await resolveVaultPathOnDisk(vaultRoot, entry.artifact.relativePath);
    const bytes = await fs.readFile(resolved.absolutePath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== entry.artifact.byteSize || sha256 !== entry.artifact.sha256) {
      throw new VaultError(
        "LEGACY_ARTIFACT_HASH_MISMATCH",
        `Legacy integration artifact "${entry.artifact.relativePath}" changed before deletion.`,
      );
    }
  }
  for (const manifestPath of bundle.manifestPaths) {
    const parsed = parseRawImportManifest(JSON.parse(await fs.readFile(
      (await resolveVaultPathOnDisk(vaultRoot, manifestPath)).absolutePath,
      "utf8",
    )));
    if (stableManifestSignature(parsed) !== stableManifestSignature(bundle.manifest)) {
      throw new VaultError(
        "LEGACY_MANIFEST_CONFLICT",
        `Legacy manifest "${manifestPath}" changed before deletion.`,
      );
    }
  }
  if (
    !existingJournalRecord
    || stableSerializeIntegrationIngest(existingJournalRecord) !== stableSerializeIntegrationIngest(bundle.row)
  ) {
    throw new VaultError(
      "JOURNAL_ROW_CONFLICT",
      `Integration ingest "${bundle.importId}" is missing or changed before legacy deletion.`,
    );
  }
}

async function scanEventShardsForMigration({
  allLegacyFileSet,
  rawRefBundleByPath,
  state,
  vaultRoot,
}: EventShardMigrationScanInput): Promise<EventShardMigrationScanResult> {
  const relativePaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, { extension: ".jsonl" });
  const eventShards: EventShardSnapshot[] = [];
  const outputRolesByBundle = new Map<string, Map<string, Set<string>>>();
  const referencedRowsByBundle = new Map<string, Set<string>>();

  for (const relativePath of relativePaths.sort()) {
    const records: EventRecord[] = [];
    let retainShard = false;

    for await (const { index, record } of readEventRecordsFromShard(vaultRoot, relativePath)) {
      records.push(record);
      const integrationRefs = (record.rawRefs ?? []).filter((rawRef) => rawRef.startsWith(`${LEGACY_INTEGRATION_ROOT}/`));
      if (integrationRefs.length === 0) continue;

      const bundlesForRow = new Set<LegacyIntegrationBundle>();
      for (const rawRef of integrationRefs) {
        const bundle = rawRefBundleByPath.get(rawRef);
        if (!bundle) {
          if (allLegacyFileSet.has(rawRef)) {
            continue;
          }
          addBlocker(state, {
            code: "LEGACY_REFERENCE_UNRESOLVED",
            relativePath: rawRef,
            message: `Historical event "${record.id}" references an unverified integration file.`,
          });
          continue;
        }

        retainShard = true;
        bundlesForRow.add(bundle);
        const artifact = bundle.artifacts.find((candidate) => candidate.artifact.relativePath === rawRef);
        if (!artifact || artifact.artifact.role.startsWith("wearable-raw-receipt:")) {
          addBlocker(state, {
            code: "LEGACY_REFERENCE_UNRESOLVED",
            relativePath: rawRef,
            message: `Historical event "${record.id}" references a legacy integration file that is not preserved as evidence.`,
          });
          continue;
        }
        const eventRoles = outputRolesByBundle.get(bundle.importId) ?? new Map<string, Set<string>>();
        const roles = eventRoles.get(record.id) ?? new Set<string>();
        roles.add(artifact.artifact.role);
        eventRoles.set(record.id, roles);
        outputRolesByBundle.set(bundle.importId, eventRoles);
      }

      for (const bundle of bundlesForRow) {
        const eventRoles = outputRolesByBundle.get(bundle.importId) ?? new Map<string, Set<string>>();
        if (!eventRoles.has(record.id)) eventRoles.set(record.id, new Set<string>());
        outputRolesByBundle.set(bundle.importId, eventRoles);
        const rows = referencedRowsByBundle.get(bundle.importId) ?? new Set<string>();
        rows.add(`${relativePath}:${index}`);
        referencedRowsByBundle.set(bundle.importId, rows);
      }
    }

    if (retainShard) {
      eventShards.push({ relativePath, records });
    }
  }

  return { eventShards, outputRolesByBundle, referencedRowsByBundle };
}

async function* readEventRecordsFromShard(
  vaultRoot: string,
  relativePath: string,
): AsyncGenerator<{ index: number; record: EventRecord }> {
  const absolutePath = resolveVaultPath(vaultRoot, relativePath).absolutePath;
  const lines = createInterface({
    crlfDelay: Infinity,
    input: createReadStream(absolutePath, { encoding: "utf8" }),
  });
  let index = 0;

  for await (const line of lines) {
    if (!line) {
      continue;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new VaultError("VAULT_INVALID_JSONL", `Invalid JSON on line ${index + 1}.`, {
        relativePath,
        lineNumber: index + 1,
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    const parsed = eventRecordSchema.safeParse(raw);
    if (!parsed.success) {
      throw new VaultError(
        "EVENT_INVALID",
        `Stored event in "${relativePath}" failed validation during migration.`,
        { errors: parsed.error.issues.map((issue) => issue.message) },
      );
    }
    yield { index, record: parsed.data };
    index += 1;
  }
}

function serializeEventShard(records: readonly EventRecord[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : "");
}

async function withMigrationLock<T>(vaultRoot: string, fn: () => Promise<T>): Promise<T> {
  return await withCanonicalWriteLockScope(vaultRoot, async () => {
    const lock = await acquireCanonicalWriteLock(vaultRoot);
    try {
      return await fn();
    } finally {
      await lock.release();
    }
  });
}

function assertNoMigrationBlockers(detection: IntegrationIngestMigrationDetection): void {
  if (detection.blockerCount > 0) {
    throw new VaultError(
      "INTEGRATION_INGEST_MIGRATION_BLOCKED",
      `Integration ingest migration is blocked by ${detection.blockerCount} issue(s).`,
      { blockersByCode: detection.blockersByCode },
    );
  }
}

function addBlocker(state: MutableDetectionState, blocker: IntegrationIngestMigrationBlocker): void {
  state.blockersByCode[blocker.code] = (state.blockersByCode[blocker.code] ?? 0) + 1;
  if (state.blockers.length < MAX_BLOCKER_EXAMPLES) state.blockers.push(blocker);
}

function stableManifestSignature(manifest: RawImportManifest): string {
  return JSON.stringify({
    ...manifest,
    artifacts: [...manifest.artifacts].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath) || left.role.localeCompare(right.role)
    ),
  });
}

function readArtifactMetadataByRole(manifest: RawImportManifest): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  const provenance = isRecord(manifest.provenance) ? manifest.provenance : {};
  const entries = Array.isArray(provenance.rawArtifacts) ? provenance.rawArtifacts : [];
  for (const value of entries) {
    if (!isRecord(value) || typeof value.role !== "string" || !isRecord(value.metadata)) continue;
    result.set(value.role, value.metadata);
  }
  return result;
}

function readManifestOperatorMetadata(manifest: RawImportManifest): Record<string, unknown> | undefined {
  const provenance = isRecord(manifest.provenance) ? manifest.provenance : {};
  return isRecord(provenance.operatorMetadata) ? provenance.operatorMetadata : undefined;
}

function readManifestCount(manifest: RawImportManifest, key: "eventCount" | "sampleCount"): number | undefined {
  const provenance = isRecord(manifest.provenance) ? manifest.provenance : {};
  const value = provenance[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function readManifestString(manifest: RawImportManifest, key: string): string | null {
  const provenance = isRecord(manifest.provenance) ? manifest.provenance : {};
  const value = provenance[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeEventSource(value: unknown): "manual" | "import" | "device" | "derived" {
  return value === "manual" || value === "import" || value === "device" || value === "derived"
    ? value
    : "device";
}

function normalizeIsoTimestamp(value: unknown): string {
  const timestamp = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp)) {
    throw new VaultError("LEGACY_MANIFEST_INVALID", "Legacy manifest importedAt must be a valid timestamp.");
  }
  return new Date(timestamp).toISOString();
}

async function readMigrationVaultMetadata(vaultRoot: string): Promise<Record<string, unknown> & { formatVersion: number }> {
  const raw = JSON.parse(await fs.readFile(resolveVaultPath(vaultRoot, VAULT_LAYOUT.metadata).absolutePath, "utf8"));
  if (!isRecord(raw) || !Number.isInteger(raw.formatVersion) || Number(raw.formatVersion) < 0) {
    throw new VaultError("VAULT_INVALID_METADATA", "Vault metadata requires a non-negative integer formatVersion.");
  }
  return raw as Record<string, unknown> & { formatVersion: number };
}

async function readLegacyVaultMetadata(vaultRoot: string): Promise<Record<string, unknown> & { formatVersion: 1 }> {
  const metadata = await readMigrationVaultMetadata(vaultRoot);
  if (metadata.formatVersion !== LEGACY_VAULT_FORMAT_VERSION) {
    throw new VaultError(
      "VAULT_UNSUPPORTED_FORMAT",
      `Expected legacy vault formatVersion ${LEGACY_VAULT_FORMAT_VERSION}.`,
    );
  }
  for (const key of ["vaultId", "createdAt", "title", "timezone"] as const) {
    if (typeof metadata[key] !== "string" || !(metadata[key] as string).trim()) {
      throw new VaultError("VAULT_INVALID_METADATA", `Legacy vault metadata requires ${key}.`);
    }
  }
  return metadata as Record<string, unknown> & { formatVersion: 1 };
}

async function ensureMissingRequiredDirectories(vaultRoot: string): Promise<string[]> {
  const createdDirectories: string[] = [];
  for (const relativeDirectory of REQUIRED_DIRECTORIES) {
    const directoryPath = resolveVaultPath(vaultRoot, relativeDirectory);
    if (await pathExists(directoryPath.absolutePath)) {
      continue;
    }
    createdDirectories.push(await ensureVaultDirectory(vaultRoot, relativeDirectory));
  }
  return createdDirectories;
}

async function hasLegacyIntegrationFiles(vaultRoot: string): Promise<boolean> {
  return (await walkVaultFiles(vaultRoot, LEGACY_INTEGRATION_ROOT)).length > 0;
}

async function hasLegacyIntegrationEventReferences(vaultRoot: string): Promise<boolean> {
  const relativePaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, { extension: ".jsonl" });
  for (const relativePath of relativePaths.sort()) {
    for await (const { record } of readEventRecordsFromShard(vaultRoot, relativePath)) {
      if (record.rawRefs?.some((rawRef) => rawRef.startsWith(`${LEGACY_INTEGRATION_ROOT}/`))) {
        return true;
      }
    }
  }
  return false;
}

async function removeEmptyLegacyIntegrationDirectories(vaultRoot: string): Promise<void> {
  const root = resolveVaultPath(vaultRoot, LEGACY_INTEGRATION_ROOT).absolutePath;
  if (!(await pathExists(root))) return;
  const removeChildren = async (absoluteDirectory: string): Promise<void> => {
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await removeChildren(path.join(absoluteDirectory, entry.name));
      }
    }
    if (absoluteDirectory !== root) {
      try { await fs.rmdir(absoluteDirectory); } catch { /* non-empty or concurrently reused */ }
    }
  };
  await removeChildren(root);
  try { await fs.rmdir(root); } catch { /* non-empty or absent */ }
}

function emptyFinalizedDetection(): IntegrationIngestMigrationDetection {
  return {
    storedFormatVersion: CURRENT_VAULT_FORMAT_VERSION,
    candidateBundleCount: 0,
    copiedBundleCount: 0,
    detachedBundleCount: 0,
    deletableFileCount: 0,
    sourceBytes: 0,
    journalBytes: 0,
    blockerCount: 0,
    blockersByCode: {},
    blockerExamples: [],
    hasWork: false,
    hasMore: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
