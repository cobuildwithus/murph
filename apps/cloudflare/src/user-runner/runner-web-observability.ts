import type {
  HostedExecutionRedactedLogEntry,
  HostedExecutionRunContext,
  HostedExecutionRunLevel,
  HostedExecutionRunPhase,
} from "@murphai/hosted-execution";
import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  computeHostedRunElapsedMs,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

import type { HostedExecutionEnvironment } from "../env.js";
import { recordHostedRunLogInWeb } from "../web-control-plane.ts";

const HOSTED_RUN_PHASE_LOG_TIMEOUT_MS = 2_000;
const HOSTED_RUN_LOG_COMPONENT = "cloudflare-runner";

export async function recordHostedRunPhaseLogInWebBestEffort(input: {
  baseUrl: string | null;
  callbackSigning: HostedExecutionEnvironment["webCallbackSigning"];
  component?: string;
  error?: unknown;
  level?: HostedExecutionRunLevel;
  message: string;
  phase: HostedExecutionRunPhase;
  recordLog?: typeof recordHostedRunLogInWeb;
  run: HostedExecutionRunContext;
  runToken?: string | null;
  userId: string;
  wakeEventId: string;
}): Promise<void> {
  return recordHostedRunBreadcrumbInWebBestEffort(input);
}

export async function recordHostedRunBreadcrumbInWebBestEffort(input: {
  baseUrl: string | null;
  callbackSigning: HostedExecutionEnvironment["webCallbackSigning"];
  component?: string;
  error?: unknown;
  level?: HostedExecutionRunLevel;
  message: string;
  phase: string;
  recordLog?: typeof recordHostedRunLogInWeb;
  redacted?: Record<string, unknown> | null;
  run: HostedExecutionRunContext;
  runToken?: string | null;
  userId: string;
  wakeEventId: string;
}): Promise<void> {
  if (!input.baseUrl) {
    return;
  }

  if (typeof input.runToken !== "string") {
    return;
  }

  const runToken = input.runToken;
  const recordLog = input.recordLog ?? recordHostedRunLogInWeb;
  // Keep web-visible observability linkable without persisting canonical wake ids.
  const correlationId = await createHostedRunLogCorrelationId(input.wakeEventId);
  const redacted = {
    ...(stripHostedRunObservabilityEventFields(input.redacted) ?? {}),
    correlationId,
    ...(input.error === undefined ? {} : { errorCode: deriveHostedExecutionErrorCode(input.error) }),
    runElapsedMs: computeHostedRunElapsedMs(input.run),
  };

  try {
    await recordLog({
      baseUrl: input.baseUrl,
      body: {
        at: new Date().toISOString(),
        component: input.component ?? HOSTED_RUN_LOG_COMPONENT,
        level: input.level ?? (input.error === undefined ? "info" : "error"),
        message: input.message,
        phase: input.phase,
        redacted,
        runId: input.run.runId,
        runToken,
      },
      boundUserId: input.userId,
      callbackSigning: input.callbackSigning,
      timeoutMs: HOSTED_RUN_PHASE_LOG_TIMEOUT_MS,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: HOSTED_RUN_LOG_COMPONENT,
      details: {
        runElapsedMs: computeHostedRunElapsedMs(input.run),
        runLogCorrelationId: correlationId,
      },
      error,
      eventId: input.wakeEventId,
      level: "warn",
      message: "Hosted run phase log write to web failed; continuing with runner-local observability only.",
      phase: "retry.scheduled",
      run: input.run,
      userId: input.userId,
    });
  }
}

export async function recordHostedRunnerResultLogsInWebBestEffort(input: {
  baseUrl: string | null;
  callbackSigning: HostedExecutionEnvironment["webCallbackSigning"];
  recordLog?: typeof recordHostedRunLogInWeb;
  redactedLogEntries: readonly HostedExecutionRedactedLogEntry[] | null | undefined;
  run: HostedExecutionRunContext;
  runToken?: string | null;
  userId: string;
  wakeEventId: string;
}): Promise<void> {
  for (const entry of input.redactedLogEntries ?? []) {
    const eventId = entry.eventId ?? input.wakeEventId;
    await recordHostedRunBreadcrumbInWebBestEffort({
      baseUrl: input.baseUrl,
      callbackSigning: input.callbackSigning,
      component: entry.component,
      level: entry.level,
      message: entry.message,
      phase: entry.phase,
      recordLog: input.recordLog,
      redacted: entry.redacted ?? null,
      run: input.run,
      runToken: input.runToken,
      userId: input.userId,
      wakeEventId: eventId,
    });
  }
}

function stripHostedRunObservabilityEventFields(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  const { correlationId: _ignoredCorrelationId, eventId: _ignoredEventId, ...rest } = value;
  return Object.keys(rest).length > 0 ? rest : null;
}

async function createHostedRunLogCorrelationId(eventId: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`hosted-run-log:${eventId}`),
    ),
  );

  return `evtcorr_${bytesToHex(digest.subarray(0, 16))}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
