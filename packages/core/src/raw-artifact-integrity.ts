import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";

import { VaultError } from "./errors.ts";
import { resolveVaultPathOnDisk } from "./path-safety.ts";
import { isErrnoException } from "./types.ts";

export interface RawArtifactIntegrity {
  byteSize: number;
  sha256: string;
}

type InterruptibleRawArtifactIntegrity =
  | { kind: "interrupted" }
  | { kind: "missing" }
  | { kind: "ok"; integrity: RawArtifactIntegrity };

export async function statAndHashVaultFile(
  vaultRoot: string,
  relativePath: string,
): Promise<RawArtifactIntegrity | null> {
  const target = await statVaultFileForHash(vaultRoot, relativePath);
  if (!target) {
    return null;
  }

  return {
    byteSize: target.byteSize,
    sha256: await sha256File(target.absolutePath),
  };
}

export async function statAndHashVaultFileInterruptible(
  vaultRoot: string,
  relativePath: string,
  options: { shouldContinue?: () => boolean } = {},
): Promise<InterruptibleRawArtifactIntegrity> {
  if (options.shouldContinue?.() === false) {
    return { kind: "interrupted" };
  }

  const target = await statVaultFileForHash(vaultRoot, relativePath);
  if (!target) {
    return { kind: "missing" };
  }

  const sha256 = await sha256FileInterruptible(target.absolutePath, options.shouldContinue);
  if (sha256 === null) {
    return { kind: "interrupted" };
  }

  return {
    kind: "ok",
    integrity: {
      byteSize: target.byteSize,
      sha256,
    },
  };
}

async function statVaultFileForHash(
  vaultRoot: string,
  relativePath: string,
): Promise<{ absolutePath: string; byteSize: number } | null> {
  const resolved = await resolveVaultPathOnDisk(vaultRoot, relativePath);
  let stats: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stats = await fs.lstat(resolved.absolutePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  if (stats.isSymbolicLink()) {
    throw new VaultError(
      "VAULT_PATH_SYMLINK",
      "Vault paths may not traverse symbolic links.",
      { relativePath },
    );
  }
  if (!stats.isFile()) {
    throw new VaultError(
      "VAULT_INVALID_FILE",
      "Raw manifest artifacts must be regular files.",
      { relativePath },
    );
  }
  return {
    absolutePath: resolved.absolutePath,
    byteSize: stats.size,
  };
}

export async function safeStatAndHashVaultFile(
  vaultRoot: string,
  relativePath: string,
): Promise<
  | { kind: "missing" }
  | { kind: "invalid"; code: string; message: string }
  | { kind: "ok"; integrity: RawArtifactIntegrity }
> {
  try {
    const integrity = await statAndHashVaultFile(vaultRoot, relativePath);
    if (!integrity) {
      return { kind: "missing" };
    }
    return { kind: "ok", integrity };
  } catch (error) {
    return {
      kind: "invalid",
      code: error instanceof VaultError ? error.code : "RAW_MANIFEST_INVALID",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function sha256File(absolutePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(absolutePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function sha256FileInterruptible(
  absolutePath: string,
  shouldContinue: (() => boolean) | undefined,
): Promise<string | null> {
  if (shouldContinue?.() === false) {
    return null;
  }

  const hash = createHash("sha256");
  const stream = createReadStream(absolutePath);
  for await (const chunk of stream) {
    if (shouldContinue?.() === false) {
      return null;
    }
    hash.update(chunk);
  }

  return shouldContinue?.() === false ? null : hash.digest("hex");
}
