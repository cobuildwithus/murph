import path from "node:path";

import { VaultError } from "./errors.js";

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

  if (/^[A-Za-z]:\//.test(candidate) || path.posix.isAbsolute(candidate)) {
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

  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new VaultError("VAULT_PATH_ESCAPE", "Resolved path escaped the vault root.");
  }
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
