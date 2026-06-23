import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_DATABASE_URL,
  HOSTED_LOCAL_PERSISTED_STATE_ENV_NAMES,
  HOSTED_RUNNER_LOCAL_BUILD_ID_ENV,
  USE_REMOTE_HOSTED_CRYPTO_KEYS_ENV,
  repoRoot,
} from "./constants.ts";
import { resolveHostedLocalDevConfig } from "./config.ts";
import { parsePrivateEcP256Jwk } from "./crypto.ts";
import { buildHostedRunnerLocalBuildId, parseEnvText } from "./environment.ts";
import type { HostedLocalDevConfig } from "./types.ts";

export interface HostedLocalWorktreeConfig {
  buildId: string;
  databaseName: string;
  databaseUrl: string;
  env: NodeJS.ProcessEnv;
  paths: HostedLocalWorktreePaths;
  ports: HostedLocalWorktreePorts;
  profileName: "worktree";
  slug: string;
  urls: {
    webBaseUrl: string;
    workerBaseUrl: string;
  };
}

export interface HostedLocalWorktreePaths {
  cryptoStatePath: string;
  linqWebhookRegistrationCachePath: string;
  linqWebhookTunnelConfigPath: string;
  minioDataDir: string;
  rootDir: string;
  wranglerPersistDir: string;
}

export interface HostedLocalWorktreePorts {
  minio: number;
  temporal: number;
  web: number;
  worker: number;
}

export interface HostedLocalWorktreeDatabaseState {
  created: boolean;
}

