import path from "node:path";
import { promises as fs } from "node:fs";

import { VaultError } from "./errors.js";
import { isErrnoException } from "./types.js";

const WINDOWS_DRIVE_PREFIX_PATTERN = /^[A-Za-z]:/;

function toVaultRelativeDisplayPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function normalizeVaultRoot(vaultRoot: unknown): string {
  const candidate = String(vaultRoot ?? "").trim();

  if (!candidate) {
    throw new VaultError("VAULT_INVALID_ROOT", "Vault root is required.");
  }

  return path.resolve(candidate);
}

export function normalizeRelativeVaultPath(relativePath: unknown): string {
  const candidate = String(relativePath ?? "").trim().replace(/\\/g, "/");

  if (!candidate) {
    throw new VaultError("VAULT_INVALID_PATH", "Vault-relative path is required.");
  }

  if (candidate.includes("\u0000")) {
    throw new VaultError("VAULT_INVALID_PATH", "Vault-relative path may not contain NUL bytes.", {
      relativePath: String(relativePath ?? ""),
    });
  }

  if (WINDOWS_DRIVE_PREFIX_PATTERN.test(candidate) || path.posix.isAbsolute(candidate)) {
    throw new VaultError("VAULT_INVALID_PATH", "Vault-relative path must not be absolute.", {
      relativePath: String(relativePath ?? ""),
    });
  }

  const normalized = path.posix.normalize(candidate);

  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new VaultError("VAULT_INVALID_PATH", "Vault-relative path may not escape the vault root.", {
      relativePath: String(relativePath ?? ""),
      normalized,
    });
  }

  return normalized;
}

export function resolveVaultPath(vaultRoot: unknown, relativePath: unknown): {
  vaultRoot: string;
  relativePath: string;
  absolutePath: string;
} {
  const absoluteRoot = normalizeVaultRoot(vaultRoot);
  const normalizedRelativePath = normalizeRelativeVaultPath(relativePath);
  const absolutePath = path.resolve(absoluteRoot, normalizedRelativePath);
  assertPathWithinVault(absoluteRoot, absolutePath);

  return {
    vaultRoot: absoluteRoot,
    relativePath: normalizedRelativePath,
    absolutePath,
  };
}

export function assertPathWithinVault(vaultRoot: unknown, absolutePath: unknown): void {
  const absoluteRoot = normalizeVaultRoot(vaultRoot);
  const candidate = path.resolve(String(absolutePath ?? ""));
  const relative = path.relative(absoluteRoot, candidate);

  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    WINDOWS_DRIVE_PREFIX_PATTERN.test(relative)
  ) {
    throw new VaultError("VAULT_PATH_ESCAPE", "Resolved path escaped the vault root.");
  }
}

export type ResolvedVaultPath = ReturnType<typeof resolveVaultPath>;

async function resolveExistingPath(absolutePath: string, code: string, message: string): Promise<string> {
  try {
    return await fs.realpath(absolutePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new VaultError(code, message, {
        absolutePath,
      });
    }

    throw error;
  }
}

export async function assertPathWithinVaultOnDisk(
  vaultRoot: unknown,
  absolutePath: unknown,
): Promise<void> {
  const absoluteRoot = normalizeVaultRoot(vaultRoot);
  const candidate = path.resolve(String(absolutePath ?? ""));
  assertPathWithinVault(absoluteRoot, candidate);

  const canonicalRoot = await resolveExistingPath(
    absoluteRoot,
    "VAULT_INVALID_ROOT",
    "Vault root does not exist on disk.",
  );
  const relative = path.relative(absoluteRoot, candidate);

  if (!relative) {
    return;
  }

  const segments = relative.split(path.sep).filter(Boolean);
  let currentPath = canonicalRoot;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const nextPath = path.join(currentPath, segment);

    try {
      const stats = await fs.lstat(nextPath);

      if (stats.isSymbolicLink()) {
        throw new VaultError(
          "VAULT_PATH_SYMLINK",
          "Vault paths may not traverse symbolic links.",
          {
            relativePath: toVaultRelativeDisplayPath(segments.slice(0, index + 1).join(path.sep)),
          },
        );
      }

      currentPath = await fs.realpath(nextPath);
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        break;
      }

      throw error;
    }
  }
}

export async function resolveVaultPathOnDisk(
  vaultRoot: unknown,
  relativePath: unknown,
): Promise<ResolvedVaultPath> {
  const resolved = resolveVaultPath(vaultRoot, relativePath);
  await assertPathWithinVaultOnDisk(resolved.vaultRoot, resolved.absolutePath);
  return resolved;
}

export function formatVaultRelativePath(vaultRoot: unknown, absolutePath: unknown): string {
  const absoluteRoot = normalizeVaultRoot(vaultRoot);
  const candidate = path.resolve(String(absolutePath ?? ""));
  assertPathWithinVault(absoluteRoot, candidate);
  return path.relative(absoluteRoot, candidate).split(path.sep).join("/");
}

export function isRawRelativePath(relativePath: unknown): boolean {
  const normalized = normalizeRelativeVaultPath(relativePath);
  return normalized === "raw" || normalized.startsWith("raw/");
}

export function isAppendOnlyRelativePath(relativePath: unknown): boolean {
  const normalized = normalizeRelativeVaultPath(relativePath);
  return (
    normalized === "audit" ||
    normalized.startsWith("audit/") ||
    normalized === "ledger" ||
    normalized.startsWith("ledger/")
  );
}

export function sanitizePathSegment(value: unknown, fallback = "item"): string {
  const candidate = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return candidate || fallback;
}

export function basenameFromFilePath(filePath: unknown): string {
  const candidate = String(filePath ?? "").trim().replace(/\\/g, "/");
  const baseName = candidate.split("/").at(-1);

  if (!baseName) {
    throw new VaultError("VAULT_INVALID_SOURCE_PATH", "Source file path must end in a file name.");
  }

  return baseName;
}

export function sanitizeFileName(fileName: unknown, fallback = "artifact"): string {
  const parsed = path.posix.parse(basenameFromFilePath(fileName));
  const stem = sanitizePathSegment(parsed.name || fallback, fallback);
  const extension = parsed.ext ? parsed.ext.toLowerCase().replace(/[^.a-z0-9]+/g, "") : "";
  return `${stem}${extension}`;
}
