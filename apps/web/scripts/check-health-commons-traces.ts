import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(appRoot, ".next");
const forbiddenGeneratedCatalogPattern =
  /(?:^|[/\\])packages[/\\]health-commons[/\\]generated[/\\]catalog\.json$/u;
const forbiddenGeneratedCatalogSubstring =
  /packages[/\\]health-commons[/\\]generated[/\\]catalog\.json/u;
const forbiddenRouteBundleSubstring =
  /packages[/\\]health-commons[/\\]generated[/\\]web[/\\]bundles[/\\]/u;
const requiredExperimentTraceArtifacts = [
  "packages/health-commons/generated/web/routes/index.json",
  "packages/health-commons/generated/web/shell/experiments/finnish-sauna.json",
  "packages/health-commons/generated/web/tabs/experiments/finnish-sauna/protocol.json",
  "packages/health-commons/generated/web/tabs/experiments/finnish-sauna/research.json",
  "packages/health-commons/generated/web/tabs/experiments/finnish-sauna/results-public.json",
] as const;
const requiredBrowseTraceArtifacts = [
  "packages/health-commons/generated/web/browse/experiments.json",
] as const;

if (!existsSync(distDir)) {
  throw new Error(
    "Cannot check Health Commons traces because apps/web/.next does not exist. Run next build first.",
  );
}

const traceFiles = listFiles(distDir).filter((file) => file.endsWith(".nft.json"));
const violations: string[] = [];
const experimentTraceArtifacts = new Set<string>();
const browseTraceArtifacts = new Set<string>();

for (const traceFile of traceFiles) {
  const trace = JSON.parse(readFileSync(traceFile, "utf8")) as unknown;
  const files = readTraceFiles(trace);
  const relativeTraceFile = path.relative(appRoot, traceFile).replace(/\\/gu, "/");
  const isExperimentDetailTrace = relativeTraceFile.includes(
    "server/app/(dashboard)/experiments/[experimentId]/",
  );
  const isExperimentBrowseTrace = relativeTraceFile.endsWith(
    "server/app/(dashboard)/experiments/page.js.nft.json",
  );

  for (const tracedFile of files) {
    const normalizedTracedFile = tracedFile.replace(/\\/gu, "/");
    if (
      forbiddenGeneratedCatalogPattern.test(normalizedTracedFile) ||
      forbiddenGeneratedCatalogSubstring.test(normalizedTracedFile) ||
      (isExperimentDetailTrace && forbiddenRouteBundleSubstring.test(normalizedTracedFile))
    ) {
      violations.push(`${relativeTraceFile} -> ${tracedFile}`);
    }

    if (isExperimentDetailTrace) {
      for (const requiredArtifact of requiredExperimentTraceArtifacts) {
        if (normalizedTracedFile.endsWith(requiredArtifact)) {
          experimentTraceArtifacts.add(requiredArtifact);
        }
      }
    }

    if (isExperimentBrowseTrace) {
      for (const requiredArtifact of requiredBrowseTraceArtifacts) {
        if (normalizedTracedFile.endsWith(requiredArtifact)) {
          browseTraceArtifacts.add(requiredArtifact);
        }
      }
    }
  }
}

if (violations.length > 0) {
  throw new Error([
    "Health Commons generated catalog leaked into Next build traces.",
    "Public experiment routes must use web projections instead of the monolithic catalog or route bundles.",
    ...violations.map((violation) => `- ${violation}`),
  ].join("\n"));
}

const missingExperimentArtifacts = requiredExperimentTraceArtifacts.filter((artifact) =>
  !experimentTraceArtifacts.has(artifact)
);
const missingBrowseArtifacts = requiredBrowseTraceArtifacts.filter((artifact) =>
  !browseTraceArtifacts.has(artifact)
);

if (missingExperimentArtifacts.length > 0 || missingBrowseArtifacts.length > 0) {
  throw new Error([
    "Health Commons generated web projections are missing from Next build traces.",
    "Public experiment routes need compact generated/web artifacts at runtime.",
    ...missingExperimentArtifacts.map((artifact) => `- missing experiment detail trace artifact: ${artifact}`),
    ...missingBrowseArtifacts.map((artifact) => `- missing experiment browse trace artifact: ${artifact}`),
  ].join("\n"));
}

console.log(`Checked ${traceFiles.length} Next trace files for Health Commons catalog leakage.`);

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