export interface HostedLocalWorktreeDatabaseFailureCleanupResult {
  missingCryptoState: boolean;
  removed: boolean;
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
  return buildHostedLocalWorktreeConfig({
    env: input.env,
    ports: deriveHostedLocalWorktreePorts(slug),
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

export async function ensureHostedLocalWorktreeDatabase(
  config: HostedLocalWorktreeConfig,
): Promise<HostedLocalWorktreeDatabaseState> {
  if (config.env[HOSTED_LOCAL_WORKTREE_DB_CREATE_SKIP_ENV]?.trim() === "1") {
    await assertHostedLocalWorktreeCryptoStatePresentForExistingDatabase(config);
    return { created: false };
  }

  const { commonArgs, commonEnv, database } =
    resolveHostedLocalWorktreeDatabaseCommand(config);
  const createResult = spawnSync("createdb", [
    ...commonArgs,
    database.databaseName,
  ], {
    encoding: "utf8",
    env: commonEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (createResult.status === 0) {
    return { created: true };
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
    return { created: false };
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
    ["MURPH_DEV_LINQ_WEBHOOK_TUNNEL", config.env.MURPH_DEV_LINQ_WEBHOOK_TUNNEL],
    [
      "MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER",
      config.env.MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER,
    ],
    ["NEXT_DIST_DIR_MODE", config.env.NEXT_DIST_DIR_MODE],
    ["NEXT_DIST_DIR_SUFFIX", config.env.NEXT_DIST_DIR_SUFFIX],
  ] as const;

  return [
    `# hosted-local worktree ${config.slug}`,
    `# database: ${config.databaseName}`,
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

export async function removeCreatedHostedLocalWorktreeDatabaseAfterStartupFailureIfCryptoStateMissing(
  config: HostedLocalWorktreeConfig,
): Promise<HostedLocalWorktreeDatabaseFailureCleanupResult> {
  if (isTruthyEnvValue(config.env[USE_REMOTE_HOSTED_CRYPTO_KEYS_ENV])) {
    return { missingCryptoState: false, removed: false };
  }
  if (!await isHostedLocalWorktreeCryptoStateMissing(config)) {
    return { missingCryptoState: false, removed: false };
  }

  const { commonArgs, commonEnv, database } =
    resolveHostedLocalWorktreeDatabaseCommand(config);
  const dropResult = spawnSync("dropdb", [
    ...commonArgs,
    "--if-exists",
    database.databaseName,
  ], {
    encoding: "utf8",
    env: commonEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { missingCryptoState: true, removed: dropResult.status === 0 };
}

async function assertHostedLocalWorktreeCryptoStatePresentForExistingDatabase(
  config: HostedLocalWorktreeConfig,
): Promise<void> {
  if (isTruthyEnvValue(config.env[USE_REMOTE_HOSTED_CRYPTO_KEYS_ENV])) {
    return;
  }

  try {
    const contents = await readHostedLocalWorktreeCryptoStateText(config);
    assertHostedLocalWorktreeCryptoStateContents(contents);
  } catch (error) {
    const reason = error instanceof Error && error.message
      ? error.message
      : "is invalid";
    throw new Error(
      [
        `Refusing to reuse local Postgres database ${config.databaseName} because its paired hosted-local crypto state file ${reason}.`,
        `Expected crypto state: ${config.paths.cryptoStatePath}`,
        "Drop that slug database or restore the crypto state file before running the worktree stack again.",
      ].join("\n"),
    );
  }
}

async function readHostedLocalWorktreeCryptoStateText(
  config: HostedLocalWorktreeConfig,
): Promise<string> {
  try {
    return await readFile(
      path.join(repoRoot, config.paths.cryptoStatePath),
      "utf8",
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error("is missing");
    }
    throw new Error("could not be read");
  }
}

async function isHostedLocalWorktreeCryptoStateMissing(
  config: HostedLocalWorktreeConfig,
): Promise<boolean> {
  try {
    await readFile(
      path.join(repoRoot, config.paths.cryptoStatePath),
      "utf8",
    );
    return false;
  } catch (error) {
    return isNodeError(error) && error.code === "ENOENT";
  }
}

function assertHostedLocalWorktreeCryptoStateContents(contents: string): void {
  const parsed = parseEnvText(contents);
  const missing = HOSTED_LOCAL_PERSISTED_STATE_ENV_NAMES.filter(
    (name) => !parsed[name]?.trim(),
  );
  if (missing.length > 0) {
    throw new Error(`is incomplete; missing ${missing.join(", ")}`);
  }

  if (parsed.HOSTED_CRYPTO_ENV.trim().toLowerCase() !== "local") {
    throw new Error("is not local generated crypto state");
  }

  for (const name of [
    "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK",
    "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK",
    "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
  ] as const) {
    try {
      parsePrivateEcP256Jwk(parsed[name]!, name);
    } catch {
      throw new Error(`has invalid ${name}`);
    }
  }

  for (const name of [
    "HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON",
    "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK",
    "HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON",
  ] as const) {
    assertJsonRecordEnv(parsed[name]!, name);
  }

  const authorityPublicKey = parsed.HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM;
  if (
    !authorityPublicKey.includes("-----BEGIN PUBLIC KEY-----")
    || !authorityPublicKey.includes("-----END PUBLIC KEY-----")
  ) {
    throw new Error("has invalid HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM");
  }
}

function assertJsonRecordEnv(value: string, name: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`has invalid ${name}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`has invalid ${name}`);
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
    ...buildHostedLocalWorktreeLinqEnv({
      baseEnv: input.baseEnv,
      paths: input.paths,
    }),
    MURPH_DEV_MINIO_DATA_DIR: input.paths.minioDataDir,
    MURPH_DEV_MINIO_PORT: String(input.ports.minio),
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

function buildHostedLocalWorktreeLinqEnv(input: {
  baseEnv: NodeJS.ProcessEnv;
  paths: HostedLocalWorktreePaths;
}): NodeJS.ProcessEnv {
  const tunnelMode = input.baseEnv.MURPH_DEV_LINQ_WEBHOOK_TUNNEL?.trim();
  const skipRegister = input.baseEnv.MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER?.trim();
  const publicUrl = input.baseEnv.MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL?.trim();
  const wantsTunnel = tunnelMode !== undefined
    && tunnelMode.length > 0
    && !["0", "false", "no", "off", "disabled"].includes(tunnelMode.toLowerCase());
  const wantsRegistration = skipRegister !== "1"
    && (wantsTunnel || Boolean(publicUrl));
  const resolvedTunnelMode = publicUrl && !tunnelMode ? "auto" : tunnelMode;

  if (!wantsTunnel && !wantsRegistration) {
    return {
      MURPH_DEV_LINQ_WEBHOOK_REGISTRATION_CACHE:
        input.paths.linqWebhookRegistrationCachePath,
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "0",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG: input.paths.linqWebhookTunnelConfigPath,
      MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
    };
  }

  const tunnelConfig = input.baseEnv.MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG?.trim();
  const tunnelName = input.baseEnv.MURPH_DEV_LINQ_WEBHOOK_TUNNEL_NAME?.trim();
  if (wantsTunnel && (!tunnelName || tunnelName === "dev" || !tunnelConfig)) {
    throw new Error(
      [
        "Hosted-local worktree live Linq tunnel delivery requires",
        "MURPH_DEV_LINQ_WEBHOOK_TUNNEL_NAME to be non-default and",
        "MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG to point at a dedicated worktree tunnel config.",
      ].join(" "),
    );
  }

  if (wantsRegistration && !wantsTunnel && !publicUrl) {
    throw new Error(
      "Hosted-local worktree live Linq registration requires MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL or a dedicated tunnel.",
    );
  }

  return {
    MURPH_DEV_LINQ_WEBHOOK_REGISTRATION_CACHE:
      input.paths.linqWebhookRegistrationCachePath,
    MURPH_DEV_LINQ_WEBHOOK_TUNNEL: resolvedTunnelMode ?? "0",
    MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG:
      tunnelConfig ?? input.paths.linqWebhookTunnelConfigPath,
    ...(wantsRegistration
      ? { MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "0" }
      : { MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1" }),
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

function resolveHostedLocalWorktreeDatabaseCommand(config: HostedLocalWorktreeConfig): {
  commonArgs: string[];
  commonEnv: NodeJS.ProcessEnv;
  database: ReturnType<typeof parseHostedLocalWorktreeDatabaseUrl>;
} {
  const database = parseHostedLocalWorktreeDatabaseUrl(config.databaseUrl);
  return {
    commonArgs: [
      "--host",
      database.host,
      "--port",
      String(database.port),
      "--username",
      database.username,
    ],
    commonEnv: {
      ...process.env,
      PGCONNECT_TIMEOUT: "5",
      ...(database.password ? { PGPASSWORD: database.password } : {}),
    },
    database,
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
