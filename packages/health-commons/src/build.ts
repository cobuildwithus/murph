import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildHealthCommonsCatalog,
  buildHealthCommonsSourceArtifactIndex,
  buildHealthCommonsSourceIndex,
} from "./catalog.ts";
import { buildHealthCommonsBiomarkerDesiredDirectionsArtifact } from "./biomarker-runtime-artifacts.ts";
import {
  HEALTH_COMMONS_KNOWLEDGE_INDEX_FILE,
  writeHealthCommonsKnowledgeIndex,
} from "./knowledge-index.ts";
import { stablePrettyJson } from "./normalize.ts";
import { buildHealthCommonsProtocolGeneratedArtifacts } from "./protocol-artifacts.ts";
import { buildHealthCommonsWebGeneratedArtifacts } from "./web-artifacts.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface CliOptions {
  check: boolean;
  contentRoot: string;
  generatedRoot: string;
}

export async function writeHealthCommonsGeneratedArtifacts(options: CliOptions): Promise<void> {
  const catalog = await buildHealthCommonsCatalog({ contentRoot: options.contentRoot });
  const files = buildGeneratedFiles(catalog);

  if (options.check) {
    await assertGeneratedArtifactsCurrent(options.contentRoot, options.generatedRoot, files, catalog);
    return;
  }

  await replaceGeneratedRoot(options.generatedRoot, files, catalog);
}

async function writeGeneratedFiles(outputRoot: string, files: ReadonlyMap<string, string>): Promise<void> {
  for (const [fileName, nextContent] of files.entries()) {
    const outputPath = resolveGeneratedFilePath(outputRoot, fileName);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, nextContent, "utf8");
  }
}

async function replaceGeneratedRoot(
  generatedRoot: string,
  files: ReadonlyMap<string, string>,
  catalog: Awaited<ReturnType<typeof buildHealthCommonsCatalog>>,
): Promise<void> {
  const targetRoot = path.resolve(generatedRoot);
  const targetParent = path.dirname(targetRoot);
  const targetBaseName = path.basename(targetRoot);
  if (!targetBaseName || targetRoot === path.parse(targetRoot).root) {
    throw new Error("Unsafe Health Commons generated root.");
  }
  const temporaryRoot = path.join(targetParent, `.${targetBaseName}.${process.pid}.${randomUUID()}.tmp`);
  const backupRoot = path.join(targetParent, `.${targetBaseName}.${process.pid}.${randomUUID()}.old`);

  await mkdir(targetParent, { recursive: true });
  try {
    await writeGeneratedFiles(temporaryRoot, files);
    writeHealthCommonsKnowledgeIndex(
      path.join(temporaryRoot, HEALTH_COMMONS_KNOWLEDGE_INDEX_FILE),
      catalog,
    );
  } catch (error) {
    await rm(temporaryRoot, { force: true, recursive: true }).catch(() => {});
    throw error;
  }

  let targetMoved = false;
  try {
    await rename(targetRoot, backupRoot).then(
      () => {
        targetMoved = true;
      },
      (error: unknown) => {
        if (!isNodeErrorWithCode(error, "ENOENT")) {
          throw error;
        }
      },
    );
    await rename(temporaryRoot, targetRoot);
  } catch (error) {
    await rm(temporaryRoot, { force: true, recursive: true }).catch(() => {});
    if (targetMoved) {
      await rename(backupRoot, targetRoot).catch(() => {});
    }
    throw error;
  }

  await rm(backupRoot, { force: true, recursive: true });
}

