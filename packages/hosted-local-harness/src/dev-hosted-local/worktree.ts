import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  sanitizeHostedLocalGenericEnvironment,
} from "../authority-env.ts";
import {
  DEFAULT_LINQ_WEBHOOK_TUNNEL_CONFIG,
  DEFAULT_DATABASE_URL,
  HOSTED_LOCAL_PERSISTED_STATE_ENV_NAMES,
  HOSTED_LOCAL_WORKTREE_ROOT,
  HOSTED_LOCAL_WORKTREE_SCOPE_ENV,
  HOSTED_RUNNER_LOCAL_BUILD_ID_ENV,
  USE_REMOTE_HOSTED_CRYPTO_KEYS_ENV,
  repoRoot,
} from "./constants.ts";
import { resolveHostedLocalDevConfig } from "./config.ts";
import { parsePrivateEcP256Jwk } from "./crypto.ts";
import {
  buildHostedRunnerLocalBuildId,
  isHostedLocalTruthyEnvValue,
  parseEnvText,
} from "./environment.ts";
import { parseCloudflaredTunnelHostname } from "./linq-webhook-tunnel.ts";
import type { HostedLocalDevConfig } from "./types.ts";

export interface HostedLocalWorktreeConfig {
  buildId: string;
  databaseName: string;
  databaseUrl: string;
  env: NodeJS.ProcessEnv;
  paths: HostedLocalWorktreePaths;
  ports: HostedLocalWorktreePorts;
  profileName: "dev";
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

export interface HostedLocalWorktreeDatabaseCleanupResult {
  missingCryptoState: boolean;
  removed: boolean;
}

export interface HostedLocalWorktreeLock {
  lockDir: string;
  recordDatabaseCreated(): Promise<void>;
  release(): Promise<void>;
}

interface HostedLocalWorktreeLockOwner {
  databaseCreated: boolean;
  databaseName: string;
  pid: number;
  slug: string;
}

const HOSTED_LOCAL_WORKTREE_PROFILE = "dev";
const HOSTED_LOCAL_WORKTREE_DATABASE_PREFIX = "murph_dev_";
const HOSTED_LOCAL_WORKTREE_LOCK_ROOT = "murph-hosted-local-worktree-locks";
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
const HOSTED_LOCAL_WORKTREE_DEFAULT_WEB_HOST = "localhost";
const HOSTED_LOCAL_WORKTREE_WEB_HOSTS = [
  "localhost",
  "127.0.0.1",
] as const;

type HostedLocalWorktreeWebHost = typeof HOSTED_LOCAL_WORKTREE_WEB_HOSTS[number];

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
  const genericEnvironment = sanitizeHostedLocalGenericEnvironment(input.env);
  assertHostedLocalWorktreeLocalCryptoMode(genericEnvironment);
  const slug = normalizeHostedLocalWorktreeSlug(input.slug);
  const databaseName = buildHostedLocalWorktreeDatabaseName(slug);
  const databaseUrl = buildHostedLocalWorktreeDatabaseUrl(databaseName, genericEnvironment);
  const buildId = `worktree-${slug}`;
  const webHost = resolveHostedLocalWorktreeWebHost(genericEnvironment);
  const webOrigin = buildHostedLocalWorktreeWebOrigin(webHost, input.ports.web);
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
    baseEnv: genericEnvironment,
    buildId,
    databaseUrl,
    paths,
    ports: input.ports,
    slug,
    webHost,
    webOrigin,
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
      webBaseUrl: webOrigin,
      workerBaseUrl: `http://127.0.0.1:${input.ports.worker}`,
    },
  };
}

