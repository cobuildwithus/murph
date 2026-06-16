import {
  DEFAULT_WEB_HOST,
  DEFAULT_WEB_PORT,
  DEFAULT_WORKER_HOST,
  DEFAULT_WORKER_PERSIST_DIR,
  DEFAULT_WORKER_PORT,
  DEFAULT_WORKER_PROTOCOL,
  DEFAULT_STRIPE_ENV_FILE,
  DEFAULT_LINQ_WEBHOOK_TUNNEL_CONFIG,
  DEFAULT_LINQ_WEBHOOK_TUNNEL_NAME,
  USE_REMOTE_HOSTED_CRYPTO_KEYS_ENV,
} from "./constants.ts";
import type {
  HostedLocalDevConfig,
  HostedLocalTemporalMode,
} from "./types.ts";

const DEFAULT_TEMPORAL_HOST = "127.0.0.1";
const DEFAULT_TEMPORAL_NAMESPACE = "default";
const DEFAULT_TEMPORAL_PORT = 7233;
const DEFAULT_TEMPORAL_TASK_QUEUE = "murph-hosted-runtime";

export const DEPRECATED_HOSTED_LOCAL_CODEX_BRIDGE_ENV_NAMES = [
  "MURPH_DEV_CODEX_BRIDGE",
  "MURPH_DEV_CODEX_COMMAND",
  "MURPH_DEV_CODEX_BRIDGE_HOST",
  "MURPH_DEV_CODEX_BRIDGE_PORT",
  "MURPH_DEV_CODEX_APP_SERVER_PROXY_URL",
  "MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN",
] as const;

export function resolveHostedLocalDevConfig(
  env: NodeJS.ProcessEnv,
): HostedLocalDevConfig {
  assertNoDeprecatedHostedLocalCodexBridgeEnv(env);

  return {
    databaseUrlOverride: env.MURPH_DEV_DATABASE_URL?.trim() || null,
    forceResetLocalDatabase: env.MURPH_DEV_FORCE_RESET_LOCAL_DB === "1",
    forceResetLocalTemporal: env.MURPH_DEV_FORCE_RESET_TEMPORAL === "1",
    linqWebhookPublicUrl: env.MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL?.trim() || null,
    linqWebhookTunnelConfigPath:
      env.MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG?.trim()
      || DEFAULT_LINQ_WEBHOOK_TUNNEL_CONFIG,
    linqWebhookTunnelMode: parseLinqWebhookTunnelMode(env.MURPH_DEV_LINQ_WEBHOOK_TUNNEL),
    linqWebhookTunnelName:
      env.MURPH_DEV_LINQ_WEBHOOK_TUNNEL_NAME?.trim()
      || DEFAULT_LINQ_WEBHOOK_TUNNEL_NAME,
    skipHealthCommonsWatch: env.MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH === "1",
    skipLinqWebhookRegister: env.MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER === "1",
    skipPrismaMigrate: env.MURPH_DEV_SKIP_PRISMA_MIGRATE === "1",
    skipRunnerSmoke: env.MURPH_DEV_SKIP_RUNNER_SMOKE === "1",
    skipStripeListen: env.MURPH_DEV_SKIP_STRIPE_LISTEN === "1",
    skipWeb: env.MURPH_DEV_SKIP_WEB === "1",
    skipVercelPull: env.MURPH_DEV_SKIP_VERCEL_PULL === "1",
    temporal: resolveHostedLocalTemporalConfig(env),
    useVercelDatabaseUrl: env.MURPH_DEV_USE_VERCEL_DATABASE_URL === "1",
    webHost: env.MURPH_DEV_WEB_HOST?.trim() || DEFAULT_WEB_HOST,
    webPort: parsePort(env.MURPH_DEV_WEB_PORT, DEFAULT_WEB_PORT, "MURPH_DEV_WEB_PORT"),
    workerHost: env.MURPH_DEV_WORKER_HOST?.trim() || DEFAULT_WORKER_HOST,
    workerPersistDir: env.MURPH_DEV_CF_PERSIST_DIR?.trim() || DEFAULT_WORKER_PERSIST_DIR,
    workerPort: parsePort(env.MURPH_DEV_WORKER_PORT, DEFAULT_WORKER_PORT, "MURPH_DEV_WORKER_PORT"),
    workerProtocol: parseWorkerProtocol(env.MURPH_DEV_WORKER_PROTOCOL),
  };
}

