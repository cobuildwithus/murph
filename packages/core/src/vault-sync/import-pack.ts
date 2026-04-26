import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  VAULT_FRONTMATTER_FAMILIES,
  VAULT_JSON_VALIDATION_FAMILIES,
} from "@murphai/contracts";
import {
  restoreHostedBundleRoots,
  snapshotHostedBundleRoots,
  type HostedBundleArtifactRef,
  type HostedBundleArtifactSnapshotInput,
} from "@murphai/runtime-state/node";

import { VAULT_LAYOUT, VAULT_SCHEMA_VERSION } from "../constants.ts";
import { VaultError } from "../errors.ts";
import { normalizeRelativeVaultPath, resolveVaultPath } from "../path-safety.ts";
import {
  IMPORT_PACK_MANIFEST_PATH,
  IMPORT_PACK_META_ROOT_KEY,
  IMPORT_PACK_VAULT_ROOT_KEY,
  SYNC_IMPORT_ROOT,
  VAULT_SYNC_IMPORT_BUNDLE_KIND,
  VAULT_SYNC_IMPORT_MANIFEST_SCHEMA,
  type BuildVaultSyncImportPackInput,
  type BuildVaultSyncImportPackResult,
  type RestoreVaultSyncImportPackInput,
  type RestoreVaultSyncImportPackResult,
  type VaultSyncImportFileKind,
  type VaultSyncImportManifest,
  type VaultSyncImportManifestExcludedFile,
  type VaultSyncImportManifestFile,
  type VaultSyncSourceVaultMetadata,
} from "./types.ts";

const JSONL_EXTENSION = ".jsonl";

type JsonPrimitive = string | number | boolean | null;
type JsonObject = { [key: string]: JsonValue };
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry));
  }

  if (!isPlainObject(value)) {
    return String(value);
  }

  const output: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (typeof entry === "undefined" || typeof entry === "function" || typeof entry === "symbol") {
      continue;
    }
    output[key] = toJsonValue(entry);
  }
  return output;
}

function stableJson(value: unknown): string {
  return JSON.stringify(toJsonValue(value));
}

