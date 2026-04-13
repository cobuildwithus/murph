import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(repoRoot, "apps", "web");
const cloudflareDir = path.join(repoRoot, "apps", "cloudflare");
const cloudflareDevVarsPath = path.join(cloudflareDir, ".dev.vars");
const vercelLinkCandidatePaths = [
  path.join(webDir, ".vercel", "project.json"),
  path.join(webDir, ".vercel", "repo.json"),
  path.join(repoRoot, ".vercel", "project.json"),
  path.join(repoRoot, ".vercel", "repo.json"),
] as const;

const DEFAULT_WEB_HOST = "127.0.0.1";
const DEFAULT_WEB_PORT = 3000;
const DEFAULT_WORKER_HOST = "127.0.0.1";
const DEFAULT_WORKER_PORT = 8787;
const DEFAULT_WORKER_PROTOCOL = "http";
const DEFAULT_WORKER_PERSIST_DIR = path.join(".wrangler", "state", "dev-root");
const DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync";
const HEALTH_TIMEOUT_MS = 90_000;
const HEALTH_POLL_INTERVAL_MS = 500;
const HOSTED_WEB_DEV_DIST_DIR = ".next-dev";
const HOSTED_WEB_SMOKE_DIST_DIR = ".next-smoke";
const WRANGLER_VAR_ALLOWLIST = [
  "HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID",
  "HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS",
  "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID",
  "HOSTED_EXECUTION_RECOVERY_RECIPIENT_KEY_ID",
  "HOSTED_EXECUTION_RETRY_DELAY_MS",
  "HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS",
  "HOSTED_EXECUTION_RUNNER_TIMEOUT_MS",
  "HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_KEY_ID",
  "HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT",
  "HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME",
  "HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG",
  "HOSTED_WEB_BASE_URL",
  "HOSTED_WEB_CALLBACK_SIGNING_KEY_ID",
] as const satisfies readonly string[];

interface HostedLocalDevConfig {
  skipPrismaMigrate: boolean;
  skipVercelPull: boolean;
  webHost: string;
  webPort: number;
  workerHost: string;
  workerPersistDir: string;
  workerPort: number;
  workerProtocol: "http" | "https";
}

interface HostedExecutionOidcIdentity {
  environment: "development" | "preview" | "production";
  projectName: string;
  teamSlug: string;
}

interface HostedWebDevServerLockMetadata {
  command: string;
  pid: number;
  port: number;
  startedAt: string;
}

interface NamedChildProcess {
  child: ChildProcess;
  name: "cloudflare" | "web";
}

const argv = new Set(process.argv.slice(2));

if (argv.has("--help") || argv.has("-h")) {
  printHelp();
  process.exit(0);
}

await main();

