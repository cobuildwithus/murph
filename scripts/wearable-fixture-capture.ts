import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";

import { initializeVault } from "@murphai/core";
import { ensureManagedDeviceSyncControlPlane } from "@murphai/operator-config/device-daemon";
import {
  createDeviceSyncClient,
  DEFAULT_DEVICE_SYNC_BASE_URL,
} from "@murphai/operator-config/device-sync-client";
import type { DeviceSyncAccountRecord } from "@murphai/device-syncd/client";
import {
  JUNCTION_CONNECT_SOURCE_TARGETS,
} from "@murphai/device-syncd/connect-config";
import { readConfiguredJunctionDeviceSyncProviderConfig } from "@murphai/device-syncd/config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultRuntimeRoot = path.join(repoRoot, ".runtime", "tmp", "wearable-fixture-capture");
const defaultVaultRoot = path.join(defaultRuntimeRoot, "vault");
const defaultOutputPath = path.join(defaultRuntimeRoot, "output", "junction-wearables-sanitized.json");
const defaultPort = 8799;
const junctionProvider = "junction";
const redactedValue = "<redacted>";
const dateShiftAnchor = Date.parse("2026-04-01T00:00:00.000Z");
const reconcileWaitTimeoutMs = 120_000;
const reconcilePollMs = 2_000;
const requiredJunctionEnvKeys = [
  "JUNCTION_API_KEY",
  "JUNCTION_CLIENT_USER_ID_SECRET",
  "JUNCTION_ENV",
  "JUNCTION_REGION",
] as const;

const wearableCaptureTargetIds = ["oura", "whoop", "garmin"] as const;

type WearableCaptureTargetId = (typeof wearableCaptureTargetIds)[number];

interface WearableCaptureTarget {
  id: WearableCaptureTargetId;
  label: string;
  sourceProviderSlug: string;
  sourceAliases: readonly string[];
}

export const wearableCaptureTargets: readonly WearableCaptureTarget[] =
  wearableCaptureTargetIds.map(resolveWearableCaptureTarget);

interface CaptureCliOptions {
  port: number;
  vaultRoot: string;
  outputPath: string;
  deviceSyncBaseUrl: string | null;
}

interface CaptureServerState {
  env: NodeJS.ProcessEnv;
  origin: string;
  browserToken: string;
  options: CaptureCliOptions;
  controlPlane:
    | {
        baseUrl: string;
        controlToken: string | null;
      }
    | null;
  latestExportPath: string | null;
}

export interface RedactionReport {
  droppedKeys: number;
  pseudonymizedValues: number;
  shiftedDates: number;
  scannedFiles: number;
  includedJsonFiles: number;
  includedJsonlRecords: number;
}

interface SanitizedFixtureCandidate {
  schema: "murph.wearable-fixture-capture.v1";
  provider: "junction";
  generatedAt: string;
  captureWindow: {
    firstObservedAt: string | null;
    dateShiftAnchor: string;
  };
  targets: Array<{
    id: WearableCaptureTarget["id"];
    label: WearableCaptureTarget["label"];
    sourceProviderSlug: WearableCaptureTarget["sourceProviderSlug"];
  }>;
  accounts: Array<{
    provider: string;
    status: DeviceSyncAccountRecord["status"];
    setupPhase: DeviceSyncAccountRecord["setupPhase"] | null;
    sourceProviderSlugs: string[];
    lastSyncCompletedAt: string | null;
    lastSyncErrorAt: string | null;
    lastErrorCode: string | null;
  }>;
  rawArtifacts: Array<{
    relativePath: string;
    content: unknown;
  }>;
  eventLedgers: Array<{
    relativePath: string;
    records: unknown[];
  }>;
  metricSampleLedgers: Array<{
    relativePath: string;
    records: unknown[];
  }>;
  redactionReport: RedactionReport;
}

export interface SanitizerState {
  dateShiftMs: number;
  pseudonyms: Map<string, string>;
  pseudonymCounters: Map<string, number>;
  report: RedactionReport;
}

export interface CaptureRequestHostCheck {
  allowed: boolean;
  reason: "ok" | "missing_host" | "unexpected_host" | "forwarded_header";
}

interface JunctionCaptureConfigStatus {
  configured: boolean;
  missingEnv: string[];
  configError: string | null;
}

interface AccountSyncBaseline {
  id: string;
  lastSyncCompletedAt: string | null;
  lastSyncErrorAt: string | null;
}

type DeviceSyncClient = ReturnType<typeof createDeviceSyncClient>;

type ParsedCandidateFile =
  | {
      kind: "json";
      relativePath: string;
      value: unknown;
    }
  | {
      kind: "jsonl";
      relativePath: string;
      records: unknown[];
    };

