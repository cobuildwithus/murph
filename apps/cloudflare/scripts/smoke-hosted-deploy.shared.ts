import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  readBooleanEnv,
  normalizeOptionalString,
} from "./deploy-automation/shared.ts";
import {
  runnerBundleManifestFileName,
} from "./deploy-artifacts.ts";
import {
  readBearerAuthorizationToken,
} from "../src/auth-adapter.ts";
import {
  createHostedWebCallbackSignatureHeaders,
  readHostedWebCallbackSigningEnvironment,
} from "../src/web-callback-auth.ts";

type EnvSource = Readonly<Record<string, string | undefined>>;

type FetchLike = typeof fetch;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");

interface SmokeControlRequest {
  authorizationHeader: string;
  boundUserId: string;
  fetchImpl: FetchLike;
  url: string;
  versionOverrideHeaders: Record<string, string> | undefined;
}

type SmokeUserStatus = HostedExecutionUserStatus;

interface SmokeRunnerBundleManifest {
  buildSkipped?: boolean;
  bundleFingerprint?: string;
  sourceFingerprint?: string;
}

export function resolveSmokeWorkerBaseUrl(source: EnvSource = process.env): string {
  const workerBaseUrl = readFirstConfiguredString(
    source.HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL,
    source.CF_PUBLIC_BASE_URL,
  );

  if (!workerBaseUrl) {
    throw new Error(
      "HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL or CF_PUBLIC_BASE_URL must be configured.",
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

export function resolveSmokeRunnerManifestPath(source: EnvSource = process.env): string {
  return normalizeOptionalString(source.HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH)
    ?? path.join(appDir, ".deploy", "runner-bundle", runnerBundleManifestFileName);
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
  const smokeVersionId = normalizeOptionalString(source.HOSTED_EXECUTION_SMOKE_VERSION_ID);
  const shouldSmokeRunnerContainer = readBooleanEnv(
    source.HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER,
    false,
  );
  const authorizationHeader = readSmokeOidcAuthorizationHeader(source);
  const versionOverrideHeaders = buildVersionOverrideHeaders(source);
  const smokeBaseUrl = `${workerBaseUrl}/`;

  await assertServiceBanner(
    fetchImpl,
    new URL("/", smokeBaseUrl).toString(),
    smokeVersionId,
    versionOverrideHeaders,
  );
  await assertHealth(
    fetchImpl,
    new URL("/health", smokeBaseUrl).toString(),
    smokeVersionId,
    versionOverrideHeaders,
  );

  if (shouldSmokeRunnerContainer) {
    await assertRunnerContainerSmoke({
      fetchImpl,
      source,
      url: new URL("/internal/deploy/container-smoke", smokeBaseUrl).toString(),
      versionOverrideHeaders,
    });
  }

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
  log(
    `Authenticated hosted status check passed for ${smokeUserId}. `
      + `pendingIngressEventCount=${status.pendingIngressEventCount}`,
  );
  log("Cloudflare hosted execution smoke checks passed.");
}

async function assertRunnerContainerSmoke(input: {
  fetchImpl: FetchLike;
  source: EnvSource;
  url: string;
  versionOverrideHeaders: Record<string, string> | undefined;
}): Promise<void> {
  const url = new URL(input.url);
  const payload = "";
  const signatureHeaders = await createHostedWebCallbackSignatureHeaders({
    environment: readHostedWebCallbackSigningEnvironment(input.source),
    method: "POST",
    path: url.pathname,
    payload,
    search: url.search,
  });
  const response = await input.fetchImpl(url, {
    body: payload,
    headers: {
      ...(input.versionOverrideHeaders ?? {}),
      ...signatureHeaders,
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`runner container smoke failed with HTTP ${response.status}.`);
  }

  const responsePayload = await response.json() as {
    ok?: unknown;
    runnerContainer?: {
      ok?: unknown;
      runnerBundle?: SmokeRunnerBundleManifest | null;
      service?: unknown;
    };
  };

  if (responsePayload.ok !== true || responsePayload.runnerContainer?.ok !== true) {
    throw new Error("runner container smoke did not return ok=true.");
  }

  if (responsePayload.runnerContainer.service !== "cloudflare-hosted-runner-node") {
    throw new Error("runner container smoke did not return the expected service id.");
  }

  assertSmokeRunnerBundleManifest(
    responsePayload.runnerContainer.runnerBundle ?? null,
    await readExpectedRunnerBundleManifest(input.source),
  );
}

async function readExpectedRunnerBundleManifest(source: EnvSource): Promise<SmokeRunnerBundleManifest> {
  const manifestPath = resolveSmokeRunnerManifestPath(source);
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("runner smoke manifest must contain a JSON object.");
  }

  const manifest = parsed as SmokeRunnerBundleManifest;

  if (
    typeof manifest.bundleFingerprint !== "string" ||
    typeof manifest.sourceFingerprint !== "string"
  ) {
    throw new Error("runner smoke manifest is missing bundle/source fingerprints.");
  }

  return manifest;
}

function assertSmokeRunnerBundleManifest(
  actual: SmokeRunnerBundleManifest | null,
  expected: SmokeRunnerBundleManifest,
): void {
  if (!actual) {
    throw new Error("runner container smoke did not return runner bundle metadata.");
  }

  if (actual.buildSkipped === true) {
    throw new Error("runner container smoke returned a runner bundle assembled without rebuilding workspace artifacts.");
  }

  if (
    typeof actual.bundleFingerprint !== "string" ||
    typeof actual.sourceFingerprint !== "string"
  ) {
    throw new Error("runner container smoke returned incomplete runner bundle metadata.");
  }

  if (
    actual.bundleFingerprint !== expected.bundleFingerprint ||
    actual.sourceFingerprint !== expected.sourceFingerprint
  ) {
    throw new Error("runner container smoke did not run the expected runner bundle.");
  }
}

async function assertHealth(
  fetchImpl: FetchLike,
  url: string,
  expectedVersionId: string | null,
  versionOverrideHeaders: Record<string, string> | undefined,
): Promise<void> {
  const payload = await readSmokePublicPayload(fetchImpl, url, versionOverrideHeaders, "worker health check");

  if (payload.ok !== true) {
    throw new Error("worker health check did not return ok=true.");
  }

  assertSmokeWorkerVersion(payload, expectedVersionId, "worker health check");
}

async function assertServiceBanner(
  fetchImpl: FetchLike,
  url: string,
  expectedVersionId: string | null,
  versionOverrideHeaders: Record<string, string> | undefined,
): Promise<void> {
  const payload = await readSmokePublicPayload(fetchImpl, url, versionOverrideHeaders, "worker banner check");

  if (payload.ok !== true) {
    throw new Error("worker banner check did not return ok=true.");
  }

  if (payload.service !== "cloudflare-hosted-runner") {
    throw new Error("worker banner check did not return the expected service id.");
  }

  assertSmokeWorkerVersion(payload, expectedVersionId, "worker banner check");
}

async function readSmokePublicPayload(
  fetchImpl: FetchLike,
  url: string,
  versionOverrideHeaders: Record<string, string> | undefined,
  action: string,
): Promise<{ ok?: unknown; service?: unknown; workerVersionId?: unknown }> {
  const response = await fetchImpl(url, {
    headers: versionOverrideHeaders,
  });

  if (!response.ok) {
    throw new Error(`${action} failed with HTTP ${response.status}.`);
  }

  return await response.json() as { ok?: unknown; service?: unknown; workerVersionId?: unknown };
}

function assertSmokeWorkerVersion(
  payload: { workerVersionId?: unknown },
  expectedVersionId: string | null,
  action: string,
): void {
  if (!expectedVersionId) {
    return;
  }

  if (payload.workerVersionId !== expectedVersionId) {
    throw new Error(`${action} did not run the requested Worker version.`);
  }
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
