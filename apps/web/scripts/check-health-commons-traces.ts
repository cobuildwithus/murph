import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PHASE_PRODUCTION_BUILD } from "next/constants";

import { resolveHostedWebDistDir } from "../next-artifacts";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDirName = resolveHostedWebDistDir(PHASE_PRODUCTION_BUILD);
const distDir = path.join(appRoot, distDirName);
const forbiddenGeneratedCatalogPattern =
  /(?:^|[/\\])packages[/\\]health-commons[/\\]generated[/\\]catalog\.json$/u;
const forbiddenGeneratedCatalogSubstring =
  /packages[/\\]health-commons[/\\]generated[/\\]catalog\.json/u;
const forbiddenRouteBundleSubstring =
  /packages[/\\]health-commons[/\\]generated[/\\]web[/\\]bundles[/\\]/u;
const allowedMeasurementMethodRouteBundleSubstring =
  /packages[/\\]health-commons[/\\]generated[/\\]web[/\\]bundles[/\\]measurement_method[/\\]/u;
const requiredMeasurementMethodTraceArtifacts = [
  "packages/health-commons/generated/web/routes/index.json",
  "packages/health-commons/generated/web/bundles/measurement_method/home-standardized-photo-roi-analysis.json",
] as const;
if (!existsSync(distDir)) {
  throw new Error(
    `Cannot check Health Commons traces because apps/web/${distDirName} does not exist. Run next build first.`,
  );
}

const traceFiles = listFiles(distDir).filter((file) => file.endsWith(".nft.json"));
const violations: string[] = [];
const measurementMethodTraceArtifacts = new Set<string>();
for (const traceFile of traceFiles) {
  const trace = JSON.parse(readFileSync(traceFile, "utf8")) as unknown;
  const files = readTraceFiles(trace);
  const relativeTraceFile = path.relative(appRoot, traceFile).replace(/\\/gu, "/");
  const isMeasurementMethodTrace = relativeTraceFile.includes(
    "server/app/measurement-methods/[measurementMethodId]/",
  );
  for (const tracedFile of files) {
    const normalizedTracedFile = tracedFile.replace(/\\/gu, "/");
    if (
      forbiddenGeneratedCatalogPattern.test(normalizedTracedFile) ||
      forbiddenGeneratedCatalogSubstring.test(normalizedTracedFile) ||
      (
        isMeasurementMethodTrace
        && forbiddenRouteBundleSubstring.test(normalizedTracedFile)
        && !allowedMeasurementMethodRouteBundleSubstring.test(normalizedTracedFile)
      )
    ) {
      violations.push(`${relativeTraceFile} -> ${tracedFile}`);
    }

    if (isMeasurementMethodTrace) {
      for (const requiredArtifact of requiredMeasurementMethodTraceArtifacts) {
        if (normalizedTracedFile.endsWith(requiredArtifact)) {
          measurementMethodTraceArtifacts.add(requiredArtifact);
        }
      }
    }
  }
}

if (violations.length > 0) {
  throw new Error([
    "Health Commons Next trace boundary check failed.",
    "Measurement routes may trace only measurement-method route bundles.",
    ...violations.map((violation) => `- ${violation}`),
  ].join("\n"));
}

const missingMeasurementMethodArtifacts = requiredMeasurementMethodTraceArtifacts.filter((artifact) =>
  !measurementMethodTraceArtifacts.has(artifact)
);
if (missingMeasurementMethodArtifacts.length > 0) {
  throw new Error([
    "Health Commons generated web projections are missing from Next build traces.",
    "Public Health Commons routes need compact generated/web artifacts at runtime.",
    ...missingMeasurementMethodArtifacts.map((artifact) => `- missing measurement method trace artifact: ${artifact}`),
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