function resolveWearableCaptureTarget(id: WearableCaptureTargetId): WearableCaptureTarget {
  const target = JUNCTION_CONNECT_SOURCE_TARGETS.find(
    (candidate) => candidate.connectSourceId === id && candidate.connectMode === "junction_link",
  );

  if (!target) {
    throw new Error(`Junction Link target is not configured for ${id}.`);
  }

  return {
    id,
    label: target.label,
    sourceProviderSlug: target.providerSlug,
    sourceAliases: Array.from(new Set([target.providerSlug, target.connectSourceId])),
  };
}

export function parseCaptureCliOptions(args: string[]): CaptureCliOptions {
  let port = defaultPort;
  let vaultRoot = defaultVaultRoot;
  let outputPath = defaultOutputPath;
  let deviceSyncBaseUrl: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--port" && next) {
      port = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--vault" && next) {
      vaultRoot = path.resolve(next);
      index += 1;
    } else if (arg === "--output" && next) {
      outputPath = path.resolve(next);
      index += 1;
    } else if (arg === "--device-sync-base-url" && next) {
      deviceSyncBaseUrl = next;
      index += 1;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Expected --port to be an integer between 1 and 65535.");
  }

  return {
    port,
    vaultRoot,
    outputPath,
    deviceSyncBaseUrl,
  };
}

export function loadLocalEnvFiles(
  root: string = repoRoot,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const nextEnv = { ...env };

  for (const relativePath of [".env", ".env.local"]) {
    const envPath = path.join(root, relativePath);
    const lockedEnvKeys = new Set(Object.keys(env));
    try {
      const contents = readFileSyncSafe(envPath);
      if (contents === null) {
        continue;
      }
      for (const line of contents.split(/\r?\n/)) {
        const parsed = parseEnvLine(line);
        if (!parsed || lockedEnvKeys.has(parsed.key)) {
          continue;
        }
        nextEnv[parsed.key] = parsed.value;
      }
    } catch {
      continue;
    }
  }

  return nextEnv;
}

export async function buildSanitizedWearableFixtureCandidate(input: {
  vaultRoot: string;
  accounts?: DeviceSyncAccountRecord[];
  generatedAt?: Date;
}): Promise<SanitizedFixtureCandidate> {
  const generatedAt = input.generatedAt ?? new Date();
  const files = await findCandidateFiles(input.vaultRoot);
  const parsedFiles = await Promise.all(
    files.map((filePath) => readParsedCandidateFile(input.vaultRoot, filePath)),
  );
  const valuesForTimestampScan = parsedFiles.flatMap((file) =>
    file.kind === "json" ? [file.value] : file.records,
  );

  const firstObservedAtMs = findEarliestTimestamp(valuesForTimestampScan);
  const state: SanitizerState = {
    dateShiftMs:
      firstObservedAtMs === null ? 0 : dateShiftAnchor - firstObservedAtMs,
    pseudonyms: new Map(),
    pseudonymCounters: new Map(),
    report: {
      droppedKeys: 0,
      pseudonymizedValues: 0,
      shiftedDates: 0,
      scannedFiles: files.length,
      includedJsonFiles: 0,
      includedJsonlRecords: 0,
    },
  };
  const rawArtifacts: SanitizedFixtureCandidate["rawArtifacts"] = [];
  const eventLedgers: SanitizedFixtureCandidate["eventLedgers"] = [];
  const metricSampleLedgers: SanitizedFixtureCandidate["metricSampleLedgers"] = [];

  for (const file of parsedFiles) {
    if (file.kind === "json") {
      rawArtifacts.push({
        relativePath: file.relativePath,
        content: sanitizeWearableCaptureValue(file.value, state),
      });
      state.report.includedJsonFiles += 1;
      continue;
    }

    const records = file.records.map((record) =>
      sanitizeWearableCaptureValue(record, state),
    );
    state.report.includedJsonlRecords += file.records.length;
    const ledger = {
      relativePath: file.relativePath,
      records,
    };

    if (file.relativePath.startsWith("ledger/events/")) {
      eventLedgers.push(ledger);
    } else if (file.relativePath.startsWith("ledger/metric-samples/")) {
      metricSampleLedgers.push(ledger);
    }
  }

  const accounts = (input.accounts ?? []).map((account) => ({
    provider: account.provider,
    status: account.status,
    setupPhase: account.setupPhase ?? null,
    sourceProviderSlugs: Array.from(
      new Set((account.sources ?? []).map((source) => source.sourceProviderSlug)),
    ).sort(),
    lastSyncCompletedAt: account.lastSyncCompletedAt,
    lastSyncErrorAt: account.lastSyncErrorAt,
    lastErrorCode: account.lastErrorCode,
  }));

  const candidate: SanitizedFixtureCandidate = {
    schema: "murph.wearable-fixture-capture.v1",
    provider: junctionProvider,
    generatedAt: generatedAt.toISOString(),
    captureWindow: {
      firstObservedAt:
        firstObservedAtMs === null
          ? null
          : shiftTimestamp(new Date(firstObservedAtMs).toISOString(), state.dateShiftMs),
      dateShiftAnchor: new Date(dateShiftAnchor).toISOString(),
    },
    targets: wearableCaptureTargets.map((target) => ({
      id: target.id,
      label: target.label,
      sourceProviderSlug: target.sourceProviderSlug,
    })),
    accounts,
    rawArtifacts,
    eventLedgers,
    metricSampleLedgers,
    redactionReport: state.report,
  };

  assertSanitizedFixtureSafe(candidate);
  return candidate;
}

