import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  buildHostedLocalCodexSubscriptionSeedAuth,
  type HostedLocalCodexSubscriptionHostAuth,
  parseHostedLocalCodexSubscriptionHostAuth,
} from "@murphai/hosted-execution/hosted-codex-subscription-auth";

import { resolveHostedLocalProfile } from "../profiles.ts";

export const MURPH_HOSTED_LOCAL_CODEX_HOME_ENV = "MURPH_HOSTED_LOCAL_CODEX_HOME";
// Opt-in escape hatch for hosted-local dev when the Codex subscription is
// exhausted or unavailable: bypass the ChatGPT-mode seed and let the runner's
// API-key model provider config bill `OPENAI_API_KEY` for assistant turns
// instead. Off by default so dev never silently re-routes to the API key.
export const MURPH_DEV_USE_OPENAI_API_KEY_ENV = "MURPH_DEV_USE_OPENAI_API_KEY";

const DEFAULT_HOSTED_LOCAL_CODEX_HOME_DIR_NAME = ".codex";
const CODEX_AUTH_FILE_NAME = "auth.json";
// Codex CLI's own public OAuth client id and refresh endpoint
// (codex-rs/login/src/auth/manager.rs). The harness performs the same refresh
// request Codex would, but on the host, so rotated refresh tokens always land
// back in the host Codex home instead of dying with the ephemeral runner.
const CODEX_OAUTH_REFRESH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
// Codex refreshes tokens lazily near access-token expiry. If the seeded token
// crossed that point inside the runner container, the rotated refresh token
// would be orphaned there, so refresh host-side well before expiry instead.
const ACCESS_TOKEN_REFRESH_WINDOW_MS = 96 * 60 * 60 * 1000;
// Without a usable expiry-and-refresh path the seeded tokens could brick the
// host Codex login mid-session; fail closed instead of guessing.
const ACCESS_TOKEN_MINIMUM_REMAINING_MS = 24 * 60 * 60 * 1000;
// Refresh tokens rotate server-side; two dev stacks refreshing concurrently
// would trip OAuth reuse detection and could revoke the shared host login.
// The acquire timeout must outlive both a slow holder (refresh request
// timeout plus writes) and the stale-lock reap threshold.
const REFRESH_LOCK_ACQUIRE_TIMEOUT_MS = 120_000;
const REFRESH_LOCK_STALE_MS = 60_000;
const REFRESH_REQUEST_TIMEOUT_MS = 30_000;

// Interactive dev/debug profiles run hosted Codex on the local ChatGPT
// subscription; test-mode profiles and NODE_ENV=test lanes (e2e, harness
// tests, the e2e Codex override) keep API-key config and never read the host
// Codex home. The useOpenaiApiKey override is an explicit dev escape hatch
// (MURPH_DEV_USE_OPENAI_API_KEY) for when the local Codex subscription is
// exhausted or unavailable.
export function shouldSeedHostedLocalCodexSubscriptionAuth(input: {
  nodeEnv: string | undefined;
  profileName: string | undefined;
  useOpenaiApiKey: boolean;
}): boolean {
  if (input.useOpenaiApiKey) {
    return false;
  }
  return input.nodeEnv?.trim() !== "test"
    && resolveHostedLocalProfile(input.profileName).mode !== "test";
}

