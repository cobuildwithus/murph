import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PHASE_PRODUCTION_BUILD } from "next/constants";

import { resolveHostedWebDistDir } from "../next-artifacts";

// OG and share-card route handlers read these brand assets from disk at
// render time (app/font-files.ts). If an asset is missing from a route's
// serverless trace, every non-prerendered render of that route 500s with
// ENOENT, so a missing trace entry must fail the build
// (outputFileTracingIncludes in next.config.ts owns the tracing).
//
// Today this is a backstop rather than the sole guarantee: the current
// Turbopack tracer already pulls the whole apps/web tree into each route's
// closure, so these assets are present even without the explicit includes.
// That breadth is incidental and could tighten in any release, and a dynamic
// `readFile` is invisible to static tracing, so the includes state the
// requirement and this check keeps it honest.
// Trace entries are recorded relative to each trace file and stay inside
// apps/web, so the suffixes carry no apps/web prefix.
const requiredOgAssetSuffixes = [
  "public/logo.svg",
  "app/fonts/Fraunces-400.ttf",
  "app/fonts/Fraunces-600.ttf",
  "app/fonts/DMSans-400.ttf",
] as const;

// Routes that render OG/share-card images on demand. Each must have a
// serverless trace containing every required asset. Substring-matched so the
// `opengraph-image-[[...__metadata_id__]]` route suffix Next generates for
// metadata image routes stays matched if its exact shape changes.
const requiredOgRouteTraceMarkers = [
  "server/app/join/[inviteCode]/opengraph-image",
  "server/app/family/accept/[inviteCode]/opengraph-image",
  "server/app/groups/join/[joinCode]/opengraph-image",
  "server/app/(dashboard)/biomarkers/[biomarkerId]/opengraph-image",
  "server/app/(dashboard)/experiments/[experimentId]/opengraph-image",
  "server/app/(dashboard)/experiments/[experimentId]/card/route.js.nft.json",
  "server/app/changelog/card/v1/[items]/route.js.nft.json",
] as const;

const ogImageTracePattern = /server\/app\/.*opengraph-image[^/]*\/route\.js\.nft\.json$/u;

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDirName = resolveHostedWebDistDir(PHASE_PRODUCTION_BUILD);
const distDir = path.join(appRoot, distDirName);

if (!existsSync(distDir)) {
  throw new Error(
    `Cannot check OG asset traces because apps/web/${distDirName} does not exist. Run next build first.`,
  );
}

const traceFiles = listFiles(distDir).filter((file) => file.endsWith(".nft.json"));
const ogTraceFiles = traceFiles
  .map((traceFile) => ({
    absolutePath: traceFile,
    relativePath: path.relative(appRoot, traceFile).replace(/\\/gu, "/"),
  }))
  .filter(({ relativePath }) =>
    ogImageTracePattern.test(relativePath)
    || requiredOgRouteTraceMarkers.some((marker) => relativePath.includes(marker))
  );

const missingRouteTraces = requiredOgRouteTraceMarkers.filter((marker) =>
  !ogTraceFiles.some(({ relativePath }) => relativePath.includes(marker))
);
if (missingRouteTraces.length > 0) {
  throw new Error([
    "Expected OG/share-card route traces are missing from the Next build output.",
    "If a route moved, update requiredOgRouteTraceMarkers in apps/web/scripts/check-og-asset-traces.ts.",
    ...missingRouteTraces.map((marker) => `- missing route trace: ${marker}`),
  ].join("\n"));
}

const violations: string[] = [];
for (const { absolutePath, relativePath } of ogTraceFiles) {
  const trace = JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
  const tracedFiles = readTraceFiles(trace).map((file) => file.replace(/\\/gu, "/"));
  for (const requiredAsset of requiredOgAssetSuffixes) {
    if (!tracedFiles.some((file) => file.endsWith(requiredAsset))) {
      violations.push(`${relativePath} -> missing ${requiredAsset}`);
    }
  }
}

if (violations.length > 0) {
  throw new Error([
    "OG/share-card brand assets are missing from Next build traces.",
    "Serverless OG routes read these files at render time; a missing trace is a guaranteed ENOENT 500.",
    "Check outputFileTracingIncludes in apps/web/next.config.ts.",
    ...violations.map((violation) => `- ${violation}`),
  ].join("\n"));
}

console.log(
  `Checked ${ogTraceFiles.length} OG/share-card route traces for bundled brand assets.`,
);

function listFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(root, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      files.push(...listFiles(absolutePath));
      continue;
    }

    if (stats.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

function readTraceFiles(trace: unknown): string[] {
  if (!trace || typeof trace !== "object" || !("files" in trace)) {
    return [];
  }

  const files = (trace as { files?: unknown }).files;

  return Array.isArray(files)
    ? files.filter((file): file is string => typeof file === "string")
    : [];
}