export function sanitizeWearableCaptureValue(
  value: unknown,
  state: SanitizerState,
  keyPath: string[] = [],
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      sanitizeWearableCaptureValue(item, state, [...keyPath, String(index)]),
    );
  }

  if (isPlainRecord(value)) {
    const output: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(value)) {
      const decision = classifyKey(key, keyPath);
      if (decision === "drop") {
        state.report.droppedKeys += 1;
        continue;
      }
      if (decision === "pseudonymize") {
        output[key] = pseudonymizeValue(state, key, child);
        continue;
      }
      output[key] = sanitizeWearableCaptureValue(child, state, [...keyPath, key]);
    }

    return output;
  }

  if (typeof value === "string") {
    const shifted = shiftDateString(value, state.dateShiftMs);
    if (shifted !== value) {
      state.report.shiftedDates += 1;
      return shifted;
    }
    if (looksLikeEmail(value) || looksLikePhone(value)) {
      state.report.pseudonymizedValues += 1;
      return redactedValue;
    }
    if (looksLikeUuid(value)) {
      state.report.pseudonymizedValues += 1;
      return redactedValue;
    }
  }

  if (typeof value === "number") {
    const shifted = shiftTimestampNumber(value, state.dateShiftMs, keyPath);
    if (shifted !== value) {
      state.report.shiftedDates += 1;
      return shifted;
    }
  }

  return value;
}

export function assertSanitizedFixtureSafe(candidate: unknown): void {
  const serialized = JSON.stringify(candidate);
  const lowered = serialized.toLowerCase();
  const forbiddenFragments = [
    "access_token",
    "refreshtoken",
    "refresh_token",
    "authorization",
    "bearer ",
    "client_secret",
    "api_key",
  ];

  for (const fragment of forbiddenFragments) {
    if (lowered.includes(fragment)) {
      throw new Error("Sanitized wearable fixture still contains a forbidden secret marker.");
    }
  }

  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(serialized)) {
    throw new Error("Sanitized wearable fixture still contains an email-like value.");
  }

  for (const directIdentifier of [process.env.HOME, process.env.USER, process.env.LOGNAME]) {
    if (
      typeof directIdentifier === "string" &&
      directIdentifier.length > 4 &&
      serialized.includes(directIdentifier)
    ) {
      throw new Error("Sanitized wearable fixture still contains a local identifier.");
    }
  }
}

