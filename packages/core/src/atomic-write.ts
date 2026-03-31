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

type AtomicTempFileStep = (tempAbsolutePath: string) => Promise<void>;

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

async function cleanupAtomicTempFileBestEffort(tempAbsolutePath: string): Promise<void> {
  await cleanupAtomicTempFile(tempAbsolutePath).catch(() => undefined);
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

async function withPreparedAtomicTempFile(
  targetAbsolutePath: string,
  prepareTempFile: AtomicTempFileStep,
  commitPreparedTempFile: AtomicTempFileStep,
): Promise<void> {
  const tempAbsolutePath = buildAtomicTempPath(targetAbsolutePath);
  await ensureTargetDirectory(targetAbsolutePath);

  try {
    await prepareTempFile(tempAbsolutePath);
    await commitPreparedTempFile(tempAbsolutePath);
  } catch (error) {
    await cleanupAtomicTempFileBestEffort(tempAbsolutePath);
    throw error;
  }
}

async function replaceTargetWithPreparedTempFile(
  targetAbsolutePath: string,
  tempAbsolutePath: string,
): Promise<void> {
  await preserveExistingTargetMode(targetAbsolutePath, tempAbsolutePath);
  await fs.rename(tempAbsolutePath, targetAbsolutePath);
}

async function linkPreparedTempFileExclusively(input: {
  targetAbsolutePath: string;
  tempAbsolutePath: string;
  fallbackCreateTarget: () => Promise<void>;
}): Promise<void> {
  try {
    await fs.link(input.tempAbsolutePath, input.targetAbsolutePath);
  } catch (error) {
    if (!supportsExclusiveCreateLinkFallback(error)) {
      throw error;
    }

    await cleanupAtomicTempFileBestEffort(input.tempAbsolutePath);
    await input.fallbackCreateTarget();
    return;
  }

  await cleanupAtomicTempFileBestEffort(input.tempAbsolutePath);
}

export async function writeTextFileAtomic(targetAbsolutePath: string, content: string): Promise<void> {
  await withPreparedAtomicTempFile(
    targetAbsolutePath,
    async (tempAbsolutePath) => {
      await fs.writeFile(tempAbsolutePath, content, {
        encoding: "utf8",
        flag: "wx",
      });
    },
    async (tempAbsolutePath) => {
      await replaceTargetWithPreparedTempFile(targetAbsolutePath, tempAbsolutePath);
    },
  );
}

export async function copyFileAtomic(sourceAbsolutePath: string, targetAbsolutePath: string): Promise<void> {
  await withPreparedAtomicTempFile(
    targetAbsolutePath,
    async (tempAbsolutePath) => {
      await fs.copyFile(sourceAbsolutePath, tempAbsolutePath, fsConstants.COPYFILE_EXCL);
    },
    async (tempAbsolutePath) => {
      await replaceTargetWithPreparedTempFile(targetAbsolutePath, tempAbsolutePath);
    },
  );
}

export async function writeTextFileAtomicExclusive(
  targetAbsolutePath: string,
  content: string,
): Promise<void> {
  await withPreparedAtomicTempFile(
    targetAbsolutePath,
    async (tempAbsolutePath) => {
      await fs.writeFile(tempAbsolutePath, content, {
        encoding: "utf8",
        flag: "wx",
      });
    },
    async (tempAbsolutePath) => {
      await linkPreparedTempFileExclusively({
        targetAbsolutePath,
        tempAbsolutePath,
        fallbackCreateTarget: () =>
          fs.writeFile(targetAbsolutePath, content, {
            encoding: "utf8",
            flag: "wx",
          }),
      });
    },
  );
}

export async function copyFileAtomicExclusive(
  sourceAbsolutePath: string,
  targetAbsolutePath: string,
): Promise<void> {
  await withPreparedAtomicTempFile(
    targetAbsolutePath,
    async (tempAbsolutePath) => {
      await fs.copyFile(sourceAbsolutePath, tempAbsolutePath, fsConstants.COPYFILE_EXCL);
    },
    async (tempAbsolutePath) => {
      await linkPreparedTempFileExclusively({
        targetAbsolutePath,
        tempAbsolutePath,
        fallbackCreateTarget: () =>
          fs.copyFile(sourceAbsolutePath, targetAbsolutePath, fsConstants.COPYFILE_EXCL),
      });
    },
  );
}
