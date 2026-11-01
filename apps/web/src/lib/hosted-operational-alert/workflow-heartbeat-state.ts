import "server-only";

import type { HostedLinqAlert, Prisma } from "@prisma/client";
import type { HostedOperationalAlertPrismaClient } from "./incident-email-monitor";
import { hostedOperationalHeartbeatWorkflow } from "./heartbeat-workflow";

export const WORKFLOW_HEARTBEAT_STATE_ID = "hosted-workflow-heartbeat-state:v1";
export const WORKFLOW_HEARTBEAT_INTERVAL_MS = 15 * 60_000;
export const WORKFLOW_HEARTBEAT_DEADLINE_MS = 30 * 60_000;
export const WORKFLOW_HEARTBEAT_API_TIMEOUT_MS = 10_000;
const SCHEMA = "murph.workflow-heartbeat-state.v1";
const STATUSES = ["idle", "starting", "pending", "running", "completed", "failed", "cancelled", "start_failed", "read_failed"] as const;
type HeartbeatStatus = typeof STATUSES[number];
type HeartbeatState = {
  schema: typeof SCHEMA;
  firstStartedAt: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  runId: string | null;
  status: HeartbeatStatus;
};
export type WorkflowHeartbeatHealth = {
  anomalous: boolean;
  firstStartedAt: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  status: HeartbeatStatus;
};
export type HeartbeatEngine = {
  start(): Promise<string>;
  inspect(runId: string): Promise<{ status: "pending" | "running" | "completed" | "failed" | "cancelled"; completedAt?: Date }>;
};
const engine: HeartbeatEngine = {
  async start() {
    const { start } = await import("workflow/api");
    return (await start(hostedOperationalHeartbeatWorkflow, [])).runId;
  },
  async inspect(runId) {
    const { getRun } = await import("workflow/api");
    const run = getRun(runId);
    const status = await run.status;
    return { status, ...(status === "completed" ? { completedAt: await run.completedAt } : {}) };
  },
};
const initialState: HeartbeatState = {
  schema: SCHEMA, firstStartedAt: null, lastStartedAt: null,
  lastCompletedAt: null, runId: null, status: "idle",
};

export async function advanceWorkflowHeartbeat(input: {
  now: Date; prisma: HostedOperationalAlertPrismaClient; engine?: HeartbeatEngine;
}): Promise<void> {
  const client = input.engine ?? engine;
  let row = await input.prisma.hostedLinqAlert.upsert({
    where: { id: WORKFLOW_HEARTBEAT_STATE_ID },
    create: { id: WORKFLOW_HEARTBEAT_STATE_ID, kind: "workflow_heartbeat_state", status: "active",
      subject: "Workflow heartbeat state", claimedAt: input.now, detailsJson: initialState },
    update: {},
  });
  let state = parseState(row.detailsJson);
  if (state.runId && state.status !== "completed") {
    const observed = await observeHeartbeat(client, state, input.now);
    if (!await compareAndSet(input.prisma, row, observed)) return;
    // Reload after the CAS: another cron may have advanced this row meanwhile.
    row = await readStateRow(input.prisma);
    state = parseState(row.detailsJson);
  }
  if (!heartbeatStartDue(state, input.now)) return;
  const startedAt = input.now.toISOString();
  const claimed: HeartbeatState = { ...state, firstStartedAt: state.firstStartedAt ?? startedAt,
    lastStartedAt: startedAt, runId: null, status: "starting" };
  // Persist intent before external work, including start errors/timeouts/crashes.
  // A fresh attempt never resets the first-start or last-completion deadline.
  if (!await compareAndSet(input.prisma, row, claimed)) return;
  let started: HeartbeatState;
  try {
    const runId = await boundedEngineCall(client.start());
    started = { ...claimed, runId, status: "pending" };
  } catch {
    started = { ...claimed, status: "start_failed" };
  }
  await input.prisma.hostedLinqAlert.updateMany({
    where: { id: WORKFLOW_HEARTBEAT_STATE_ID, detailsJson: { equals: claimed } },
    data: { detailsJson: started },
  });
}

async function observeHeartbeat(client: HeartbeatEngine, state: HeartbeatState, now: Date): Promise<HeartbeatState> {
  try {
    const observed = await boundedEngineCall(client.inspect(state.runId!));
    if (observed.status !== "completed") return { ...state, status: observed.status };
    const completedAt = observed.completedAt;
    if (!completedAt || !state.lastStartedAt || !Number.isFinite(+completedAt)
      || +completedAt < Date.parse(state.lastStartedAt) || +completedAt > +now) {
      return { ...state, status: "read_failed" };
    }
    return { ...state, status: "completed", lastCompletedAt: completedAt.toISOString() };
  } catch {
    return { ...state, status: "read_failed" };
  }
}

function heartbeatStartDue(state: HeartbeatState, now: Date): boolean {
  if (!state.lastStartedAt) return true;
  const age = +now - Date.parse(state.lastStartedAt);
  if (age < WORKFLOW_HEARTBEAT_INTERVAL_MS) return false;
  return ["completed", "failed", "cancelled", "start_failed"].includes(state.status)
    || age >= WORKFLOW_HEARTBEAT_DEADLINE_MS;
}

export async function readWorkflowHeartbeatHealth(input: { now: Date; prisma: HostedOperationalAlertPrismaClient }): Promise<WorkflowHeartbeatHealth> {
  const state = parseState((await readStateRow(input.prisma)).detailsJson);
  const anchor = state.lastCompletedAt ?? state.firstStartedAt;
  return {
    anomalous: anchor !== null && +input.now - Date.parse(anchor) >= WORKFLOW_HEARTBEAT_DEADLINE_MS,
    firstStartedAt: state.firstStartedAt, lastStartedAt: state.lastStartedAt,
    lastCompletedAt: state.lastCompletedAt, status: state.status,
  };
}

async function readStateRow(prisma: HostedOperationalAlertPrismaClient): Promise<HostedLinqAlert> {
  const row = await prisma.hostedLinqAlert.findUnique({ where: { id: WORKFLOW_HEARTBEAT_STATE_ID } });
  if (!row) throw new Error("Workflow heartbeat state is missing.");
  return row;
}

async function compareAndSet(prisma: HostedOperationalAlertPrismaClient, row: HostedLinqAlert, state: HeartbeatState): Promise<boolean> {
  return (await prisma.hostedLinqAlert.updateMany({
    where: { id: WORKFLOW_HEARTBEAT_STATE_ID, updatedAt: row.updatedAt,
      detailsJson: { equals: parseState(row.detailsJson) } },
    data: { detailsJson: state },
  })).count === 1;
}

function parseState(value: Prisma.JsonValue): HeartbeatState {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema !== SCHEMA
    || !STATUSES.some(status => status === value.status)
    || ![value.firstStartedAt, value.lastStartedAt, value.lastCompletedAt].every(validDate)
    || !(value.runId === null || typeof value.runId === "string")) {
    throw new Error("Workflow heartbeat state is invalid.");
  }
  return value as HeartbeatState;
}

function validDate(value: Prisma.JsonValue | undefined): boolean {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

async function boundedEngineCall<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Workflow heartbeat API deadline exceeded.")), WORKFLOW_HEARTBEAT_API_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer); }
}