async function runServer(): Promise<void> {
  const options = parseCaptureCliOptions(process.argv.slice(2));
  const env = loadLocalEnvFiles(repoRoot, process.env);
  const origin = `http://127.0.0.1:${options.port}`;
  const state: CaptureServerState = {
    env: {
      ...env,
      DEVICE_SYNC_ALLOWED_RETURN_ORIGINS: appendCsvValue(
        env.DEVICE_SYNC_ALLOWED_RETURN_ORIGINS,
        origin,
      ),
    },
    origin,
    browserToken: randomBytes(24).toString("hex"),
    options,
    controlPlane: null,
    latestExportPath: null,
  };
  const server = createServer((request, response) => {
    void handleRequest(state, request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  console.log(`Wearable fixture capture helper: ${origin}`);
  console.log("Raw capture vault and sanitized exports stay under .runtime/tmp/wearable-fixture-capture/.");
}

async function handleRequest(
  state: CaptureServerState,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const hostCheck = checkCaptureRequestHost(request.headers, new URL(state.origin).host);
    if (!hostCheck.allowed) {
      sendJson(response, { error: "forbidden", reason: hostCheck.reason }, 403);
      return;
    }

    const requestUrl = new URL(request.url ?? "/", state.origin);

    if (request.method === "GET" && requestUrl.pathname === "/") {
      sendHtml(response, renderPage(state.browserToken));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/connected") {
      sendHtml(response, renderConnectedPage(requestUrl.searchParams.get("target")));
      return;
    }

    if (requestUrl.pathname.startsWith("/api/") || requestUrl.pathname.startsWith("/download/")) {
      assertBrowserToken(state, request);
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/status") {
      sendJson(response, await getStatus(state));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname.startsWith("/api/connect/")) {
      const target = requireTarget(requestUrl.pathname.slice("/api/connect/".length));
      const client = await ensureCaptureClient(state);
      const ownerId = await ensureCaptureOwnerId(state.options.vaultRoot);
      const result = await client.beginConnection({
        provider: junctionProvider,
        sourceProviderSlug: target.sourceProviderSlug,
        ownerId,
        returnTo: `${state.origin}/connected?target=${target.id}`,
        open: false,
      });
      sendJson(response, {
        authorizationUrl: result.authorizationUrl,
        expiresAt: result.expiresAt,
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/reconcile") {
      sendJson(response, await reconcileConnectedAccounts(state));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/export") {
      sendJson(response, await exportSanitizedFixture(state));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/download/latest") {
      await sendLatestExport(state, response);
      return;
    }

    sendJson(response, { error: "not_found" }, 404);
  } catch (error) {
    sendJson(
      response,
      {
        error: "request_failed",
        message: error instanceof Error ? error.message : "Request failed.",
      },
      500,
    );
  }
}

export function checkCaptureRequestHost(
  headers: IncomingMessage["headers"],
  expectedHost: string,
): CaptureRequestHostCheck {
  if (
    headers.forwarded !== undefined ||
    headers["x-forwarded-for"] !== undefined ||
    headers["x-forwarded-host"] !== undefined ||
    headers["x-forwarded-proto"] !== undefined ||
    headers["x-real-ip"] !== undefined
  ) {
    return {
      allowed: false,
      reason: "forwarded_header",
    };
  }

  const host = headers.host;
  if (typeof host !== "string" || host.trim().length === 0) {
    return {
      allowed: false,
      reason: "missing_host",
    };
  }

  return host.trim().toLowerCase() === expectedHost.toLowerCase()
    ? {
        allowed: true,
        reason: "ok",
      }
    : {
        allowed: false,
        reason: "unexpected_host",
      };
}

async function ensureCaptureClient(state: CaptureServerState): Promise<ReturnType<typeof createDeviceSyncClient>> {
  await ensureCaptureVault(state.options.vaultRoot);

  if (state.controlPlane === null) {
    const controlPlane = await ensureManagedDeviceSyncControlPlane({
      vault: state.options.vaultRoot,
      baseUrl: state.options.deviceSyncBaseUrl,
      env: state.env,
    });
    state.controlPlane = {
      baseUrl: controlPlane.baseUrl,
      controlToken: controlPlane.controlToken,
    };
  }

  return createDeviceSyncClient({
    baseUrl: state.controlPlane.baseUrl,
    controlToken: state.controlPlane.controlToken,
    env: state.env,
  });
}

async function ensureCaptureVault(vaultRoot: string): Promise<void> {
  await mkdir(vaultRoot, { recursive: true });

  try {
    await stat(path.join(vaultRoot, "vault.json"));
    return;
  } catch {
    await initializeVault({
      vaultRoot,
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
    });
  }
}

async function ensureCaptureOwnerId(vaultRoot: string): Promise<string> {
  const ownerStatePath = path.join(path.dirname(vaultRoot), "capture-owner.json");

  try {
    const parsed = JSON.parse(await readFile(ownerStatePath, "utf8"));
    if (
      isPlainRecord(parsed) &&
      parsed.schema === "murph.wearable-fixture-capture-owner.v1" &&
      typeof parsed.ownerId === "string" &&
      parsed.ownerId.startsWith("capture-owner-")
    ) {
      return parsed.ownerId;
    }
  } catch {
    // Regenerate invalid or missing local capture-owner state.
  }

  const ownerId = `capture-owner-${randomBytes(18).toString("hex")}`;
  await mkdir(path.dirname(ownerStatePath), { recursive: true });
  await writeFile(
    ownerStatePath,
    `${JSON.stringify({
      schema: "murph.wearable-fixture-capture-owner.v1",
      ownerId,
    }, null, 2)}\n`,
    "utf8",
  );
  return ownerId;
}

async function getStatus(state: CaptureServerState): Promise<Record<string, unknown>> {
  const configStatus = readJunctionCaptureConfigStatus(state.env);
  let accounts: DeviceSyncAccountRecord[] = [];
  let controlPlaneBaseUrl = state.options.deviceSyncBaseUrl ?? DEFAULT_DEVICE_SYNC_BASE_URL;
  let controlPlaneError: string | null = null;

  if (configStatus.configured) {
    try {
      const client = await ensureCaptureClient(state);
      controlPlaneBaseUrl = client.baseUrl;
      accounts = (await client.listAccounts({ provider: junctionProvider })).accounts;
    } catch (error) {
      controlPlaneError = safeErrorMessage(error);
      accounts = [];
    }
  }

  return {
    configured: configStatus.configured,
    missingEnv: configStatus.missingEnv,
    configError: configStatus.configError,
    controlPlaneError,
    controlPlaneBaseUrl,
    vault: ".runtime/tmp/wearable-fixture-capture/vault",
    output: ".runtime/tmp/wearable-fixture-capture/output/junction-wearables-sanitized.json",
    targets: buildTargetStatuses(accounts),
    accountCount: accounts.length,
    latestDownloadUrl: state.latestExportPath ? "/download/latest" : null,
  };
}

async function reconcileConnectedAccounts(state: CaptureServerState): Promise<Record<string, unknown>> {
  const client = await ensureCaptureClient(state);
  const before = new Date().toISOString();
  const accounts = (await client.listAccounts({ provider: junctionProvider })).accounts.filter(
    (account) => account.status === "active",
  );
  const baselines = accounts.map(toAccountSyncBaseline);

  for (const account of accounts) {
    await client.reconcileAccount(account.id);
  }

  const waitResult = await waitForAccountSyncSettlement(client, baselines, before);

  return {
    queuedCount: accounts.length,
    startedAt: before,
    settledCount: waitResult.settledCount,
    timedOutAccountCount: waitResult.timedOutAccountCount,
    targets: buildTargetStatuses(waitResult.accounts),
  };
}

async function waitForAccountSyncSettlement(
  client: DeviceSyncClient,
  baselines: AccountSyncBaseline[],
  startedAt: string,
): Promise<{
  accounts: DeviceSyncAccountRecord[];
  settledCount: number;
  timedOutAccountCount: number;
}> {
  if (baselines.length === 0) {
    return {
      accounts: [],
      settledCount: 0,
      timedOutAccountCount: 0,
    };
  }

  const deadline = Date.now() + reconcileWaitTimeoutMs;
  let latestAccounts = (await client.listAccounts({ provider: junctionProvider })).accounts;

  while (Date.now() < deadline) {
    const settledCount = countSettledAccounts(latestAccounts, baselines, startedAt);
    if (settledCount === baselines.length) {
      return {
        accounts: latestAccounts,
        settledCount,
        timedOutAccountCount: 0,
      };
    }

    await sleep(reconcilePollMs);
    latestAccounts = (await client.listAccounts({ provider: junctionProvider })).accounts;
  }

  const settledCount = countSettledAccounts(latestAccounts, baselines, startedAt);
  return {
    accounts: latestAccounts,
    settledCount,
    timedOutAccountCount: baselines.length - settledCount,
  };
}

function countSettledAccounts(
  accounts: DeviceSyncAccountRecord[],
  baselines: AccountSyncBaseline[],
  startedAt: string,
): number {
  return baselines.filter((baseline) => {
    const account = accounts.find((candidate) => candidate.id === baseline.id);
    return account ? isAccountSyncSettled(account, baseline, startedAt) : false;
  }).length;
}

function toAccountSyncBaseline(account: DeviceSyncAccountRecord): AccountSyncBaseline {
  return {
    id: account.id,
    lastSyncCompletedAt: account.lastSyncCompletedAt,
    lastSyncErrorAt: account.lastSyncErrorAt,
  };
}

function isAccountSyncSettled(
  account: DeviceSyncAccountRecord,
  baseline: AccountSyncBaseline,
  startedAt: string,
): boolean {
  return (
    isFreshSyncTimestamp(account.lastSyncCompletedAt, baseline.lastSyncCompletedAt, startedAt) ||
    isFreshSyncTimestamp(account.lastSyncErrorAt, baseline.lastSyncErrorAt, startedAt)
  );
}

function isFreshSyncTimestamp(
  value: string | null,
  previousValue: string | null,
  startedAt: string,
): boolean {
  if (!value || value === previousValue) {
    return false;
  }

  const parsedValue = Date.parse(value);
  const parsedStartedAt = Date.parse(startedAt);
  return Number.isFinite(parsedValue) && Number.isFinite(parsedStartedAt)
    ? parsedValue >= parsedStartedAt
    : true;
}

async function exportSanitizedFixture(state: CaptureServerState): Promise<Record<string, unknown>> {
  const client = await ensureCaptureClient(state);
  const accounts = (await client.listAccounts({ provider: junctionProvider })).accounts;
  const candidate = await buildSanitizedWearableFixtureCandidate({
    vaultRoot: state.options.vaultRoot,
    accounts,
  });

  await mkdir(path.dirname(state.options.outputPath), { recursive: true });
  await writeFile(state.options.outputPath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  state.latestExportPath = state.options.outputPath;

  return {
    downloadUrl: "/download/latest",
    output: ".runtime/tmp/wearable-fixture-capture/output/junction-wearables-sanitized.json",
    redactionReport: candidate.redactionReport,
    targetCount: candidate.targets.length,
    rawArtifactCount: candidate.rawArtifacts.length,
    eventLedgerCount: candidate.eventLedgers.length,
    metricSampleLedgerCount: candidate.metricSampleLedgers.length,
  };
}

async function sendLatestExport(state: CaptureServerState, response: ServerResponse): Promise<void> {
  if (!state.latestExportPath) {
    sendJson(response, { error: "no_export" }, 404);
    return;
  }

  const body = await readFile(state.latestExportPath);
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Disposition", "attachment; filename=\"junction-wearables-sanitized.json\"");
  response.end(body);
}

function buildTargetStatuses(accounts: DeviceSyncAccountRecord[]): Array<Record<string, unknown>> {
  return wearableCaptureTargets.map((target) => {
    const sourceAliases: readonly string[] = target.sourceAliases;
    const matchedSources = accounts.flatMap((account) =>
      (account.sources ?? []).filter((source) =>
        sourceAliases.includes(source.sourceProviderSlug),
      ),
    );
    return {
      id: target.id,
      label: target.label,
      sourceProviderSlug: target.sourceProviderSlug,
      connected: matchedSources.some((source) => source.status === "connected"),
      sourceCount: matchedSources.length,
      lastSeenAt: matchedSources
        .map((source) => source.lastSeenAt)
        .sort()
        .at(-1) ?? null,
    };
  });
}

async function findCandidateFiles(vaultRoot: string): Promise<string[]> {
  const roots = [
    path.join(vaultRoot, "raw", "integrations"),
    path.join(vaultRoot, "ledger", "events"),
    path.join(vaultRoot, "ledger", "metric-samples"),
  ];
  const files: string[] = [];

  for (const root of roots) {
    files.push(...await walkJsonFiles(root));
  }

  return files.sort();
}

async function readParsedCandidateFile(
  vaultRoot: string,
  filePath: string,
): Promise<ParsedCandidateFile> {
  const relativePath = toVaultRelativePath(vaultRoot, filePath);
  const contents = await readFile(filePath, "utf8");

  if (relativePath.endsWith(".json")) {
    return {
      kind: "json",
      relativePath,
      value: JSON.parse(contents),
    };
  }

  return {
    kind: "jsonl",
    relativePath,
    records: splitJsonl(contents).map((line) => JSON.parse(line)),
  };
}

async function walkJsonFiles(root: string): Promise<string[]> {
  try {
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkJsonFiles(entryPath));
    } else if (entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".jsonl"))) {
      files.push(entryPath);
    }
  }

  return files;
}