function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Prefixed(bytes: Uint8Array | string): string {
  return `sha256:${sha256Hex(bytes)}`;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function readFileIfExists(absolutePath: string): Promise<Uint8Array | null> {
  try {
    return await readFile(absolutePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readJsonObjectIfExists(absolutePath: string): Promise<Record<string, unknown> | null> {
  const bytes = await readFileIfExists(absolutePath);
  if (!bytes) {
    return null;
  }

  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  return isPlainObject(parsed) ? parsed : null;
}

function stringField(value: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (!value) {
    return null;
  }

  for (const key of keys) {
    const entry = value[key];
    if (typeof entry === "string" && entry.trim().length > 0) {
      return entry;
    }
  }

  return null;
}

export async function readSourceVaultMetadata(vaultRoot: string): Promise<VaultSyncSourceVaultMetadata> {
  const metadata = await readJsonObjectIfExists(path.join(vaultRoot, VAULT_LAYOUT.metadata));
  return {
    schemaVersion: stringField(metadata, ["schemaVersion", "vaultSchemaVersion"]) ?? VAULT_SCHEMA_VERSION,
    title: stringField(metadata, ["title", "name"]),
    vaultId: stringField(metadata, ["vaultId", "id"]),
  };
}

function startsWithPath(relativePath: string, prefix: string): boolean {
  return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
}

function isExcludedLocalPath(relativePath: string): string | null {
  if (startsWithPath(relativePath, SYNC_IMPORT_ROOT)) {
    return "previous_sync_import";
  }

  if (startsWithPath(relativePath, VAULT_LAYOUT.auditDirectory)) {
    return "local_audit_history";
  }

  if (
    relativePath.split("/").some((segment) => segment === ".env" || segment.startsWith(".env."))
    || relativePath === ".git"
    || startsWithPath(relativePath, ".git")
    || relativePath === "node_modules"
    || startsWithPath(relativePath, "node_modules")
    || relativePath === ".runtime"
    || startsWithPath(relativePath, ".runtime")
    || relativePath === "derived"
    || startsWithPath(relativePath, "derived")
    || startsWithPath(relativePath, VAULT_LAYOUT.exportPacksDirectory)
    || startsWithPath(relativePath, "dist")
    || startsWithPath(relativePath, "build")
    || startsWithPath(relativePath, "coverage")
  ) {
    return "local_or_rebuildable_state";
  }

  return null;
}

function isImportableJsonlLedgerPath(relativePath: string): boolean {
  return relativePath.endsWith(JSONL_EXTENSION) && (
    startsWithPath(relativePath, VAULT_LAYOUT.assessmentLedgerDirectory)
    || startsWithPath(relativePath, VAULT_LAYOUT.eventLedgerDirectory)
    || startsWithPath(relativePath, VAULT_LAYOUT.sampleLedgerDirectory)
    || startsWithPath(relativePath, VAULT_LAYOUT.inboxCaptureLedgerDirectory)
  );
}

function isImportableValidatedTextPath(relativePath: string): boolean {
  return VAULT_FRONTMATTER_FAMILIES.some((family) =>
    family.storageKind === "singleton-file"
      ? family.relativePath === relativePath
      : relativePath.endsWith(family.fileExtension) && startsWithPath(relativePath, family.directory)
  ) || VAULT_JSON_VALIDATION_FAMILIES.some((family) => family.relativePath === relativePath);
}

export function classifyImportFile(relativePath: string): VaultSyncImportFileKind | null {
  if (isExcludedLocalPath(relativePath)) {
    return null;
  }

  if (relativePath === VAULT_LAYOUT.metadata) {
    return "metadata";
  }

  if (startsWithPath(relativePath, VAULT_LAYOUT.rawDirectory)) {
    return "raw";
  }

  if (isImportableJsonlLedgerPath(relativePath)) {
    return "jsonl_ledger";
  }

  if (isImportableValidatedTextPath(relativePath)) {
    return "text";
  }

  return null;
}

export async function listVaultFiles(vaultRoot: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(directory: string, baseRelativePath: string): Promise<void> {
    let entries: Array<{
      isDirectory(): boolean;
      isFile(): boolean;
      isSymbolicLink(): boolean;
      name: string | Buffer;
    }>;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const entryName = String(entry.name);
      const relativePath = baseRelativePath ? `${baseRelativePath}/${entryName}` : entryName;
      const normalized = normalizeRelativeVaultPath(relativePath);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(path.join(directory, entryName), normalized);
        continue;
      }
      if (entry.isFile()) {
        files.push(normalized);
      }
    }
  }

  await walk(vaultRoot, "");
  return files.sort();
}

export function buildManifestHashInput(input: Omit<VaultSyncImportManifest, "manifestHash">): string {
  return stableJson(input);
}

export function artifactRefForBytes(bytes: Uint8Array): HostedBundleArtifactRef {
  return {
    byteSize: bytes.byteLength,
    sha256: sha256Hex(bytes),
  };
}

function buildIncludedPathPrefixSet(paths: Iterable<string>): Set<string> {
  const prefixes = new Set<string>();
  for (const includedPath of paths) {
    const parts = includedPath.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      prefixes.add(parts.slice(0, index).join("/"));
    }
  }
  return prefixes;
}

export function shouldExternalizeImportPackFile(input: HostedBundleArtifactSnapshotInput): boolean {
  return input.root === IMPORT_PACK_VAULT_ROOT_KEY
    && startsWithPath(input.path, VAULT_LAYOUT.rawDirectory)
    && input.bytes.byteLength >= 256 * 1024;
}

export async function buildVaultSyncImportPack(
  input: BuildVaultSyncImportPackInput,
): Promise<BuildVaultSyncImportPackResult> {
  const { vaultRoot } = resolveVaultPath(input.vaultRoot, VAULT_LAYOUT.metadata);
  const createdAt = (input.now ?? new Date()).toISOString();
  const sourceVault = await readSourceVaultMetadata(vaultRoot);
  const files = await listVaultFiles(vaultRoot);
  const included = new Map<string, VaultSyncImportFileKind>();
  const manifestFiles: VaultSyncImportManifestFile[] = [];
  const excludedByReason = new Map<string, number>();

  for (const relativePath of files) {
    const explicitExclusion = isExcludedLocalPath(relativePath);
    const kind = classifyImportFile(relativePath);
    if (!kind || explicitExclusion) {
      const reason = explicitExclusion ?? "not_canonical_sync_input";
      excludedByReason.set(reason, (excludedByReason.get(reason) ?? 0) + 1);
      continue;
    }

    const absolutePath = path.join(vaultRoot, relativePath);
    const bytes = await readFile(absolutePath);
    included.set(relativePath, kind);
    manifestFiles.push({
      bytes: bytes.byteLength,
      kind,
      path: relativePath,
      sha256: sha256Prefixed(bytes),
    });
  }

  const manifestBase = {
    createdAt,
    excluded: [...excludedByReason.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([reason, count]): VaultSyncImportManifestExcludedFile => ({ count, reason })),
    files: manifestFiles,
    schema: VAULT_SYNC_IMPORT_MANIFEST_SCHEMA,
    sourceVault,
  } satisfies Omit<VaultSyncImportManifest, "manifestHash">;
  const manifestHash = sha256Prefixed(buildManifestHashInput(manifestBase));
  const manifest: VaultSyncImportManifest = {
    ...manifestBase,
    manifestHash,
  };

  const includedPrefixes = buildIncludedPathPrefixSet(included.keys());
  const metaRoot = await mkdtemp(path.join(tmpdir(), "murph-vault-sync-meta-"));
  try {
    await writeFile(path.join(metaRoot, IMPORT_PACK_MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const bundle = await snapshotHostedBundleRoots({
      externalizeFile: input.artifactSink
        ? async (artifactInput) => {
            if (!shouldExternalizeImportPackFile(artifactInput)) {
              return null;
            }
            const ref = artifactRefForBytes(artifactInput.bytes);
            await input.artifactSink?.({
              ...artifactInput,
              ref,
            });
            return ref;
          }
        : undefined,
      kind: VAULT_SYNC_IMPORT_BUNDLE_KIND,
      roots: [
        {
          root: vaultRoot,
          rootKey: IMPORT_PACK_VAULT_ROOT_KEY,
          shouldIncludeRelativePath: (relativePath) => {
            const normalized = normalizeRelativeVaultPath(relativePath);
            return included.has(normalized) || includedPrefixes.has(normalized);
          },
        },
        {
          root: metaRoot,
          rootKey: IMPORT_PACK_META_ROOT_KEY,
        },
      ],
    });

    if (!bundle) {
      throw new VaultError("VAULT_SYNC_IMPORT_EMPTY", "Vault sync import pack did not include any roots.");
    }

    return {
      bundle,
      manifest,
      manifestHash,
      sourceSchemaVersion: sourceVault.schemaVersion,
      sourceVaultId: sourceVault.vaultId,
      sourceVaultTitle: sourceVault.title,
    };
  } finally {
    await rm(metaRoot, { force: true, recursive: true });
  }
}

export async function restoreVaultSyncImportPack(
  input: RestoreVaultSyncImportPackInput,
): Promise<RestoreVaultSyncImportPackResult> {
  const workspaceRoot = input.workspaceRoot ?? await mkdtemp(path.join(tmpdir(), "murph-vault-sync-import-"));
  const vaultRoot = path.join(workspaceRoot, "vault");
  const metaRoot = path.join(workspaceRoot, "meta");
  await mkdir(vaultRoot, { recursive: true });
  await mkdir(metaRoot, { recursive: true });

  await restoreHostedBundleRoots({
    artifactResolver: input.artifactResolver,
    bytes: input.bundle,
    expectedKind: VAULT_SYNC_IMPORT_BUNDLE_KIND,
    roots: {
      [IMPORT_PACK_META_ROOT_KEY]: metaRoot,
      [IMPORT_PACK_VAULT_ROOT_KEY]: vaultRoot,
    },
  });

  return {
    cleanup: async () => {
      if (!input.workspaceRoot) {
        await rm(workspaceRoot, { force: true, recursive: true });
      }
    },
    metaRoot,
    vaultRoot,
    workspaceRoot,
  };
}