async function main(): Promise<void> {
  const config = resolveHostedLocalDevConfig(process.env);

  await ensureVercelLinkExists();
  await assertHostedWebDevServerAvailable(process.env);
  await assertPortAvailable(config.webHost, config.webPort, [
    `Local hosted web port ${config.webPort} is already in use on ${config.webHost}.`,
    "Stop the existing listener or set MURPH_DEV_WEB_PORT to a free port before running `pnpm dev`.",
  ].join(" "));
  await assertPortAvailable(config.workerHost, config.workerPort, [
    `Local Cloudflare worker port ${config.workerPort} is already in use on ${config.workerHost}.`,
    "Stop the existing listener or set MURPH_DEV_WORKER_PORT to a free port before running `pnpm dev`.",
  ].join(" "));

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "murph-dev-env-"));
  const pulledEnvPath = path.join(tempDir, ".env.local");
  const initialEnv = { ...process.env } satisfies NodeJS.ProcessEnv;

  try {
    if (!config.skipVercelPull) {
      await runCommand("vercel", ["env", "pull", pulledEnvPath, "--environment=development"], {
        cwd: webDir,
        env: initialEnv,
        name: "setup",
      });
    }

    const pulledEnv = config.skipVercelPull
      ? {}
      : await readSimpleEnvFile(pulledEnvPath);
    const vercelEnv: NodeJS.ProcessEnv = {
      ...initialEnv,
      ...pulledEnv,
    };

    if (!vercelEnv.DATABASE_URL?.trim()) {
      vercelEnv.DATABASE_URL = DEFAULT_DATABASE_URL;
    }

    const vercelOidcToken = await resolveVercelOidcToken(vercelEnv);
    const oidcIdentity = parseHostedExecutionOidcIdentity(vercelOidcToken);
    const cloudflareDevVars = await resolveCloudflareLocalEnv({
      config,
      oidcIdentity,
    });
    const localOverrides = buildHostedLocalDevOverrides(config, cloudflareDevVars);
    const runtimeEnv: NodeJS.ProcessEnv = {
      ...vercelEnv,
      ...localOverrides,
      VERCEL_OIDC_TOKEN: vercelOidcToken,
    };
    const workerRuntimeEnv: NodeJS.ProcessEnv = {
      ...runtimeEnv,
      ...cloudflareDevVars,
    };

    requireEnvValue(
      "DATABASE_URL",
      runtimeEnv.DATABASE_URL,
      "Set DATABASE_URL in the Vercel development environment, export it in your shell, or run local Postgres on 127.0.0.1:5432.",
    );
    requireEnvValue(
      "VERCEL_OIDC_TOKEN",
      runtimeEnv.VERCEL_OIDC_TOKEN,
      "Enable Vercel OIDC for the linked project and make sure the Vercel CLI is logged in.",
    );

    warnForMissingEnv("NEXT_PUBLIC_PRIVY_APP_ID", runtimeEnv.NEXT_PUBLIC_PRIVY_APP_ID);
    warnForMissingEnv("PRIVY_VERIFICATION_KEY", runtimeEnv.PRIVY_VERIFICATION_KEY);
    warnForMissingEnv("HOSTED_ONBOARDING_STRIPE_PRICE_ID", runtimeEnv.HOSTED_ONBOARDING_STRIPE_PRICE_ID);
    warnForMissingEnv("STRIPE_SECRET_KEY", runtimeEnv.STRIPE_SECRET_KEY);
    warnForMissingEnv("STRIPE_WEBHOOK_SECRET", runtimeEnv.STRIPE_WEBHOOK_SECRET);

    await runCommand("pnpm", ["--dir", "apps/web", "prisma:generate"], {
      cwd: repoRoot,
      env: runtimeEnv,
      name: "setup",
    });

    if (!config.skipPrismaMigrate) {
      await runCommand("pnpm", ["--dir", "apps/web", "prisma:migrate:deploy"], {
        cwd: repoRoot,
        env: runtimeEnv,
        name: "setup",
      });
    }

    const children: NamedChildProcess[] = [
      spawnChildProcess("cloudflare", "pnpm", [
        "--dir",
        "apps/cloudflare",
        "exec",
        "wrangler",
        "dev",
        "--ip",
        config.workerHost,
        "--port",
        String(config.workerPort),
        "--local-protocol",
        config.workerProtocol,
        "--persist-to",
        config.workerPersistDir,
        ...buildWranglerVarArgs(cloudflareDevVars),
      ], workerRuntimeEnv),
      spawnChildProcess("web", "pnpm", [
        "--dir",
        ".",
        "exec",
        "tsx",
        "apps/web/scripts/dev-local.ts",
        "--",
        "--hostname",
        config.webHost,
        "--port",
        String(config.webPort),
      ], runtimeEnv),
    ];
    let terminationSignal: NodeJS.Signals | null = null;

    const stopChildren = async (signal: NodeJS.Signals = "SIGTERM") => {
      await Promise.all(children.map(async ({ child }) => {
        terminateChildProcess(child, signal);
      }));
    };

    const handleTerminationSignal = async (signal: NodeJS.Signals) => {
      if (terminationSignal) {
        return;
      }

      terminationSignal = signal;
      process.stderr.write(`\nStopping local hosted dev (${signal}).\n`);
      await stopChildren(signal);
    };

    process.once("SIGINT", () => {
      void handleTerminationSignal("SIGINT");
    });
    process.once("SIGTERM", () => {
      void handleTerminationSignal("SIGTERM");
    });

    try {
      await Promise.all([
        waitForHealthyHttpEndpoint({
          host: config.workerHost,
          label: "cloudflare",
          path: "/health",
          port: config.workerPort,
          protocol: config.workerProtocol,
        }),
        waitForHealthyHttpEndpoint({
          host: config.webHost,
          label: "web",
          path: "/",
          port: config.webPort,
          protocol: "http",
        }),
      ]);
    } catch (error) {
      if (terminationSignal) {
        return;
      }

      await stopChildren("SIGTERM");
      throw error;
    }

    process.stdout.write(
      [
        "",
        "Local hosted dev is ready.",
        `web:    http://${config.webHost}:${config.webPort}`,
        `worker: ${config.workerProtocol}://${config.workerHost}:${config.workerPort}`,
        "",
      ].join("\n"),
    );

    const exited = await waitForFirstChildExit(children);
    await stopChildren("SIGTERM");

    if (terminationSignal) {
      return;
    }

    if (exited.child.exitCode === 0) {
      return;
    }

    throw new Error(`${exited.name} exited with code ${exited.child.exitCode ?? "unknown"}.`);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

function resolveHostedLocalDevConfig(
  env: NodeJS.ProcessEnv,
): HostedLocalDevConfig {
  return {
    skipPrismaMigrate: env.MURPH_DEV_SKIP_PRISMA_MIGRATE === "1",
    skipVercelPull: env.MURPH_DEV_SKIP_VERCEL_PULL === "1",
    webHost: env.MURPH_DEV_WEB_HOST?.trim() || DEFAULT_WEB_HOST,
    webPort: parsePort(env.MURPH_DEV_WEB_PORT, DEFAULT_WEB_PORT, "MURPH_DEV_WEB_PORT"),
    workerHost: env.MURPH_DEV_WORKER_HOST?.trim() || DEFAULT_WORKER_HOST,
    workerPersistDir: env.MURPH_DEV_CF_PERSIST_DIR?.trim() || DEFAULT_WORKER_PERSIST_DIR,
    workerPort: parsePort(env.MURPH_DEV_WORKER_PORT, DEFAULT_WORKER_PORT, "MURPH_DEV_WORKER_PORT"),
    workerProtocol: parseWorkerProtocol(env.MURPH_DEV_WORKER_PROTOCOL),
  };
}

function buildHostedLocalDevOverrides(
  config: HostedLocalDevConfig,
  cloudflareDevVars: Record<string, string>,
): NodeJS.ProcessEnv {
  const webOrigin = `http://${config.webHost}:${config.webPort}`;
  const workerBaseUrl = `${config.workerProtocol}://${config.workerHost}:${config.workerPort}`;
  const callbackPrivateJwkJson = cloudflareDevVars.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK;
  const callbackKeyId = cloudflareDevVars.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID?.trim();

  return {
    HOSTED_EXECUTION_DISPATCH_URL: workerBaseUrl,
    HOSTED_ONBOARDING_PUBLIC_BASE_URL: webOrigin,
    HOSTED_WEB_BASE_URL: webOrigin,
    ...(callbackPrivateJwkJson
      ? {
        HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK: JSON.stringify(
          toPublicEcP256Jwk(parsePrivateEcP256Jwk(callbackPrivateJwkJson)),
        ),
      }
      : {}),
    ...(callbackKeyId ? { HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: callbackKeyId } : {}),
    VERCEL_PROJECT_PRODUCTION_URL: `${config.webHost}:${config.webPort}`,
  };
}

function buildWranglerVarArgs(cloudflareDevVars: Record<string, string>): string[] {
  const args: string[] = [];

  for (const key of WRANGLER_VAR_ALLOWLIST) {
    const value = cloudflareDevVars[key];

    if (!value?.trim()) {
      continue;
    }

    args.push("--var", `${key}:${value}`);
  }

  return args;
}

async function resolveCloudflareLocalEnv(input: {
  config: HostedLocalDevConfig;
  oidcIdentity: HostedExecutionOidcIdentity;
}): Promise<Record<string, string>> {
  const originalContents = await tryReadTextFile(cloudflareDevVarsPath);
  const existing = originalContents === null
    ? {}
    : parseEnvText(originalContents);

  assertLocalWorkerOidcEnvironment(existing);

  const automationKeys = existing.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK?.trim()
    && existing.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK?.trim()
    ? {
      privateJwkJson: existing.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK,
      publicJwkJson: existing.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK,
    }
    : createEcP256JwkPairJson();
  const callbackSigningPrivateJwkJson = existing.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK?.trim()
    ? existing.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK
    : createEcP256JwkPairJson().privateJwkJson;
  const webOrigin = `http://${input.config.webHost}:${input.config.webPort}`;

  const merged: Record<string, string> = {
    ...existing,
    HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY:
      existing.HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY?.trim()
      ?? randomBytes(32).toString("base64"),
    HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID:
      existing.HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID?.trim()
      ?? "v1",
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID:
      existing.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID?.trim()
      ?? "automation:v1",
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK: automationKeys.privateJwkJson,
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK: automationKeys.publicJwkJson,
    HOSTED_EXECUTION_RECOVERY_RECIPIENT_KEY_ID:
      existing.HOSTED_EXECUTION_RECOVERY_RECIPIENT_KEY_ID?.trim()
      ?? "recovery:v1",
    HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK:
      existing.HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK?.trim()
      ?? automationKeys.publicJwkJson,
    HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: input.oidcIdentity.teamSlug,
    HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: input.oidcIdentity.projectName,
    HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: input.oidcIdentity.environment,
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: callbackSigningPrivateJwkJson,
    HOSTED_WEB_CALLBACK_SIGNING_KEY_ID:
      existing.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID?.trim()
      ?? "v1",
    HOSTED_WEB_BASE_URL: webOrigin,
  };

  return merged;
}

function assertLocalWorkerOidcEnvironment(cloudflareDevVars: Record<string, string>): void {
  const environment = cloudflareDevVars.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT?.trim();

  if (environment && environment !== "development") {
    throw new Error(
      [
        "apps/cloudflare/.dev.vars must set HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=development for local `pnpm dev`.",
        `Current value: ${JSON.stringify(environment)}`,
      ].join(" "),
    );
  }
}

async function tryReadTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}