function classifyKey(key: string, keyPath: string[]): "keep" | "drop" | "pseudonymize" {
  const normalized = normalizeKey(key);
  const normalizedPath = keyPath.map(normalizeKey);

  if (
    [
      "accesstoken",
      "refreshtoken",
      "idtoken",
      "token",
      "authorization",
      "authorizationheader",
      "bearer",
      "clientsecret",
      "secret",
      "password",
      "apikey",
      "code",
      "cursor",
      "url",
      "weburl",
      "link",
      "href",
      "polyline",
      "route",
      "latitude",
      "longitude",
      "lat",
      "lng",
    ].includes(normalized)
  ) {
    return "drop";
  }

  if (
    [
      "email",
      "phone",
      "address",
      "birthdate",
      "dateofbirth",
      "firstname",
      "lastname",
      "fullname",
      "displayname",
      "memberid",
      "patientid",
      "personid",
      "userid",
      "user",
      "clientuserid",
      "ownerid",
      "accountid",
      "externalaccountid",
      "connectionid",
      "deviceid",
      "sourcedeviceid",
      "sourceid",
      "providerid",
      "serial",
      "serialnumber",
      "sourceinstancekey",
      "sourceappid",
      "appsourceid",
      "applicationid",
      "sourceapplicationid",
      "appid",
      "uuid",
      "provideruserid",
      "athleteid",
      "profileid",
    ].includes(normalized)
  ) {
    return "pseudonymize";
  }

  if (
    normalized === "id" &&
    normalizedPath.some((segment) =>
      [
        "account",
        "app",
        "athlete",
        "client",
        "device",
        "member",
        "owner",
        "person",
        "profile",
        "provider",
        "source",
        "user",
      ].some((identitySegment) => segment.includes(identitySegment)),
    )
  ) {
    return "pseudonymize";
  }

  return "keep";
}

