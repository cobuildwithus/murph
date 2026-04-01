import {
  buildHostedExecutionUserRunPath,
  buildHostedExecutionUserStatusPath,
  type HostedExecutionBundleRef,
} from "@murph/hosted-execution";

type EnvSource = Readonly<Record<string, string | undefined>>;

type FetchLike = typeof fetch;

type SmokeBundleRef = HostedExecutionBundleRef;

interface SmokeUserStatus {
  bundleRefs: {
    agentState: SmokeBundleRef | null;
    vault: SmokeBundleRef | null;
  };
  inFlight: boolean;
  lastError: string | null;
  lastRunAt: string | null;
  pendingEventCount: number;
  poisonedEventIds: string[];
  retryingEventId: string | null;
}

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
  const controlToken = normalizeConfiguredString(source.HOSTED_EXECUTION_CONTROL_TOKEN);
  const versionOverrideHeaders = buildVersionOverrideHeaders(source);

  await assertHealth(fetchImpl, new URL("/health", `${workerBaseUrl}/`).toString(), versionOverrideHeaders);

  if (smokeUserId) {
    if (!controlToken) {
      throw new Error("HOSTED_EXECUTION_CONTROL_TOKEN is required when HOSTED_EXECUTION_SMOKE_USER_ID is set.");
    }

    const statusUrl = new URL(buildHostedExecutionUserStatusPath(smokeUserId), `${workerBaseUrl}/`).toString();
    const initialStatus = await readSmokeUserStatus({
      controlToken,
      fetchImpl,
      headers: versionOverrideHeaders,
      url: statusUrl,
    });
    await invokeManualRun({
      controlToken,
      fetchImpl,
      headers: versionOverrideHeaders,
      url: new URL(buildHostedExecutionUserRunPath(smokeUserId), `${workerBaseUrl}/`).toString(),
    });
    const finalStatus = await waitForSmokeCompletion({
      controlToken,
      fetchImpl,
      headers: versionOverrideHeaders,
      initialStatus,
      pollIntervalMs: readPositiveInteger(
        source.HOSTED_EXECUTION_SMOKE_STATUS_POLL_INTERVAL_MS,
        DEFAULT_SMOKE_STATUS_POLL_INTERVAL_MS,
        "HOSTED_EXECUTION_SMOKE_STATUS_POLL_INTERVAL_MS",
      ),
      timeoutMs: readPositiveInteger(
        source.HOSTED_EXECUTION_SMOKE_STATUS_TIMEOUT_MS,
        DEFAULT_SMOKE_STATUS_TIMEOUT_MS,
        "HOSTED_EXECUTION_SMOKE_STATUS_TIMEOUT_MS",
      ),
      url: statusUrl,
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

async function invokeManualRun(input: {
  controlToken: string;
  fetchImpl: FetchLike;
  headers: Record<string, string> | undefined;
  url: string;
}): Promise<void> {
  const response = await input.fetchImpl(input.url, {
    body: JSON.stringify({}),
    headers: {
      authorization: `Bearer ${input.controlToken}`,
      "content-type": "application/json; charset=utf-8",
      ...input.headers,
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Manual smoke run failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}.`);
  }
}

async function readSmokeUserStatus(input: {
  controlToken: string;
  fetchImpl: FetchLike;
  headers: Record<string, string> | undefined;
  url: string;
}): Promise<SmokeUserStatus> {
  const response = await input.fetchImpl(input.url, {
    headers: {
      authorization: `Bearer ${input.controlToken}`,
      ...input.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Manual smoke status check failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}.`);
  }

  return parseSmokeUserStatus(await response.json());
}

async function waitForSmokeCompletion(input: {
  controlToken: string;
  fetchImpl: FetchLike;
  headers: Record<string, string> | undefined;
  initialStatus: SmokeUserStatus;
  pollIntervalMs: number;
  timeoutMs: number;
  url: string;
}): Promise<SmokeUserStatus> {
  const startedAt = Date.now();

  while (true) {
    const status = await readSmokeUserStatus(input);

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
  return status.bundleRefs.agentState !== null || status.bundleRefs.vault !== null;
}

function normalizeConfiguredString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseSmokeUserStatus(value: unknown): SmokeUserStatus {
  const record = requireRecord(value, "Manual smoke status");

  return {
    bundleRefs: parseBundleRefs(record.bundleRefs),
    inFlight: requireBoolean(record.inFlight, "Manual smoke status inFlight"),
    lastError: readOptionalString(record.lastError, "Manual smoke status lastError"),
    lastRunAt: readOptionalString(record.lastRunAt, "Manual smoke status lastRunAt"),
    pendingEventCount: requireNonNegativeInteger(
      record.pendingEventCount,
      "Manual smoke status pendingEventCount",
    ),
    poisonedEventIds: readStringArray(record.poisonedEventIds, "Manual smoke status poisonedEventIds"),
    retryingEventId: readOptionalString(record.retryingEventId, "Manual smoke status retryingEventId"),
  };
}

function parseBundleRefs(value: unknown): SmokeUserStatus["bundleRefs"] {
  const record = requireRecord(value, "Manual smoke status bundleRefs");

  return {
    agentState: parseBundleRef(record.agentState, "Manual smoke status bundleRefs.agentState"),
    vault: parseBundleRef(record.vault, "Manual smoke status bundleRefs.vault"),
  };
}

function parseBundleRef(value: unknown, label: string): SmokeBundleRef | null {
  if (value === null || value === undefined) {
    return null;
  }

  const record = requireRecord(value, label);

  return {
    hash: requireString(record.hash, `${label}.hash`),
    key: requireString(record.key, `${label}.key`),
    size: requireNonNegativeInteger(record.size, `${label}.size`),
    updatedAt: requireString(record.updatedAt, `${label}.updatedAt`),
  };
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

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }

  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return value;
}

function readOptionalString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireString(value, label);
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value.map((entry, index) => requireString(entry, `${label}[${index}]`));
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