// Parses MURPH_DEV_USE_OPENAI_API_KEY truthiness. Accepts "1" and "true"
// (case-insensitive); anything else is off, including the empty string.
export function isHostedLocalUseOpenaiApiKey(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const value = env[MURPH_DEV_USE_OPENAI_API_KEY_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true";
}

export function resolveHostedLocalCodexHome(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const configured = env[MURPH_HOSTED_LOCAL_CODEX_HOME_ENV]?.trim();
  if (configured) {
    return expandLeadingTilde(configured);
  }

  return path.join(os.homedir(), DEFAULT_HOSTED_LOCAL_CODEX_HOME_DIR_NAME);
}

// Loads ChatGPT-subscription Codex auth from the host Codex home for the
// hosted-local dev runner, refreshing host-side when the access token is near
// expiry. Returns single-line auth.json content for the runner env.
export async function resolveHostedLocalCodexSubscriptionAuthEnvValue(
  env: Readonly<Record<string, string | undefined>>,
): Promise<string> {
  const codexHome = resolveHostedLocalCodexHome(env);
  const authPath = path.join(codexHome, CODEX_AUTH_FILE_NAME);
  const auth = await readChatGptCodexAuthDotJson(authPath, codexHome);
  const refreshed = await maybeRefreshChatGptCodexAuth({ auth, authPath, codexHome });
  // Dotenv-style env files do not round-trip embedded quotes/backslashes
  // reliably across the wrangler env-file/.dev.vars hop; base64url keeps the
  // value inert end-to-end. The runner decodes it before use.
  return Buffer.from(
    JSON.stringify(buildRunnerSeedAuthDotJson(refreshed)),
    "utf8",
  ).toString("base64url");
}

// The runner gets only what Codex needs for ChatGPT subscription model calls. The
// durable account-scoped refresh token stays host-side: the harness refreshes
// before seeding, and a refresh inside the ephemeral runner could only orphan
// the rotated token. The seed uses Codex's external-token auth mode, where
// refresh is owned outside the runner.
function buildRunnerSeedAuthDotJson(
  auth: HostedLocalCodexSubscriptionHostAuth,
) {
  return buildHostedLocalCodexSubscriptionSeedAuth(auth);
}

async function readChatGptCodexAuthDotJson(
  authPath: string,
  codexHome: string,
): Promise<HostedLocalCodexSubscriptionHostAuth> {
  let raw: string;
  try {
    raw = await readFile(authPath, "utf8");
  } catch {
    throw new Error(
      [
        `Hosted local dev needs a ChatGPT-subscription Codex login at ${authPath}.`,
        `Run \`CODEX_HOME=${codexHome} codex login\` to sign in,`,
        `or point ${MURPH_HOSTED_LOCAL_CODEX_HOME_ENV} at a Codex home that is already signed in.`,
      ].join(" "),
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `${authPath} is not valid JSON. Re-run \`CODEX_HOME=${codexHome} codex login\` to repair it.`,
    );
  }

  try {
    return parseHostedLocalCodexSubscriptionHostAuth(parsed);
  } catch {
    throw new Error(
      [
        `${authPath} is not a ChatGPT-subscription Codex login.`,
        "Hosted local dev uses subscription auth for Codex model turns so dev",
        `does not bill the OpenAI API key. Run \`CODEX_HOME=${codexHome} codex login\``,
        "and choose the ChatGPT sign-in.",
      ].join(" "),
    );
  }
}

async function maybeRefreshChatGptCodexAuth(input: {
  auth: HostedLocalCodexSubscriptionHostAuth;
  authPath: string;
  codexHome: string;
}): Promise<HostedLocalCodexSubscriptionHostAuth> {
  if (!isWithinRefreshWindow(input.auth)) {
    return input.auth;
  }

  return withCodexAuthRefreshLock(input.authPath, async () => {
    // Another dev stack may have refreshed while this one waited on the lock;
    // re-read so the rotated refresh token is never reused.
    const auth = await readChatGptCodexAuthDotJson(input.authPath, input.codexHome);
    if (!isWithinRefreshWindow(auth)) {
      return auth;
    }

    const expiresAtMs = readJwtExpiryMs(String(auth.tokens?.access_token));
    const remainingMs = expiresAtMs === null ? 0 : expiresAtMs - Date.now();
    let refreshError: string | null = null;
    try {
      const refreshed = await refreshChatGptCodexAuth(auth);
      await writeFile(input.authPath, `${JSON.stringify(refreshed, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(input.authPath, 0o600);
      process.stderr.write(
        `[setup] Refreshed Codex subscription tokens in ${input.authPath} for hosted local dev.\n`,
      );
      return refreshed;
    } catch (error) {
      refreshError = error instanceof Error ? error.message : String(error);
    }

    if (remainingMs > ACCESS_TOKEN_MINIMUM_REMAINING_MS) {
      process.stderr.write(
        [
          `[setup] Warning: could not refresh Codex subscription tokens (${refreshError}).`,
          ` Continuing with the current token (${Math.round(remainingMs / 3_600_000)}h remaining).\n`,
        ].join(""),
      );
      return auth;
    }

    throw new Error(
      [
        `Codex subscription token refresh failed for ${input.authPath} (${refreshError})`,
        "and the current access token is too close to expiry for a safe dev session.",
        `Run \`CODEX_HOME=${input.codexHome} codex login\` to sign in again.`,
      ].join(" "),
    );
  });
}

function isWithinRefreshWindow(auth: HostedLocalCodexSubscriptionHostAuth): boolean {
  const expiresAtMs = readJwtExpiryMs(auth.tokens.access_token);
  return expiresAtMs === null
    || expiresAtMs - Date.now() <= ACCESS_TOKEN_REFRESH_WINDOW_MS;
}

// Exclusive advisory lock around the refresh so concurrent dev stacks
// serialize token rotation instead of tripping OAuth reuse detection.
async function withCodexAuthRefreshLock<T>(
  authPath: string,
  run: () => Promise<T>,
): Promise<T> {
  const lockPath = `${authPath}.murph-refresh-lock`;
  const deadline = Date.now() + REFRESH_LOCK_ACQUIRE_TIMEOUT_MS;

  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      await removeStaleCodexAuthRefreshLock(lockPath);
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for the Codex auth refresh lock at ${lockPath}. ` +
            "Remove it manually if no other hosted-local stack is starting.",
        );
      }
      await sleep(150);
    }
  }

  try {
    return await run();
  } finally {
    await rm(lockPath, { force: true, recursive: true });
  }
}

async function removeStaleCodexAuthRefreshLock(lockPath: string): Promise<void> {
  try {
    const lockStat = await stat(lockPath);
    if (Date.now() - lockStat.mtimeMs > REFRESH_LOCK_STALE_MS) {
      await rm(lockPath, { force: true, recursive: true });
    }
  } catch {
    // Lock vanished or is unreadable; the acquire loop will retry.
  }
}

async function refreshChatGptCodexAuth(
  auth: HostedLocalCodexSubscriptionHostAuth,
): Promise<HostedLocalCodexSubscriptionHostAuth> {
  const response = await fetch(CODEX_OAUTH_REFRESH_TOKEN_URL, {
    body: JSON.stringify({
      client_id: CODEX_OAUTH_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: auth.tokens.refresh_token,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(REFRESH_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`token refresh returned HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null) {
    throw new Error("token refresh returned an unexpected payload");
  }

  const payloadAccessToken = Reflect.get(payload, "access_token");
  if (typeof payloadAccessToken !== "string" || payloadAccessToken.length === 0) {
    throw new Error("token refresh did not return a new access token");
  }

  // Mirror Codex's persist_tokens: overwrite only returned fields and stamp
  // last_refresh so Codex's own refresh heuristics stay accurate.
  const tokens = { ...auth.tokens };
  for (const key of ["access_token", "id_token", "refresh_token"] as const) {
    const value = Reflect.get(payload, key);
    if (typeof value === "string" && value.length > 0) {
      tokens[key] = value;
    }
  }

  const refreshed = parseHostedLocalCodexSubscriptionHostAuth({
    ...auth,
    last_refresh: new Date().toISOString(),
    tokens,
  });
  assertAccessTokenMinimumRunway(refreshed);
  return refreshed;
}

function assertAccessTokenMinimumRunway(
  auth: HostedLocalCodexSubscriptionHostAuth,
): void {
  const expiresAtMs = readJwtExpiryMs(auth.tokens.access_token);
  const remainingMs = expiresAtMs === null ? 0 : expiresAtMs - Date.now();
  if (remainingMs <= ACCESS_TOKEN_MINIMUM_REMAINING_MS) {
    throw new Error("token refresh returned an access token that is too close to expiry");
  }
}

function readJwtExpiryMs(token: string): number | null {
  const payloadSegment = token.split(".")[1];
  if (!payloadSegment) {
    return null;
  }

  try {
    const claims: unknown = JSON.parse(
      Buffer.from(payloadSegment, "base64url").toString("utf8"),
    );
    if (typeof claims !== "object" || claims === null) {
      return null;
    }
    const exp = Reflect.get(claims, "exp");
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function expandLeadingTilde(value: string): string {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}
