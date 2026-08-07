import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");

const commonChildEnvironmentNames = [
  "HOME",
  "PATH",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

export interface R2BucketInfo {
  defaultStorageClass: string;
  location: string;
  name: string;
}

export function assertHostedR2Bucket(input: {
  bucket: R2BucketInfo;
  bucketName: string;
  label: string;
  location: "ENAM" | "OC";
}): void {
  if (input.bucket.name !== input.bucketName) {
    throw new Error(`${input.label} bucket-info response did not match the requested bucket.`);
  }
  if (input.bucket.location.toUpperCase() !== input.location) {
    throw new Error(`${input.label} bucket must report ${input.location}.`);
  }
  if (input.bucket.defaultStorageClass.toLowerCase() !== "standard") {
    throw new Error(`${input.label} bucket must use Standard as its default storage class.`);
  }
}

function buildWranglerR2ChildEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
  return {
    ...pickEnvironment(source, [
      ...commonChildEnvironmentNames,
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_API_KEY",
      "CLOUDFLARE_EMAIL",
      "CF_API_TOKEN",
    ]),
    CI: "1",
    NO_COLOR: "1",
    WRANGLER_HIDE_BANNER: "true",
  };
}

export function createWranglerR2BucketInfoReader(
  source: Readonly<Record<string, string | undefined>>,
): (bucketName: string) => Promise<R2BucketInfo> {
  const environment = buildWranglerR2ChildEnvironment(source);
  return async (bucketName) =>
    parseR2BucketInfoJson(await readR2BucketInfoWithWrangler(bucketName, environment));
}

function parseR2BucketInfoJson(value: string): R2BucketInfo {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("Wrangler returned an invalid R2 bucket-info response.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Wrangler returned an invalid R2 bucket-info response.");
  }
  return {
    defaultStorageClass: requireString(parsed, "default_storage_class"),
    location: requireString(parsed, "location"),
    name: requireString(parsed, "name"),
  };
}

function pickEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  names: readonly string[],
): NodeJS.ProcessEnv {
  const picked: NodeJS.ProcessEnv = {};
  for (const name of names) {
    if (source[name] !== undefined) {
      picked[name] = source[name];
    }
  }
  return picked;
}

async function readR2BucketInfoWithWrangler(
  bucketName: string,
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn("pnpm", [
      "exec",
      "wrangler",
      "r2",
      "bucket",
      "info",
      bucketName,
      "--json",
    ], {
      cwd: appDir,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.resume();
    child.on("error", () => reject(new Error("Hosted deploy R2 bucket-info check could not start.")));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(
          `Hosted deploy R2 bucket-info check failed with exit code ${code ?? "unknown"}.`,
        ));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
  });
}

function requireString(
  record: object,
  key: string,
): string {
  const value = Reflect.get(record, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`R2 bucket info omitted ${key}.`);
  }
  return value;
}
