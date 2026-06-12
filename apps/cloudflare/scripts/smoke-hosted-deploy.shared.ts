import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCloudflareHostedControlUserStatusPath,
} from "@murphai/cloudflare-hosted-control/routes";
import {
  parseHostedRunnerStatusResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  parseOptionalStrictInteger,
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
import {
  HOSTED_RUNNER_SMOKE_CLI_SURFACE_HOT_PATH_PROOF_COUNT,
} from "../src/hosted-runner-smoke-contract.ts";
import {
  DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
} from "../src/deploy-smoke-live-model.ts";

type EnvSource = Readonly<Record<string, string | undefined>>;

type FetchLike = typeof fetch;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const DEFAULT_RUNNER_CONTAINER_SMOKE_MAX_ATTEMPTS = 120;
const DEFAULT_RUNNER_CONTAINER_SMOKE_RETRY_DELAY_MS = 10_000;
interface SmokeControlRequest {
  authorizationHeader: string;
  boundUserId: string;
  fetchImpl: FetchLike;
  url: string;
  versionOverrideHeaders: Record<string, string> | undefined;
}

type SmokeUserStatus = HostedRunnerStatusResponse;

interface SmokeRunnerBundleManifest {
  buildSkipped?: boolean;
  bundleFingerprint?: string;
  sourceFingerprint?: string;
}

interface SmokeCodexShellResult {
  cliSurfaceContractBytes?: unknown;
  cliSurfaceHotPathProofCount?: unknown;
  client?: unknown;
  murphPathBytes?: unknown;
  noteAddBytes?: unknown;
  stderrBytes?: unknown;
  vaultCliLlmsBytes?: unknown;
  vaultCliPathBytes?: unknown;
  vaultShowBytes?: unknown;
}

interface SmokeDirectR2PresignedPutResult {
  byteLength?: unknown;
  ok?: unknown;
  payloadSha256?: unknown;
  status?: unknown;
}

interface SmokeLiveModelTurnResult {
  durationMs?: unknown;
  egressGrantConsumed?: unknown;
  model?: unknown;
  stdoutBytes?: unknown;
}

interface SmokeRunnerRetryPolicy {
  maxAttempts: number;
  retryDelayMs: number;
}

class RunnerContainerSmokeRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunnerContainerSmokeRetryableError";
  }
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
  const shouldSmokeDirectR2PresignedPut = readBooleanEnv(
    source.HOSTED_EXECUTION_SMOKE_DIRECT_R2_PRESIGNED_PUT,
    false,
  );
  if (shouldSmokeDirectR2PresignedPut && !shouldSmokeRunnerContainer) {
    throw new Error(
      "HOSTED_EXECUTION_SMOKE_DIRECT_R2_PRESIGNED_PUT requires HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER=true.",
    );
  }
  const shouldSmokeLiveModelTurn = readBooleanEnv(
    source.HOSTED_EXECUTION_SMOKE_LIVE_MODEL_TURN,
    false,
  );
  if (shouldSmokeLiveModelTurn && !shouldSmokeRunnerContainer) {
    throw new Error(
      "HOSTED_EXECUTION_SMOKE_LIVE_MODEL_TURN requires HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER=true.",
    );
  }
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

  let status: SmokeUserStatus | null = null;
  const statusRequest: SmokeControlRequest | null = smokeUserId && authorizationHeader
    ? {
        authorizationHeader,
        boundUserId: smokeUserId,
        fetchImpl,
        url: new URL(buildCloudflareHostedControlUserStatusPath(smokeUserId), smokeBaseUrl).toString(),
        versionOverrideHeaders,
      }
    : null;

  if (shouldSmokeRunnerContainer) {
    await assertRunnerContainerSmoke({
      fetchImpl,
      log,
      source,
      url: buildRunnerContainerSmokeUrl({
        directR2PresignedPut: shouldSmokeDirectR2PresignedPut,
        liveModelTurnModel: null,
        smokeBaseUrl,
      }),
      versionOverrideHeaders,
      expectDirectR2PresignedPut: shouldSmokeDirectR2PresignedPut,
      expectLiveModelTurnModel: null,
    });
    if (shouldSmokeLiveModelTurn) {
      await assertRunnerContainerLiveModelTurnSmoke({
        expectLiveModelTurnModel: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
        fetchImpl,
        source,
        url: buildRunnerContainerSmokeUrl({
          directR2PresignedPut: false,
          liveModelTurnModel: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
          smokeBaseUrl,
        }),
        versionOverrideHeaders,
      });
    }
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

  if (!statusRequest) {
    throw new Error("Authenticated hosted status configuration is missing.");
  }
  status ??= await readSmokeUserStatus(statusRequest);
  log(
    "Authenticated hosted status check passed. "
      + `mailboxLag=${JSON.stringify(status.mailboxLag)}`,
  );
  log("Cloudflare hosted execution smoke checks passed.");
}

