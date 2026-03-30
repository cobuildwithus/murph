import { randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";

import { isErrnoException } from "./types.ts";

const EXCLUSIVE_CREATE_LINK_FALLBACK_CODES = new Set<string>([
  "EMLINK",
  "ENOTSUP",
  "EOPNOTSUPP",
  "EPERM",
  "EXDEV",
]);

function buildAtomicTempPath(targetAbsolutePath: string): string {
  return path.join(
    path.dirname(targetAbsolutePath),
    `.${path.basename(targetAbsolutePath)}.${randomUUID().replace(/-/g, "")}.tmp`,
  );
}

async function ensureTargetDirectory(targetAbsolutePath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetAbsolutePath), { recursive: true });
}

async function cleanupAtomicTempFile(tempAbsolutePath: string): Promise<void> {
  try {
    await fs.rm(tempAbsolutePath, { force: true });
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

function supportsExclusiveCreateLinkFallback(error: unknown): boolean {
  return isErrnoException(error) && EXCLUSIVE_CREATE_LINK_FALLBACK_CODES.has(error.code ?? "");
}

async function preserveExistingTargetMode(
  targetAbsolutePath: string,
  replacementAbsolutePath: string,
): Promise<void> {
  try {
    const existingTarget = await fs.stat(targetAbsolutePath);
    await fs.chmod(replacementAbsolutePath, existingTarget.mode & 0o7777);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function writeTextFileAtomic(targetAbsolutePath: string, content: string): Promise<void> {
  const tempAbsolutePath = buildAtomicTempPath(targetAbsolutePath);
  await ensureTargetDirectory(targetAbsolutePath);

  try {
    await fs.writeFile(tempAbsolutePath, content, {
      encoding: "utf8",
      flag: "wx",
    });
    await preserveExistingTargetMode(targetAbsolutePath, tempAbsolutePath);
    await fs.rename(tempAbsolutePath, targetAbsolutePath);
  } catch (error) {
    await cleanupAtomicTempFile(tempAbsolutePath).catch(() => undefined);
    throw error;
  }
}

export async function copyFileAtomic(sourceAbsolutePath: string, targetAbsolutePath: string): Promise<void> {
  const tempAbsolutePath = buildAtomicTempPath(targetAbsolutePath);
  await ensureTargetDirectory(targetAbsolutePath);

  try {
    await fs.copyFile(sourceAbsolutePath, tempAbsolutePath, fsConstants.COPYFILE_EXCL);
    await preserveExistingTargetMode(targetAbsolutePath, tempAbsolutePath);
    await fs.rename(tempAbsolutePath, targetAbsolutePath);
  } catch (error) {
    await cleanupAtomicTempFile(tempAbsolutePath).catch(() => undefined);
    throw error;
  }
}

export async function writeTextFileAtomicExclusive(
  targetAbsolutePath: string,
  content: string,
): Promise<void> {
  const tempAbsolutePath = buildAtomicTempPath(targetAbsolutePath);
  await ensureTargetDirectory(targetAbsolutePath);

  try {
    await fs.writeFile(tempAbsolutePath, content, {
      encoding: "utf8",
      flag: "wx",
    });

    let linked = false;

    try {
      await fs.link(tempAbsolutePath, targetAbsolutePath);
      linked = true;
    } catch (error) {
      if (supportsExclusiveCreateLinkFallback(error)) {
        await cleanupAtomicTempFile(tempAbsolutePath).catch(() => undefined);
        await fs.writeFile(targetAbsolutePath, content, {
          encoding: "utf8",
          flag: "wx",
        });
        return;
      }

      throw error;
    } finally {
      if (linked) {
        await cleanupAtomicTempFile(tempAbsolutePath).catch(() => undefined);
      }
    }
  } catch (error) {
    await cleanupAtomicTempFile(tempAbsolutePath).catch(() => undefined);
    throw error;
  }
}

export async function copyFileAtomicExclusive(
  sourceAbsolutePath: string,
  targetAbsolutePath: string,
): Promise<void> {
  const tempAbsolutePath = buildAtomicTempPath(targetAbsolutePath);
  await ensureTargetDirectory(targetAbsolutePath);

  try {
    await fs.copyFile(sourceAbsolutePath, tempAbsolutePath, fsConstants.COPYFILE_EXCL);

    let linked = false;

    try {
      await fs.link(tempAbsolutePath, targetAbsolutePath);
      linked = true;
    } catch (error) {
      if (supportsExclusiveCreateLinkFallback(error)) {
        await cleanupAtomicTempFile(tempAbsolutePath).catch(() => undefined);
        await fs.copyFile(sourceAbsolutePath, targetAbsolutePath, fsConstants.COPYFILE_EXCL);
        return;
      }

      throw error;
    } finally {
      if (linked) {
        await cleanupAtomicTempFile(tempAbsolutePath).catch(() => undefined);
      }
    }
  } catch (error) {
    await cleanupAtomicTempFile(tempAbsolutePath).catch(() => undefined);
    throw error;
  }
}
