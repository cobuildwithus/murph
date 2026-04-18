import { createRequire } from "node:module";
import { lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requireFromHere = createRequire(import.meta.url);

export function resolveHostedWebPrismaClientLinkPaths(packageDir: string): {
  generatedPrismaDir: string;
  linkPath: string;
} {
  const prismaClientPackageJsonPath = requireFromHere.resolve("@prisma/client/package.json", {
    paths: [packageDir],
  });
  const prismaClientDir = path.dirname(prismaClientPackageJsonPath);
  const generatedPrismaDefaultPath = requireFromHere.resolve(".prisma/client/default", {
    paths: [prismaClientDir],
  });

  return {
    generatedPrismaDir: path.resolve(path.dirname(generatedPrismaDefaultPath), ".."),
    linkPath: path.join(packageDir, "node_modules", ".prisma"),
  };
}

export async function ensureHostedWebPrismaClientLink(packageDir: string): Promise<void> {
  const { generatedPrismaDir, linkPath } = resolveHostedWebPrismaClientLinkPaths(packageDir);
  const linkParentDir = path.dirname(linkPath);
  const relativeTarget = path.relative(linkParentDir, generatedPrismaDir) || ".";

  await mkdir(linkParentDir, { recursive: true });

  try {
    const existingEntry = await lstat(linkPath);

    if (existingEntry.isSymbolicLink()) {
      const existingTarget = await readlink(linkPath);

      if (existingTarget === relativeTarget) {
        return;
      }
    }

    await rm(linkPath, { force: true, recursive: true });
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }

  await symlink(relativeTarget, linkPath, process.platform === "win32" ? "junction" : "dir");
}

async function main(): Promise<void> {
  const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await ensureHostedWebPrismaClientLink(packageDir);
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
