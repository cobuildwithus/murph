#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, open, readFile, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  acquireDirectoryLock,
  atomicWriteJson,
  atomicWriteText,
  buildSnapshot,
  claimIncident,
  ensurePrivateDirectory,
  filterSnapshotForIncident,
  heartbeatIncident,
  normalizeToken,
  parseAdapterEvidence,
  parseProviderEvidence,
  readState,
  renderActiveIncidents,
  renderIncidentHistory,
  renderMonitorStatus,
  safeErrorCode,
  transitionIncident,
  updateStateFromSnapshot,
  WATCH_SOURCES,
  type AdapterEvidence,
  type CollectorFailure,
  type IncidentRecord,
  type IncidentState,
  type ProductionWatchSnapshot,
  type ProductionWatchState,
  type RunMode,
  type WatchSource,
} from "./prod-watch/core.ts";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const runtimeRoot = resolveRuntimeRoot();
const operationRoot = path.join(runtimeRoot, "operations", "prod-watch");
const projectionRoot = path.join(runtimeRoot, "projections", "prod-watch");
const lockRoot = path.join(runtimeRoot, "tmp", "prod-watch");
const statePath = path.join(operationRoot, "state.v1.json");
const overlapEventPath = path.join(operationRoot, "last-overlap.v1.json");
const activeIncidentsPath = path.join(projectionRoot, "ACTIVE_INCIDENTS.md");
const incidentHistoryPath = path.join(projectionRoot, "INCIDENT_HISTORY.md");
const monitorStatusPath = path.join(projectionRoot, "MONITOR_STATUS.md");
const latestSnapshotPath = path.join(projectionRoot, "latest.snapshot.v1.json");
const runLockPath = path.join(lockRoot, "run.lock");
const stateLockPath = path.join(lockRoot, "state.lock");
const databaseSqlPath = path.join(repoRoot, "scripts", "prod-watch", "collect-v1.sql");
const schedulerTemplatePath = path.join(repoRoot, "scripts", "prod-watch", "com.murph.prod-watch.plist.template");
const fixtureRoot = path.join(repoRoot, "scripts", "prod-watch", "fixtures");
const DATABASE_HELPER = "murph-prod-psql-ro";
const DEFAULT_LOOKBACK_MINUTES = 15;
const DEFAULT_SETTLING_DELAY_SECONDS = 60;
const DEFAULT_ADAPTER_TIMEOUT_MS = 30_000;
const DEFAULT_RUN_TIMEOUT_MS = 240_000;
const MAX_PROVIDER_EVIDENCE_BYTES = 256 * 1_024;
const MAX_SUBPROCESS_OUTPUT_BYTES = 1 * 1_024 * 1_024;
const SCHEDULER_INTERVAL_MS = 300_000;
const LAUNCHD_LABEL = "com.murph.prod-watch";
const LAUNCHD_MANAGED_MARKER = "murph-prod-watch-managed:v1";
const SCHEDULER_SYSTEM_PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] as const;
const USAGE = `Usage:
  pnpm --silent prod-watch collect [--lookback-minutes 15] [--fixture healthy|suspicious] [--provider-evidence <file>] [--output -|<file>]
  pnpm --silent prod-watch run [--scheduled] [--dry-run] [--provider-evidence <file>]
  pnpm --silent prod-watch drill-down <database-incident-id-or-fingerprint> --session-id <id> [--lookback-minutes 60]
  pnpm --silent prod-watch incident list
  pnpm --silent prod-watch incident claim <incident-id-or-fingerprint> --session-id <id>
  pnpm --silent prod-watch incident heartbeat <incident-id-or-fingerprint> --session-id <id>
  pnpm --silent prod-watch incident transition <incident-id-or-fingerprint> --session-id <id> --state <state>
  pnpm --silent prod-watch scheduler render [--output -|<file>]
  pnpm --silent prod-watch scheduler install
  pnpm --silent prod-watch scheduler status
  pnpm --silent prod-watch scheduler uninstall
  pnpm --silent prod-watch remediate <incident-id-or-fingerprint>
`;

interface CommonCollectOptions {
  lookbackMinutes: number;
  settlingDelaySeconds: number;
  adapterTimeoutMs: number;
  runTimeoutMs: number;
  fixture?: "healthy" | "suspicious";
  providerEvidencePath?: string;
  configuredSources: WatchSource[];
  dryRun: boolean;
  mode: RunMode;
  scheduled: boolean;
  outputPath?: string;
}

interface SnapshotResult {
  snapshot: ProductionWatchSnapshot;
  stateBefore: ProductionWatchState;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath;
if (isMain) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`prod-watch: ${safeErrorCode(error)}`);
    process.exitCode = 1;
  }
}

export async function runCli(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case "collect":
      await runCollectCommand(rest);
      return;
    case "run":
      await runScheduledCommand(rest);
      return;
    case "drill-down":
      await runDrillDownCommand(rest);
      return;
    case "incident":
      await runIncidentCommand(rest);
      return;
    case "scheduler":
      await runSchedulerCommand(rest);
      return;
    case "remediate":
      throw new Error("automation_disabled_phase_1");
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(USAGE);
      return;
    default:
      process.stderr.write(USAGE);
      throw new Error("command_invalid");
  }
}

