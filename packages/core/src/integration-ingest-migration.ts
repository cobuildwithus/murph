import { promises as fs } from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  CURRENT_VAULT_FORMAT_VERSION,
  eventRecordSchema,
  integrationIngestReceiptSchema,
  safeParseContract,
  type EventRecord,
  type IntegrationIngestReceipt,
  type JsonObject,
  type RawImportManifest,
  type RawImportManifestArtifact,
} from "@murphai/contracts";

import { emitAuditRecord } from "./audit.ts";
import { VAULT_LAYOUT } from "./constants.ts";
import { VaultError } from "./errors.ts";
import { ensureDirectory, pathExists, readJsonFile, walkVaultFiles } from "./fs.ts";
import {
  buildIntegrationIngestAppendPlan,
  buildIntegrationIngestRecord,
  stageIntegrationIngestAppendPlan,
  type IntegrationEvidencePartSeed,
  type IntegrationIngestAppendPlan,
} from "./integration-ingests.ts";
import { readJsonlRecords } from "./jsonl.ts";
import { isRawManifestFileName, parseRawImportManifest } from "./operations/raw-manifests.ts";
import { runCanonicalWrite } from "./operations/write-batch.ts";
import { normalizeRelativeVaultPath, resolveVaultPath } from "./path-safety.ts";
import { statAndHashVaultFile } from "./raw-artifact-integrity.ts";
import { toIsoTimestamp } from "./time.ts";
import { assertValidVault } from "./vault.ts";

interface MigrateIntegrationStorageInput {
  vaultRoot: string;
  apply?: boolean;
  validateAfter?: boolean;
}

export interface IntegrationStorageMigrationResult {
  mode: "dry-run" | "apply";
  mutated: boolean;
  formatVersionBefore: number | null;
  formatVersionAfter: number | null;
  legacyBundleCount: number;
  journalAppendCount: number;
  eventShardRewriteCount: number;
  deletedLegacyFileCount: number;
  blockerCount: number;
  blockers: string[];
  touchedPaths: string[];
  auditPath: string | null;
}

interface VerifiedLegacyArtifact {
  artifact: RawImportManifestArtifact;
  content: string;
  metadata?: Record<string, unknown>;
}

interface VerifiedLegacyBundle {
  accountId?: string;
  deletedPaths: string[];
  evidenceParts: IntegrationEvidencePartSeed[];
  importId: string;
  importedAt: string;
  manifest: RawImportManifest;
  manifestPath: string;
  manifestPaths: string[];
  provider: string;
  receipt?: IntegrationIngestReceipt;
  rawDirectory: string;
  sampleCount: number;
  source: string;
}

interface EventRewritePlan {
  eventOutputsByImportId: Map<string, Map<string, Set<string>>>;
  rewrites: Map<string, string>;
}

interface MigrationPlan {
  appendPlans: IntegrationIngestAppendPlan[];
  blockers: string[];
  deletedLegacyFiles: string[];
  eventRewrites: Map<string, string>;
  formatVersionBefore: number | null;
  formatVersionAfter: number | null;
  journalAppendCount: number;
  legacyBundleCount: number;
  metadataWrite: string | null;
}