function resolveHostedLocalTemporalConfig(
  env: NodeJS.ProcessEnv,
): HostedLocalDevConfig["temporal"] {
  return {
    host: env.MURPH_DEV_TEMPORAL_HOST?.trim() || DEFAULT_TEMPORAL_HOST,
    mode: parseTemporalMode(env.MURPH_DEV_TEMPORAL, defaultTemporalMode(env)),
    namespace:
      env.TEMPORAL_NAMESPACE?.trim()
      || env.HOSTED_TEMPORAL_NAMESPACE?.trim()
      || DEFAULT_TEMPORAL_NAMESPACE,
    port: parsePort(env.MURPH_DEV_TEMPORAL_PORT, DEFAULT_TEMPORAL_PORT, "MURPH_DEV_TEMPORAL_PORT"),
    taskQueue:
      env.TEMPORAL_TASK_QUEUE?.trim()
      || env.HOSTED_TEMPORAL_TASK_QUEUE?.trim()
      || DEFAULT_TEMPORAL_TASK_QUEUE,
  };
}

function defaultTemporalMode(env: NodeJS.ProcessEnv): HostedLocalTemporalMode {
  const profile = env.MURPH_HOSTED_LOCAL_PROFILE?.trim();
  if (profile === "worker-only" || env.MURPH_DEV_SKIP_WEB === "1") {
    return "disabled";
  }

  if (env.HOSTED_TEMPORAL_ADDRESS?.trim() || env.TEMPORAL_ADDRESS?.trim()) {
    return "external";
  }

  if (
    env.MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED === "1"
    || profile === "e2e:stub"
    || profile === "e2e:live"
  ) {
    return "managed";
  }

  return "auto";
}

export function parseTemporalMode(
  value: string | undefined,
  fallback: HostedLocalTemporalMode = "disabled",
): HostedLocalTemporalMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (["0", "false", "no", "off", "disabled"].includes(normalized)) {
    return "disabled";
  }

  if (["1", "true", "yes", "on", "managed"].includes(normalized)) {
    return "managed";
  }

  if (normalized === "auto") {
    return "auto";
  }

  if (normalized === "external") {
    return "external";
  }

  throw new Error(
    "MURPH_DEV_TEMPORAL must be auto, managed, external, disabled, 1, or 0.",
  );
}

export function assertNoDeprecatedHostedLocalCodexBridgeEnv(
  env: Readonly<Record<string, string | undefined>>,
): void {
  const configured = DEPRECATED_HOSTED_LOCAL_CODEX_BRIDGE_ENV_NAMES.filter(
    (key) => Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined,
  );

  if (configured.length === 0) {
    return;
  }

  throw new Error(
    [
      `Deprecated hosted-local Codex bridge env is no longer supported: ${configured.join(", ")}.`,
      "Use HOSTED_ASSISTANT_PROVIDER=openai and OPENAI_API_KEY for local hosted dev.",
    ].join(" "),
  );
}

export function parseLinqWebhookTunnelMode(
  value: string | undefined,
): HostedLocalDevConfig["linqWebhookTunnelMode"] {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "auto") {
    return "auto";
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return "disabled";
  }

  if (["1", "true", "yes", "on", "required"].includes(normalized)) {
    return "required";
  }

  throw new Error(
    "MURPH_DEV_LINQ_WEBHOOK_TUNNEL must be auto, required, 1, or 0.",
  );
}