async function runCollectCommand(argv: string[]): Promise<void> {
  const parsed = parseCommonOptions(argv, { mode: "collect", dryRun: true, scheduled: false });
  const result = await collectSnapshot(parsed);
  const output = `${JSON.stringify(result.snapshot, null, 2)}\n`;
  if (parsed.outputPath === undefined || parsed.outputPath === "-") {
    process.stdout.write(output);
  } else {
    await atomicWriteText(resolveOutputPath(parsed.outputPath), output, { privateDirectory: false });
  }
}

async function runScheduledCommand(argv: string[]): Promise<void> {
  const parsed = parseCommonOptions(argv, { mode: "scheduled", dryRun: false, scheduled: false });
  if (parsed.fixture !== undefined) {
    throw new Error("fixture_stateful_command_forbidden");
  }
  const runId = randomUUID();
  const runClaim = await acquireDirectoryLock({
    lockPath: runLockPath,
    runId,
    purpose: "production_watch_run",
    waitMs: 0,
  });
  if (!runClaim.acquired) {
    if (!parsed.dryRun) {
      await atomicWriteJson(overlapEventPath, {
        schemaVersion: 1,
        at: new Date().toISOString(),
        ownerRunId: runClaim.ownerRunId ?? "unknown",
      });
    }
    if (!parsed.scheduled) {
      process.stdout.write(`${JSON.stringify({ status: "skipped_overlap" })}\n`);
    }
    return;
  }

  const abortController = new AbortController();
  const abortTimer = setTimeout(() => abortController.abort(new Error("run_deadline_exceeded")), parsed.runTimeoutMs);
  const hardExitTimer = setTimeout(() => process.exit(124), parsed.runTimeoutMs + 5_000);
  abortTimer.unref();
  hardExitTimer.unref();
  installSignalAbort(abortController);

  try {
    const overlap = await readOverlapEvent();
    const result = await collectSnapshot(parsed, {
      runId,
      signal: abortController.signal,
      skippedOverlap: overlap !== undefined,
    });
    if (parsed.dryRun) {
      process.stdout.write(`${JSON.stringify(result.snapshot, null, 2)}\n`);
      return;
    }

    const update = await withStateLock(runId, async () => {
      const latestState = await readState(statePath, parsed.configuredSources, new Date());
      const next = updateStateFromSnapshot(latestState, result.snapshot);
      await writeStateAndProjections(next.state, result.snapshot);
      return next;
    });
    if (overlap !== undefined) {
      await rm(overlapEventPath, { force: true });
    }
    if (!parsed.scheduled || update.promotedIncidentIds.length > 0 || result.snapshot.monitor.status === "degraded") {
      process.stdout.write(`${JSON.stringify({
        status: result.snapshot.monitor.status,
        incidentsPromoted: update.promotedIncidentIds,
        evidenceComplete: result.snapshot.monitor.evidenceComplete,
      })}\n`);
    }
  } finally {
    clearTimeout(abortTimer);
    clearTimeout(hardExitTimer);
    await runClaim.release?.();
  }
}

async function runDrillDownCommand(argv: string[]): Promise<void> {
  const [target, ...rest] = argv;
  if (target === undefined || target.startsWith("-")) {
    throw new Error("incident_target_required");
  }
  const sessionId = readRequiredFlag(rest, "--session-id");
  const parsed = parseCommonOptions(removeFlagsWithValues(rest, ["--session-id"]), {
    mode: "drill_down",
    dryRun: true,
    scheduled: false,
    lookbackMinutes: 60,
  });
  if (parsed.fixture !== undefined) {
    throw new Error("fixture_stateful_command_forbidden");
  }
  if (parsed.lookbackMinutes > 120) {
    throw new Error("drill_down_lookback_too_large");
  }
  if (parsed.providerEvidencePath !== undefined) {
    throw new Error("drill_down_provider_evidence_forbidden_phase_1");
  }
  const incident = await withStateLock(randomUUID(), async () => {
    const state = await readState(statePath, parsed.configuredSources, new Date());
    const record = findIncident(state, target);
    if (record.source !== "database") {
      throw new Error("provider_incident_drill_down_unavailable_phase_1");
    }
    const next = heartbeatIncident(state, record.fingerprint, sessionId, new Date(), 15);
    await writeStateAndProjections(next);
    return structuredClone(record) as IncidentRecord;
  });
  const result = await collectSnapshot(parsed);
  const filtered = filterSnapshotForIncident(result.snapshot, incident);
  process.stdout.write(`${JSON.stringify(filtered, null, 2)}\n`);
}

