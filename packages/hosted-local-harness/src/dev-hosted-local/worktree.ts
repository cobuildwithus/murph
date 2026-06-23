import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import {
  DEFAULT_DATABASE_URL,
  HOSTED_RUNNER_LOCAL_BUILD_ID_ENV,
  USE_REMOTE_HOSTED_CRYPTO_KEYS_ENV,
  repoRoot,
} from "./constants.ts";
import { resolveHostedLocalDevConfig } from "./config.ts";
import { buildHostedRunnerLocalBuildId } from "./environment.ts";
import { cleanupHostedLocalMinioBuildContainersBestEffort } from "./minio.ts";
import { cleanupHostedRunnerContainers } from "./runtime.ts";
import { terminateKnownHostedLocalProcessResidue } from "./stack.ts";
import type { HostedLocalDevConfig } from "./types.ts";

export interface HostedLocalWorktreeConfig {
  buildId: string;
  databaseName: string;
  databaseUrl: string;
  env: NodeJS.ProcessEnv;
  manifestPath: string;
  paths: HostedLocalWorktreePaths;
  ports: HostedLocalWorktreePorts;
  profileName: "worktree";
  slug: string;
  urls: {
    webBaseUrl: string;
    workerBaseUrl: string;
  };
}

export interface HostedLocalWorktreeManifest {
  buildId: string;
  databaseName: string;
  paths: HostedLocalWorktreePaths;
  ports: HostedLocalWorktreePorts;
  profileName: "worktree";
  schemaVersion: 1;
  slug: string;
  updatedAt: string;
  urls: HostedLocalWorktreeConfig["urls"];
}

export interface HostedLocalWorktreePaths {
  cryptoStatePath: string;
  linqWebhookRegistrationCachePath: string;
  linqWebhookTunnelConfigPath: string;
  minioDataDir: string;
  rootDir: string;
  tempDir: string;
  wranglerPersistDir: string;
}

export interface HostedLocalWorktreePorts {
  minio: number;
  temporal: number;
  web: number;
  worker: number;
}

const HOSTED_LOCAL_WORKTREE_PROFILE = "worktree";
const HOSTED_LOCAL_WORKTREE_ROOT = path.join(".tmp", "hosted-local-worktrees");
const HOSTED_LOCAL_WORKTREE_DATABASE_PREFIX = "murph_dev_";
const HOSTED_LOCAL_WORKTREE_PORT_RANGE_SIZE = 300;
const HOSTED_LOCAL_WORKTREE_PORT_RANGES = {
  minio: 9100,
  temporal: 7300,
  web: 3100,
  worker: 8800,
} as const satisfies Record<keyof HostedLocalWorktreePorts, number>;
const HOSTED_LOCAL_WORKTREE_DB_CREATE_SKIP_ENV =
  "MURPH_DEV_SKIP_WORKTREE_DB_CREATE";
const HOSTED_LOCAL_WORKTREE_DATABASE_URL_ENV = "MURPH_DEV_DATABASE_URL";

export async function resolveHostedLocalWorktreeConfig(input: {
  env: NodeJS.ProcessEnv;
  probePorts?: boolean;
  slug: string;
}): Promise<HostedLocalWorktreeConfig> {
  const slug = normalizeHostedLocalWorktreeSlug(input.slug);
  const ports = input.probePorts === false
    ? deriveHostedLocalWorktreePorts(slug)
    : await resolveAvailableHostedLocalWorktreePorts(slug);
  return buildHostedLocalWorktreeConfig({
    env: input.env,
    ports,
    slug,
  });
}