function resolveGeneratedFilePath(root: string, fileName: string): string {
  const normalized = fileName.replace(/\\/gu, "/");
  const segments = normalized.split("/");
  if (
    normalized.length === 0
    || normalized.startsWith("/")
    || segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe Health Commons generated artifact path: ${fileName}`);
  }

  return path.join(root, ...segments);
}

function buildGeneratedFiles(
  catalog: Awaited<ReturnType<typeof buildHealthCommonsCatalog>>,
): Map<string, string> {
  const sourceIndex = buildHealthCommonsSourceIndex(catalog);
  const sourceArtifactIndex = buildHealthCommonsSourceArtifactIndex(catalog);
  const webArtifacts = buildHealthCommonsWebGeneratedArtifacts(catalog);
  const protocolArtifacts = buildHealthCommonsProtocolGeneratedArtifacts({
    catalog,
    routeIndex: webArtifacts.routeIndex,
  });
  const biomarkerDesiredDirections =
    buildHealthCommonsBiomarkerDesiredDirectionsArtifact(webArtifacts.biomarkerIndex);
  const files = new Map<string, string>([
    ["catalog.hash", `${catalog.catalogHash}\n`],
    ["redirects.json", stablePrettyJson({ redirects: catalog.redirects })],
    ["recent-changes.json", stablePrettyJson({ changes: catalog.changes })],
    ["artifact-manifests.json", stablePrettyJson({ artifactManifests: catalog.artifactManifests })],
    ["evidence-appraisals.json", stablePrettyJson({ evidenceAppraisals: catalog.evidenceAppraisals })],
    ["protocol-index.json", stablePrettyJson(protocolArtifacts.index)],
    ["protocol-run-specs.json", stablePrettyJson(protocolArtifacts.runSpecs)],
    ["protocol-family-graph.json", stablePrettyJson(protocolArtifacts.familyGraph)],
    ["biomarker-desired-directions.json", stablePrettyJson(biomarkerDesiredDirections)],
    ["source-index.json", stablePrettyJson(sourceIndex)],
    ["source-identities.ndjson", sourceIndex.identityLookup.map((entry) => JSON.stringify(entry)).join("\n") + "\n"],
    ["source-artifact-index.json", stablePrettyJson(sourceArtifactIndex)],
    ["web/routes/index.json", stablePrettyJson(webArtifacts.routeIndex)],
    ["web/browse/experiments.json", stablePrettyJson(webArtifacts.experimentIndex)],
    ["web/browse/biomarkers.json", stablePrettyJson(webArtifacts.biomarkerIndex)],
  ]);

  for (const [fileName, bundle] of webArtifacts.routeBundles.entries()) {
    files.set(`web/${fileName}`, stablePrettyJson(bundle));
  }

  for (const [fileName, projectionArtifact] of webArtifacts.projectionArtifacts.entries()) {
    files.set(`web/${fileName}`, stablePrettyJson(projectionArtifact));
  }

  return files;
}

async function assertGeneratedArtifactsCurrent(
  contentRoot: string,
  generatedRoot: string,
  expectedFiles: ReadonlyMap<string, string>,
  firstCatalog: Awaited<ReturnType<typeof buildHealthCommonsCatalog>>,
): Promise<void> {
  const secondCatalog = await buildHealthCommonsCatalog({ contentRoot });
  const secondFiles = buildGeneratedFiles(secondCatalog);
  const mismatches: string[] = [];

  for (const [fileName, expectedContent] of expectedFiles.entries()) {
    if (secondFiles.get(fileName) !== expectedContent) {
      mismatches.push(fileName);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`Health Commons generated artifacts are nondeterministic: ${mismatches.join(", ")}.`);
  }

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "murph-health-commons-check-"));
  try {
    const firstIndexPath = path.join(temporaryRoot, "first.sqlite");
    const secondIndexPath = path.join(temporaryRoot, "second.sqlite");
    writeHealthCommonsKnowledgeIndex(firstIndexPath, firstCatalog);
    writeHealthCommonsKnowledgeIndex(secondIndexPath, secondCatalog);
    const [firstIndex, secondIndex] = await Promise.all([
      readFile(firstIndexPath),
      readFile(secondIndexPath),
    ]);
    if (!firstIndex.equals(secondIndex)) {
      throw new Error(
        `Health Commons generated artifacts are nondeterministic: ${HEALTH_COMMONS_KNOWLEDGE_INDEX_FILE}.`,
      );
    }
    const currentIndex = await readFile(
      path.join(generatedRoot, HEALTH_COMMONS_KNOWLEDGE_INDEX_FILE),
    ).catch(() => null);
    if (!currentIndex || !firstIndex.equals(currentIndex)) {
      throw new Error(
        `Health Commons generated artifacts are out of date; changed 1: ${HEALTH_COMMONS_KNOWLEDGE_INDEX_FILE}. Run pnpm --filter @murphai/health-commons generate.`,
      );
    }
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }

  const actualFiles = await readGeneratedTree(generatedRoot);
  const missingFiles: string[] = [];
  const changedFiles: string[] = [];
  const staleFiles: string[] = [];

  for (const [fileName, expectedContent] of expectedFiles.entries()) {
    if (!actualFiles.has(fileName)) {
      missingFiles.push(fileName);
      continue;
    }
    if (actualFiles.get(fileName) !== expectedContent) {
      changedFiles.push(fileName);
    }
  }

  for (const fileName of actualFiles.keys()) {
    if (!expectedFiles.has(fileName) && fileName !== HEALTH_COMMONS_KNOWLEDGE_INDEX_FILE) {
      staleFiles.push(fileName);
    }
  }

  const expectedIndexPath = path.join(generatedRoot, HEALTH_COMMONS_KNOWLEDGE_INDEX_FILE);
  const indexExists = await readFile(expectedIndexPath).then(() => true, () => false);
  if (!indexExists) {
    missingFiles.push(HEALTH_COMMONS_KNOWLEDGE_INDEX_FILE);
  }

  if (missingFiles.length > 0 || changedFiles.length > 0 || staleFiles.length > 0) {
    throw new Error(
      [
        "Health Commons generated artifacts are out of date",
        formatGeneratedDiff("missing", missingFiles),
        formatGeneratedDiff("changed", changedFiles),
        formatGeneratedDiff("stale", staleFiles),
      ].filter(Boolean).join("; ") + ". Run pnpm --filter @murphai/health-commons generate.",
    );
  }
}

async function readGeneratedTree(root: string): Promise<Map<string, string | null>> {
  const files = new Map<string, string | null>();

  await collectGeneratedTreeFiles(path.resolve(root), "", files);

  return files;
}

async function collectGeneratedTreeFiles(
  absoluteRoot: string,
  relativeDir: string,
  files: Map<string, string | null>,
): Promise<void> {
  const entries = await readdir(path.join(absoluteRoot, relativeDir), { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  });

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const relativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;
    const absolutePath = path.join(absoluteRoot, relativePath);
    if (entry.isDirectory()) {
      await collectGeneratedTreeFiles(absoluteRoot, relativePath, files);
      continue;
    }

    files.set(
      relativePath,
      entry.isFile() && relativePath !== HEALTH_COMMONS_KNOWLEDGE_INDEX_FILE
        ? await readFile(absolutePath, "utf8")
        : null,
    );
  }
}

function formatGeneratedDiff(label: string, files: readonly string[]): string | null {
  if (files.length === 0) {
    return null;
  }

  const shown = files.slice(0, 8);
  const suffix = files.length > shown.length ? `, and ${files.length - shown.length} more` : "";
  return `${label} ${files.length}: ${shown.join(", ")}${suffix}`;
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    check: false,
    contentRoot: path.join(packageRoot, "content"),
    generatedRoot: path.join(packageRoot, "generated"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (arg === "--content-root") {
      options.contentRoot = path.resolve(requireNext(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--generated-root") {
      options.generatedRoot = path.resolve(requireNext(argv, index, arg));
      index += 1;
      continue;
    }
    throw new Error(`Unknown health-commons build argument: ${arg}`);
  }

  return options;
}

function requireNext(argv: readonly string[], index: number, label: string): string {
  const next = argv[index + 1];
  if (!next) {
    throw new Error(`${label} requires a value.`);
  }
  return next;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeHealthCommonsGeneratedArtifacts(parseCliOptions(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