export async function ensureHostedLocalWorktreeDatabase(
  config: HostedLocalWorktreeConfig,
  options: {
    onCreated?: (() => Promise<void> | void) | null;
  } = {},
): Promise<HostedLocalWorktreeDatabaseState> {
  assertHostedLocalWorktreeLocalCryptoMode(config.env);
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
    await options.onCreated?.();
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

export async function acquireHostedLocalWorktreeLock(
  config: HostedLocalWorktreeConfig,
): Promise<HostedLocalWorktreeLock> {
  const lockRoot = path.join(os.tmpdir(), HOSTED_LOCAL_WORKTREE_LOCK_ROOT);
  const lockDir = path.join(lockRoot, `${config.databaseName}.lock`);
  await mkdir(lockRoot, { mode: 0o700, recursive: true });

  for (;;) {
    try {
      await mkdir(lockDir, { mode: 0o700 });
      break;
    } catch (error) {
      if (!(isNodeError(error) && error.code === "EEXIST")) {
        throw error;
      }
      if (await reclaimDeadHostedLocalWorktreeLock(config, lockDir)) {
        continue;
      }
      throw new Error(
        [
          `Refusing to start hosted-local worktree ${config.slug} because another process already owns database ${config.databaseName}.`,
          "Stop the existing `hosted-local worktree up` process for this slug before starting another one.",
        ].join("\n"),
      );
    }
  }

  let owner: HostedLocalWorktreeLockOwner = {
    databaseCreated: false,
    databaseName: config.databaseName,
    pid: process.pid,
    slug: config.slug,
  };
  try {
    await writeHostedLocalWorktreeLockOwner(lockDir, owner);
  } catch (error) {
    await rm(lockDir, { force: true, recursive: true }).catch(() => {});
    throw error;
  }

  let released = false;
  return {
    lockDir,
    recordDatabaseCreated: async () => {
      if (released) {
        return;
      }
      owner = {
        ...owner,
        databaseCreated: true,
      };
      await writeHostedLocalWorktreeLockOwner(lockDir, owner);
    },
    release: async () => {
      if (released) {
        return;
      }
      released = true;
      await rm(lockDir, { force: true, recursive: true });
    },
  };
}

async function reclaimDeadHostedLocalWorktreeLock(
  config: HostedLocalWorktreeConfig,
  lockDir: string,
): Promise<boolean> {
  const owner = await readHostedLocalWorktreeLockOwner(lockDir);
  if (owner && isHostedLocalWorktreeLockOwnerAlive(owner)) {
    return false;
  }

  if (
    owner?.databaseCreated === true
    && owner.databaseName === config.databaseName
    && owner.slug === config.slug
  ) {
    const cleanup = await removeCreatedHostedLocalWorktreeDatabaseIfCryptoStateMissing(config);
    if (cleanup.missingCryptoState && !cleanup.removed) {
      throw new Error(
        [
          `Refusing to reclaim stale hosted-local worktree lock for ${config.slug} because database ${config.databaseName} was created by the dead owner but could not be removed.`,
          "Drop that slug database manually before retrying.",
        ].join("\n"),
      );
    }
  }

  await rm(lockDir, { force: true, recursive: true });
  return true;
}

async function readHostedLocalWorktreeLockOwner(
  lockDir: string,
): Promise<HostedLocalWorktreeLockOwner | null> {
  let contents: string;
  try {
    contents = await readFile(path.join(lockDir, "owner.json"), "utf8");
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(contents) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    const pid = parsed.pid;
    const databaseName = parsed.databaseName;
    const slug = parsed.slug;
    if (
      typeof pid !== "number"
      || !Number.isInteger(pid)
      || pid <= 0
      || typeof databaseName !== "string"
      || typeof slug !== "string"
    ) {
      return null;
    }
    return {
      databaseCreated: parsed.databaseCreated === true,
      databaseName,
      pid,
      slug,
    };
  } catch {
    return null;
  }
}

function isHostedLocalWorktreeLockOwnerAlive(
  owner: HostedLocalWorktreeLockOwner,
): boolean {
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return !(isNodeError(error) && error.code === "ESRCH");
  }
}

