import {
  buildCloudflareHostedControlUserRunPath,
  buildCloudflareHostedControlUserStatusPath,
} from "@murphai/cloudflare-hosted-control";
import {
  parseHostedExecutionUserStatus,
} from "@murphai/hosted-execution";
import type {
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution";
import {
  readBearerAuthorizationToken,
} from "../src/auth-adapter.ts";

type EnvSource = Readonly<Record<string, string | undefined>>;

type FetchLike = typeof fetch;

interface SmokeControlRequest {
  authorizationHeader: string;
  fetchImpl: FetchLike;
  headers: Record<string, string> | undefined;
  url: string;
}

type SmokeUserStatus = HostedExecutionUserStatus;

const DEFAULT_SMOKE_STATUS_POLL_INTERVAL_MS = 2_000;
const DEFAULT_SMOKE_STATUS_TIMEOUT_MS = 60_000;

export function resolveSmokeWorkerBaseUrl(source: EnvSource = process.env): string {
  const workerBaseUrl =
    normalizeConfiguredString(source.HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL)
    ?? normalizeConfiguredString(source.HOSTED_EXECUTION_DISPATCH_URL);

  if (!workerBaseUrl) {
    throw new Error(
      "HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL or HOSTED_EXECUTION_DISPATCH_URL must be configured.",
    );
  }

  return workerBaseUrl.replace(/\/$/u, "");
}

export function buildVersionOverrideHeaders(
  source: EnvSource = process.env,
): Record<string, string> | undefined {
  const smokeVersionId = normalizeConfiguredString(source.HOSTED_EXECUTION_SMOKE_VERSION_ID);

  if (!smokeVersionId) {
    return undefined;
  }

  const workerName = normalizeConfiguredString(
    source.HOSTED_EXECUTION_SMOKE_WORKER_NAME
      ?? source.CF_WORKER_NAME,
  );

  if (!workerName) {
    throw new Error("HOSTED_EXECUTION_SMOKE_WORKER_NAME or CF_WORKER_NAME must be configured.");
  }

  return {
    "Cloudflare-Workers-Version-Overrides": `${workerName}="${smokeVersionId}"`,
  };
}

export async function runSmokeHostedDeploy(input: {
  fetchImpl?: FetchLike;
  log?: (message: string) => void;
  source?: EnvSource;
} = {}): Promise<void> {
  const source = input.source ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const log = input.log ?? console.log;
  const workerBaseUrl = resolveSmokeWorkerBaseUrl(source);
  const smokeUserId = normalizeConfiguredString(source.HOSTED_EXECUTION_SMOKE_USER_ID);
  const authorizationHeader = readSmokeOidcAuthorizationHeader(source);
  const versionOverrideHeaders = buildVersionOverrideHeaders(source);

  await assertHealth(fetchImpl, new URL("/health", `${workerBaseUrl}/`).toString(), versionOverrideHeaders);

  if (smokeUserId) {
    if (!authorizationHeader) {
      throw new Error(
        "HOSTED_EXECUTION_SMOKE_OIDC_TOKEN or VERCEL_OIDC_TOKEN is required when HOSTED_EXECUTION_SMOKE_USER_ID is set.",
      );
    }

    const statusRequest: SmokeControlRequest = {
      authorizationHeader,
      fetchImpl,
      headers: versionOverrideHeaders,
      url: new URL(buildCloudflareHostedControlUserStatusPath(smokeUserId), `${workerBaseUrl}/`).toString(),
    };
    const initialStatus = await readSmokeUserStatus(statusRequest);
    await invokeManualRun({
      ...statusRequest,
      url: new URL(buildCloudflareHostedControlUserRunPath(smokeUserId), `${workerBaseUrl}/`).toString(),
    });
    const pollIntervalMs = readPositiveInteger(
      source.HOSTED_EXECUTION_SMOKE_STATUS_POLL_INTERVAL_MS,
      DEFAULT_SMOKE_STATUS_POLL_INTERVAL_MS,
      "HOSTED_EXECUTION_SMOKE_STATUS_POLL_INTERVAL_MS",
    );
    const timeoutMs = readPositiveInteger(
      source.HOSTED_EXECUTION_SMOKE_STATUS_TIMEOUT_MS,
      DEFAULT_SMOKE_STATUS_TIMEOUT_MS,
      "HOSTED_EXECUTION_SMOKE_STATUS_TIMEOUT_MS",
    );
    const finalStatus = await waitForSmokeCompletion({
      initialStatus,
      pollIntervalMs,
      statusRequest,
      timeoutMs,
    });

    log(
      `Manual smoke run completed for ${smokeUserId} at ${finalStatus.lastRunAt}.`,
    );
  } else {
    log("Skipping manual smoke run because HOSTED_EXECUTION_SMOKE_USER_ID is not configured.");
  }

  log("Cloudflare hosted execution smoke checks passed.");
}

async function assertHealth(
  fetchImpl: FetchLike,
  url: string,
  versionOverrideHeaders: Record<string, string> | undefined,
): Promise<void> {
  const response = await fetchImpl(url, {
    headers: versionOverrideHeaders,
  });

  if (!response.ok) {
    throw new Error(`worker health check failed with HTTP ${response.status}.`);
  }

  const payload = await response.json() as { ok?: unknown };

  if (payload.ok !== true) {
    throw new Error("worker health check did not return ok=true.");
  }
}

async function invokeManualRun(input: SmokeControlRequest): Promise<void> {
  await sendSmokeControlRequest({
    ...input,
    action: "Manual smoke run",
    body: JSON.stringify({}),
    method: "POST",
  });
}

async function readSmokeUserStatus(input: SmokeControlRequest): Promise<SmokeUserStatus> {
  const response = await sendSmokeControlRequest({
    ...input,
    action: "Manual smoke status check",
  });

  return parseHostedExecutionUserStatus(await response.json());
}

async function waitForSmokeCompletion(input: {
  initialStatus: SmokeUserStatus;
  pollIntervalMs: number;
  statusRequest: SmokeControlRequest;
  timeoutMs: number;
}): Promise<SmokeUserStatus> {
  const startedAt = Date.now();

  while (true) {
    const status = await readSmokeUserStatus(input.statusRequest);

    if (didSmokeRunComplete(input.initialStatus, status)) {
      return status;
    }

    if ((Date.now() - startedAt) >= input.timeoutMs) {
      throw new Error(
        [
          `Timed out waiting for manual smoke run completion after ${input.timeoutMs}ms.`,
          `pendingEventCount=${status.pendingEventCount}`,
          `inFlight=${status.inFlight}`,
          `lastRunAt=${status.lastRunAt ?? "null"}`,
          `retryingEventId=${status.retryingEventId ?? "null"}`,
          `lastError=${status.lastError ?? "null"}`,
        ].join(" "),
      );
    }

    await sleep(input.pollIntervalMs);
  }
}

async function sendSmokeControlRequest(input: SmokeControlRequest & {
  action: string;
  body?: string;
  method?: "GET" | "POST";
}): Promise<Response> {
  const response = await input.fetchImpl(input.url, {
    body: input.body,
    headers: {
      ...(input.body ? { "content-type": "application/json; charset=utf-8" } : {}),
      ...(input.headers ?? {}),
      authorization: input.authorizationHeader,
    },
    method: input.method ?? "GET",
  });

  if (!response.ok) {
    throw new Error(`${input.action} failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}.`);
  }

  return response;
}

function didSmokeRunComplete(
  initialStatus: SmokeUserStatus,
  nextStatus: SmokeUserStatus,
): boolean {
  if (nextStatus.pendingEventCount !== 0 || nextStatus.inFlight) {
    return false;
  }

  if (!didLastRunAdvance(initialStatus.lastRunAt, nextStatus.lastRunAt)) {
    return false;
  }

  return hasBundleRefs(nextStatus);
}

function didLastRunAdvance(
  initialLastRunAt: string | null,
  nextLastRunAt: string | null,
): boolean {
  if (!nextLastRunAt) {
    return false;
  }

  if (!initialLastRunAt) {
    return true;
  }

  return Date.parse(nextLastRunAt) > Date.parse(initialLastRunAt);
}

function hasBundleRefs(status: SmokeUserStatus): boolean {
  return status.bundleRef !== null;
}

function readPositiveInteger(value: string | undefined, fallback: number, label: string): number {
  const normalized = normalizeConfiguredString(value);

  if (!normalized) {
    return fallback;
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function normalizeConfiguredString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readSmokeOidcAuthorizationHeader(source: EnvSource): string | null {
  const token = normalizeConfiguredString(source.HOSTED_EXECUTION_SMOKE_OIDC_TOKEN)
    ?? normalizeConfiguredString(source.VERCEL_OIDC_TOKEN);

  if (!token) {
    return null;
  }

  const normalized = readBearerAuthorizationToken(token.startsWith("Bearer ") ? token : `Bearer ${token}`);
  return normalized ? `Bearer ${normalized}` : null;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
