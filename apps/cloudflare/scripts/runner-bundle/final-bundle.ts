import { cp, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";

export async function materializeFinalRunnerBundle(
  stagingBundleDir: string,
  finalBundleDir: string,
): Promise<void> {
  const finalParentDir = path.dirname(finalBundleDir);
  const finalBackupDir = `${finalBundleDir}.previous`;
  await mkdir(finalParentDir, { recursive: true });
  const preparedParentDir = await mkdtemp(
    path.join(finalParentDir, ".runner-bundle-prepared-"),
  );
  const preparedBundleDir = path.join(
    preparedParentDir,
    path.basename(finalBundleDir),
  );

  try {
    await prepareBundleReplica(stagingBundleDir, preparedBundleDir);
    await replaceFinalBundle(preparedBundleDir, finalBundleDir, finalBackupDir);
  } finally {
    await rm(preparedParentDir, { force: true, recursive: true });
  }
}

async function prepareBundleReplica(
  stagingBundleDir: string,
  preparedBundleDir: string,
): Promise<void> {
  await rm(preparedBundleDir, { force: true, recursive: true });

  try {
    await rename(stagingBundleDir, preparedBundleDir);
  } catch (error) {
    if (!isCrossDeviceRenameError(error)) {
      throw error;
    }

    await cp(stagingBundleDir, preparedBundleDir, {
      force: true,
      recursive: true,
      verbatimSymlinks: true,
    });
  }
}

async function replaceFinalBundle(
  preparedBundleDir: string,
  finalBundleDir: string,
  finalBackupDir: string,
): Promise<void> {
  await rm(finalBackupDir, { force: true, recursive: true });

  let finalWasBackedUp = false;

  try {
    await rename(finalBundleDir, finalBackupDir);
    finalWasBackedUp = true;
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  try {
    await rm(finalBundleDir, { force: true, recursive: true });
    await rename(preparedBundleDir, finalBundleDir);
  } catch (error) {
    if (finalWasBackedUp) {
      await rm(finalBundleDir, { force: true, recursive: true });
      await rename(finalBackupDir, finalBundleDir);
    }

    throw error;
  }

  await rm(finalBackupDir, { force: true, recursive: true });
}

function isCrossDeviceRenameError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "EXDEV",
  );
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT",
  );
}