export function buildHostedLocalWorktreeConfig(input: {
  env: NodeJS.ProcessEnv;
  ports: HostedLocalWorktreePorts;
  slug: string;
}): HostedLocalWorktreeConfig {
  const slug = normalizeHostedLocalWorktreeSlug(input.slug);
  const databaseName = buildHostedLocalWorktreeDatabaseName(slug);
  const databaseUrl = buildHostedLocalWorktreeDatabaseUrl(databaseName, input.env);
  const buildId = `worktree-${slug}`;
  const rootDir = path.join(HOSTED_LOCAL_WORKTREE_ROOT, slug);
  const paths = {
    cryptoStatePath: path.join(rootDir, "hosted-local-crypto-state.dev.vars"),
    linqWebhookRegistrationCachePath: path.join(rootDir, "linq-webhook-registration.json"),
    linqWebhookTunnelConfigPath: path.join(rootDir, "cloudflared-linq-webhook.yml"),
    minioDataDir: path.join(rootDir, "minio-r2"),
    rootDir,
    tempDir: path.join(rootDir, "temp"),
    wranglerPersistDir: path.posix.join(
      "..",
      ".tmp",
      "hosted-local-worktrees",
      slug,
      "wrangler-state",
    ),
  } satisfies HostedLocalWorktreePaths;
  const env = buildHostedLocalWorktreeEnv({
    baseEnv: input.env,
    buildId,
    databaseUrl,
    paths,
    ports: input.ports,
    slug,
  });
  return {
    buildId,
    databaseName,
    databaseUrl,
    env,
    manifestPath: path.join(rootDir, "manifest.json"),
    paths,
    ports: input.ports,
    profileName: HOSTED_LOCAL_WORKTREE_PROFILE,
    slug,
    urls: {
      webBaseUrl: `http://127.0.0.1:${input.ports.web}`,
      workerBaseUrl: `http://127.0.0.1:${input.ports.worker}`,
    },
  };
}

export function buildHostedLocalWorktreeManifest(
  config: HostedLocalWorktreeConfig,
): HostedLocalWorktreeManifest {
  return {
    buildId: config.buildId,
    databaseName: config.databaseName,
    paths: config.paths,
    ports: config.ports,
    profileName: config.profileName,
    schemaVersion: 1,
    slug: config.slug,
    updatedAt: new Date().toISOString(),
    urls: config.urls,
  };
}

