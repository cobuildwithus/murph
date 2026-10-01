import { resolveRuntimeAssetPath } from "./runtime-asset-files";

/**
 * Shared brand assets that OG and share-card routes read from disk with
 * `node:fs` at render time.
 * The files are traced into every OG/card function by
 * `outputFileTracingIncludes` in `next.config.ts` and guarded by
 * `scripts/check-og-asset-traces.ts`.
 */
export const fraunces400FontPath = resolveRuntimeAssetPath(
  "app/fonts/Fraunces-400.ttf",
);
export const fraunces600FontPath = resolveRuntimeAssetPath(
  "app/fonts/Fraunces-600.ttf",
);
export const dmSans400FontPath = resolveRuntimeAssetPath("app/fonts/DMSans-400.ttf");
export const dmSans600FontPath = resolveRuntimeAssetPath(
  "app/fonts/DMSans-600.ttf",
);

export const logoSvgPath = resolveRuntimeAssetPath("public/logo.svg");
export const murphMarkSvgPath = resolveRuntimeAssetPath(
  "public/icons/murph-mark.svg",
);