async function runIncidentCommand(argv: string[]): Promise<void> {
  const [action, target, ...rest] = argv;
  if (action === "list") {
    if (argv.length !== 1) {
      throw new Error("incident_list_arguments_invalid");
    }
    const state = await readState(statePath, [...WATCH_SOURCES], new Date());
    process.stdout.write(renderActiveIncidents(state));
    return;
  }
  if (target === undefined) {
    throw new Error("incident_target_required");
  }
  const sessionId = readRequiredFlag(rest, "--session-id");
  const configuredSources = [...WATCH_SOURCES];
  const next = await withStateLock(randomUUID(), async () => {
    const state = await readState(statePath, configuredSources, new Date());
    const incident = findIncident(state, target);
    let updated: ProductionWatchState;
    if (action === "claim") {
      assertNoUnknownFlags(rest, new Set(["--session-id"]));
      updated = claimIncident(state, incident.fingerprint, sessionId, new Date(), 15);
    } else if (action === "heartbeat") {
      assertNoUnknownFlags(rest, new Set(["--session-id"]));
      updated = heartbeatIncident(state, incident.fingerprint, sessionId, new Date(), 15);
    } else if (action === "transition") {
      assertNoUnknownFlags(rest, new Set(["--session-id", "--state"]));
      const targetState = readRequiredFlag(rest, "--state") as IncidentState;
      const allowedStates = new Set<IncidentState>([
        "investigating",
        "confirmed",
        "monitor_incomplete",
        "false_positive",
        "escalated",
        "resolved",
      ]);
      if (!allowedStates.has(targetState)) {
        throw new Error("phase_1_transition_forbidden");
      }
      updated = transitionIncident(
        state,
        incident.fingerprint,
        sessionId,
        targetState,
        new Date(),
      );
    } else {
      throw new Error("incident_action_invalid");
    }
    await writeStateAndProjections(updated);
    return updated;
  });
  process.stdout.write(`${JSON.stringify({ status: "ok", updatedAt: next.updatedAt })}\n`);
}

async function runSchedulerCommand(argv: string[]): Promise<void> {
  const [action, ...rest] = argv;
  switch (action) {
    case "render": {
      assertNoUnknownFlags(rest, new Set(["--output"]));
      const rendered = await renderLaunchdPlist();
      const outputPath = readOptionalFlag(rest, "--output") ?? "-";
      if (outputPath === "-") {
        process.stdout.write(rendered);
      } else {
        await atomicWriteText(resolveOutputPath(outputPath), rendered, { privateDirectory: false });
      }
      return;
    }
    case "install":
      if (rest.length > 0) {
        throw new Error("scheduler_arguments_invalid");
      }
      await installScheduler();
      process.stdout.write(`${JSON.stringify({ status: "installed", label: LAUNCHD_LABEL })}\n`);
      return;
    case "status":
      if (rest.length > 0) {
        throw new Error("scheduler_arguments_invalid");
      }
      await printSchedulerStatus();
      return;
    case "uninstall":
      if (rest.length > 0) {
        throw new Error("scheduler_arguments_invalid");
      }
      await uninstallScheduler();
      process.stdout.write(`${JSON.stringify({ status: "uninstalled", label: LAUNCHD_LABEL })}\n`);
      return;
    default:
      throw new Error("scheduler_action_invalid");
  }
}

async function collectSnapshot(
  options: CommonCollectOptions,
  runtime: { runId?: string; signal?: AbortSignal; skippedOverlap?: boolean } = {},
): Promise<SnapshotResult> {
  const startedAt = new Date();
  const stateBefore = await readState(statePath, options.configuredSources, startedAt);
  const end = new Date(startedAt.getTime() - options.settlingDelaySeconds * 1_000);
  const currentStart = new Date(end.getTime() - options.lookbackMinutes * 60 * 1_000);
  const previousStart = new Date(currentStart.getTime() - options.lookbackMinutes * 60 * 1_000);
  const evidences: AdapterEvidence[] = [];
  const failures: CollectorFailure[] = [];

  try {
    const databaseEvidence = options.fixture === undefined
      ? await collectDatabaseEvidence({
          previousStart,
          currentStart,
          end,
          timeoutMs: options.adapterTimeoutMs,
          signal: runtime.signal,
        })
      : await readFixtureEvidence(options.fixture, startedAt);
    evidences.push(databaseEvidence);
  } catch (error) {
    failures.push(classifyAdapterFailure("database", error));
  }

  if (options.providerEvidencePath !== undefined) {
    try {
      const providerEvidence = await readProviderEvidence(
        options.providerEvidencePath,
        options.fixture !== undefined,
      );
      evidences.push(...providerEvidence.sources
        .filter((evidence) => options.configuredSources.includes(evidence.source))
        .map((evidence) => options.fixture === undefined ? evidence : rebaseFixture(evidence, startedAt)));
      failures.push(...providerEvidence.failures.filter((failure) =>
        options.configuredSources.includes(failure.source)
      ));
    } catch {
      for (const source of options.configuredSources.filter((candidate) => candidate !== "database")) {
        failures.push({
          source,
          class: "schema",
          code: "provider_evidence_invalid",
          retryable: false,
        });
      }
    }
  }

  const repositorySha = await resolveRepositorySha();
  const previousRunAt = stateBefore.monitor.lastRunAt === undefined
    ? undefined
    : new Date(stateBefore.monitor.lastRunAt);
  const scheduledFor = options.scheduled && previousRunAt !== undefined
    ? new Date(previousRunAt.getTime() + SCHEDULER_INTERVAL_MS)
    : undefined;
  const schedulerLagMs = scheduledFor === undefined
    ? undefined
    : Math.max(0, startedAt.getTime() - scheduledFor.getTime());
  const snapshot = buildSnapshot({
    now: new Date(),
    runId: runtime.runId ?? randomUUID(),
    mode: options.mode,
    dryRun: options.dryRun,
    startedAt,
    timeoutMs: options.runTimeoutMs,
    ...(scheduledFor === undefined ? {} : { scheduledFor }),
    ...(schedulerLagMs === undefined ? {} : { schedulerLagMs }),
    skippedOverlap: runtime.skippedOverlap ?? false,
    previousStart,
    currentStart,
    end,
    lookbackMinutes: options.lookbackMinutes,
    settlingDelaySeconds: options.settlingDelaySeconds,
    configuredSources: options.configuredSources,
    evidences,
    failures,
    ...(repositorySha === undefined ? {} : { repositorySha }),
    previousCumulativeCounters: stateBefore.cumulativeCounters,
  });
  return { snapshot, stateBefore };
}

