import {
  DEFAULT_WEB_HOST,
  DEFAULT_WEB_PORT,
  DEFAULT_WORKER_HOST,
  DEFAULT_WORKER_PERSIST_DIR,
  DEFAULT_WORKER_PORT,
  DEFAULT_WORKER_PROTOCOL,
  DEFAULT_STRIPE_ENV_FILE,
} from "./constants.ts";
import type { HostedLocalDevConfig } from "./types.ts";

export function resolveHostedLocalDevConfig(
  env: NodeJS.ProcessEnv,
): HostedLocalDevConfig {
  return {
    databaseUrlOverride: env.MURPH_DEV_DATABASE_URL?.trim() || null,
    forceResetLocalDatabase: env.MURPH_DEV_FORCE_RESET_LOCAL_DB === "1",
    localCodexBridge: env.MURPH_DEV_CODEX_BRIDGE !== "0",
    localCodexBridgeHost: env.MURPH_DEV_CODEX_BRIDGE_HOST?.trim() || "127.0.0.1",
    localCodexBridgePort: parseListenPort(
      env.MURPH_DEV_CODEX_BRIDGE_PORT,
      0,
      "MURPH_DEV_CODEX_BRIDGE_PORT",
    ),
    localCodexCommand: env.MURPH_DEV_CODEX_COMMAND?.trim() || "codex",
    skipHealthCommonsWatch: env.MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH === "1",
    skipPrismaMigrate: env.MURPH_DEV_SKIP_PRISMA_MIGRATE === "1",
    skipRunnerSmoke: env.MURPH_DEV_SKIP_RUNNER_SMOKE === "1",
    skipStripeListen: env.MURPH_DEV_SKIP_STRIPE_LISTEN === "1",
    skipWeb: env.MURPH_DEV_SKIP_WEB === "1",
    skipVercelPull: env.MURPH_DEV_SKIP_VERCEL_PULL === "1",
    useVercelDatabaseUrl: env.MURPH_DEV_USE_VERCEL_DATABASE_URL === "1",
    webHost: env.MURPH_DEV_WEB_HOST?.trim() || DEFAULT_WEB_HOST,
    webPort: parsePort(env.MURPH_DEV_WEB_PORT, DEFAULT_WEB_PORT, "MURPH_DEV_WEB_PORT"),
    workerHost: env.MURPH_DEV_WORKER_HOST?.trim() || DEFAULT_WORKER_HOST,
    workerPersistDir: env.MURPH_DEV_CF_PERSIST_DIR?.trim() || DEFAULT_WORKER_PERSIST_DIR,
    workerPort: parsePort(env.MURPH_DEV_WORKER_PORT, DEFAULT_WORKER_PORT, "MURPH_DEV_WORKER_PORT"),
    workerProtocol: parseWorkerProtocol(env.MURPH_DEV_WORKER_PROTOCOL),
  };
}

export function parseListenPort(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`${label} must be a valid TCP listen port.`);
  }

  return parsed;
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
      "  MURPH_DEV_CODEX_BRIDGE=0            Disable the local Codex app-server bridge and rely on hosted assistant provider env",
      "  MURPH_DEV_CODEX_COMMAND=codex       Local Codex CLI command used by the bridge",
      "  MURPH_DEV_CODEX_BRIDGE_HOST=127.0.0.1 Local Codex bridge listen host; set explicitly for Linux Docker bridge reachability",
      "  MURPH_DEV_CODEX_BRIDGE_PORT=0       Local Codex bridge listen port (0 picks a free port)",
      "  MURPH_DEV_USE_VERCEL_DATABASE_URL=1 Use the pulled Vercel development DATABASE_URL instead of the default local database",
      "  MURPH_DEV_SKIP_VERCEL_PULL=1        Reuse the current shell env instead of pulling Vercel development env",
      "  MURPH_DEV_SKIP_PRISMA_MIGRATE=1     Skip prisma migrate deploy before startup",
      "  MURPH_DEV_SKIP_RUNNER_SMOKE=1       Skip the runner container deploy-smoke readiness proof",
      "  MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH=1  Skip the Health Commons markdown watcher after startup generation",
      "  MURPH_DEV_SKIP_STRIPE_LISTEN=1      Skip the auto-launched `stripe listen` forwarder for hosted onboarding webhooks",
      `  MURPH_DEV_STRIPE_ENV_FILE=${DEFAULT_STRIPE_ENV_FILE}  Load local Stripe test checkout env after Vercel env pull`,
      "  MURPH_DEV_SKIP_WEB=1                Start only the local worker/container lane",
      "  MURPH_DEV_WEB_HOST=localhost        Hosted web listen host",
      "  MURPH_DEV_WEB_PORT=3000             Hosted web listen port",
      "  MURPH_DEV_WORKER_HOST=127.0.0.1     Cloudflare worker listen host",
      "  MURPH_DEV_WORKER_PORT=8787          Cloudflare worker listen port",
      "  MURPH_DEV_WORKER_PROTOCOL=http      Cloudflare local protocol (http or https)",
      "  MURPH_DEV_CF_PERSIST_DIR=...        Wrangler local persistence directory",
      "  MURPH_DEV_TEMP_DIR=.tmp/...         Keep generated worker env/config under a repo-local .tmp subdir (contains local secrets)",
      "",
    ].join("\n"),
  );
}