async function readSimpleEnvFile(filePath: string): Promise<Record<string, string>> {
  const raw = await readFile(filePath, "utf8");
  return parseEnvText(raw);
}

function parseEnvText(raw: string): Record<string, string> {
  const parsed = parseEnv(raw);

  return Object.fromEntries(
    Object.entries(parsed)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, value]) => [key, normalizeLoadedEnvValue(key, value)]),
  );
}

function normalizeLoadedEnvValue(key: string, value: string): string {
  const prefix = `${key}=`;
  let normalized = value;

  if (normalized.startsWith(prefix)) {
    normalized = normalized.slice(prefix.length);
  }

  if (normalized.startsWith("{\\\"") || normalized.startsWith("[\\\"")) {
    normalized = normalized.replace(/\\"/gu, "\"");
  }

  return normalized;
}

async function resolveVercelOidcToken(env: NodeJS.ProcessEnv): Promise<string> {
  const existing = env.VERCEL_OIDC_TOKEN?.trim();

  if (existing) {
    return existing;
  }

  const token = await captureCommandOutput(
    "pnpm",
    [
      "--dir",
      "apps/web",
      "exec",
      "node",
      "-e",
      [
        "const { getVercelOidcToken } = require('@vercel/oidc');",
        "getVercelOidcToken()",
        "  .then((token) => process.stdout.write(token))",
        "  .catch((error) => {",
        "    console.error(error instanceof Error ? error.message : String(error));",
        "    process.exit(1);",
        "  });",
      ].join(""),
    ],
    {
      cwd: repoRoot,
      env,
      name: "setup",
    },
  );

  const normalized = token.trim();

  if (!normalized) {
    throw new Error(
      "Failed to load a Vercel OIDC token for local hosted dev. Make sure Vercel CLI is logged in, the project is linked, and OIDC is enabled.",
    );
  }

  return normalized;
}

