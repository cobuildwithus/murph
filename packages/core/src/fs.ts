import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { promises as fs } from "node:fs";

import { VaultError } from "./errors.js";
import {
  assertPathWithinVaultOnDisk,
  normalizeVaultRoot,
  normalizeRelativeVaultPath,
  resolveVaultPath,
} from "./path-safety.js";
import {
  applyImmutableWriteTarget,
  applyJsonlAppendTarget,
  applyTextWriteTarget,
  fileContentsEqual,
  prepareVerifiedWriteTarget,
} from "./write-policy.js";

import { isErrnoException } from "./types.js";

interface WriteVaultTextFileOptions {
  overwrite?: boolean;
}

interface ImmutableRawWriteOptions {
  allowExistingMatch?: boolean;
}

interface WalkVaultFilesOptions {
  extension?: string | null;
}

export async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export async function ensureDirectory(absolutePath: string): Promise<void> {
  await fs.mkdir(absolutePath, { recursive: true });
}

export async function ensureVaultDirectory(vaultRoot: string, relativePath: string): Promise<string> {
  const resolved = resolveVaultPath(vaultRoot, relativePath);
  await assertPathWithinVaultOnDisk(resolved.vaultRoot, resolved.absolutePath);
  await ensureDirectory(resolved.absolutePath);
  await assertPathWithinVaultOnDisk(resolved.vaultRoot, resolved.absolutePath);
  return resolved.relativePath;
}

export async function readUtf8File(vaultRoot: string, relativePath: string): Promise<string> {
  const resolved = resolveVaultPath(vaultRoot, relativePath);
  await assertPathWithinVaultOnDisk(resolved.vaultRoot, resolved.absolutePath);

  try {
    return await fs.readFile(resolved.absolutePath, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new VaultError("VAULT_FILE_MISSING", `Missing required file "${resolved.relativePath}".`, {
        relativePath: resolved.relativePath,
      });
    }

    throw error;
  }
}