async function assertRunnerContainerSmoke(input: {
  expectDirectR2PresignedPut: boolean;
  expectLiveModelTurnModel: string | null;
  fetchImpl: FetchLike;
  log: (message: string) => void;
  source: EnvSource;
  url: string;
  versionOverrideHeaders: Record<string, string> | undefined;
}): Promise<void> {
  const expectedManifest = await readExpectedRunnerBundleManifest(input.source);
  const retryPolicy = readRunnerContainerSmokeRetryPolicy(input.source);

  for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
    try {
      assertSmokeRunnerBundleManifest(
        await readRunnerContainerSmoke(input),
        expectedManifest,
      );
      return;
    } catch (error) {
      if (
        attempt >= retryPolicy.maxAttempts ||
        !(error instanceof RunnerContainerSmokeRetryableError)
      ) {
        throw error;
      }

      input.log(
        `Runner container smoke attempt ${attempt}/${retryPolicy.maxAttempts} failed `
          + `(${error.message}); retrying in ${retryPolicy.retryDelayMs}ms.`,
      );
      await sleep(retryPolicy.retryDelayMs);
    }
  }
}

async function assertRunnerContainerLiveModelTurnSmoke(input: {
  expectLiveModelTurnModel: string;
  fetchImpl: FetchLike;
  source: EnvSource;
  url: string;
  versionOverrideHeaders: Record<string, string> | undefined;
}): Promise<void> {
  const expectedManifest = await readExpectedRunnerBundleManifest(input.source);
  assertSmokeRunnerBundleManifest(
    await readRunnerContainerSmoke({
      expectDirectR2PresignedPut: false,
      expectLiveModelTurnModel: input.expectLiveModelTurnModel,
      fetchImpl: input.fetchImpl,
      retryableFailures: false,
      source: input.source,
      url: input.url,
      versionOverrideHeaders: input.versionOverrideHeaders,
    }),
    expectedManifest,
    {
      retryable: false,
    },
  );
}

async function readRunnerContainerSmoke(input: {
  expectDirectR2PresignedPut: boolean;
  expectLiveModelTurnModel: string | null;
  fetchImpl: FetchLike;
  retryableFailures?: boolean;
  source: EnvSource;
  url: string;
  versionOverrideHeaders: Record<string, string> | undefined;
}): Promise<SmokeRunnerBundleManifest | null> {
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
    const failureBody = await readSmokeFailureBody(response);
    const message = `runner container smoke failed with HTTP ${response.status}${
      failureBody ? `: ${failureBody}` : "."
    }`;
    throw input.retryableFailures !== false && (response.status === 400 || response.status >= 500)
      ? new RunnerContainerSmokeRetryableError(message)
      : new Error(message);
  }

  const responsePayload = await response.json() as {
    ok?: unknown;
    runnerContainer?: {
      codexShell?: SmokeCodexShellResult | null;
      directR2PresignedPut?: SmokeDirectR2PresignedPutResult | null;
      liveModelTurn?: SmokeLiveModelTurnResult | null;
      ok?: unknown;
      runnerBundle?: SmokeRunnerBundleManifest | null;
      service?: unknown;
    };
  };

  if (responsePayload.ok !== true || responsePayload.runnerContainer?.ok !== true) {
    throw input.retryableFailures === false
      ? new Error("runner container smoke did not return ok=true.")
      : new RunnerContainerSmokeRetryableError("runner container smoke did not return ok=true.");
  }

  if (responsePayload.runnerContainer.service !== "cloudflare-hosted-runner-node") {
    throw new Error("runner container smoke did not return the expected service id.");
  }

  assertSmokeCodexShellResult(responsePayload.runnerContainer.codexShell);
  if (input.expectDirectR2PresignedPut) {
    assertSmokeDirectR2PresignedPutResult(responsePayload.runnerContainer.directR2PresignedPut);
  }
  if (input.expectLiveModelTurnModel !== null) {
    assertSmokeLiveModelTurnResult(
      responsePayload.runnerContainer.liveModelTurn,
      input.expectLiveModelTurnModel,
    );
  }

  return responsePayload.runnerContainer.runnerBundle ?? null;
}

