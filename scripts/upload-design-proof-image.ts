import { execFileSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com";
const CONFIG_KEYS = [
  "CLOUDFLARE_IMAGES_ACCOUNT_ID",
  "CLOUDFLARE_IMAGES_API_KEY",
] as const;
const ENV_FILE_NAMES = [".env.local", ".env"];
const MAX_ENV_FILE_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const UPLOAD_TIMEOUT_MS = 30_000;
const VERIFY_TIMEOUT_MS = 15_000;

const HELP = `Usage:
  pnpm design-proof:upload -- <screenshot> [screenshot ...]

Uploads PNG, JPEG, or WebP design-proof screenshots to Cloudflare Images.
When a task worktree has no local credential, the command reads only the
required Cloudflare Images settings from the primary checkout's ignored
.env.local or .env file. Each verified public URL is printed on its own line.
`;

export class DesignProofUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignProofUploadError";
  }
}

function fail(message: string): DesignProofUploadError {
  return new DesignProofUploadError(message);
}

type RepoRoots = {
  currentRepoRoot: string;
  primaryRepoRoot: string;
};

type CloudflareImagesConfig = {
  accountId: string;
  apiKey: string;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type CliArgs = {
  files: string[];
  help: boolean;
};

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code;
}

function runGit(cwd: string, args: string[]): string {
  const gitEnvironment = { ...process.env };
  for (const key of CONFIG_KEYS) {
    delete gitEnvironment[key];
  }
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: gitEnvironment,
      maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim();
  } catch {
    throw fail("Could not discover the repository checkout through Git.");
  }
}

export function discoverRepoRoots(cwd = process.cwd()): RepoRoots {
  const currentRepoRoot = path.resolve(
    runGit(cwd, ["rev-parse", "--show-toplevel"]),
  );
  const commonGitDir = path.resolve(
    runGit(cwd, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]),
  );
  if (path.basename(commonGitDir) !== ".git") {
    throw fail("Could not locate the primary repository checkout.");
  }

  const primaryRepoRoot = path.dirname(commonGitDir);
  const confirmedPrimaryRoot = path.resolve(
    runGit(primaryRepoRoot, ["rev-parse", "--show-toplevel"]),
  );
  if (confirmedPrimaryRoot !== path.resolve(primaryRepoRoot)) {
    throw fail("Could not verify the primary repository checkout.");
  }

  return { currentRepoRoot, primaryRepoRoot };
}

export function resolveEnvFilePaths({
  currentRepoRoot,
  primaryRepoRoot,
}: RepoRoots): string[] {
  const paths: string[] = [];
  for (const repoRoot of new Set([currentRepoRoot, primaryRepoRoot])) {
    for (const fileName of ENV_FILE_NAMES) {
      paths.push(path.join(repoRoot, fileName));
    }
  }
  return paths;
}

type RegularFileOptions = {
  label: string;
  maxBytes: number;
  optional?: boolean;
};

async function readRegularFileNoFollow(
  filePath: string,
  options: RegularFileOptions & { optional: true },
): Promise<Buffer | null>;
async function readRegularFileNoFollow(
  filePath: string,
  options: RegularFileOptions & { optional?: false },
): Promise<Buffer>;
async function readRegularFileNoFollow(
  filePath: string,
  { label, maxBytes, optional = false }: RegularFileOptions,
): Promise<Buffer | null> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(
      filePath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
  } catch (error) {
    if (optional && hasErrorCode(error, "ENOENT")) {
      return null;
    }
    throw fail(`Could not read ${label} as a regular file.`);
  }

  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw fail(`Could not read ${label} as a regular file.`);
    }
    if (stats.size === 0) {
      throw fail(`${label} is empty.`);
    }
    if (stats.size > maxBytes) {
      throw fail(`${label} exceeds the ${maxBytes} byte limit.`);
    }
    return await handle.readFile();
  } catch (error) {
    if (error instanceof DesignProofUploadError) {
      throw error;
    }
    throw fail(`Could not read ${label}.`);
  } finally {
    await handle.close();
  }
}

function readNonempty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function loadCloudflareImagesConfig({
  cwd = process.cwd(),
  env = process.env,
  repoRoots,
}: {
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
  repoRoots?: RepoRoots;
} = {}): Promise<CloudflareImagesConfig> {
  const values = Object.fromEntries(
    CONFIG_KEYS.map((key) => [key, readNonempty(env[key])]),
  ) as Record<(typeof CONFIG_KEYS)[number], string | null>;
  if (!CONFIG_KEYS.every((key) => values[key])) {
    const roots = repoRoots ?? discoverRepoRoots(cwd);
    for (const envPath of resolveEnvFilePaths(roots)) {
      if (CONFIG_KEYS.every((key) => values[key])) break;

      const contents = await readRegularFileNoFollow(envPath, {
        label: "a local environment file",
        maxBytes: MAX_ENV_FILE_BYTES,
        optional: true,
      });
      if (!contents) continue;

      let parsed;
      try {
        parsed = parseEnv(contents.toString("utf8"));
      } catch {
        throw fail("Could not parse a local environment file.");
      }
      for (const key of CONFIG_KEYS) {
        values[key] ??= readNonempty(parsed[key]);
      }
    }
  }

  const accountId = values.CLOUDFLARE_IMAGES_ACCOUNT_ID;
  const apiKey = values.CLOUDFLARE_IMAGES_API_KEY;
  if (!accountId) {
    throw fail(
      "CLOUDFLARE_IMAGES_ACCOUNT_ID is not exported or present in the invoking or primary checkout environment files.",
    );
  }
  if (!/^[a-f0-9]{32}$/iu.test(accountId)) {
    throw fail("CLOUDFLARE_IMAGES_ACCOUNT_ID is not a valid account ID.");
  }
  if (!apiKey) {
    throw fail(
      "CLOUDFLARE_IMAGES_API_KEY is not exported or present in the invoking or primary checkout environment files.",
    );
  }

  return { accountId, apiKey };
}