function pseudonymizeValue(state: SanitizerState, key: string, value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const label = normalizeKey(key) || "value";
  const rawValue = typeof value === "string" ? value : JSON.stringify(value);
  const mapKey = `${label}:${rawValue}`;
  const existing = state.pseudonyms.get(mapKey);
  if (existing) {
    return existing;
  }

  const nextCounter = (state.pseudonymCounters.get(label) ?? 0) + 1;
  state.pseudonymCounters.set(label, nextCounter);
  const pseudonym = `fixture-${label}-${nextCounter}`;
  state.pseudonyms.set(mapKey, pseudonym);
  state.report.pseudonymizedValues += 1;
  return pseudonym;
}

function shiftDateString(value: string, shiftMs: number): string {
  if (shiftMs === 0) {
    return value;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const shifted = shiftTimestamp(value, shiftMs);
    return shifted === null ? value : shifted.slice(0, 10);
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?(?:\.\d+)?$/.test(value)) {
    return shiftTimestamp(`${value.replace(" ", "T")}Z`, shiftMs) ?? value;
  }

  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return value;
  }

  return shiftTimestamp(value, shiftMs) ?? value;
}

function shiftTimestampNumber(value: number, shiftMs: number, keyPath: string[]): number {
  if (shiftMs === 0 || !Number.isFinite(value) || !isTimestampKey(keyPath.at(-1) ?? "")) {
    return value;
  }

  if (value >= 946_684_800_000 && value <= 4_102_444_800_000) {
    return value + shiftMs;
  }

  if (value >= 946_684_800 && value <= 4_102_444_800) {
    return Math.round((value * 1_000 + shiftMs) / 1_000);
  }

  return value;
}

