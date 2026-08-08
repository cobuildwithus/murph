import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Shared brand assets that OG and share-card routes read from disk with
 * `node:fs` at render time.
 *
 * Resolve them from the runtime working directory instead of
 * `import.meta.url`: the Turbopack production build inlines the build
 * machine's absolute path (for example `/vercel/path0/apps/web/...`) into the
 * bundle, and that path does not exist inside the deployed serverless
 * function, so every non-prerendered OG render 500s with ENOENT. The deployed
 * function's filesystem is shaped like the monorepo root while local dev and
 * tests run from `apps/web`, so both layouts are tried. The files themselves
 * are traced into every OG/card function by `outputFileTracingIncludes` in
 * `next.config.ts` and guarded by `scripts/check-og-asset-traces.ts`.
 */
export function ogAssetCandidatePaths(
  relativePath: string,
  cwd?: string,
): string[] {
  const base = cwd ?? /* turbopackIgnore: true */ process.cwd();
  return [join(base, "apps/web", relativePath), join(base, relativePath)];
}

function resolveOgAssetPath(relativePath: string): string {
  const candidates = ogAssetCandidatePaths(relativePath);
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export const fraunces400FontPath = resolveOgAssetPath(
  "app/fonts/Fraunces-400.ttf",
);
export const fraunces600FontPath = resolveOgAssetPath(
  "app/fonts/Fraunces-600.ttf",
);
export const dmSans400FontPath = resolveOgAssetPath("app/fonts/DMSans-400.ttf");

export const logoSvgPath = resolveOgAssetPath("public/logo.svg");