export async function writeHostedLocalWorktreeManifest(
  config: HostedLocalWorktreeConfig,
): Promise<HostedLocalWorktreeManifest> {
  const manifest = buildHostedLocalWorktreeManifest(config);
  const manifestPath = path.join(repoRoot, config.manifestPath);
  await mkdir(path.dirname(manifestPath), { mode: 0o700, recursive: true });
  const tempPath = `${manifestPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tempPath, manifestPath);
  return manifest;
}

async function readHostedLocalWorktreeManifest(
  slug: string,
): Promise<Pick<HostedLocalWorktreeManifest, "ports"> | null> {
  try {
    const manifestPath = path.join(
      repoRoot,
      HOSTED_LOCAL_WORKTREE_ROOT,
      slug,
      "manifest.json",
    );
    const contents = await readFile(manifestPath, "utf8");
    return parseHostedLocalWorktreeManifest(contents, slug);
  } catch {
    return null;
  }
}

export async function ensureHostedLocalWorktreeDatabase(
  config: HostedLocalWorktreeConfig,
): Promise<void> {
  if (config.env[HOSTED_LOCAL_WORKTREE_DB_CREATE_SKIP_ENV]?.trim() === "1") {
    return;
  }

  const database = parseHostedLocalWorktreeDatabaseUrl(config.databaseUrl);
  const commonArgs = [
    "--host",
    database.host,
    "--port",
    String(database.port),
    "--username",
    database.username,
  ];
  const commonEnv = {
    ...process.env,
    PGCONNECT_TIMEOUT: "5",
    ...(database.password ? { PGPASSWORD: database.password } : {}),
  };
  const createResult = spawnSync("createdb", [
    ...commonArgs,
    database.databaseName,
  ], {
    encoding: "utf8",
    env: commonEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (createResult.status === 0) {
    return;
  }

  const checkResult = spawnSync("psql", [
    ...commonArgs,
    "--dbname",
    database.databaseName,
    "--command",
    "select 1",
  ], {
    encoding: "utf8",
    env: commonEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (checkResult.status === 0) {
    await assertHostedLocalWorktreeCryptoStatePresentForExistingDatabase(config);
    return;
  }

  const createDiagnostic = redactHostedLocalWorktreeDatabaseDiagnostic(
    createResult.stderr || createResult.stdout || createResult.error?.message || "",
  );
  const checkDiagnostic = redactHostedLocalWorktreeDatabaseDiagnostic(
    checkResult.stderr || checkResult.stdout || checkResult.error?.message || "",
  );
  throw new Error(
    [
      `Unable to create or reach local Postgres database ${database.databaseName}.`,
      "Start local Postgres on 127.0.0.1:5432, create the database manually,",
      `or set ${HOSTED_LOCAL_WORKTREE_DB_CREATE_SKIP_ENV}=1 if the database already exists.`,
      createDiagnostic ? `createdb: ${createDiagnostic}` : null,
      checkDiagnostic ? `psql: ${checkDiagnostic}` : null,
    ].filter(Boolean).join("\n"),
  );
}

export async function stopHostedLocalWorktreeResources(input: {
  env: NodeJS.ProcessEnv;
  slug: string;
}): Promise<void> {
  const slug = normalizeHostedLocalWorktreeSlug(input.slug);
  const manifest = await readHostedLocalWorktreeManifest(slug);
  const config = manifest
    ? buildHostedLocalWorktreeConfig({
        env: input.env,
        ports: manifest.ports,
        slug,
      })
    : await resolveHostedLocalWorktreeConfig({
        env: input.env,
        probePorts: false,
        slug,
      });
  const devConfig = resolveHostedLocalDevConfig(config.env);
  terminateKnownHostedLocalProcessResidue({
    config: devConfig,
    owned: {
      cloudflareWorker: true,
      healthCommons: false,
      linqTunnel: true,
      stripe: true,
      temporalServer: true,
      temporalWorker: false,
      web: true,
    },
    signal: "SIGTERM",
    stripeForwardUrl: `${config.urls.webBaseUrl}/api/hosted-onboarding/stripe/webhook`,
  });
  await cleanupHostedRunnerContainers({
    cwd: repoRoot,
    env: config.env,
    ignoreErrors: true,
    scope: "current-build",
  });
  await cleanupHostedLocalMinioBuildContainersBestEffort(config.env, config.buildId);
  await rm(path.join(repoRoot, config.manifestPath), { force: true });
}

export function formatHostedLocalWorktreeEnv(
  config: HostedLocalWorktreeConfig,
): string {
  const entries = [
    ["MURPH_HOSTED_LOCAL_PROFILE", config.profileName],
    [HOSTED_RUNNER_LOCAL_BUILD_ID_ENV, config.buildId],
    [HOSTED_LOCAL_WORKTREE_DATABASE_URL_ENV, "[redacted]"],
    [
      "MURPH_DEV_HOSTED_LOCAL_CRYPTO_STATE_PATH",
      config.env.MURPH_DEV_HOSTED_LOCAL_CRYPTO_STATE_PATH,
    ],
    ["MURPH_DEV_WEB_HOST", config.env.MURPH_DEV_WEB_HOST],
    ["MURPH_DEV_WEB_PORT", config.env.MURPH_DEV_WEB_PORT],
    ["MURPH_DEV_WORKER_HOST", config.env.MURPH_DEV_WORKER_HOST],
    ["MURPH_DEV_WORKER_PORT", config.env.MURPH_DEV_WORKER_PORT],
    ["MURPH_DEV_TEMPORAL", config.env.MURPH_DEV_TEMPORAL],
    ["MURPH_DEV_TEMPORAL_HOST", config.env.MURPH_DEV_TEMPORAL_HOST],
    ["MURPH_DEV_TEMPORAL_PORT", config.env.MURPH_DEV_TEMPORAL_PORT],
    ["MURPH_DEV_TEMP_DIR", config.env.MURPH_DEV_TEMP_DIR],
    ["MURPH_DEV_CF_PERSIST_DIR", config.env.MURPH_DEV_CF_PERSIST_DIR],
    ["MURPH_DEV_MINIO_DATA_DIR", config.env.MURPH_DEV_MINIO_DATA_DIR],
    ["MURPH_DEV_MINIO_PORT", config.env.MURPH_DEV_MINIO_PORT],
    [
      "MURPH_DEV_LINQ_WEBHOOK_REGISTRATION_CACHE",
      config.env.MURPH_DEV_LINQ_WEBHOOK_REGISTRATION_CACHE,
    ],
    [
      "MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG",
      config.env.MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG,
    ],
    ["NEXT_DIST_DIR_MODE", config.env.NEXT_DIST_DIR_MODE],
    ["NEXT_DIST_DIR_SUFFIX", config.env.NEXT_DIST_DIR_SUFFIX],
  ] as const;

  return [
    `# hosted-local worktree ${config.slug}`,
    `# database: ${config.databaseName}`,
    `# manifest: ${config.manifestPath}`,
    ...entries.map(([key, value]) => `export ${key}=${shellQuote(value ?? "")}`),
    "",
  ].join("\n");
}