function shiftTimestamp(value: string, shiftMs: number): string | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed + shiftMs).toISOString();
}

function findEarliestTimestamp(values: unknown[]): number | null {
  let earliest: number | null = null;

  for (const value of values) {
    for (const timestamp of collectTimestamps(value)) {
      earliest = earliest === null ? timestamp : Math.min(earliest, timestamp);
    }
  }

  return earliest;
}

function collectTimestamps(value: unknown, keyPath: string[] = []): number[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectTimestamps(item, [...keyPath, String(index)]));
  }
  if (isPlainRecord(value)) {
    return Object.entries(value).flatMap(([key, item]) => collectTimestamps(item, [...keyPath, key]));
  }
  if (typeof value === "number") {
    const shifted = shiftTimestampNumber(value, 0, keyPath);
    if (shifted !== value || !isTimestampKey(keyPath.at(-1) ?? "")) {
      return [];
    }
    if (value >= 946_684_800_000 && value <= 4_102_444_800_000) {
      return [value];
    }
    if (value >= 946_684_800 && value <= 4_102_444_800) {
      return [value * 1_000];
    }
    return [];
  }
  if (typeof value !== "string") {
    return [];
  }
  if (!/^\d{4}-\d{2}-\d{2}(?:T| |\b)/.test(value)) {
    return [];
  }
  const parseValue = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const parsed = Date.parse(parseValue);
  return Number.isFinite(parsed) ? [parsed] : [];
}

function renderPage(browserToken: string): string {
  return htmlDocument(`
    <main>
      <section class="toolbar">
        ${wearableCaptureTargets
          .map(
            (target) =>
              `<button data-connect="${target.id}">Connect ${escapeHtml(target.label)}</button>`,
          )
          .join("")}
        <button data-action="sync">Run sync</button>
        <button data-action="export">Build sanitized fixture</button>
      </section>
      <section class="panel">
        <div class="status-line" id="config"></div>
        <div class="targets" id="targets"></div>
        <pre id="log"></pre>
      </section>
    </main>
    <script>
      const captureToken = ${escapeJsString(browserToken)};
      const log = document.querySelector("#log");
      const config = document.querySelector("#config");
      const targets = document.querySelector("#targets");
      function append(message) {
        log.textContent = [new Date().toLocaleTimeString(), message, log.textContent].filter(Boolean).join("\\n");
      }
      async function api(path, options = {}) {
        const response = await fetch(path, {
          ...options,
          headers: { ...(options.headers || {}), "X-Capture-Token": captureToken },
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || payload.error || "Request failed");
        return payload;
      }
      async function downloadLatest(path) {
        const response = await fetch(path, { headers: { "X-Capture-Token": captureToken } });
        if (!response.ok) throw new Error("Download failed");
        const blobUrl = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = "junction-wearables-sanitized.json";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(blobUrl);
      }
      async function refresh() {
        const status = await api("/api/status");
        config.textContent = status.configured
          ? "Junction credentials found. Raw data stays in " + status.vault + "."
          : status.configError || ("Missing Junction env: " + status.missingEnv.join(", "));
        if (status.controlPlaneError) append(status.controlPlaneError);
        targets.innerHTML = status.targets.map((target) =>
          '<div class="target ' + (target.connected ? "connected" : "") + '">' +
          '<strong>' + target.label + '</strong>' +
          '<span>' + (target.connected ? "connected" : "not connected") + '</span>' +
          '</div>'
        ).join("");
        if (status.latestDownloadUrl) append("Latest sanitized export is ready.");
      }
      for (const button of document.querySelectorAll("[data-connect]")) {
        button.addEventListener("click", async () => {
          const target = button.getAttribute("data-connect");
          append("Opening Junction Link for " + target + "...");
          const result = await api("/api/connect/" + target, { method: "POST" });
          window.location.href = result.authorizationUrl;
        });
      }
      document.querySelector('[data-action="sync"]').addEventListener("click", async () => {
        append("Sync queued...");
        const result = await api("/api/reconcile", { method: "POST" });
        append("Queued " + result.queuedCount + " account sync(s).");
        await refresh();
      });
      document.querySelector('[data-action="export"]').addEventListener("click", async () => {
        append("Building sanitized fixture candidate...");
        const result = await api("/api/export", { method: "POST" });
        append("Export ready: " + JSON.stringify(result.redactionReport));
        await downloadLatest(result.downloadUrl);
        await refresh();
      });
      refresh().catch((error) => append(error.message));
    </script>
  `);
}

function renderConnectedPage(target: string | null): string {
  return htmlDocument(`
    <main>
      <section class="panel">
        <h1>${target ? `${escapeHtml(target)} connected` : "Provider connected"}</h1>
        <p>Return to the capture page and run sync when all providers are connected.</p>
        <a class="button" href="/">Back to capture</a>
      </section>
    </main>
  `);
}