async function collectDatabaseEvidence(input: {
  previousStart: Date;
  currentStart: Date;
  end: Date;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<AdapterEvidence> {
  const sql = await readFile(databaseSqlPath, "utf8");
  const result = await spawnCaptured(
    DATABASE_HELPER,
    [
      "--no-psqlrc",
      "--quiet",
      "--tuples-only",
      "--no-align",
      "--set=ON_ERROR_STOP=1",
      `--set=previous_start=${input.previousStart.toISOString()}`,
      `--set=current_start=${input.currentStart.toISOString()}`,
      `--set=window_end=${input.end.toISOString()}`,
    ],
    {
      stdin: sql,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
      outputLimitBytes: MAX_SUBPROCESS_OUTPUT_BYTES,
    },
  );
  if (result.timedOut) {
    throw Object.assign(new Error("database_helper_timeout"), { code: "ETIMEDOUT" });
  }
  if (result.status !== 0) {
    const authFailure = /auth|credential|keychain|password/iu.test(result.stderr);
    throw Object.assign(new Error(authFailure ? "database_helper_auth_failed" : "database_helper_failed"), {
      code: authFailure ? "EAUTH" : "EHELPER",
    });
  }
  const outputLines = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (
    outputLines.length !== 1
    || !outputLines[0]!.startsWith("{")
    || !outputLines[0]!.endsWith("}")
  ) {
    throw Object.assign(new Error("database_helper_output_invalid"), { code: "EBADMSG" });
  }
  return parseAdapterEvidence(JSON.parse(outputLines[0]) as unknown);
}

async function readFixtureEvidence(name: "healthy" | "suspicious", now: Date): Promise<AdapterEvidence> {
  const fixturePath = path.join(fixtureRoot, `${name}.database.json`);
  const parsed = parseAdapterEvidence(JSON.parse(await readFile(fixturePath, "utf8")) as unknown);
  return rebaseFixture(parsed, now);
}

async function readProviderEvidence(targetPath: string, allowFixturePermissions: boolean) {
  const resolved = path.resolve(targetPath);
  const handle = await open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  let raw: string;
  try {
    const metadata = await handle.stat();
    const currentUid = process.getuid?.();
    const permissionsUnsafe = process.platform !== "win32"
      && !allowFixturePermissions
      && (metadata.mode & 0o077) !== 0;
    const ownerUnsafe = currentUid !== undefined
      && !allowFixturePermissions
      && metadata.uid !== currentUid;
    if (
      !metadata.isFile()
      || metadata.size > MAX_PROVIDER_EVIDENCE_BYTES
      || permissionsUnsafe
      || ownerUnsafe
    ) {
      throw new Error("provider_evidence_file_invalid");
    }
    raw = await handle.readFile("utf8");
    if (Buffer.byteLength(raw) > MAX_PROVIDER_EVIDENCE_BYTES) {
      throw new Error("provider_evidence_file_invalid");
    }
  } finally {
    await handle.close();
  }
  const evidence = parseProviderEvidence(JSON.parse(raw) as unknown);
  const maximumFutureTimestamp = Date.now() + 5 * 60 * 1_000;
  if (
    Date.parse(evidence.generatedAt) > maximumFutureTimestamp
    || evidence.sources.some((source) => Date.parse(source.collectedAt) > maximumFutureTimestamp)
  ) {
    throw new Error("provider_evidence_timestamp_future");
  }
  return evidence;
}

function rebaseFixture(evidence: AdapterEvidence, now: Date): AdapterEvidence {
  const observedAt = new Date(now.getTime() - 2 * 60 * 1_000).toISOString();
  const firstSeenAt = new Date(now.getTime() - 10 * 60 * 1_000).toISOString();
  return {
    ...evidence,
    collectedAt: now.toISOString(),
    freshnessSeconds: 0,
    releaseContext: evidence.releaseContext.map((release) => ({
      ...release,
      observedAt,
      ...(release.deployedAt === undefined ? {} : { deployedAt: new Date(now.getTime() - 20 * 60 * 1_000).toISOString() }),
    })),
    fingerprints: evidence.fingerprints.map((fingerprint) => ({
      ...fingerprint,
      firstSeenAt,
      lastSeenAt: observedAt,
    })),
  };
}

function classifyAdapterFailure(source: WatchSource, error: unknown): CollectorFailure {
  const code = safeErrorCode(error);
  if (code === "EAUTH") {
    return { source, class: "auth", code: "helper_auth_failed", retryable: false };
  }
  if (code === "ETIMEDOUT" || code === "ABORT_ERR") {
    return { source, class: "timeout", code: "helper_timeout", retryable: true };
  }
  if (code === "ENOENT") {
    return { source, class: "unavailable", code: "helper_not_found", retryable: false };
  }
  if (code === "EBADMSG" || error instanceof SyntaxError) {
    return { source, class: "schema", code: "helper_output_invalid", retryable: false };
  }
  return { source, class: "unavailable", code: "helper_failed", retryable: true };
}

async function writeStateAndProjections(
  state: ProductionWatchState,
  snapshot?: ProductionWatchSnapshot,
): Promise<void> {
  await Promise.all([ensurePrivateDirectory(operationRoot), ensurePrivateDirectory(projectionRoot)]);
  await atomicWriteJson(statePath, state);
  await atomicWriteText(activeIncidentsPath, renderActiveIncidents(state));
  await atomicWriteText(incidentHistoryPath, renderIncidentHistory(state));
  await atomicWriteText(monitorStatusPath, renderMonitorStatus(state));
  if (snapshot !== undefined) {
    await atomicWriteJson(latestSnapshotPath, snapshot);
  }
}

async function withStateLock<T>(runId: string, action: () => Promise<T>): Promise<T> {
  const claim = await acquireDirectoryLock({
    lockPath: stateLockPath,
    runId,
    purpose: "production_watch_state",
    waitMs: 5_000,
  });
  if (!claim.acquired) {
    throw new Error("state_lock_busy");
  }
  try {
    return await action();
  } finally {
    await claim.release?.();
  }
}

async function readOverlapEvent(): Promise<{ at: string } | undefined> {
  try {
    const value = JSON.parse(await readFile(overlapEventPath, "utf8")) as { at?: unknown };
    return typeof value.at === "string" && Number.isFinite(Date.parse(value.at))
      ? { at: new Date(value.at).toISOString() }
      : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
}

async function resolveRepositorySha(): Promise<string | undefined> {
  const result = await spawnCaptured("git", ["rev-parse", "HEAD"], {
    timeoutMs: 2_000,
    outputLimitBytes: 1_024,
  });
  const sha = result.stdout.trim().toLowerCase();
  return result.status === 0 && /^[a-f0-9]{7,64}$/u.test(sha) ? sha : undefined;
}

async function spawnCaptured(
  command: string,
  args: string[],
  options: {
    stdin?: string;
    timeoutMs: number;
    signal?: AbortSignal;
    outputLimitBytes: number;
  },
): Promise<{ status: number; stdout: string; stderr: string; timedOut: boolean }> {
  return await new Promise((resolve, reject) => {
    const detached = process.platform !== "win32";
    const child = spawn(command, args, {
      cwd: repoRoot,
      detached,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let terminationStarted = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let pendingError: unknown;
    const finish = (result: { status: number; stdout: string; stderr: string; timedOut: boolean }) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const terminate = () => {
      if (terminationStarted) {
        return;
      }
      terminationStarted = true;
      killProcessTree(child.pid, "SIGTERM");
      forceKillTimer = setTimeout(() => killProcessTree(child.pid, "SIGKILL"), 1_000);
      forceKillTimer.unref();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);
    timeout.unref();
    const onAbort = () => {
      timedOut = true;
      terminate();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timeout);
      if (forceKillTimer !== undefined) {
        clearTimeout(forceKillTimer);
      }
      options.signal?.removeEventListener("abort", onAbort);
    };
    child.on("error", fail);
    child.stdin?.on("error", (error) => {
      if (settled) {
        return;
      }
      pendingError ??= error;
      terminate();
    });
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (pendingError !== undefined) {
        return;
      }
      if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > options.outputLimitBytes) {
        stdout = "";
        pendingError = Object.assign(new Error("subprocess_stdout_too_large"), { code: "EFBIG" });
        terminate();
        return;
      }
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = appendWithinByteLimit(stderr, chunk, 64 * 1_024);
    });
    child.on("exit", (status, signal) => {
      if (pendingError !== undefined) {
        fail(pendingError);
        return;
      }
      finish({
        status: status ?? (signal === undefined || signal === null ? 1 : 128),
        stdout,
        stderr,
        timedOut,
      });
    });
    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    } else {
      child.stdin?.end();
    }
  });
}