export async function readJsonFile(vaultRoot: string, relativePath: string): Promise<unknown> {
  const resolved = resolveVaultPath(vaultRoot, relativePath);
  const content = await readUtf8File(vaultRoot, resolved.relativePath);

  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new VaultError("VAULT_INVALID_JSON", `Invalid JSON in "${resolved.relativePath}".`, {
      relativePath: resolved.relativePath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function writeVaultTextFile(
  vaultRoot: string,
  relativePath: string,
  content: string,
  options: WriteVaultTextFileOptions = {},
): Promise<string> {
  const overwrite = options.overwrite ?? true;
  const resolved = await prepareVerifiedWriteTarget(vaultRoot, relativePath, {
    kind: "text",
    messages: {
      appendOnlyDisallowed: "Use appendJsonlRecord for ledger and audit shards.",
      rawDisallowed: "Use copyRawArtifact for raw writes.",
    },
  });
  await applyTextWriteTarget({
    createTarget: () =>
      fs.writeFile(resolved.absolutePath, content, {
        encoding: "utf8",
        flag: "wx",
      }),
    matchesExistingContent: async () => {
      const existingContent = await fs.readFile(resolved.absolutePath, "utf8");
      return existingContent === content;
    },
    overwrite,
    replaceTarget: () =>
      fs.writeFile(resolved.absolutePath, content, {
        encoding: "utf8",
        flag: "w",
      }),
    target: resolved,
  });

  return resolved.relativePath;
}

export async function writeVaultJsonFile(
  vaultRoot: string,
  relativePath: string,
  value: unknown,
  options: WriteVaultTextFileOptions = {},
): Promise<string> {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  return writeVaultTextFile(vaultRoot, relativePath, content, options);
}

export async function appendVaultTextFile(
  vaultRoot: string,
  relativePath: string,
  content: string,
): Promise<string> {
  const resolved = await prepareVerifiedWriteTarget(vaultRoot, relativePath, {
    kind: "jsonl_append",
    messages: {
      appendOnlyDisallowed: "Append-only writes are restricted to JSONL ledger and audit shards.",
      rawDisallowed: "Raw files are immutable once written.",
    },
  });
  await applyJsonlAppendTarget({
    appendPayload: (payload) => fs.appendFile(resolved.absolutePath, payload, "utf8"),
    readPayload: async () => content,
    target: resolved,
  });

  return resolved.relativePath;
}

export async function copyImmutableFileIntoVaultRaw(
  vaultRoot: string,
  sourcePath: string,
  relativePath: string,
  options: ImmutableRawWriteOptions = {},
): Promise<string> {
  const sourceAbsolutePath = path.resolve(String(sourcePath ?? "").trim());

  if (!(await pathExists(sourceAbsolutePath))) {
    throw new VaultError("VAULT_SOURCE_MISSING", "Raw source file does not exist.");
  }

  const sourceStats = await fs.stat(sourceAbsolutePath);

  if (!sourceStats.isFile()) {
    throw new VaultError("VAULT_SOURCE_INVALID", "Raw source path must point to a file.");
  }

  const resolved = await prepareVerifiedWriteTarget(vaultRoot, relativePath, {
    kind: "raw",
    messages: {
      rawRequired: "Raw copies must target the raw/ tree.",
    },
  });
  await applyImmutableWriteTarget({
    allowExistingMatch: options.allowExistingMatch,
    createEffect: "copy",
    createTarget: () => fs.copyFile(sourceAbsolutePath, resolved.absolutePath, fsConstants.COPYFILE_EXCL),
    existsErrorMessage: "Raw target already exists and may not be overwritten.",
    matchesExistingContent: () => fileContentsEqual(sourceAbsolutePath, resolved.absolutePath),
    target: resolved,
  });

  return resolved.relativePath;
}

export async function writeImmutableJsonFileIntoVaultRaw(
  vaultRoot: string,
  relativePath: string,
  value: unknown,
  options: ImmutableRawWriteOptions = {},
): Promise<string> {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const resolved = await prepareVerifiedWriteTarget(vaultRoot, relativePath, {
    kind: "raw",
    messages: {
      rawRequired: "Raw writes must target the raw/ tree.",
    },
  });
  await applyImmutableWriteTarget({
    allowExistingMatch: options.allowExistingMatch,
    createTarget: () =>
      fs.writeFile(resolved.absolutePath, content, {
        encoding: "utf8",
        flag: "wx",
      }),
    existsErrorMessage: "Raw target already exists and may not be overwritten.",
    matchesExistingContent: async () => {
      const existingContent = await fs.readFile(resolved.absolutePath, "utf8");
      return existingContent === content;
    },
    target: resolved,
  });

  return resolved.relativePath;
}

export async function walkVaultFiles(
  vaultRoot: string,
  relativeDirectory: string,
  options: WalkVaultFilesOptions = {},
): Promise<string[]> {
  const absoluteRoot = normalizeVaultRoot(vaultRoot);
  const resolved = resolveVaultPath(vaultRoot, relativeDirectory);
  const extension = options.extension ?? null;
  const matches: string[] = [];

  if (!(await pathExists(resolved.absolutePath))) {
    return matches;
  }

  await assertPathWithinVaultOnDisk(absoluteRoot, resolved.absolutePath);

  async function walk(currentAbsolutePath: string): Promise<void> {
    const entries = await fs.readdir(currentAbsolutePath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const nextAbsolutePath = path.join(currentAbsolutePath, entry.name);

      if (entry.isDirectory()) {
        await walk(nextAbsolutePath);
        continue;
      }

      if (extension && !entry.name.endsWith(extension)) {
        continue;
      }

      const nextRelativePath = path
        .relative(absoluteRoot, nextAbsolutePath)
        .split(path.sep)
        .join("/");

      matches.push(normalizeRelativeVaultPath(nextRelativePath));
    }
  }

  await walk(resolved.absolutePath);
  return matches;
}
