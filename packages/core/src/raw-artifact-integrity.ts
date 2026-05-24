import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";

import { VaultError } from "./errors.ts";
import { resolveVaultPathOnDisk } from "./path-safety.ts";
import { isErrnoException } from "./types.ts";

export interface RawArtifactIntegrity {
  byteSize: number;
  sha256: string;
}

export async function statAndHashVaultFile(
  vaultRoot: string,
  relativePath: string,
): Promise<RawArtifactIntegrity | null> {
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
    byteSize: stats.size,
    sha256: await sha256File(resolved.absolutePath),
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
