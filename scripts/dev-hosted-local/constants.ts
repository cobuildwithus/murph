import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HOSTED_WORKER_OPTIONAL_VAR_NAMES,
} from "../../apps/cloudflare/scripts/deploy-automation/worker-optional-vars.ts";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(scriptsDir, "..", "..");
export const webDir = path.join(repoRoot, "apps", "web");
export const cloudflareDir = path.join(repoRoot, "apps", "cloudflare");
export const cloudflareDevVarsPath = path.join(cloudflareDir, ".dev.vars");
export const vercelLinkCandidatePaths = [
  path.join(webDir, ".vercel", "project.json"),
  path.join(webDir, ".vercel", "repo.json"),
  path.join(repoRoot, ".vercel", "project.json"),
  path.join(repoRoot, ".vercel", "repo.json"),
] as const;

export const DEFAULT_WEB_HOST = "127.0.0.1";
export const DEFAULT_WEB_PORT = 3000;
export const DEFAULT_WORKER_HOST = "127.0.0.1";
export const DEFAULT_WORKER_PORT = 8787;
export const DEFAULT_WORKER_PROTOCOL = "http";
export const DEFAULT_WORKER_PERSIST_DIR = path.join(".wrangler", "state", "dev-root");
export const DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync";
// Local Cloudflare startup can include a full runner bundle build and cold container prep.
export const HEALTH_TIMEOUT_MS = 300_000;
export const HEALTH_POLL_INTERVAL_MS = 500;
export const HEALTH_REQUEST_TIMEOUT_MS = 20_000;
export const HOSTED_WEB_DEV_DIST_DIR = ".next-dev";
export const HOSTED_WEB_SMOKE_DIST_DIR = ".next-smoke";
export const HOSTED_RUNNER_LOCAL_BUILD_ID_ENV = "MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID";
export const WRANGLER_VAR_ALLOWLIST = [
  ...HOSTED_WORKER_OPTIONAL_VAR_NAMES,
  "ALLOW_LOCAL_INTERNAL_PROXY",
  "MURPH_E2E_CODEX_APP_SERVER_STUB_BASE_URL",
  "HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID",
  "HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL",
  "HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS",
  "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID",
  "HOSTED_EXECUTION_RECOVERY_RECIPIENT_KEY_ID",
  "HOSTED_EXECUTION_RETRY_DELAY_MS",
  "HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS",
  "HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS",
  "HOSTED_EXECUTION_RUNNER_TIMEOUT_MS",
  "HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_KEY_ID",
  "HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT",
  "HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL",
  "HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME",
  "HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG",
  "HOSTED_WEB_BASE_URL",
  "HOSTED_WEB_CALLBACK_SIGNING_KEY_ID",
] as const satisfies readonly string[];