function parseHostedExecutionOidcIdentity(token: string): HostedExecutionOidcIdentity {
  const payload = parseJwtPayload(token);
  const issuer = typeof payload.iss === "string" ? payload.iss.trim() : "";
  const issuerMatch = /^https:\/\/oidc\.vercel\.com\/([^/]+)$/u.exec(issuer);
  const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const subjectMatch =
    /^owner:([^:]+):project:([^:]+):environment:(development|preview|production)$/u.exec(subject);
  const environment = normalizeOidcEnvironment(
    typeof payload.environment === "string" ? payload.environment : subjectMatch?.[3],
  );
  const teamSlug = issuerMatch?.[1] ?? readOidcClaim(payload.owner);
  const projectName = subjectMatch?.[2] ?? readOidcClaim(payload.project);

  if (!teamSlug || !projectName || !environment) {
    throw new Error("Could not derive the Vercel OIDC validation identity for local Cloudflare dev.");
  }

  if (subjectMatch?.[1] && subjectMatch[1] !== teamSlug) {
    throw new Error("The local Vercel OIDC token owner does not match its issuer.");
  }

  if (environment !== "development") {
    throw new Error(
      `Local hosted dev expects a development-scoped Vercel OIDC token, received ${JSON.stringify(environment)}.`,
    );
  }

  return {
    environment,
    projectName,
    teamSlug,
  };
}

function parseJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");

  if (parts.length < 2) {
    throw new Error("VERCEL_OIDC_TOKEN must be a JWT.");
  }

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `VERCEL_OIDC_TOKEN must contain a valid JWT payload: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readOidcClaim(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOidcEnvironment(
  value: string | undefined,
): HostedExecutionOidcIdentity["environment"] | null {
  if (!value) {
    return null;
  }

  if (value === "development" || value === "preview" || value === "production") {
    return value;
  }

  return null;
}

function createEcP256JwkPairJson(): {
  privateJwkJson: string;
  publicJwkJson: string;
} {
  const pair = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "jwk" },
    publicKeyEncoding: { format: "jwk" },
  });

  return {
    privateJwkJson: JSON.stringify(pair.privateKey),
    publicJwkJson: JSON.stringify(pair.publicKey),
  };
}

async function assertHostedWebDevServerAvailable(env: NodeJS.ProcessEnv): Promise<void> {
  const lockPaths = resolveHostedWebDevLockPaths(env);
  const rawMetadata = await tryReadTextFile(lockPaths.metadataPath);

  if (rawMetadata === null) {
    return;
  }

  let metadata: unknown;

  try {
    metadata = JSON.parse(rawMetadata) as unknown;
  } catch {
    await rm(lockPaths.lockPath, { force: true, recursive: true });
    return;
  }

  if (!isHostedWebDevServerLockMetadata(metadata)) {
    await rm(lockPaths.lockPath, { force: true, recursive: true });
    return;
  }

  if (!isProcessRunning(metadata.pid)) {
    await rm(lockPaths.lockPath, { force: true, recursive: true });
    return;
  }

  throw new Error(
    [
      `apps/web already has an active dev server lock (pid ${metadata.pid}, port ${metadata.port}).`,
      "Stop that dev server before running `pnpm dev`.",
    ].join(" "),
  );
}

function resolveHostedWebDevLockPaths(env: NodeJS.ProcessEnv): {
  lockPath: string;
  metadataPath: string;
} {
  const distDirName = env.NEXT_DIST_DIR_MODE === "smoke"
    ? HOSTED_WEB_SMOKE_DIST_DIR
    : HOSTED_WEB_DEV_DIST_DIR;
  const lockPath = path.join(webDir, distDirName, ".dev-server.lock");

  return {
    lockPath,
    metadataPath: path.join(lockPath, "owner.json"),
  };
}

async function assertPortAvailable(host: string, port: number, message: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      if (
        typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "EADDRINUSE"
      ) {
        reject(new Error(message));
        return;
      }

      reject(error);
    });
    server.once("listening", () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve();
      });
    });
    server.listen(port, host);
  });
}

function isHostedWebDevServerLockMetadata(value: unknown): value is HostedWebDevServerLockMetadata {
  return Boolean(
    value
    && typeof value === "object"
    && "command" in value
    && "pid" in value
    && "port" in value
    && "startedAt" in value
    && typeof value.command === "string"
    && typeof value.pid === "number"
    && Number.isInteger(value.pid)
    && typeof value.port === "number"
    && Number.isInteger(value.port)
    && typeof value.startedAt === "string",
  );
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "ESRCH"
    ) {
      return false;
    }

    return true;
  }
}

function parsePrivateEcP256Jwk(value: string): Record<string, string> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(
      `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK in apps/cloudflare/.dev.vars must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK in apps/cloudflare/.dev.vars must be a JSON object.");
  }

  const record = parsed as Record<string, unknown>;
  if (
    record.kty !== "EC"
    || record.crv !== "P-256"
    || typeof record.x !== "string"
    || typeof record.y !== "string"
    || typeof record.d !== "string"
  ) {
    throw new Error("HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK in apps/cloudflare/.dev.vars must be an EC P-256 private JWK.");
  }

  return record as Record<string, string>;
}

