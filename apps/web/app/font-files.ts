import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** `apps/web`, as located by the bundle at runtime. */
const bundledWebDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Shared brand assets that OG and share-card routes read from disk with
 * `node:fs` at render time. Each candidate below covers a different way this
 * resolution has been observed to break, cheapest and most reliable first.
 *
 * 1. Working directory plus `apps/web`. The deployed serverless function's
 *    filesystem is shaped like the monorepo root, so this is where the assets
 *    live. Trying this first also keeps Webpack from touching the build-time
 *    source path it inlines for `import.meta.url`. This is the layout the
 *    emitted-runtime check materializes.
 * 2. Bare working directory. Local dev, tests, and `next build` all run from
 *    `apps/web`.
 * 3. Module-relative. Turbopack compiles `import.meta.url` to a path resolved
 *    from the emitted chunk's own location at runtime, so this relocates with
 *    the function. Webpack inlines the source location instead, which is why
 *    this candidate must remain last.
 *
 * The files are traced into every OG/card function by
 * `outputFileTracingIncludes` in `next.config.ts` and guarded by
 * `scripts/check-og-asset-traces.ts`.
 */
export function ogAssetCandidatePaths(
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
export const dmSans600FontPath = resolveOgAssetPath(
  "app/fonts/DMSans-600.ttf",
);

export const logoSvgPath = resolveOgAssetPath("public/logo.svg");
export const murphMarkSvgPath = resolveOgAssetPath(
  "public/icons/murph-mark.svg",
);