export function resolveHostedLocalWorktreeBuildId(slug: string): string {
  return buildHostedRunnerLocalBuildId(`worktree-${normalizeHostedLocalWorktreeSlug(slug)}`);
}

export function resolveHostedLocalWorktreeDevConfig(input: {
  env: NodeJS.ProcessEnv;
  slug: string;
}): HostedLocalDevConfig {
  const slug = normalizeHostedLocalWorktreeSlug(input.slug);
  const config = buildHostedLocalWorktreeConfig({
    env: input.env,
    ports: deriveHostedLocalWorktreePorts(slug),
    slug,
  });
  return resolveHostedLocalDevConfig(config.env);
}

async function assertHostedLocalWorktreeCryptoStatePresentForExistingDatabase(
  config: HostedLocalWorktreeConfig,
): Promise<void> {
  if (isTruthyEnvValue(config.env[USE_REMOTE_HOSTED_CRYPTO_KEYS_ENV])) {
    return;
  }

  try {
    await access(path.join(repoRoot, config.paths.cryptoStatePath));
  } catch {
    throw new Error(
      [
        `Refusing to reuse local Postgres database ${config.databaseName} because its paired hosted-local crypto state file is missing.`,
        `Expected crypto state: ${config.paths.cryptoStatePath}`,
        "Drop that slug database or restore the crypto state file before running the worktree stack again.",
      ].join("\n"),
    );
  }
}