async function writeHostedLocalWorktreeLockOwner(
  lockDir: string,
  owner: HostedLocalWorktreeLockOwner,
): Promise<void> {
  await writeFile(
    path.join(lockDir, "owner.json"),
    `${JSON.stringify(owner)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
}

export function formatHostedLocalWorktreeEnv(
  config: HostedLocalWorktreeConfig,
): string {
  const entries = [
    ["MURPH_HOSTED_LOCAL_PROFILE", config.profileName],
    [HOSTED_LOCAL_WORKTREE_SCOPE_ENV, config.env[HOSTED_LOCAL_WORKTREE_SCOPE_ENV]],
    [HOSTED_RUNNER_LOCAL_BUILD_ID_ENV, config.buildId],
    [HOSTED_LOCAL_WORKTREE_DATABASE_URL_ENV, "[redacted]"],
    [
      "MURPH_DEV_HOSTED_LOCAL_CRYPTO_STATE_PATH",
      config.env.MURPH_DEV_HOSTED_LOCAL_CRYPTO_STATE_PATH,
    ],
    ["MURPH_DEV_WEB_HOST", config.env.MURPH_DEV_WEB_HOST],
    ["MURPH_DEV_WEB_PORT", config.env.MURPH_DEV_WEB_PORT],
    ["DEVICE_SYNC_PUBLIC_BASE_URL", config.env.DEVICE_SYNC_PUBLIC_BASE_URL],
    ["HOSTED_ONBOARDING_PUBLIC_BASE_URL", config.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL],
    [
      "HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS",
      config.env.HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS,
    ],
    ["HOSTED_WEB_BASE_URL", config.env.HOSTED_WEB_BASE_URL],
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
    ["MURPH_DEV_SKIP_STRIPE_LISTEN", config.env.MURPH_DEV_SKIP_STRIPE_LISTEN],
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

export async function prepareHostedLocalWorktreeLinqTunnelConfig(
  config: HostedLocalWorktreeConfig,
): Promise<void> {
  if (!shouldPrepareHostedLocalWorktreeLinqTunnelConfig(config)) {
    return;
  }

  try {
    await readFile(config.paths.linqWebhookTunnelConfigPath, "utf8");
    return;
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT")) {
      throw error;
    }
  }

  for (const candidate of resolveHostedLocalSharedLinqTunnelConfigCandidates(config)) {
    let sourceText: string;
    try {
      sourceText = await readFile(candidate, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    const rewritten = rewriteHostedLocalWorktreeLinqTunnelConfig(sourceText, config);
    if (rewritten === null) {
      continue;
    }

    await mkdir(path.dirname(config.paths.linqWebhookTunnelConfigPath), {
      mode: 0o700,
      recursive: true,
    });
    await writeFile(config.paths.linqWebhookTunnelConfigPath, rewritten, {
      encoding: "utf8",
      mode: 0o600,
    });
    return;
  }
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

export async function removeCreatedHostedLocalWorktreeDatabaseIfCryptoStateMissing(
  config: HostedLocalWorktreeConfig,
): Promise<HostedLocalWorktreeDatabaseCleanupResult> {
  assertHostedLocalWorktreeLocalCryptoMode(config.env);
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
  assertHostedLocalWorktreeLocalCryptoMode(config.env);

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

function assertHostedLocalWorktreeLocalCryptoMode(
  env: Readonly<Record<string, string | undefined>>,
): void {
  if (!isHostedLocalTruthyEnvValue(env[USE_REMOTE_HOSTED_CRYPTO_KEYS_ENV])) {
    return;
  }

  throw new Error(
    [
      `${USE_REMOTE_HOSTED_CRYPTO_KEYS_ENV}=1 is not supported by hosted-local worktree commands.`,
      "Worktree databases are paired with local generated crypto state; use the normal dev profile for remote hosted crypto keys.",
    ].join(" "),
  );
}

function buildHostedLocalWorktreeEnv(input: {
  baseEnv: NodeJS.ProcessEnv;
  buildId: string;
  databaseUrl: string;
  paths: HostedLocalWorktreePaths;
  ports: HostedLocalWorktreePorts;
  slug: string;
  webHost: HostedLocalWorktreeWebHost;
  webOrigin: string;
}): NodeJS.ProcessEnv {
  const env = { ...input.baseEnv };
  delete env.MURPH_DEV_TEMP_DIR;

  return {
    ...env,
    [HOSTED_RUNNER_LOCAL_BUILD_ID_ENV]: input.buildId,
    [HOSTED_LOCAL_WORKTREE_SCOPE_ENV]: input.slug,
    [USE_REMOTE_HOSTED_CRYPTO_KEYS_ENV]: "0",
    DEVICE_SYNC_PUBLIC_BASE_URL: `${input.webOrigin}/api/device-sync`,
    HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS:
      buildHostedLocalWorktreeAllowedMutationOrigins(input.ports.web),
    HOSTED_ONBOARDING_PUBLIC_BASE_URL: input.webOrigin,
    HOSTED_WEB_BASE_URL: input.webOrigin,
    MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "0",
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
    MURPH_DEV_REUSE_EXISTING_WORKER: "0",
    MURPH_DEV_SKIP_STRIPE_LISTEN: input.baseEnv.MURPH_DEV_SKIP_STRIPE_LISTEN ?? "1",
    MURPH_DEV_TEMPORAL:
      input.baseEnv.MURPH_DEV_TEMPORAL?.trim().toLowerCase() === "disabled"
        ? "disabled"
        : "managed",
    MURPH_DEV_TEMPORAL_HOST: "127.0.0.1",
    MURPH_DEV_TEMPORAL_PORT: String(input.ports.temporal),
    MURPH_DEV_WEB_HOST: input.webHost,
    MURPH_DEV_WEB_PORT: String(input.ports.web),
    MURPH_DEV_WORKER_HOST: "127.0.0.1",
    MURPH_DEV_WORKER_PORT: String(input.ports.worker),
    NEXT_DIST_DIR_MODE: "smoke",
    NEXT_DIST_DIR_SUFFIX: input.slug,
  };
}

function resolveHostedLocalWorktreeWebHost(
  env: Readonly<Record<string, string | undefined>>,
): HostedLocalWorktreeWebHost {
  const configured = env.MURPH_DEV_WEB_HOST?.trim().toLowerCase();
  if (!configured) {
    return HOSTED_LOCAL_WORKTREE_DEFAULT_WEB_HOST;
  }
  if (isHostedLocalWorktreeWebHost(configured)) {
    return configured;
  }
  throw new Error(
    "Hosted-local worktree web host must be localhost or 127.0.0.1.",
  );
}

function isHostedLocalWorktreeWebHost(
  value: string,
): value is HostedLocalWorktreeWebHost {
  return HOSTED_LOCAL_WORKTREE_WEB_HOSTS.some((host) => host === value);
}

function buildHostedLocalWorktreeWebOrigin(
  host: HostedLocalWorktreeWebHost,
  port: number,
): string {
  return `http://${host}:${port}`;
}

function buildHostedLocalWorktreeAllowedMutationOrigins(port: number): string {
  return HOSTED_LOCAL_WORKTREE_WEB_HOSTS
    .map((host) => buildHostedLocalWorktreeWebOrigin(host, port))
    .join(",");
}

function buildHostedLocalWorktreeLinqEnv(input: {
  baseEnv: NodeJS.ProcessEnv;
  paths: HostedLocalWorktreePaths;
}): NodeJS.ProcessEnv {
  const tunnelMode = input.baseEnv.MURPH_DEV_LINQ_WEBHOOK_TUNNEL?.trim();
  const skipRegister = input.baseEnv.MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER?.trim();
  const publicUrl = input.baseEnv.MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL?.trim();
  const tunnelConfig = input.baseEnv.MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG?.trim();
  // Worktrees default to no live Linq webhook. Only one local stack can own the
  // single shared dev webhook subscription at a time, so defaulting worktrees
  // off lets multiple worktrees and e2e runs execute in parallel without
  // contending for it. Live delivery is opt-in per session via
  // MURPH_DEV_LINQ_WEBHOOK_TUNNEL=auto|required or an explicit public URL.
  const explicitlyDisabledTunnel = tunnelMode !== undefined
    && tunnelMode.length > 0
    && ["0", "false", "no", "off", "disabled"].includes(tunnelMode.toLowerCase());
  const explicitlyEnabledTunnel = !explicitlyDisabledTunnel
    && (
      (tunnelMode !== undefined && tunnelMode.length > 0)
      || (publicUrl !== undefined && publicUrl.length > 0)
    );
  const shouldRegister = explicitlyEnabledTunnel && skipRegister !== "1";
  const resolvedTunnelMode = explicitlyEnabledTunnel
    ? tunnelMode || "auto"
    : "0";

  return {
    ...(publicUrl ? { MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL: publicUrl } : {}),
    MURPH_DEV_LINQ_WEBHOOK_REGISTRATION_CACHE:
      input.paths.linqWebhookRegistrationCachePath,
    MURPH_DEV_LINQ_WEBHOOK_TUNNEL: resolvedTunnelMode,
    MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG:
      tunnelConfig ?? input.paths.linqWebhookTunnelConfigPath,
    ...(shouldRegister
      ? { MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "0" }
      : { MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1" }),
  };
}

function shouldPrepareHostedLocalWorktreeLinqTunnelConfig(
  config: HostedLocalWorktreeConfig,
): boolean {
  if (config.env.MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL?.trim()) {
    return false;
  }
  if (config.env.MURPH_DEV_LINQ_WEBHOOK_TUNNEL?.trim() === "0") {
    return false;
  }
  return config.env.MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG?.trim()
    === config.paths.linqWebhookTunnelConfigPath;
}

function resolveHostedLocalSharedLinqTunnelConfigCandidates(
  config: HostedLocalWorktreeConfig,
): string[] {
  const currentWorktreeSharedConfig = path.resolve(
    repoRoot,
    DEFAULT_LINQ_WEBHOOK_TUNNEL_CONFIG,
  );
  const worktreeLocalConfig = path.resolve(config.paths.linqWebhookTunnelConfigPath);
  const candidates = [
    currentWorktreeSharedConfig,
    ...resolveGitWorktreeRoots().map((worktreeRoot) =>
      path.resolve(worktreeRoot, DEFAULT_LINQ_WEBHOOK_TUNNEL_CONFIG)
    ),
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (candidate === worktreeLocalConfig || seen.has(candidate)) {
      return false;
    }
    seen.add(candidate);
    return true;
  });
}

function resolveGitWorktreeRoots(): string[] {
  const result = spawnSync("git", ["worktree", "list", "--porcelain", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || typeof result.stdout !== "string") {
    return [];
  }

  return result.stdout
    .split("\0")
    .filter((entry) => entry.startsWith("worktree "))
    .map((entry) => entry.slice("worktree ".length).trim())
    .filter((entry) => entry.length > 0);
}

function rewriteHostedLocalWorktreeLinqTunnelConfig(
  sourceText: string,
  config: HostedLocalWorktreeConfig,
): string | null {
  const webHost = config.env.MURPH_DEV_WEB_HOST?.trim() || HOSTED_LOCAL_WORKTREE_DEFAULT_WEB_HOST;
  const rewritten = sourceText.replace(
    /^(\s*service:\s*)http:\/\/(?:localhost|127\.0\.0\.1):\d+(\s*)$/mu,
    `$1http://${webHost}:${config.ports.web}$2`,
  );
  if (rewritten === sourceText) {
    return null;
  }

  parseCloudflaredTunnelHostname(
    rewritten,
    config.paths.linqWebhookTunnelConfigPath,
    {
      webHost,
      webPort: config.ports.web,
    },
  );
  return rewritten;
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
      ...sanitizeHostedLocalGenericEnvironment(process.env),
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