function appendWithinByteLimit(current: string, chunk: string, limitBytes: number): string {
  const currentBytes = Buffer.byteLength(current);
  if (currentBytes >= limitBytes) {
    return current;
  }
  const remaining = limitBytes - currentBytes;
  const chunkBuffer = Buffer.from(chunk, "utf8");
  return current + chunkBuffer.subarray(0, remaining).toString("utf8");
}

function killProcessTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(process.platform === "win32" ? pid : -pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      // A failed best-effort kill is handled by the outer deadline.
    }
  }
}

function parseCommonOptions(
  argv: string[],
  defaults: {
    mode: RunMode;
    dryRun: boolean;
    scheduled: boolean;
    lookbackMinutes?: number;
  },
): CommonCollectOptions {
  const fixture = readOptionalFlag(argv, "--fixture");
  if (fixture !== undefined && fixture !== "healthy" && fixture !== "suspicious") {
    throw new Error("fixture_invalid");
  }
  const lookbackMinutes = readIntegerFlag(argv, "--lookback-minutes", defaults.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES, 5, 120);
  const settlingDelaySeconds = readIntegerFlag(argv, "--settling-delay-seconds", DEFAULT_SETTLING_DELAY_SECONDS, 0, 300);
  const adapterTimeoutMs = readIntegerFlag(argv, "--adapter-timeout-ms", DEFAULT_ADAPTER_TIMEOUT_MS, 1_000, 60_000);
  const runTimeoutMs = readIntegerFlag(argv, "--run-timeout-ms", DEFAULT_RUN_TIMEOUT_MS, 30_000, 270_000);
  const scheduled = defaults.scheduled || argv.includes("--scheduled");
  const dryRun = defaults.dryRun || argv.includes("--dry-run");
  assertNoUnknownFlags(argv, new Set([
    "--adapter-timeout-ms",
    "--dry-run",
    "--fixture",
    "--lookback-minutes",
    "--output",
    "--provider-evidence",
    "--run-timeout-ms",
    "--scheduled",
    "--settling-delay-seconds",
  ]));
  return {
    lookbackMinutes,
    settlingDelaySeconds,
    adapterTimeoutMs,
    runTimeoutMs,
    ...(fixture === undefined ? {} : { fixture }),
    ...(readOptionalFlag(argv, "--provider-evidence") === undefined
      ? {}
      : { providerEvidencePath: readOptionalFlag(argv, "--provider-evidence") }),
    configuredSources: [...WATCH_SOURCES],
    dryRun,
    mode: defaults.mode,
    scheduled,
    ...(readOptionalFlag(argv, "--output") === undefined ? {} : { outputPath: readOptionalFlag(argv, "--output") }),
  };
}