function detectImage(bytes: Buffer): {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
} {
  if (
    bytes.length >= 8
    && bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return { extension: "png", contentType: "image/png" };
  }
  if (
    bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
  ) {
    return { extension: "jpg", contentType: "image/jpeg" };
  }
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { extension: "webp", contentType: "image/webp" };
  }
  throw fail("The input is not a supported PNG, JPEG, or WebP image.");
}

async function readBoundedResponseText(response: Response): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw fail("Cloudflare Images returned an oversized response.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function discardResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is already terminal; disposal must not replace the safe error.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readPublicVariant(payload: unknown): string {
  if (
    !isRecord(payload)
    || payload.success !== true
    || !isRecord(payload.result)
    || !Array.isArray(payload.result.variants)
  ) {
    throw fail("Cloudflare Images returned an invalid upload response.");
  }

  for (const candidate of payload.result.variants) {
    if (typeof candidate !== "string") continue;
    try {
      const url = new URL(candidate);
      if (
        url.protocol === "https:"
        && url.hostname === "imagedelivery.net"
        && /^\/[^/]+\/[^/]+\/public$/u.test(url.pathname)
        && url.search === ""
        && url.hash === ""
      ) {
        return url.toString();
      }
    } catch {
      // Continue until the canonical public variant is found.
    }
  }
  throw fail("Cloudflare Images did not return a public delivery variant.");
}

async function verifyPublicImage(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw fail("The uploaded Cloudflare Images URL could not be verified.");
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const valid = response.ok && contentType.startsWith("image/");
  await discardResponse(response);
  if (!valid) {
    throw fail("The uploaded Cloudflare Images URL did not render as an image.");
  }
}

export async function uploadDesignProofImage({
  accountId,
  apiKey,
  fetchImpl = fetch,
  filePath,
  index = 1,
  uploadTimeoutMs = UPLOAD_TIMEOUT_MS,
  verifyTimeoutMs = VERIFY_TIMEOUT_MS,
}: {
  accountId: string;
  apiKey: string;
  fetchImpl?: FetchLike;
  filePath: string;
  index?: number;
  uploadTimeoutMs?: number;
  verifyTimeoutMs?: number;
}): Promise<string> {
  const bytes = await readRegularFileNoFollow(path.resolve(filePath), {
    label: "the design-proof image",
    maxBytes: MAX_IMAGE_BYTES,
  });
  const image = detectImage(bytes);
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: image.contentType }),
    `design-proof-${index}.${image.extension}`,
  );
  form.append("requireSignedURLs", "false");

  const endpoint = new URL(
    `/client/v4/accounts/${accountId}/images/v1`,
    CLOUDFLARE_API_ORIGIN,
  );
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      body: form,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "murph-design-proof-upload",
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(uploadTimeoutMs),
    });
  } catch {
    throw fail("The Cloudflare Images upload request failed.");
  }

  if (!response.ok) {
    await discardResponse(response);
    throw fail(`Cloudflare Images rejected the upload (HTTP ${response.status}).`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await readBoundedResponseText(response));
  } catch (error) {
    if (error instanceof DesignProofUploadError) throw error;
    throw fail("Cloudflare Images returned an invalid upload response.");
  }
  const publicUrl = readPublicVariant(payload);
  await verifyPublicImage(publicUrl, fetchImpl, verifyTimeoutMs);
  return publicUrl;
}

export function parseCliArgs(args: readonly string[]): CliArgs {
  const files: string[] = [];
  let positionalOnly = false;
  for (const arg of args) {
    if (!positionalOnly && (arg === "--help" || arg === "-h")) {
      return { help: true, files: [] };
    }
    if (!positionalOnly && arg === "--") {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && arg.startsWith("-")) {
      throw fail(`Unknown option: ${arg}`);
    }
    files.push(arg);
  }
  if (files.length === 0) {
    throw fail("Provide at least one design-proof screenshot path.");
  }
  return { help: false, files };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const parsed = parseCliArgs(args);
  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }

  const config = await loadCloudflareImagesConfig();
  for (const [index, filePath] of parsed.files.entries()) {
    const publicUrl = await uploadDesignProofImage({
      ...config,
      filePath,
      index: index + 1,
    });
    process.stdout.write(`${publicUrl}\n`);
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    const message = error instanceof DesignProofUploadError
      ? error.message
      : "Unexpected design-proof upload failure.";
    process.stderr.write(`Design-proof upload failed: ${message}\n`);
    process.exitCode = 1;
  });
}
