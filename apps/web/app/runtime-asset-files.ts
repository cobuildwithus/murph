import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** `apps/web`, as located by the bundle at runtime. */
const bundledWebDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Candidate locations for Web assets traced into a serverless function.
 *
 * The deployed function uses a repository-shaped working directory, while
 * local Next commands run from `apps/web`. The module-relative candidate
 * follows Turbopack's emitted chunk when neither working-directory layout is
 * present.
 */
export function runtimeAssetCandidatePaths(
  relativePath: string,
  cwd?: string,
): string[] {
  const base = cwd ?? /* turbopackIgnore: true */ process.cwd();
  return [
    join(base, "apps/web", relativePath),
    join(base, relativePath),
    join(bundledWebDir, relativePath),
  ];
}

export function resolveRuntimeAssetPath(relativePath: string): string {
  const candidates = runtimeAssetCandidatePaths(relativePath);
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}