function assertNoUnknownFlags(argv: string[], allowed: Set<string>): void {
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new Error(`argument_unexpected_${normalizeToken(argument)}`);
    }
    if (!allowed.has(argument)) {
      throw new Error(`flag_invalid_${normalizeToken(argument)}`);
    }
    if (seen.has(argument)) {
      throw new Error(`flag_duplicate_${normalizeToken(argument)}`);
    }
    seen.add(argument);
    if (!["--dry-run", "--scheduled"].includes(argument)) {
      index += 1;
      if (index >= argv.length || argv[index].startsWith("--")) {
        throw new Error(`flag_value_missing_${normalizeToken(argument)}`);
      }
    }
  }
}

function readIntegerFlag(argv: string[], flag: string, fallback: number, minimum: number, maximum: number): number {
  const value = readOptionalFlag(argv, flag);
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || String(parsed) !== value || parsed < minimum || parsed > maximum) {
    throw new Error(`${normalizeToken(flag)}_out_of_range`);
  }
  return parsed;
}

function readRequiredFlag(argv: string[], flag: string): string {
  const value = readOptionalFlag(argv, flag);
  if (value === undefined) {
    throw new Error(`${normalizeToken(flag)}_required`);
  }
  return value;
}

function readOptionalFlag(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${normalizeToken(flag)}_value_missing`);
  }
  return value;
}

function removeFlagsWithValues(argv: string[], flags: string[]): string[] {
  const removed = new Set(flags);
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (removed.has(argv[index])) {
      index += 1;
      continue;
    }
    result.push(argv[index]);
  }
  return result;
}

function resolveOutputPath(value: string): string {
  return path.resolve(process.cwd(), value);
}

function findIncident(state: ProductionWatchState, target: string): IncidentRecord {
  const incident = state.incidents.find(
    (candidate) => candidate.id === target || candidate.fingerprint === target,
  );
  if (incident === undefined) {
    throw new Error("incident_not_found");
  }
  return incident;
}

async function renderLaunchdPlist(): Promise<string> {
  if (process.platform !== "darwin") {
    throw new Error("launchd_requires_macos");
  }
  await verifySchedulerExecutableChain(repoRoot, process.execPath, os.homedir());
  const template = await readFile(schedulerTemplatePath, "utf8");
  return renderLaunchdPlistTemplate(template, repoRoot, os.homedir(), process.execPath);
}

export function renderLaunchdPlistTemplate(
  template: string,
  repositoryRoot: string,
  homeDirectory: string,
  nodeExecutable = process.execPath,
): string {
  const relativeRepoPath = path.relative(path.resolve(homeDirectory), path.resolve(repositoryRoot));
  if (
    relativeRepoPath.length === 0
    || relativeRepoPath === ".."
    || relativeRepoPath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeRepoPath)
    || !/^[A-Za-z0-9._ /-]+$/u.test(relativeRepoPath)
  ) {
    throw new Error("scheduler_repo_path_unsafe");
  }
  const portableRepoPath = relativeRepoPath.split(path.sep).join("/");
  const portableNodeExecutable = launchdShellPath(nodeExecutable, homeDirectory);
  return template
    .replaceAll("__LABEL__", xmlEscape(LAUNCHD_LABEL))
    .replaceAll("__REPO_HOME_RELATIVE__", xmlEscape(portableRepoPath))
    .replaceAll("__NODE_EXECUTABLE__", xmlEscape(portableNodeExecutable))
    .replaceAll("__SCHEDULER_PATH__", xmlEscape(schedulerShellPath()));
}

export async function verifySchedulerExecutableChain(
  repositoryRoot: string,
  nodeExecutable: string,
  homeDirectory = os.homedir(),
): Promise<void> {
  const requiredPaths: Array<[string, number]> = [
    [nodeExecutable, fsConstants.X_OK],
    [path.join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"), fsConstants.R_OK],
    [path.join(repositoryRoot, "tsconfig.tools.json"), fsConstants.R_OK],
    [path.join(repositoryRoot, "scripts", "prod-watch.ts"), fsConstants.R_OK],
  ];
  try {
    await Promise.all([
      ...requiredPaths.map(async ([targetPath, mode]) => {
        await access(targetPath, mode);
      }),
      verifySchedulerDatabaseHelper(homeDirectory),
    ]);
  } catch {
    throw new Error("scheduler_executable_chain_unavailable");
  }
}

async function verifySchedulerDatabaseHelper(homeDirectory: string): Promise<void> {
  const candidates = schedulerExecutableDirectories(homeDirectory)
    .map((directory) => path.join(directory, DATABASE_HELPER));
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return;
    } catch {
      // Keep checking the fixed scheduler PATH.
    }
  }
  throw new Error("scheduler_database_helper_unavailable");
}

function schedulerExecutableDirectories(homeDirectory: string): string[] {
  return [path.join(homeDirectory, ".local", "bin"), ...SCHEDULER_SYSTEM_PATHS];
}

function schedulerShellPath(): string {
  return ["$HOME/.local/bin", ...SCHEDULER_SYSTEM_PATHS].join(":");
}

function launchdShellPath(targetPath: string, homeDirectory: string): string {
  if (!path.isAbsolute(targetPath) || !/^[A-Za-z0-9._ /@+-]+$/u.test(targetPath)) {
    throw new Error("scheduler_executable_path_unsafe");
  }
  const relative = path.relative(path.resolve(homeDirectory), path.resolve(targetPath));
  if (relative.length === 0) {
    return "$HOME";
  }
  if (relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`)) {
    return `$HOME/${relative.split(path.sep).join("/")}`;
  }
  return targetPath.split(path.sep).join("/");
}