function isTruthyEnvValue(value: string | undefined): boolean {
  return value !== undefined
    && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function buildHostedLocalWorktreeEnv(input: {
  baseEnv: NodeJS.ProcessEnv;
  buildId: string;
  databaseUrl: string;
  paths: HostedLocalWorktreePaths;
  ports: HostedLocalWorktreePorts;
  slug: string;
}): NodeJS.ProcessEnv {
  return {
    ...input.baseEnv,
    [HOSTED_RUNNER_LOCAL_BUILD_ID_ENV]: input.buildId,
    MURPH_HOSTED_LOCAL_PROFILE: HOSTED_LOCAL_WORKTREE_PROFILE,
    MURPH_DEV_CF_PERSIST_DIR: input.paths.wranglerPersistDir,
    MURPH_DEV_DATABASE_URL: input.databaseUrl,
    MURPH_DEV_HOSTED_LOCAL_CRYPTO_STATE_PATH: input.paths.cryptoStatePath,
    MURPH_DEV_LINQ_WEBHOOK_REGISTRATION_CACHE:
      input.paths.linqWebhookRegistrationCachePath,
    MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG: input.paths.linqWebhookTunnelConfigPath,
    MURPH_DEV_MINIO_DATA_DIR: input.paths.minioDataDir,
    MURPH_DEV_MINIO_PORT: String(input.ports.minio),
    MURPH_DEV_TEMP_DIR: input.paths.tempDir,
    MURPH_DEV_TEMPORAL: "managed",
    MURPH_DEV_TEMPORAL_HOST: "127.0.0.1",
    MURPH_DEV_TEMPORAL_PORT: String(input.ports.temporal),
    MURPH_DEV_WEB_HOST: "127.0.0.1",
    MURPH_DEV_WEB_PORT: String(input.ports.web),
    MURPH_DEV_WORKER_HOST: "127.0.0.1",
    MURPH_DEV_WORKER_PORT: String(input.ports.worker),
    NEXT_DIST_DIR_MODE: "smoke",
    NEXT_DIST_DIR_SUFFIX: input.slug,
  };
}

function normalizeHostedLocalWorktreeSlug(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/u.test(normalized)) {
    throw new Error(
      "Hosted-local worktree slug must be 2-40 lowercase letters, digits, or hyphens and must start and end with a letter or digit.",
    );
  }
  return normalized;
}

function buildHostedLocalWorktreeDatabaseName(slug: string): string {
  return `${HOSTED_LOCAL_WORKTREE_DATABASE_PREFIX}${slug.replace(/-/gu, "_")}`;
}