async function readSmokeFailureBody(response: Response): Promise<string | null> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return null;
  }

  const redacted = redactSmokeFailureBody(text)
    .replace(/\s+/gu, " ")
    .trim();
  return redacted.length > 0 ? redacted.slice(0, 512) : null;
}

function redactSmokeFailureBody(value: string): string {
  return value
    .replace(/(Authorization:\s*(?:Bearer|Basic)\s+)[^\s"',}]+/giu, "$1<REDACTED>")
    .replace(/(X-Amz-(?:Credential|Signature|Security-Token)=)[^&\s"',}]+/giu, "$1<REDACTED>")
    .replace(
      /("?(?:api|auth|access|refresh|id)?[_-]?(?:token|secret|password|private[_-]?jwk|key)"?\s*[:=]\s*["']?)[^"',\s}]+/giu,
      "$1<REDACTED>",
    );
}

function buildRunnerContainerSmokeUrl(input: {
  directR2PresignedPut: boolean;
  liveModelTurnModel: string | null;
  smokeBaseUrl: string;
}): string {
  const url = new URL("/internal/deploy/container-smoke", input.smokeBaseUrl);
  if (input.directR2PresignedPut) {
    url.searchParams.set("directR2PresignedPut", "1");
  }
  if (input.liveModelTurnModel !== null) {
    url.searchParams.set("liveModelTurn", input.liveModelTurnModel);
  }
  return url.toString();
}

function assertSmokeCodexShellResult(
  value: SmokeCodexShellResult | null | undefined,
): void {
  if (!value || typeof value !== "object") {
    throw new Error("runner container smoke did not return Codex shell metadata.");
  }
  if (value.client !== "codex-app-server") {
    throw new Error("runner container Codex shell smoke did not use the Codex app-server client.");
  }
  for (const [key, rawValue] of Object.entries({
    cliSurfaceContractBytes: value.cliSurfaceContractBytes,
    murphPathBytes: value.murphPathBytes,
    noteAddBytes: value.noteAddBytes,
    vaultCliLlmsBytes: value.vaultCliLlmsBytes,
    vaultCliPathBytes: value.vaultCliPathBytes,
    vaultShowBytes: value.vaultShowBytes,
  })) {
    if (typeof rawValue !== "number" || rawValue <= 0) {
      throw new Error(`runner container Codex shell smoke reported invalid ${key}.`);
    }
  }
  if (
    typeof value.cliSurfaceHotPathProofCount !== "number" ||
    value.cliSurfaceHotPathProofCount < HOSTED_RUNNER_SMOKE_CLI_SURFACE_HOT_PATH_PROOF_COUNT
  ) {
    throw new Error(
      "runner container Codex shell smoke did not prove assistant CLI surface hot-path schemas.",
    );
  }
  if (typeof value.stderrBytes !== "number" || value.stderrBytes < 0) {
    throw new Error("runner container Codex shell smoke reported invalid stderr bytes.");
  }
}

function assertSmokeDirectR2PresignedPutResult(
  value: SmokeDirectR2PresignedPutResult | null | undefined,
): void {
  if (!value || typeof value !== "object") {
    throw new Error("runner container direct R2 presigned PUT smoke did not return metadata.");
  }
  if (value.ok !== true || value.status !== 200) {
    throw new Error("runner container direct R2 presigned PUT smoke did not complete successfully.");
  }
  if (typeof value.byteLength !== "number" || value.byteLength <= 150 * 1024 * 1024) {
    throw new Error("runner container direct R2 presigned PUT smoke did not upload a large payload.");
  }
  if (typeof value.payloadSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.payloadSha256)) {
    throw new Error("runner container direct R2 presigned PUT smoke did not report a payload hash.");
  }
}

function assertSmokeLiveModelTurnResult(
  value: SmokeLiveModelTurnResult | null | undefined,
  expectedModel: string,
): void {
  if (!value || typeof value !== "object") {
    throw new Error("runner container live model turn smoke did not return metadata.");
  }
  if (value.model !== expectedModel) {
    throw new Error("runner container live model turn smoke did not use the expected model.");
  }
  if (typeof value.durationMs !== "number" || value.durationMs <= 0) {
    throw new Error("runner container live model turn smoke reported an invalid duration.");
  }
  if (value.egressGrantConsumed !== true) {
    throw new Error("runner container live model turn smoke did not consume the egress grant.");
  }
  if (typeof value.stdoutBytes !== "number" || value.stdoutBytes <= 0) {
    throw new Error("runner container live model turn smoke reported no codex exec output.");
  }
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
  options: {
    retryable?: boolean;
  } = {},
): void {
  const retryable = options.retryable !== false;
  const createManifestError = (message: string): Error =>
    retryable ? new RunnerContainerSmokeRetryableError(message) : new Error(message);

  if (!actual) {
    throw createManifestError(
      "runner container smoke did not return runner bundle metadata.",
    );
  }

  if (actual.buildSkipped === true) {
    throw new Error("runner container smoke returned a runner bundle assembled without rebuilding workspace artifacts.");
  }

  if (
    typeof actual.bundleFingerprint !== "string" ||
    typeof actual.sourceFingerprint !== "string"
  ) {
    throw createManifestError(
      "runner container smoke returned incomplete runner bundle metadata.",
    );
  }

  if (
    actual.bundleFingerprint !== expected.bundleFingerprint ||
    actual.sourceFingerprint !== expected.sourceFingerprint
  ) {
    throw createManifestError(
      "runner container smoke did not run the expected runner bundle. "
        + `expected bundle=${expected.bundleFingerprint} source=${expected.sourceFingerprint}; `
        + `actual bundle=${actual.bundleFingerprint} source=${actual.sourceFingerprint}.`,
    );
  }
}

function readRunnerContainerSmokeRetryPolicy(source: EnvSource): SmokeRunnerRetryPolicy {
  const maxAttempts = parseOptionalStrictInteger(
    source.HOSTED_EXECUTION_SMOKE_RUNNER_MAX_ATTEMPTS,
    "HOSTED_EXECUTION_SMOKE_RUNNER_MAX_ATTEMPTS must be a positive integer.",
  ) ?? DEFAULT_RUNNER_CONTAINER_SMOKE_MAX_ATTEMPTS;
  const retryDelayMs = parseOptionalStrictInteger(
    source.HOSTED_EXECUTION_SMOKE_RUNNER_RETRY_DELAY_MS,
    "HOSTED_EXECUTION_SMOKE_RUNNER_RETRY_DELAY_MS must be a non-negative integer.",
  ) ?? DEFAULT_RUNNER_CONTAINER_SMOKE_RETRY_DELAY_MS;

  if (maxAttempts < 1) {
    throw new Error("HOSTED_EXECUTION_SMOKE_RUNNER_MAX_ATTEMPTS must be a positive integer.");
  }

  if (retryDelayMs < 0) {
    throw new Error("HOSTED_EXECUTION_SMOKE_RUNNER_RETRY_DELAY_MS must be a non-negative integer.");
  }

  return {
    maxAttempts,
    retryDelayMs,
  };
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, ms));
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

  return parseHostedRunnerStatusResponse(await response.json());
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
