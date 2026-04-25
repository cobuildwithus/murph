import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildHealthCommonsCatalog,
  buildHealthCommonsSourceArtifactIndex,
  buildHealthCommonsSourceIndex,
} from "./catalog.ts";
import { stablePrettyJson } from "./normalize.ts";

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
    await assertGeneratedArtifactsDeterministic(options.contentRoot, files);
    return;
  }

  await mkdir(options.generatedRoot, { recursive: true });

  for (const [fileName, nextContent] of files.entries()) {
    await writeFile(path.join(options.generatedRoot, fileName), nextContent, "utf8");
  }
}

function buildGeneratedFiles(
  catalog: Awaited<ReturnType<typeof buildHealthCommonsCatalog>>,
): Map<string, string> {
  const sourceIndex = buildHealthCommonsSourceIndex(catalog);
  const sourceArtifactIndex = buildHealthCommonsSourceArtifactIndex(catalog);

  return new Map<string, string>([
    ["catalog.json", stablePrettyJson(catalog)],
    ["catalog.hash", `${catalog.catalogHash}\n`],
    ["entities.ndjson", catalog.entities.map((entity) => JSON.stringify(entity)).join("\n") + "\n"],
    ["redirects.json", stablePrettyJson({ redirects: catalog.redirects })],
    ["recent-changes.json", stablePrettyJson({ changes: catalog.changes })],
    ["artifact-manifests.json", stablePrettyJson({ artifactManifests: catalog.artifactManifests })],
    ["evidence-appraisals.json", stablePrettyJson({ evidenceAppraisals: catalog.evidenceAppraisals })],
    ["source-index.json", stablePrettyJson(sourceIndex)],
    ["source-identities.ndjson", sourceIndex.identityLookup.map((entry) => JSON.stringify(entry)).join("\n") + "\n"],
    ["source-artifact-index.json", stablePrettyJson(sourceArtifactIndex)],
  ]);
}

async function assertGeneratedArtifactsDeterministic(
  contentRoot: string,
  expectedFiles: ReadonlyMap<string, string>,
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
