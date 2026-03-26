import path from "node:path";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";

import { resolveAssistantStatePaths } from "./assistant-state.js";

import type { HostedExecutionBundleKind } from "./hosted-execution.js";

const HOSTED_BUNDLE_SCHEMA = "healthybob.hosted-bundle.v1";

interface HostedBundleArchiveFile {
  contentsBase64: string;
  path: string;
}

interface HostedBundleArchive {
  files: HostedBundleArchiveFile[];
  kind: HostedExecutionBundleKind;
  schema: typeof HOSTED_BUNDLE_SCHEMA;
}

export async function snapshotHostedExecutionContext(input: {
  vaultRoot: string;
}): Promise<{
  agentStateBundle: Uint8Array | null;
  vaultBundle: Uint8Array;
}> {
  const vaultRoot = path.resolve(input.vaultRoot);
  const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
  const vaultBundle = await snapshotBundleTree({
    kind: "vault",
    root: vaultRoot,
    shouldIncludeRelativePath(relativePath) {
      return !shouldSkipVaultRelativePath(relativePath);
    },
  });

  if (vaultBundle === null) {
    throw new Error(`Hosted vault bundle could not be created for ${vaultRoot}.`);
  }

  return {
    agentStateBundle: await snapshotBundleTree({
      kind: "agent-state",
      optional: true,
      root: assistantStateRoot,
      shouldIncludeRelativePath: () => true,
    }),
    vaultBundle,
  };
}

export async function restoreHostedExecutionContext(input: {
  agentStateBundle?: Uint8Array | ArrayBuffer | null;
  vaultBundle?: Uint8Array | ArrayBuffer | null;
  workspaceRoot: string;
}): Promise<{
  assistantStateRoot: string;
  vaultRoot: string;
}> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const vaultRoot = path.join(workspaceRoot, "vault");
  const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;

  await mkdir(vaultRoot, { recursive: true });
  await mkdir(assistantStateRoot, { recursive: true });

  if (input.vaultBundle) {
    await restoreBundleTree({
      bytes: input.vaultBundle,
      expectedKind: "vault",
      root: vaultRoot,
    });
  }

  if (input.agentStateBundle) {
    await restoreBundleTree({
      bytes: input.agentStateBundle,
      expectedKind: "agent-state",
      root: assistantStateRoot,
    });
  }

  return {
    assistantStateRoot,
    vaultRoot,
  };
}

async function snapshotBundleTree(input: {
  kind: HostedExecutionBundleKind;
  optional?: boolean;
  root: string;
  shouldIncludeRelativePath: (relativePath: string) => boolean;
}): Promise<Uint8Array | null> {
  if (!(await directoryExists(input.root))) {
    if (input.optional) {
      return null;
    }

    throw new Error(`Hosted bundle root does not exist: ${input.root}`);
  }

  const files = await collectBundleFiles(input.root, input.shouldIncludeRelativePath);
  const archive: HostedBundleArchive = {
    files,
    kind: input.kind,
    schema: HOSTED_BUNDLE_SCHEMA,
  };

  return gzipSync(Buffer.from(JSON.stringify(archive), "utf8"));
}

async function restoreBundleTree(input: {
  bytes: Uint8Array | ArrayBuffer;
  expectedKind: HostedExecutionBundleKind;
  root: string;
}): Promise<void> {
  const archive = parseHostedBundleArchive(input.bytes);

  if (archive.kind !== input.expectedKind) {
    throw new Error(
      `Hosted bundle kind mismatch: expected ${input.expectedKind}, got ${archive.kind}.`,
    );
  }

  for (const file of archive.files) {
    const absolutePath = path.join(input.root, file.path);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(file.contentsBase64, "base64"));
  }
}

function parseHostedBundleArchive(bytes: Uint8Array | ArrayBuffer): HostedBundleArchive {
  const buffer = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
  const parsed = JSON.parse(gunzipSync(buffer).toString("utf8")) as Partial<HostedBundleArchive>;

  if (parsed.schema !== HOSTED_BUNDLE_SCHEMA || !Array.isArray(parsed.files)) {
    throw new Error("Hosted bundle archive is invalid.");
  }

  if (parsed.kind !== "vault" && parsed.kind !== "agent-state") {
    throw new Error("Hosted bundle archive kind is invalid.");
  }

  return {
    files: parsed.files.map((file) => {
      if (!file || typeof file.path !== "string" || typeof file.contentsBase64 !== "string") {
        throw new Error("Hosted bundle archive contains an invalid file entry.");
      }

      return {
        contentsBase64: file.contentsBase64,
        path: file.path,
      };
    }),
    kind: parsed.kind,
    schema: HOSTED_BUNDLE_SCHEMA,
  };
}

async function collectBundleFiles(
  root: string,
  shouldIncludeRelativePath: (relativePath: string) => boolean,
  relativeDirectory = "",
): Promise<HostedBundleArchiveFile[]> {
  const directoryPath = relativeDirectory ? path.join(root, relativeDirectory) : root;
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files: HostedBundleArchiveFile[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = relativeDirectory
      ? path.posix.join(relativeDirectory.split(path.sep).join(path.posix.sep), entry.name)
      : entry.name;

    if (!shouldIncludeRelativePath(relativePath)) {
      continue;
    }

    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectBundleFiles(root, shouldIncludeRelativePath, path.join(relativeDirectory, entry.name))));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    files.push({
      contentsBase64: (await readFile(absolutePath)).toString("base64"),
      path: relativePath,
    });
  }

  return files;
}

function shouldSkipVaultRelativePath(relativePath: string): boolean {
  return (
    relativePath === ".git"
    || relativePath.startsWith(`.git${path.posix.sep}`)
    || relativePath === ".runtime"
    || relativePath.startsWith(`.runtime${path.posix.sep}`)
    || relativePath === "exports/packs"
    || relativePath.startsWith(`exports/packs${path.posix.sep}`)
    || path.posix.basename(relativePath) === ".env"
    || path.posix.basename(relativePath).startsWith(".env.")
  );
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    return (await stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}
