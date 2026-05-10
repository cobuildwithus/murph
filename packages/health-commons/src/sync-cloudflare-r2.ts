import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { HealthCommonsArtifactPointer } from "@murphai/contracts";

import { readAllHealthCommonsArtifactManifests } from "./load.ts";
import { sha256Buffer } from "./normalize.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

export interface CliOptions {
  allowUnclearedRights: boolean;
  artifactRoot: string;
  bucket: string | null;
  contentRoot: string;
  dryRun: boolean;
  remote: boolean;
}

interface UploadCandidate {
  artifact: HealthCommonsArtifactPointer;
  artifactRoot: string;
  absoluteLocalPath: string;
  manifestKey: string;
}

const ALLOWED_R2_LOCAL_PATH_PREFIXES = [
  "research-artifacts/",
  "source-artifacts/",
] as const;

export async function syncHealthCommonsArtifactsToCloudflareR2(options: CliOptions): Promise<void> {
  const manifests = await readAllHealthCommonsArtifactManifests(options.contentRoot);
  const candidates: UploadCandidate[] = [];
  const artifactRoot = path.resolve(options.artifactRoot);

  for (const manifest of manifests) {
    for (const artifact of manifest.artifacts) {
      if (artifact.storage !== "cloudflare-r2") {
        continue;
      }
      if (!artifact.localPath) {
        continue;
      }
      candidates.push({
        artifact,
        artifactRoot,
        absoluteLocalPath: path.resolve(artifactRoot, artifact.localPath),
        manifestKey: manifest.manifestKey,
      });
    }
  }

  if (candidates.length === 0) {
    console.log("No Cloudflare R2 artifact candidates with localPath were found.");
    return;
  }

  const bucket = options.bucket ?? process.env.MURPH_COMMONS_R2_BUCKET ?? (options.dryRun ? "<bucket>" : null);
  if (!bucket) {
    throw new Error("Missing Cloudflare R2 bucket. Pass --bucket or set MURPH_COMMONS_R2_BUCKET.");
  }

  for (const candidate of candidates) {
    const objectPath = `${bucket}/${candidate.artifact.objectKey}`;
    const args = ["r2", "object", "put", objectPath, "--file", candidate.absoluteLocalPath];
    if (candidate.artifact.contentType) {
      args.push("--content-type", candidate.artifact.contentType);
    }
    if (options.remote) {
      args.push("--remote");
    }

    if (options.dryRun) {
      const policyIssues = collectPolicyIssues(candidate, options.allowUnclearedRights);
      if (policyIssues.length > 0) {
        console.log(`DRY RUN BLOCKED ${candidate.artifact.artifactId}: ${policyIssues.join("; ")}`);
      } else {
        console.log(`DRY RUN ${formatCommand(args)}`);
      }
      continue;
    }

    await validateCandidate(candidate, options.allowUnclearedRights);

    const result = spawnSync("pnpm", ["--dir", "apps/cloudflare", "exec", "wrangler", ...args], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      throw new Error(`wrangler failed for ${candidate.artifact.artifactId} from ${candidate.manifestKey}.`);
    }
  }
}

function collectPolicyIssues(candidate: UploadCandidate, allowUnclearedRights: boolean): string[] {
  const { artifact } = candidate;
  const issues: string[] = [];

  if (!artifact.objectKey) {
    issues.push("missing objectKey");
  }

  if (!artifact.redistributable && !allowUnclearedRights) {
    issues.push("artifact is not marked redistributable");
  }

  if (["unknown", "permission_required", "not_redistributable"].includes(artifact.rightsStatus) && !allowUnclearedRights) {
    issues.push(`rightsStatus=${artifact.rightsStatus}`);
  }

  if (artifact.byteSize === undefined) {
    issues.push("missing byteSize");
  }

  if (!artifact.sha256) {
    issues.push("missing sha256");
  }

  issues.push(...collectLocalPathPolicyIssues(candidate));

  return issues;
}

async function validateCandidate(candidate: UploadCandidate, allowUnclearedRights: boolean): Promise<void> {
  const policyIssues = collectPolicyIssues(candidate, allowUnclearedRights);
  if (policyIssues.length > 0) {
    throw new Error(`${candidate.artifact.artifactId} cannot be uploaded: ${policyIssues.join("; ")}`);
  }

  const { artifact } = candidate;
  const fileStat = await stat(candidate.absoluteLocalPath);

  if (artifact.byteSize !== fileStat.size) {
    throw new Error(`${artifact.artifactId} byteSize mismatch. Expected ${artifact.byteSize}, got ${fileStat.size}.`);
  }

  const raw = await readFile(candidate.absoluteLocalPath);
  const actualSha256 = sha256Buffer(raw);
  if (artifact.sha256 !== actualSha256) {
    throw new Error(`${artifact.artifactId} sha256 mismatch. Expected ${artifact.sha256}, got ${actualSha256}.`);
  }
}

function collectLocalPathPolicyIssues(candidate: UploadCandidate): string[] {
  const localPath = candidate.artifact.localPath ?? "";
  const normalizedLocalPath = localPath.replace(/\\/gu, "/");
  const issues: string[] = [];

  if (!normalizedLocalPath || path.posix.isAbsolute(normalizedLocalPath)) {
    issues.push("localPath must be relative");
    return issues;
  }

  const segments = normalizedLocalPath.split("/");
  if (
    segments.some((segment) =>
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      segment.startsWith(".")
    )
  ) {
    issues.push("localPath contains an unsafe path segment");
  }

  const allowedPrefix = ALLOWED_R2_LOCAL_PATH_PREFIXES.find((prefix) =>
    normalizedLocalPath.startsWith(prefix),
  );
  if (!allowedPrefix) {
    issues.push(`localPath must start with ${ALLOWED_R2_LOCAL_PATH_PREFIXES.join(" or ")}`);
  }

  if (!isPathWithinRoot(candidate.artifactRoot, candidate.absoluteLocalPath)) {
    issues.push("localPath escapes artifactRoot");
  }

  if (allowedPrefix) {
    const allowedRoot = path.resolve(candidate.artifactRoot, allowedPrefix);
    if (!isPathWithinRoot(allowedRoot, candidate.absoluteLocalPath)) {
      issues.push("localPath escapes its artifact staging root");
    }
  }

  return issues;
}

function isPathWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function formatCommand(args: readonly string[]): string {
  return ["pnpm", "--dir", "apps/cloudflare", "exec", "wrangler", ...args]
    .map((arg) => (/[\s"]/u.test(arg) ? JSON.stringify(arg) : arg))
    .join(" ");
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    allowUnclearedRights: false,
    artifactRoot: repoRoot,
    bucket: null,
    contentRoot: path.join(packageRoot, "content"),
    dryRun: false,
    remote: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allow-uncleared-rights") {
      options.allowUnclearedRights = true;
      continue;
    }
    if (arg === "--artifact-root") {
      options.artifactRoot = path.resolve(requireNext(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--bucket") {
      options.bucket = requireNext(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--content-root") {
      options.contentRoot = path.resolve(requireNext(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--local") {
      options.remote = false;
      continue;
    }
    if (arg === "--remote") {
      options.remote = true;
      continue;
    }
    throw new Error(`Unknown health-commons artifact sync argument: ${arg}`);
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
  syncHealthCommonsArtifactsToCloudflareR2(parseCliOptions(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