function toPublicEcP256Jwk(privateJwk: Record<string, string>): Record<string, string> {
  return {
    crv: privateJwk.crv,
    kty: privateJwk.kty,
    x: privateJwk.x,
    y: privateJwk.y,
  };
}

function spawnChildProcess(
  name: "cloudflare" | "web",
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): NamedChildProcess {
  const child = spawn(command, args, {
    cwd: repoRoot,
    detached: process.platform !== "win32",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  pipeWithPrefix(name, child.stdout, process.stdout);
  pipeWithPrefix(name, child.stderr, process.stderr);

  return { child, name };
}

async function waitForFirstChildExit(children: readonly NamedChildProcess[]): Promise<NamedChildProcess> {
  return await new Promise((resolve) => {
    for (const entry of children) {
      entry.child.once("exit", () => resolve(entry));
    }
  });
}

async function runCommand(
  command: string,
  args: string[],
  input: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    name: "setup";
  },
): Promise<void> {
  const child = spawn(command, args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  pipeWithPrefix(input.name, child.stdout, process.stdout);
  pipeWithPrefix(input.name, child.stderr, process.stderr);

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function captureCommandOutput(
  command: string,
  args: string[],
  input: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    name: "setup";
  },
): Promise<string> {
  const child = spawn(command, args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  pipeWithPrefix(input.name, child.stderr, process.stderr);

  let stdout = "";
  child.stdout?.on("data", (chunk: string | Buffer) => {
    stdout += chunk.toString();
  });

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}.`));
    });
  });

  return stdout;
}

async function waitForHealthyHttpEndpoint(input: {
  host: string;
  label: string;
  path: string;
  port: number;
  protocol: "http" | "https";
}): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    try {
      const statusCode = await requestStatus(input);
      if (statusCode === 200) {
        return;
      }
    } catch {
      // Wait for the service to come up.
    }

    await sleep(HEALTH_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for ${input.label} to respond on ${input.protocol}://${input.host}:${input.port}${input.path}.`,
  );
}

async function requestStatus(input: {
  host: string;
  path: string;
  port: number;
  protocol: "http" | "https";
}): Promise<number | undefined> {
  const requestImpl = input.protocol === "https" ? https.request : http.request;

  return await new Promise((resolve, reject) => {
    const req = requestImpl(
      {
        host: input.host,
        method: "GET",
        path: input.path,
        port: input.port,
        rejectUnauthorized: false,
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );

    req.setTimeout(5_000, () => {
      req.destroy(new Error("request timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

function pipeWithPrefix(
  prefix: string,
  stream: NodeJS.ReadableStream | null | undefined,
  target: NodeJS.WriteStream,
): void {
  if (!stream) {
    return;
  }

  let buffer = "";

  stream.on("data", (chunk: string | Buffer) => {
    buffer += chunk.toString();

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        break;
      }

      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      target.write(`[${prefix}] ${line}\n`);
    }
  });

  stream.on("end", () => {
    if (buffer.length > 0) {
      target.write(`[${prefix}] ${buffer}\n`);
      buffer = "";
    }
  });
}

function terminateChildProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode !== null || child.pid === undefined) {
    return;
  }

  try {
    if (process.platform !== "win32") {
      process.kill(-child.pid, signal);
    }
  } catch {
    // Ignore process-group errors and fall through to the direct signal.
  }

  try {
    child.kill(signal);
  } catch {
    // Ignore already-dead children.
  }
}

function requireEnvValue(label: string, value: string | undefined, help: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(`${label} is required for local hosted dev. ${help}`);
  }

  return normalized;
}

function warnForMissingEnv(label: string, value: string | undefined): void {
  if (value?.trim()) {
    return;
  }

  process.stderr.write(
    `[setup] Warning: ${label} is not configured. The full hosted signup flow will stay incomplete until it is added.\n`,
  );
}

async function ensurePathExists(filePath: string, message: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new Error(message);
  }
}

async function ensureVercelLinkExists(): Promise<void> {
  for (const filePath of vercelLinkCandidatePaths) {
    try {
      await access(filePath);
      return;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    [
      "This repo is not linked to the hosted web Vercel project.",
      "Run `cd apps/web && vercel link`, or run `vercel link --repo` from the repo root, before using `pnpm dev`.",
    ].join(" "),
  );
}

function parsePort(value: string | undefined, fallback: number, label: string): number {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${label} must be a valid TCP port.`);
  }

  return parsed;
}

function parseWorkerProtocol(value: string | undefined): "http" | "https" {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return DEFAULT_WORKER_PROTOCOL;
  }

  if (normalized !== "http" && normalized !== "https") {
    throw new Error("MURPH_DEV_WORKER_PROTOCOL must be either http or https.");
  }

  return normalized;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function printHelp(): void {
  process.stdout.write(
    [
      "Run the local hosted Murph lane from the repo root.",
      "",
      "Usage:",
      "  pnpm dev",
      "",
      "Optional environment overrides:",
      "  MURPH_DEV_SKIP_VERCEL_PULL=1        Reuse the current shell env instead of pulling Vercel development env",
      "  MURPH_DEV_SKIP_PRISMA_MIGRATE=1     Skip prisma migrate deploy before startup",
      "  MURPH_DEV_WEB_HOST=127.0.0.1        Hosted web listen host",
      "  MURPH_DEV_WEB_PORT=3000             Hosted web listen port",
      "  MURPH_DEV_WORKER_HOST=127.0.0.1     Cloudflare worker listen host",
      "  MURPH_DEV_WORKER_PORT=8787          Cloudflare worker listen port",
      "  MURPH_DEV_WORKER_PROTOCOL=http      Cloudflare local protocol (http or https)",
      "  MURPH_DEV_CF_PERSIST_DIR=...        Wrangler local persistence directory",
      "",
    ].join("\n"),
  );
}