function htmlDocument(body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Wearable Fixture Capture</title>
  <style>
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f7f5ef; color: #1c1c1c; }
    main { width: min(920px, calc(100vw - 32px)); margin: 48px auto; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
    button, .button { border: 1px solid #1d4d47; border-radius: 6px; background: #1d4d47; color: white; padding: 10px 14px; font: inherit; cursor: pointer; text-decoration: none; display: inline-flex; }
    button[data-action="export"] { background: #513c76; border-color: #513c76; }
    button[data-action="sync"] { background: #7a4b1f; border-color: #7a4b1f; }
    .panel { border: 1px solid #d3cdc0; border-radius: 8px; background: #fffdf8; padding: 18px; }
    .status-line { margin-bottom: 14px; color: #4d4a43; }
    .targets { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin-bottom: 16px; }
    .target { border: 1px solid #d3cdc0; border-radius: 8px; padding: 12px; display: grid; gap: 6px; background: #faf8f2; }
    .target.connected { border-color: #1d7b4f; background: #f1fbf4; }
    .target span { color: #68635a; }
    pre { min-height: 180px; white-space: pre-wrap; background: #171717; color: #f7f7f7; border-radius: 8px; padding: 14px; overflow: auto; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function sendHtml(response: ServerResponse, body: string): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  response.setHeader("X-Frame-Options", "DENY");
  response.end(body);
}

function sendJson(response: ServerResponse, body: unknown, statusCode = 200): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function assertBrowserToken(state: CaptureServerState, request: IncomingMessage): void {
  const token = request.headers["x-capture-token"];
  if (token !== state.browserToken) {
    throw new Error("Capture helper request token is missing or invalid.");
  }
}

function requireTarget(id: string): WearableCaptureTarget {
  const target = wearableCaptureTargets.find((candidate) => candidate.id === id);
  if (!target) {
    throw new Error(`Unknown wearable target: ${id}`);
  }
  return target;
}

function getMissingJunctionEnv(env: NodeJS.ProcessEnv): string[] {
  return requiredJunctionEnvKeys.filter((key) => !hasEnvValue(env[key]));
}

function readJunctionCaptureConfigStatus(env: NodeJS.ProcessEnv): JunctionCaptureConfigStatus {
  const missingEnv = getMissingJunctionEnv(env);

  if (missingEnv.length > 0) {
    return {
      configured: false,
      missingEnv,
      configError: null,
    };
  }

  try {
    const config = readConfiguredJunctionDeviceSyncProviderConfig(env);
    return {
      configured: Boolean(config),
      missingEnv: config ? [] : [...requiredJunctionEnvKeys],
      configError: null,
    };
  } catch (error) {
    return {
      configured: false,
      missingEnv,
      configError: safeErrorMessage(error),
    };
  }
}

function hasEnvValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const separator = trimmed.indexOf("=");
  if (separator <= 0) {
    return null;
  }
  const key = trimmed.slice(0, separator).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }
  return {
    key,
    value: stripEnvQuotes(trimmed.slice(separator + 1).trim()),
  };
}

function stripEnvQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function readFileSyncSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function appendCsvValue(existing: string | undefined, value: string): string {
  const values = new Set(
    (existing ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
  values.add(value);
  return Array.from(values).join(",");
}

function toVaultRelativePath(vaultRoot: string, filePath: string): string {
  return path.relative(vaultRoot, filePath).split(path.sep).join("/");
}

function splitJsonl(contents: string): string[] {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function normalizeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeEmail(value: string): boolean {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/iu.test(value);
}

function looksLikePhone(value: string): boolean {
  return /^\+?[0-9][0-9\s().-]{7,}[0-9]$/.test(value);
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isTimestampKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    normalized.endsWith("at") ||
    normalized.endsWith("date") ||
    normalized.endsWith("time") ||
    normalized.endsWith("timestamp") ||
    normalized.includes("datetime") ||
    normalized.includes("epoch") ||
    normalized === "start" ||
    normalized === "end" ||
    normalized === "from" ||
    normalized === "to"
  );
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Device sync control plane is not ready.";
  return redactLocalIdentifiers(message);
}

function redactLocalIdentifiers(value: string): string {
  let redacted = value;
  for (const directIdentifier of [process.env.HOME, process.env.USER, process.env.LOGNAME]) {
    if (typeof directIdentifier === "string" && directIdentifier.length > 4) {
      redacted = redacted.split(directIdentifier).join("<redacted>");
    }
  }
  return redacted;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeJsString(value: string): string {
  return JSON.stringify(value);
}

function printHelp(): void {
  console.log(`Usage: pnpm wearable:capture [--port ${defaultPort}] [--vault <path>] [--output <path>]

Starts a loopback-only Junction capture page for Oura, WHOOP, and Garmin.
Raw capture state and sanitized exports default to .runtime/tmp/wearable-fixture-capture/.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runServer().catch((error) => {
    console.error(error instanceof Error ? error.message : "Wearable capture helper failed.");
    process.exit(1);
  });
}
