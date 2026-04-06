import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

export const ASSISTANT_RUNTIME_DIRECTORY_NAME = "assistant";
export const ASSISTANT_STATE_DIRECTORY_NAME = ASSISTANT_RUNTIME_DIRECTORY_NAME;

export interface SiblingLocalStateBucketRoot {
  absoluteVaultRoot: string;
  bucketName: string;
  rootPath: string;
}

export function hashVaultRoot(value: string): string {
  return createHash("sha1").update(path.resolve(value)).digest("hex").slice(0, 12);
}

export function resolveSiblingLocalStateBucketRoot(
  vaultRoot: string,
  directoryName: string,
): SiblingLocalStateBucketRoot {
  const absoluteVaultRoot = path.resolve(vaultRoot);
  const bucketName = `${path.basename(absoluteVaultRoot)}-${hashVaultRoot(absoluteVaultRoot)}`;

  return {
    absoluteVaultRoot,
    bucketName,
    rootPath: path.join(path.dirname(absoluteVaultRoot), directoryName, bucketName),
  };
}

export function buildProcessCommand(argv: readonly string[] = process.argv): string {
  const parts = [argv[0], argv[1]]
    .map((value) => (typeof value === "string" && value.trim().length > 0 ? path.basename(value) : ""))
    .filter(Boolean);

  return parts.join(" ").trim() || "unknown";
}

export function fingerprintHost(hostname = os.hostname()): string {
  return `sha256:${createHash("sha256").update(hostname).digest("hex").slice(0, 12)}`;
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ESRCH"
    ) {
      return false;
    }

    return true;
  }
}

export function toVaultRelativePath(vaultRoot: string, targetPath: string): string {
  const relativePath = path.relative(path.resolve(vaultRoot), path.resolve(targetPath));
  return relativePath.length > 0 ? relativePath : ".";
}