async function installScheduler(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("launchd_requires_macos");
  }
  const renderedPlist = await renderLaunchdPlist();
  await ensurePrivateDirectory(operationRoot);
  const launchAgents = path.join(os.homedir(), "Library", "LaunchAgents");
  const plistPath = path.join(launchAgents, `${LAUNCHD_LABEL}.plist`);
  const existing = await readManagedSchedulerFile(plistPath);
  const domain = `gui/${process.getuid?.() ?? 0}`;
  if (existing !== undefined) {
    await stopLaunchdService(domain, plistPath);
  } else {
    const priorState = await inspectLaunchdService(domain);
    if (priorState === "loaded") {
      throw new Error("launchd_service_loaded_without_managed_plist");
    }
    if (priorState === "unknown") {
      throw new Error("launchd_service_state_unknown");
    }
  }
  await atomicWriteText(plistPath, renderedPlist, { privateDirectory: false });
  const bootstrap = await spawnCaptured("launchctl", ["bootstrap", domain, plistPath], { timeoutMs: 10_000, outputLimitBytes: 64 * 1_024 });
  if (bootstrap.status !== 0) {
    await stopLaunchdService(domain, plistPath).catch(() => undefined);
    throw new Error("launchd_bootstrap_failed");
  }
  const enable = await spawnCaptured("launchctl", ["enable", `${domain}/${LAUNCHD_LABEL}`], { timeoutMs: 10_000, outputLimitBytes: 64 * 1_024 });
  if (enable.status !== 0) {
    try {
      await stopLaunchdService(domain, plistPath);
    } catch {
      throw new Error("launchd_enable_cleanup_failed");
    }
    throw new Error("launchd_enable_failed");
  }
  if (await inspectLaunchdService(domain) !== "loaded") {
    throw new Error("launchd_install_state_unconfirmed");
  }
}