export function parsePort(value: string | undefined, fallback: number, label: string): number {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${label} must be a valid TCP port.`);
  }

  return parsed;
}

export function parseWorkerProtocol(value: string | undefined): "http" | "https" {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return DEFAULT_WORKER_PROTOCOL;
  }

  if (normalized !== "http" && normalized !== "https") {
    throw new Error("MURPH_DEV_WORKER_PROTOCOL must be either http or https.");
  }

  return normalized;
}

export function printHelp(): void {
  process.stdout.write(
    [
      "Run the local hosted Murph lane from the repo root.",
      "",
      "Usage:",
      "  pnpm dev",
      "",
      "Optional environment overrides:",
      "  MURPH_DEV_DATABASE_URL=...          Override the local hosted stack database URL",
      "  MURPH_DEV_FORCE_RESET_LOCAL_DB=1    Reset a local loopback Postgres database before `prisma db push` (used by hosted-local e2e)",
      "  MURPH_DEV_FORCE_RESET_TEMPORAL=1    Stop local Temporal dev server/worker residue before startup (used by `pnpm dev:reset`)",
      "  HOSTED_ASSISTANT_PROVIDER=openai  Required hosted assistant provider for local hosted dev",
      "  OPENAI_API_KEY=...                 Required OpenAI key for hosted runner Codex app-server access",
      "  MURPH_DEV_USE_VERCEL_DATABASE_URL=1 Use the pulled Vercel development DATABASE_URL instead of the default local database",
      "  MURPH_DEV_SKIP_VERCEL_PULL=1        Reuse the current shell env instead of pulling Vercel development env",
      `  ${USE_REMOTE_HOSTED_CRYPTO_KEYS_ENV}=1 Use pulled development hosted crypto/KMS env instead of generated local-only keys`,
      "  MURPH_DEV_SKIP_PRISMA_MIGRATE=1     Skip prisma migrate deploy before startup",
      "  MURPH_DEV_SKIP_RUNNER_SMOKE=1       Skip the runner container deploy-smoke readiness proof (warning-only in interactive dev, fatal in E2E)",
      "  MURPH_DEV_SKIP_MINIO=1              Skip local MinIO; requires explicit local S3-compatible HOSTED_R2_PRESIGN_* env",
      "  MURPH_DEV_SKIP_WORKERS_AI=1         Drop the Workers AI binding so the stack starts without Cloudflare auth; hosted transcription then fails closed",
      "  MURPH_DEV_MINIO_DATA_DIR=.tmp/hosted-local-minio-r2 Persist local MinIO R2 data for interactive dev",
      "  MURPH_DEV_MINIO_PORT=9000           Pin the local MinIO R2-compatible S3 port",
      "  MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH=1  Skip the Health Commons markdown watcher after startup generation",
      "  MURPH_DEV_SKIP_STRIPE_LISTEN=1      Skip the auto-launched `stripe listen` forwarder for hosted onboarding webhooks",
      `  MURPH_DEV_STRIPE_ENV_FILE=${DEFAULT_STRIPE_ENV_FILE}  Load local Stripe test checkout env after Vercel env pull`,
      "  MURPH_DEV_LINQ_WEBHOOK_TUNNEL=auto  Auto-use a local Linq cloudflared config when Linq credentials are present; set 1 to require it or 0 to disable",
      `  MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG=${DEFAULT_LINQ_WEBHOOK_TUNNEL_CONFIG}  Repo-local cloudflared config for the Linq webhook tunnel`,
      `  MURPH_DEV_LINQ_WEBHOOK_TUNNEL_NAME=${DEFAULT_LINQ_WEBHOOK_TUNNEL_NAME}  cloudflared named tunnel to run for local Linq webhooks`,
      "  MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL=...  Explicit public Linq webhook URL or HTTPS origin",
      "  HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS=...  Comma-separated sender phone allowlist for local Linq webhooks",
      "  MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER=1 Skip Linq webhook subscription registration while still using the tunnel public URL",
      "  MURPH_DEV_TEMPORAL=auto            Temporal mode: auto reuses a local Temporal listener or starts one; managed always starts one; external uses caller-supplied Temporal; disabled skips orchestration",
      "  MURPH_DEV_TEMPORAL_HOST=127.0.0.1  Local Temporal dev server bind host for auto/managed mode",
      "  MURPH_DEV_TEMPORAL_PORT=7233       Local Temporal frontend gRPC port",
      "  MURPH_DEV_TEMPORAL_ALLOW_EXTERNAL_SCHEDULE_ENSURE=1 Allow local startup to create/update the reconciler Schedule in external Temporal",
      "  TEMPORAL_NAMESPACE=default         Temporal namespace for web signals and worker polling",
      "  TEMPORAL_TASK_QUEUE=murph-hosted-runtime Temporal task queue for hosted runtime workflows",
      "  MURPH_DEV_SKIP_WEB=1                Start only the local worker/container lane",
      "  MURPH_DEV_WEB_HOST=127.0.0.1        Hosted web listen host; use loopback IP so Telegram/Privy origins match BotFather local domains",
      "  MURPH_DEV_WEB_PORT=3000             Hosted web listen port",
      "  MURPH_DEV_WORKER_HOST=127.0.0.1     Cloudflare worker listen host",
      "  MURPH_DEV_WORKER_PORT=8787          Cloudflare worker listen port",
      "  MURPH_DEV_WORKER_PROTOCOL=http      Cloudflare local protocol (http or https)",
      "  MURPH_DEV_REUSE_EXISTING_WORKER=1   Reuse an already-running local Cloudflare worker instead of requiring a fresh worker",
      "  MURPH_DEV_CF_PERSIST_DIR=...        Override Wrangler local persistence directory (defaults to a per-run temp dir)",
      "  MURPH_DEV_TEMP_DIR=.tmp/...         Keep generated worker env/config under a repo-local .tmp subdir (contains local secrets)",
      "",
    ].join("\n"),
  );
}