interface RawRefMapping {
  importId: string;
  roles: readonly string[];
}

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export async function migrateIntegrationStorage({
  vaultRoot,
  apply = false,
  validateAfter = true,
}: MigrateIntegrationStorageInput): Promise<IntegrationStorageMigrationResult> {
  const plan = await buildIntegrationStorageMigrationPlan(vaultRoot);
  const mode = apply ? "apply" : "dry-run";

  if (!apply || plan.blockers.length > 0 || !planHasWrites(plan)) {
    return {
      mode,
      mutated: false,
      formatVersionBefore: plan.formatVersionBefore,
      formatVersionAfter: plan.formatVersionAfter,
      legacyBundleCount: plan.legacyBundleCount,
      journalAppendCount: plan.journalAppendCount,
      eventShardRewriteCount: plan.eventRewrites.size,
      deletedLegacyFileCount: plan.deletedLegacyFiles.length,
      blockerCount: plan.blockers.length,
      blockers: plan.blockers,
      touchedPaths: [
        ...new Set([
          ...plan.appendPlans.filter((entry) => entry.appended).map((entry) => entry.targetShardPath),
          ...plan.eventRewrites.keys(),
          ...plan.deletedLegacyFiles,
          ...(plan.metadataWrite ? [VAULT_LAYOUT.metadata] : []),
        ]),
      ].sort(),
      auditPath: null,
    };
  }

  const occurredAt = new Date().toISOString();
  const result = await runCanonicalWrite({
    vaultRoot,
    operationType: "integration_storage_migration",
    summary: "Migrate legacy integration raw evidence into integration ingest journal",
    occurredAt,
    mutate: async ({ batch }) => {
      for (const appendPlan of plan.appendPlans) {
        await stageIntegrationIngestAppendPlan(batch, appendPlan);
      }

      for (const [relativePath, content] of plan.eventRewrites) {
        await batch.stageTextWrite(relativePath, content, {
          allowAppendOnlyJsonl: true,
          overwrite: true,
        });
      }

      for (const relativePath of plan.deletedLegacyFiles) {
        await batch.stageDelete(relativePath, {
          allowRaw: true,
        });
      }

      if (plan.metadataWrite) {
        await batch.stageTextWrite(VAULT_LAYOUT.metadata, plan.metadataWrite, {
          overwrite: true,
        });
      }

      const touchedPaths = [
        ...plan.appendPlans.filter((entry) => entry.appended).map((entry) => entry.targetShardPath),
        ...plan.eventRewrites.keys(),
        ...plan.deletedLegacyFiles,
        ...(plan.metadataWrite ? [VAULT_LAYOUT.metadata] : []),
      ].sort();

      const audit = await emitAuditRecord({
        vaultRoot,
        batch,
        action: "vault_migration",
        commandName: "core.migrateIntegrationStorage",
        summary:
          `Migrated ${plan.legacyBundleCount} integration raw bundle(s) into ` +
          `${plan.journalAppendCount} integration ingest journal row(s).`,
        occurredAt,
        files: touchedPaths,
        targetIds: plan.appendPlans.map((entry) => entry.record.id).slice(0, 50),
      });

      return {
        auditPath: audit.relativePath,
        touchedPaths,
      };
    },
  });

  await removeEmptyLegacyIntegrationDirectories(vaultRoot);
  await ensureDirectory(resolveVaultPath(vaultRoot, VAULT_LAYOUT.integrationIngestLedgerDirectory).absolutePath);

  if (validateAfter) {
    await assertValidVault({ vaultRoot });
  }

  return {
    mode,
    mutated: result.touchedPaths.length > 0,
    formatVersionBefore: plan.formatVersionBefore,
    formatVersionAfter: plan.formatVersionAfter,
    legacyBundleCount: plan.legacyBundleCount,
    journalAppendCount: plan.journalAppendCount,
    eventShardRewriteCount: plan.eventRewrites.size,
    deletedLegacyFileCount: plan.deletedLegacyFiles.length,
    blockerCount: 0,
    blockers: [],
    touchedPaths: result.touchedPaths,
    auditPath: result.auditPath,
  };
}

function planHasWrites(plan: MigrationPlan): boolean {
  return plan.appendPlans.some((entry) => entry.appended)
    || plan.eventRewrites.size > 0
    || plan.deletedLegacyFiles.length > 0
    || Boolean(plan.metadataWrite);
}

