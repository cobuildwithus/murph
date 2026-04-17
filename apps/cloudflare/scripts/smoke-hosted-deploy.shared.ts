import {
  buildCloudflareHostedControlUserStatusPath,
} from "@murphai/cloudflare-hosted-control/routes";
import {
  parseHostedExecutionUserStatus,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedExecutionUserStatus,
} from "@murphai/hosted-execution/contracts";
import {
  normalizeOptionalString,
} from "./deploy-automation/shared.ts";
import {
  readBearerAuthorizationToken,
} from "../src/auth-adapter.ts";

type EnvSource = Readonly<Record<string, string | undefined>>;

type FetchLike = typeof fetch;

interface SmokeControlRequest {
  authorizationHeader: string;
  boundUserId: string;
  fetchImpl: FetchLike;
  url: string;
  versionOverrideHeaders: Record<string, string> | undefined;
}

type SmokeUserStatus = HostedExecutionUserStatus;

export function resolveSmokeWorkerBaseUrl(source: EnvSource = process.env): string {
  const workerBaseUrl = readFirstConfiguredString(
    source.HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL,
    source.CF_PUBLIC_BASE_URL,
    source.HOSTED_EXECUTION_CONTROL_URL,
  );

  if (!workerBaseUrl) {
    throw new Error(
      "HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL, CF_PUBLIC_BASE_URL, or HOSTED_EXECUTION_CONTROL_URL must be configured.",
    );
  }

  return workerBaseUrl.replace(/\/$/u, "");
}

export function buildVersionOverrideHeaders(
  source: EnvSource = process.env,
): Record<string, string> | undefined {
  const smokeVersionId = normalizeOptionalString(source.HOSTED_EXECUTION_SMOKE_VERSION_ID);

  if (!smokeVersionId) {
    return undefined;
  }

  const workerName = readFirstConfiguredString(
    source.HOSTED_EXECUTION_SMOKE_WORKER_NAME,
    source.CF_WORKER_NAME,
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
  const smokeUserId = normalizeOptionalString(source.HOSTED_EXECUTION_SMOKE_USER_ID);
  const authorizationHeader = readSmokeOidcAuthorizationHeader(source);
  const versionOverrideHeaders = buildVersionOverrideHeaders(source);
  const smokeBaseUrl = `${workerBaseUrl}/`;

  await assertServiceBanner(
    fetchImpl,
    new URL("/", smokeBaseUrl).toString(),
    versionOverrideHeaders,
  );
  await assertHealth(
    fetchImpl,
    new URL("/health", smokeBaseUrl).toString(),
    versionOverrideHeaders,
  );

  if (!smokeUserId) {
    log("Skipping authenticated hosted status check because HOSTED_EXECUTION_SMOKE_USER_ID is not configured.");
    log("Cloudflare hosted execution smoke checks passed.");
    return;
  }

  if (!authorizationHeader) {
    throw new Error(
      "HOSTED_EXECUTION_SMOKE_OIDC_TOKEN or VERCEL_OIDC_TOKEN is required when HOSTED_EXECUTION_SMOKE_USER_ID is set.",
    );
  }

  const statusRequest: SmokeControlRequest = {
    authorizationHeader,
    boundUserId: smokeUserId,
    fetchImpl,
    url: new URL(buildCloudflareHostedControlUserStatusPath(smokeUserId), smokeBaseUrl).toString(),
    versionOverrideHeaders,
  };
  const status = await readSmokeUserStatus(statusRequest);
  log(`Authenticated hosted status check passed for ${smokeUserId}. pendingEventCount=${status.pendingEventCount}`);
  log("Cloudflare hosted execution smoke checks passed.");
}

async function assertHealth(
  fetchImpl: FetchLike,
  url: string,
  versionOverrideHeaders: Record<string, string> | undefined,
): Promise<void> {
  const payload = await readSmokePublicPayload(fetchImpl, url, versionOverrideHeaders, "worker health check");

  if (payload.ok !== true) {
    throw new Error("worker health check did not return ok=true.");
  }
}

async function assertServiceBanner(
  fetchImpl: FetchLike,
  url: string,
  versionOverrideHeaders: Record<string, string> | undefined,
): Promise<void> {
  const payload = await readSmokePublicPayload(fetchImpl, url, versionOverrideHeaders, "worker banner check");

  if (payload.ok !== true) {
    throw new Error("worker banner check did not return ok=true.");
  }

  if (payload.service !== "cloudflare-hosted-runner") {
    throw new Error("worker banner check did not return the expected service id.");
  }
}

async function readSmokePublicPayload(
  fetchImpl: FetchLike,
  url: string,
  versionOverrideHeaders: Record<string, string> | undefined,
  action: string,
): Promise<{ ok?: unknown; service?: unknown }> {
  const response = await fetchImpl(url, {
    headers: versionOverrideHeaders,
  });

  if (!response.ok) {
    throw new Error(`${action} failed with HTTP ${response.status}.`);
  }

  return await response.json() as { ok?: unknown; service?: unknown };
}

async function readSmokeUserStatus(input: SmokeControlRequest): Promise<SmokeUserStatus> {
  const response = await sendSmokeControlRequest({
    ...input,
    action: "Hosted execution status check",
  });

  return parseHostedExecutionUserStatus(await response.json());
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
      ...(input.versionOverrideHeaders ?? {}),
      authorization: input.authorizationHeader,
      [HOSTED_EXECUTION_USER_ID_HEADER]: input.boundUserId,
    },
    method: input.method ?? "GET",
  });

  if (!response.ok) {
    throw new Error(`${input.action} failed with HTTP ${response.status}.`);
  }

  return response;
}

function readSmokeOidcAuthorizationHeader(source: EnvSource): string | null {
  const token = readFirstConfiguredString(
    source.HOSTED_EXECUTION_SMOKE_OIDC_TOKEN,
    source.VERCEL_OIDC_TOKEN,
  );

  if (!token) {
    return null;
  }

  const normalized = readBearerAuthorizationToken(token.startsWith("Bearer ") ? token : `Bearer ${token}`);
  return normalized ? `Bearer ${normalized}` : null;
}

function readFirstConfiguredString(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    const normalized = normalizeOptionalString(value);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}
