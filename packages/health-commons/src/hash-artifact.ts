import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { sha256Buffer } from "./normalize.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

interface CliOptions {
  artifactId: string | null;
  contentType: string;
  file: string | null;
  kind: string;
  localPath: string | null;
  objectKey: string | null;
  rightsStatus: string;
  redistributable: boolean;
  sourceKey: string | null;
  sourceUrl: string | null;
  storage: string;
}

export async function printArtifactMetadata(options: CliOptions): Promise<void> {
  if (!options.file) {
    throw new Error("Missing --file. Pass the path to the local artifact you want to hash.");
  }

  const absoluteFile = path.resolve(options.file);
  const raw = await readFile(absoluteFile);
  const fileStat = await stat(absoluteFile);

  const parsed = path.parse(absoluteFile);
  const stem = toStableIdSegment(parsed.name);
  const extension = parsed.ext || ".bin";
  const localPath = options.localPath ?? defaultLocalPath(absoluteFile);

  const artifact = {
    artifactId: options.artifactId ?? `art_${stem}_${toStableIdSegment(extension.replace(/^\./u, "") || "bin")}`,
    sourceKey: options.sourceKey ?? undefined,
    kind: options.kind,
    storage: options.storage,
    objectKey: options.objectKey ?? `commons/research/sauna/${stem}/source${extension}`,
    localPath,
    contentType: options.contentType,
    sha256: sha256Buffer(raw),
    byteSize: fileStat.size,
    rightsStatus: options.rightsStatus,
    redistributable: options.redistributable,
    sourceUrl: options.sourceUrl ?? undefined,
  };

  console.log(JSON.stringify(artifact, null, 2));
}

function defaultLocalPath(absoluteFile: string): string {
  const relativeLocalPath = normalizePath(path.relative(repoRoot, absoluteFile));
  if (relativeLocalPath.startsWith("../") || relativeLocalPath === "..") {
    throw new Error("Default localPath only works for files inside the repo. Pass --local-path for external files.");
  }
  return relativeLocalPath;
}

function toStableIdSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._:]/gu, "_").replace(/_+/gu, "_").replace(/^_+|_+$/gu, "") || "artifact";
}

function normalizePath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    artifactId: null,
    contentType: "application/pdf",
    file: null,
    kind: "pdf",
    localPath: null,
    objectKey: null,
    rightsStatus: "permission_required",
    redistributable: false,
    sourceKey: null,
    sourceUrl: null,
    storage: "cloudflare-r2",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--artifact-id") {
      options.artifactId = requireNext(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--content-type") {
      options.contentType = requireNext(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--file") {
      options.file = requireNext(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--kind") {
      options.kind = requireNext(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--local-path") {
      options.localPath = requireNext(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--object-key") {
      options.objectKey = requireNext(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--rights-status") {
      options.rightsStatus = requireNext(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--redistributable") {
      options.redistributable = true;
      continue;
    }
    if (arg === "--source-key") {
      options.sourceKey = requireNext(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--source-url") {
      options.sourceUrl = requireNext(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--storage") {
      options.storage = requireNext(argv, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown hash-artifact argument: ${arg}`);
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
  printArtifactMetadata(parseCliOptions(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