async function buildIntegrationStorageMigrationPlan(vaultRoot: string): Promise<MigrationPlan> {
  const metadata = await readVaultMetadataLoose(vaultRoot);
  const formatVersionBefore = readFormatVersion(metadata);
  const blockers: string[] = [];
  if (formatVersionBefore !== 1 && formatVersionBefore !== CURRENT_VAULT_FORMAT_VERSION) {
    blockers.push(
      `Vault formatVersion must be 1 or ${CURRENT_VAULT_FORMAT_VERSION} for integration storage migration.`,
    );
  }
  const { bundles, blockers: bundleBlockers, rawFiles } = await readVerifiedLegacyBundles(vaultRoot);
  blockers.push(...bundleBlockers);

  const rawRefMappings = new Map<string, RawRefMapping>();
  const verifiedLegacyFiles = new Set<string>();

  for (const bundle of bundles) {
    for (const deletedPath of bundle.deletedPaths) {
      verifiedLegacyFiles.add(deletedPath);
    }

    const allRoles = bundle.evidenceParts.map((part) => part.role).sort();
    const evidenceRoles = new Set(allRoles);
    for (const manifestPath of bundle.manifestPaths) {
      rawRefMappings.set(manifestPath, {
        importId: bundle.importId,
        roles: allRoles,
      });
    }

    for (const artifact of bundle.manifest.artifacts) {
      if (evidenceRoles.has(artifact.role)) {
        rawRefMappings.set(artifact.relativePath, {
          importId: bundle.importId,
          roles: [artifact.role],
        });
      }
    }
  }

  const rawDirectoriesByImportId = new Map<string, string[]>();
  for (const bundle of bundles) {
    const directories = rawDirectoriesByImportId.get(bundle.importId) ?? [];
    directories.push(bundle.rawDirectory);
    rawDirectoriesByImportId.set(bundle.importId, directories);
  }
  for (const [importId, directories] of rawDirectoriesByImportId) {
    if (directories.length > 1) {
      blockers.push(
        `Legacy integration importId "${importId}" appears in multiple raw integration directories.`,
      );
    }
  }

  const unverifiedRawFiles = rawFiles.filter((relativePath) => !verifiedLegacyFiles.has(relativePath));
  for (const relativePath of unverifiedRawFiles) {
    blockers.push(`Legacy integration file "${relativePath}" is not covered by a verified device manifest.`);
  }

  const eventRewritePlan = await buildEventRewritePlan({
    blockers,
    rawRefMappings,
    vaultRoot,
  });
  const appendPlans: IntegrationIngestAppendPlan[] = [];

  for (const bundle of bundles) {
    const eventOutputs = [...(eventRewritePlan.eventOutputsByImportId.get(bundle.importId) ?? new Map()).entries()]
      .map(([id, roles]) => ({
        id,
        roles: [...roles].sort(),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const record = buildIntegrationIngestRecord({
      id: bundle.importId,
      provider: bundle.provider,
      accountId: bundle.accountId,
      source: bundle.source,
      importedAt: bundle.importedAt,
      receipt: bundle.receipt,
      parts: bundle.evidenceParts,
      outputs: {
        events: eventOutputs,
        sampleIds: [],
        sampleIdsComplete: false,
      },
      counts: {
        eventCount: eventOutputs.length,
        sampleCount: bundle.sampleCount,
      },
      provenance: sanitizeLegacyProvenance(bundle.manifest.provenance),
    });
    appendPlans.push(await buildIntegrationIngestAppendPlan({ record, vaultRoot }));
  }

  const metadataWrite = formatVersionBefore === 1
    ? `${JSON.stringify({ ...metadata, formatVersion: CURRENT_VAULT_FORMAT_VERSION }, null, 2)}\n`
    : null;

  return {
    appendPlans,
    blockers,
    deletedLegacyFiles: [...verifiedLegacyFiles].sort(),
    eventRewrites: eventRewritePlan.rewrites,
    formatVersionBefore,
    formatVersionAfter: CURRENT_VAULT_FORMAT_VERSION,
    journalAppendCount: appendPlans.filter((entry) => entry.appended).length,
    legacyBundleCount: bundles.length,
    metadataWrite,
  };
}

async function readVaultMetadataLoose(vaultRoot: string): Promise<Record<string, unknown>> {
  const metadata = await readJsonFile(vaultRoot, VAULT_LAYOUT.metadata);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new VaultError("VAULT_INVALID_METADATA", "Vault metadata must be a JSON object.");
  }
  return metadata as Record<string, unknown>;
}

function readFormatVersion(metadata: Record<string, unknown>): number | null {
  return typeof metadata.formatVersion === "number" && Number.isInteger(metadata.formatVersion)
    ? metadata.formatVersion
    : null;
}

async function readVerifiedLegacyBundles(vaultRoot: string): Promise<{
  blockers: string[];
  bundles: VerifiedLegacyBundle[];
  rawFiles: string[];
}> {
  const rawFiles = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.rawIntegrationsDirectory);
  const manifestPaths = rawFiles.filter((relativePath) => isRawManifestFileName(path.posix.basename(relativePath)));
  const blockers: string[] = [];
  const bundles: VerifiedLegacyBundle[] = [];
  const manifestPathsByDirectory = new Map<string, string[]>();

  for (const manifestPath of manifestPaths) {
    const directory = path.posix.dirname(manifestPath);
    const existing = manifestPathsByDirectory.get(directory) ?? [];
    existing.push(manifestPath);
    manifestPathsByDirectory.set(directory, existing);
  }

  for (const [rawDirectory, directoryManifestPaths] of [...manifestPathsByDirectory.entries()]
    .sort(([left], [right]) => left.localeCompare(right))) {
    const bundle = await readVerifiedLegacyBundle(vaultRoot, {
      manifestPaths: directoryManifestPaths.sort(),
      rawDirectory,
    }).catch((error: unknown) => {
      blockers.push(error instanceof Error ? error.message : String(error));
      return null;
    });

    if (bundle) {
      bundles.push(bundle);
    }
  }

  return { blockers, bundles, rawFiles };
}

async function readVerifiedLegacyBundle(
  vaultRoot: string,
  input: {
    manifestPaths: string[];
    rawDirectory: string;
  },
): Promise<VerifiedLegacyBundle> {
  const { manifest, manifestPath, manifestPaths, rawDirectory } = await readLegacyManifestGroup(vaultRoot, input);

  const provider = typeof manifest.owner.partition === "string" && manifest.owner.partition.trim()
    ? manifest.owner.partition.trim()
    : readString(manifest.provenance.provider) ?? "unknown";
  const artifacts: VerifiedLegacyArtifact[] = [];

  for (const artifact of manifest.artifacts) {
    const verified = await readVerifiedLegacyArtifact(vaultRoot, rawDirectory, artifact, manifest);
    artifacts.push(verified);
  }

  let receipt: IntegrationIngestReceipt | undefined;
  const evidenceParts: IntegrationEvidencePartSeed[] = [];

  for (const verified of artifacts) {
    const parsedReceipt = parseReceiptPart(verified);
    if (parsedReceipt) {
      if (receipt) {
        throw new VaultError(
          "INTEGRATION_MIGRATION_BLOCKED",
          `Legacy integration manifest "${manifestPath}" contains more than one folded receipt.`,
        );
      }
      receipt = parsedReceipt;
      continue;
    }

    evidenceParts.push({
      role: verified.artifact.role,
      fileName: path.posix.basename(verified.artifact.relativePath),
      mediaType: verified.artifact.mediaType,
      content: verified.content,
      metadata: verified.metadata,
    });
  }

  return {
    accountId: readString(manifest.provenance.accountId),
    deletedPaths: [...manifestPaths, ...manifest.artifacts.map((artifact) => artifact.relativePath)].sort(),
    evidenceParts,
    importId: manifest.importId,
    importedAt: toIsoTimestamp(manifest.importedAt, "importedAt"),
    manifest,
    manifestPath,
    manifestPaths,
    provider,
    receipt,
    rawDirectory,
    sampleCount: readNonNegativeInteger(manifest.provenance.sampleCount) ?? 0,
    source: manifest.source ?? "device",
  };
}

async function readLegacyManifestGroup(
  vaultRoot: string,
  input: {
    manifestPaths: string[];
    rawDirectory: string;
  },
): Promise<{
  manifest: RawImportManifest;
  manifestPath: string;
  manifestPaths: string[];
  rawDirectory: string;
}> {
  const manifestPaths = [...input.manifestPaths].sort();
  const canonicalPath = manifestPaths.includes(path.posix.join(input.rawDirectory, "manifest.json"))
    ? path.posix.join(input.rawDirectory, "manifest.json")
    : manifestPaths[0];

  if (!canonicalPath) {
    throw new VaultError(
      "INTEGRATION_MIGRATION_BLOCKED",
      `Legacy integration directory "${input.rawDirectory}" is missing a manifest.`,
    );
  }

  const parsed = await Promise.all(
    manifestPaths.map(async (manifestPath) => ({
      manifest: parseRawImportManifest(await readJsonFile(vaultRoot, manifestPath)),
      manifestPath,
    })),
  );
  const canonical = parsed.find((entry) => entry.manifestPath === canonicalPath) ?? parsed[0];
  if (!canonical) {
    throw new VaultError(
      "INTEGRATION_MIGRATION_BLOCKED",
      `Legacy integration directory "${input.rawDirectory}" is missing a manifest.`,
    );
  }

  const canonicalFingerprint = stableJsonFingerprint(canonical.manifest);
  for (const entry of parsed) {
    const rawDirectory = normalizeRelativeVaultPath(entry.manifest.rawDirectory);
    if (entry.manifest.importKind !== "device_batch" || entry.manifest.owner.kind !== "device_batch") {
      throw new VaultError(
        "INTEGRATION_MIGRATION_BLOCKED",
        `Legacy integration manifest "${entry.manifestPath}" is not a device_batch manifest.`,
      );
    }

    if (path.posix.dirname(entry.manifestPath) !== rawDirectory) {
      throw new VaultError(
        "INTEGRATION_MIGRATION_BLOCKED",
        `Legacy integration manifest "${entry.manifestPath}" does not live in its rawDirectory.`,
      );
    }

    if (rawDirectory !== input.rawDirectory || stableJsonFingerprint(entry.manifest) !== canonicalFingerprint) {
      throw new VaultError(
        "INTEGRATION_MIGRATION_BLOCKED",
        `Legacy integration directory "${input.rawDirectory}" has conflicting manifests.`,
      );
    }
  }

  return {
    manifest: canonical.manifest,
    manifestPath: canonical.manifestPath,
    manifestPaths,
    rawDirectory: normalizeRelativeVaultPath(canonical.manifest.rawDirectory),
  };
}

async function readVerifiedLegacyArtifact(
  vaultRoot: string,
  rawDirectory: string,
  artifact: RawImportManifestArtifact,
  manifest: RawImportManifest,
): Promise<VerifiedLegacyArtifact> {
  if (path.posix.dirname(artifact.relativePath) !== rawDirectory) {
    throw new VaultError(
      "INTEGRATION_MIGRATION_BLOCKED",
      `Legacy integration artifact "${artifact.relativePath}" is outside "${rawDirectory}".`,
    );
  }

  const integrity = await statAndHashVaultFile(vaultRoot, artifact.relativePath);
  if (!integrity) {
    throw new VaultError(
      "INTEGRATION_MIGRATION_BLOCKED",
      `Legacy integration artifact "${artifact.relativePath}" is missing.`,
    );
  }

  if (integrity.byteSize !== artifact.byteSize || integrity.sha256 !== artifact.sha256) {
    throw new VaultError(
      "INTEGRATION_MIGRATION_BLOCKED",
      `Legacy integration artifact "${artifact.relativePath}" bytes or sha256 do not match its manifest.`,
    );
  }

  const bytes = await fs.readFile(resolveVaultPath(vaultRoot, artifact.relativePath).absolutePath);
  let content: string;
  try {
    content = UTF8_DECODER.decode(bytes);
  } catch {
    throw new VaultError(
      "INTEGRATION_MIGRATION_BLOCKED",
      `Legacy integration artifact "${artifact.relativePath}" is not valid UTF-8.`,
    );
  }

  return {
    artifact,
    content,
    metadata: findLegacyArtifactMetadata(manifest, artifact.role),
  };
}

function parseReceiptPart(verified: VerifiedLegacyArtifact): IntegrationIngestReceipt | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(verified.content);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  if (candidate.schemaVersion !== "wearable.raw_ingest_receipt.v1") {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(candidate, "payload")) {
    throw new VaultError(
      "INTEGRATION_MIGRATION_BLOCKED",
      `Legacy receipt artifact "${verified.artifact.relativePath}" still contains a raw payload.`,
    );
  }

  const result = safeParseContract(integrationIngestReceiptSchema, candidate);
  if (!result.success) {
    throw new VaultError(
      "INTEGRATION_MIGRATION_BLOCKED",
      `Legacy receipt artifact "${verified.artifact.relativePath}" is invalid: ${result.errors.join("; ")}.`,
    );
  }

  return result.data;
}