async function uninstallScheduler(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("launchd_requires_macos");
  }
  const launchAgents = path.join(os.homedir(), "Library", "LaunchAgents");
  const plistPath = path.join(launchAgents, `${LAUNCHD_LABEL}.plist`);
  const existing = await readManagedSchedulerFile(plistPath);
  const domain = `gui/${process.getuid?.() ?? 0}`;
  await stopLaunchdService(domain, existing === undefined ? undefined : plistPath);
  if (existing !== undefined) {
    await unlink(plistPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    });
  }
}

async function printSchedulerStatus(): Promise<void> {
  const now = new Date();
  const state = await readState(statePath, [...WATCH_SOURCES], now);
  let installed = false;
  let launchdState: "loaded" | "absent" | "unknown" = "absent";
  if (process.platform === "darwin") {
    const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
    installed = await pathExists(plistPath);
    const domain = `gui/${process.getuid?.() ?? 0}`;
    launchdState = await inspectLaunchdService(domain);
  }
  process.stdout.write(`${JSON.stringify({
    label: LAUNCHD_LABEL,
    installed,
    loaded: launchdState === "loaded" ? true : launchdState === "absent" ? false : null,
    launchdState,
    monitorStatus: state.monitor.lastMonitorStatus ?? null,
    evidenceComplete: state.monitor.lastEvidenceComplete ?? null,
    lastRunAt: state.monitor.lastRunAt ?? null,
    stale: state.monitor.lastRunAt === undefined
      || now.getTime() - Date.parse(state.monitor.lastRunAt) > 10 * 60 * 1_000,
    lastSuccessfulCollectionAt: state.monitor.lastSuccessfulCollectionAt ?? null,
    lastCompleteEvidenceAt: state.monitor.lastCompleteEvidenceAt ?? null,
    lastDurationMs: state.monitor.lastDurationMs ?? null,
    lastSchedulerLagMs: state.monitor.lastSchedulerLagMs ?? null,
    consecutiveCollectionFailures: state.monitor.consecutiveCollectionFailures,
    skippedOverlapCount: state.monitor.skippedOverlapCount,
    sourceHealth: state.monitor.lastSourceHealth,
    activeIncidents: state.incidents.filter((incident) => !["false_positive", "resolved"].includes(incident.state)).length,
  }, null, 2)}\n`);
}

async function stopLaunchdService(domain: string, plistPath?: string): Promise<void> {
  await spawnCaptured(
    "launchctl",
    plistPath === undefined
      ? ["bootout", `${domain}/${LAUNCHD_LABEL}`]
      : ["bootout", domain, plistPath],
    { timeoutMs: 10_000, outputLimitBytes: 64 * 1_024 },
  );
  const state = await inspectLaunchdService(domain);
  if (state === "loaded") {
    throw new Error("launchd_service_still_loaded");
  }
  if (state === "unknown") {
    throw new Error("launchd_service_state_unknown");
  }
}

async function inspectLaunchdService(domain: string): Promise<"loaded" | "absent" | "unknown"> {
  const result = await spawnCaptured("launchctl", ["print", `${domain}/${LAUNCHD_LABEL}`], {
    timeoutMs: 5_000,
    outputLimitBytes: 256 * 1_024,
  });
  if (result.status === 0 && !result.timedOut) {
    return "loaded";
  }
  if (
    !result.timedOut
    && /(?:could not find (?:specified )?service|service not found)/iu.test(`${result.stdout}\n${result.stderr}`)
  ) {
    return "absent";
  }
  return "unknown";
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function readManagedSchedulerFile(targetPath: string): Promise<string | undefined> {
  try {
    const contents = await readFile(targetPath, "utf8");
    if (!contents.includes(`<!-- ${LAUNCHD_MANAGED_MARKER} -->`)) {
      throw new Error("launchd_plist_unmanaged");
    }
    return contents;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}


function resolveRuntimeRoot(): string {
  const override = process.env.MURPH_PROD_WATCH_TEST_RUNTIME_ROOT;
  if (override === undefined) {
    return path.join(repoRoot, ".runtime");
  }
  if (process.env.NODE_ENV !== "test") {
    throw new Error("test_runtime_root_requires_test_environment");
  }
  const resolved = path.resolve(override);
  const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!`${resolved}${path.sep}`.startsWith(temporaryRoot)) {
    throw new Error("test_runtime_root_must_be_temporary");
  }
  return resolved;
}

function installSignalAbort(controller: AbortController): void {
  const abort = () => controller.abort(new Error("termination_signal"));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  process.once("SIGHUP", abort);
}