function buildHostedLocalWorktreeDatabaseUrl(
  databaseName: string,
  env: NodeJS.ProcessEnv,
): string {
  const url = new URL(resolveHostedLocalWorktreeDatabaseBaseUrl(env));
  url.pathname = `/${databaseName}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function resolveHostedLocalWorktreeDatabaseBaseUrl(env: NodeJS.ProcessEnv): string {
  for (const candidate of [
    env.MURPH_DEV_DATABASE_URL,
    env.DATABASE_URL,
    DEFAULT_DATABASE_URL,
  ]) {
    if (isLoopbackPostgresUrl(candidate)) {
      return candidate;
    }
  }
  return DEFAULT_DATABASE_URL;
}

function deriveHostedLocalWorktreePorts(slug: string): HostedLocalWorktreePorts {
  return {
    minio: deriveHostedLocalWorktreePort(slug, "minio"),
    temporal: deriveHostedLocalWorktreePort(slug, "temporal"),
    web: deriveHostedLocalWorktreePort(slug, "web"),
    worker: deriveHostedLocalWorktreePort(slug, "worker"),
  };
}

async function resolveAvailableHostedLocalWorktreePorts(
  slug: string,
): Promise<HostedLocalWorktreePorts> {
  const preferred = deriveHostedLocalWorktreePorts(slug);
  return {
    minio: await pickAvailableHostedLocalWorktreePort("127.0.0.1", preferred.minio, "minio"),
    temporal: await pickAvailableHostedLocalWorktreePort(
      "127.0.0.1",
      preferred.temporal,
      "temporal",
    ),
    web: await pickAvailableHostedLocalWorktreePort("127.0.0.1", preferred.web, "web"),
    worker: await pickAvailableHostedLocalWorktreePort(
      "127.0.0.1",
      preferred.worker,
      "worker",
    ),
  };
}

function deriveHostedLocalWorktreePort(
  slug: string,
  name: keyof HostedLocalWorktreePorts,
): number {
  const base = HOSTED_LOCAL_WORKTREE_PORT_RANGES[name];
  const hash = createHash("sha256").update(`${slug}:${name}`).digest("hex");
  const offset = Number.parseInt(hash.slice(0, 8), 16)
    % HOSTED_LOCAL_WORKTREE_PORT_RANGE_SIZE;
  return base + offset;
}

function parseHostedLocalWorktreeManifest(
  contents: string,
  slug: string,
): Pick<HostedLocalWorktreeManifest, "ports"> | null {
  const parsed = JSON.parse(contents) as unknown;
  if (!isRecord(parsed)) {
    return null;
  }
  if (
    parsed.schemaVersion !== 1
    || parsed.profileName !== HOSTED_LOCAL_WORKTREE_PROFILE
    || parsed.slug !== slug
  ) {
    return null;
  }
  if (!isRecord(parsed.ports)) {
    return null;
  }

  const ports = {
    minio: parseHostedLocalWorktreeManifestPort(parsed.ports.minio, "minio"),
    temporal: parseHostedLocalWorktreeManifestPort(
      parsed.ports.temporal,
      "temporal",
    ),
    web: parseHostedLocalWorktreeManifestPort(parsed.ports.web, "web"),
    worker: parseHostedLocalWorktreeManifestPort(parsed.ports.worker, "worker"),
  };
  if (
    ports.minio === null
    || ports.temporal === null
    || ports.web === null
    || ports.worker === null
  ) {
    return null;
  }

  return {
    ports: {
      minio: ports.minio,
      temporal: ports.temporal,
      web: ports.web,
      worker: ports.worker,
    },
  };
}

function parseHostedLocalWorktreeManifestPort(
  value: unknown,
  name: keyof HostedLocalWorktreePorts,
): number | null {
  if (!Number.isInteger(value)) {
    return null;
  }
  const port = value as number;
  const base = HOSTED_LOCAL_WORKTREE_PORT_RANGES[name];
  const max = base + HOSTED_LOCAL_WORKTREE_PORT_RANGE_SIZE - 1;
  return port >= base && port <= max ? port : null;
}

async function pickAvailableHostedLocalWorktreePort(
  host: string,
  preferredPort: number,
  name: keyof HostedLocalWorktreePorts,
): Promise<number> {
  const base = HOSTED_LOCAL_WORKTREE_PORT_RANGES[name];
  const initialOffset = preferredPort - base;
  for (let attempt = 0; attempt < HOSTED_LOCAL_WORKTREE_PORT_RANGE_SIZE; attempt += 1) {
    const port = base + ((initialOffset + attempt) % HOSTED_LOCAL_WORKTREE_PORT_RANGE_SIZE);
    if (await isPortAvailable(host, port)) {
      return port;
    }
  }

  throw new Error(`No available hosted-local worktree ${name} port in ${base}-${base + HOSTED_LOCAL_WORKTREE_PORT_RANGE_SIZE - 1}.`);
}

async function isPortAvailable(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (isNodeError(error) && error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      reject(error);
    });
    server.once("listening", () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(true);
      });
    });
    server.listen(port, host);
  });
}

function parseHostedLocalWorktreeDatabaseUrl(value: string): {
  databaseName: string;
  host: string;
  password: string;
  port: number;
  username: string;
} {
  const url = new URL(value);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("Hosted-local worktree database URL must use PostgreSQL.");
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("Hosted-local worktree database URL must use loopback Postgres.");
  }
  return {
    databaseName: decodeURIComponent(url.pathname.replace(/^\//u, "")),
    host: url.hostname,
    password: decodeURIComponent(url.password),
    port: url.port ? Number.parseInt(url.port, 10) : 5432,
    username: decodeURIComponent(url.username || "postgres"),
  };
}

function isLoopbackPostgresUrl(value: string | undefined): value is string {
  if (!value?.trim()) {
    return false;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "postgresql:" || url.protocol === "postgres:")
      && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function redactHostedLocalWorktreeDatabaseDiagnostic(value: string): string {
  return value
    .replace(/postgresql:\/\/[^\s"'`]+/giu, "postgresql://<redacted>")
    .replace(/password[^\r\n]*/giu, "password <redacted>")
    .split(repoRoot)
    .join("<REPO_ROOT>")
    .trim()
    .slice(0, 500);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