async function buildEventRewritePlan(input: {
  blockers: string[];
  rawRefMappings: ReadonlyMap<string, RawRefMapping>;
  vaultRoot: string;
}): Promise<EventRewritePlan> {
  const eventOutputsByImportId = new Map<string, Map<string, Set<string>>>();
  const rewrites = new Map<string, string>();
  const eventShardPaths = await walkVaultFiles(input.vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });

  for (const relativePath of eventShardPaths) {
    let rows: unknown[];
    try {
      rows = await readJsonlRecords({ vaultRoot: input.vaultRoot, relativePath });
    } catch {
      if (input.rawRefMappings.size > 0) {
        input.blockers.push(
          `Event shard "${relativePath}" is not parseable while legacy integration raw evidence exists.`,
        );
      }
      continue;
    }
    let changed = false;
    const nextRows: unknown[] = [];

    for (const row of rows) {
      const result = safeParseContract(eventRecordSchema, row);
      if (!result.success) {
        for (const rawRef of readLegacyIntegrationRawRefs(row)) {
          input.blockers.push(
            `Invalid event row in "${relativePath}" references legacy integration raw path "${rawRef}".`,
          );
        }
        nextRows.push(row as EventRecord);
        continue;
      }

      const record = result.data;
      const rawRefs = Array.isArray(record.rawRefs) ? record.rawRefs : [];
      if (rawRefs.length === 0) {
        nextRows.push(record);
        continue;
      }

      const nextRawRefs: string[] = [];
      for (const rawRef of rawRefs) {
        const mapping = input.rawRefMappings.get(rawRef);
        if (!mapping) {
          if (isLegacyIntegrationRawPath(rawRef)) {
            input.blockers.push(`Event "${record.id}" references unverified legacy integration raw path "${rawRef}".`);
          }
          nextRawRefs.push(rawRef);
          continue;
        }

        changed = true;
        const eventOutputs = eventOutputsByImportId.get(mapping.importId) ?? new Map<string, Set<string>>();
        const roles = eventOutputs.get(record.id) ?? new Set<string>();
        for (const role of mapping.roles) {
          roles.add(role);
        }
        eventOutputs.set(record.id, roles);
        eventOutputsByImportId.set(mapping.importId, eventOutputs);
      }

      const nextRecord = nextRawRefs.length > 0
        ? { ...record, rawRefs: nextRawRefs }
        : omitRawRefs(record);
      const nextResult = safeParseContract(eventRecordSchema, nextRecord);
      if (!nextResult.success) {
        input.blockers.push(`Event "${record.id}" could not be detached from legacy integration rawRefs.`);
        nextRows.push(record);
        continue;
      }

      nextRows.push(nextResult.data);
    }

    if (changed) {
      rewrites.set(relativePath, `${nextRows.map((record) => JSON.stringify(record)).join("\n")}\n`);
    }
  }

  return { eventOutputsByImportId, rewrites };
}

function readLegacyIntegrationRawRefs(record: unknown): string[] {
  if (!isRecord(record) || !Array.isArray(record.rawRefs)) {
    return [];
  }

  return record.rawRefs.filter((rawRef): rawRef is string =>
    typeof rawRef === "string" && isLegacyIntegrationRawPath(rawRef),
  );
}

function omitRawRefs(record: EventRecord): EventRecord {
  const { rawRefs: _rawRefs, ...rest } = record;
  return rest as EventRecord;
}

function isLegacyIntegrationRawPath(relativePath: string): boolean {
  return relativePath === VAULT_LAYOUT.rawIntegrationsDirectory
    || relativePath.startsWith(`${VAULT_LAYOUT.rawIntegrationsDirectory}/`);
}

function findLegacyArtifactMetadata(manifest: RawImportManifest, role: string): Record<string, unknown> | undefined {
  const rawArtifacts: unknown[] = Array.isArray(manifest.provenance.rawArtifacts)
    ? [...manifest.provenance.rawArtifacts]
    : [];
  let match: Record<string, unknown> | undefined;
  for (const entry of rawArtifacts) {
    if (isRecord(entry) && entry.role === role) {
      match = entry;
      break;
    }
  }
  const metadata = match && isRecord(match.metadata) ? match.metadata : undefined;
  return metadata && Object.keys(metadata).length > 0 ? metadata : undefined;
}

function sanitizeLegacyProvenance(value: JsonObject): Record<string, unknown> {
  const { rawArtifacts: _rawArtifacts, ...rest } = value;
  return rest;
}

function stableJsonFingerprint(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJsonFingerprint(entry)).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJsonFingerprint(value[key])}`
    ).join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

async function removeEmptyLegacyIntegrationDirectories(vaultRoot: string): Promise<void> {
  const root = resolveVaultPath(vaultRoot, VAULT_LAYOUT.rawIntegrationsDirectory).absolutePath;
  if (!(await pathExists(root))) {
    return;
  }

  async function removeEmptyDirectory(absolutePath: string): Promise<boolean> {
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    let hasContent = false;

    for (const entry of entries) {
      const child = path.join(absolutePath, entry.name);
      if (entry.isDirectory()) {
        const removed = await removeEmptyDirectory(child);
        hasContent = hasContent || !removed;
      } else {
        hasContent = true;
      }
    }

    if (hasContent) {
      return false;
    }

    await fs.rmdir(absolutePath);
    return true;
  }

  await removeEmptyDirectory(root);
}
