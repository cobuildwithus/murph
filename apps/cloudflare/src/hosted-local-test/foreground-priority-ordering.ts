import {
  HOSTED_RUNTIME_MAILBOX_FETCH_PATH,
  HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
} from "@murphai/hosted-execution/routes";

import {
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../runner-outbound/headers.ts";
import type {
  RunnerOutboundEnvironmentSource,
} from "../runner-outbound.ts";

export interface HostedLocalForegroundPriorityOrderingOutboundContext {
  containerId?: string;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export type HostedLocalForegroundPriorityOrderingOutboundHandler = (
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  ctx: HostedLocalForegroundPriorityOrderingOutboundContext,
) => Promise<Response>;

export type HostedLocalForegroundPriorityOrderingBarrierTarget =
  | "canonical_post_commit"
  | "empty_conversation_probe"
  | "none";

export type HostedLocalForegroundPriorityOrderingBarrierState =
  | "armed"
  | "disabled"
  | "entered"
  | "released";

export type HostedLocalForegroundPriorityOrderingEvent =
  | {
      kind: "assistant_provider_started";
      ordinal: number;
    }
  | {
      kind: "canonical_checkpoint_committed";
      ordinal: number;
    }
  | {
      kind: "workspace_checkpoint_started";
      ordinal: number;
      reason:
        | "canonical_runtime_commit"
        | "idle_shutdown"
        | "other"
        | null;
    }
  | {
      conversationItemCount: number | null;
      conversationLaneRequested: boolean | null;
      conversationSeqEnd: string | null;
      kind: "mailbox_fetch_finished";
      ordinal: number;
      probeKind:
        | "checkpoint_interrupt"
        | "checkpoint_interrupt_rearm"
        | "other"
        | "runtime_wake"
        | null;
      responseStatus: number;
    }
  | {
      kind: "snapshot_started";
      ordinal: number;
    };

export interface HostedLocalForegroundPriorityOrderingObservationState {
  barrierState: HostedLocalForegroundPriorityOrderingBarrierState;
  barrierTarget: HostedLocalForegroundPriorityOrderingBarrierTarget;
  events: HostedLocalForegroundPriorityOrderingEvent[];
  state: "armed" | "unarmed";
  truncated: boolean;
}

export type HostedLocalForegroundPriorityOrderingControlInput =
  | {
      action: "arm";
      barrierTarget?: HostedLocalForegroundPriorityOrderingBarrierTarget;
      userId: string;
    }
  | {
      action: "clear" | "record-provider-start" | "release" | "status";
      userId: string;
    };

export type HostedLocalForegroundPriorityOrderingControlResult =
  | HostedLocalForegroundPriorityOrderingObservationState
  | { cleared: boolean; ok: true }
  | { ok: true }
  | { ok: true; released: boolean };

export type HostedLocalForegroundPriorityOrderingSurface =
  | "snapshot-store"
  | "web-control";

type HostedLocalForegroundPriorityOrderingEventInput =
  HostedLocalForegroundPriorityOrderingEvent extends infer Event
    ? Event extends { ordinal: number }
      ? Omit<Event, "ordinal">
      : never
    : never;

interface HostedLocalForegroundPriorityOrderingBarrier {
  release(): void;
  released: Promise<void>;
  state: HostedLocalForegroundPriorityOrderingBarrierState;
  target: HostedLocalForegroundPriorityOrderingBarrierTarget;
}

interface HostedLocalForegroundPriorityOrderingObservation {
  barrier: HostedLocalForegroundPriorityOrderingBarrier;
  events: HostedLocalForegroundPriorityOrderingEvent[];
  truncated: boolean;
}

const HOSTED_LOCAL_FOREGROUND_PRIORITY_ORDERING_EVENT_LIMIT = 64;
const foregroundPriorityOrderingObservations =
  new Map<string, HostedLocalForegroundPriorityOrderingObservation>();

export function armForegroundPriorityOrderingObservation(
  userId: string,
  barrierTarget: HostedLocalForegroundPriorityOrderingBarrierTarget = "none",
): void {
  const normalizedUserId = normalizeForegroundPriorityOrderingUserId(userId);
  if (foregroundPriorityOrderingObservations.has(normalizedUserId)) {
    throw new Error(
      "A hosted-local foreground-priority ordering observation is already armed for this user.",
    );
  }

  foregroundPriorityOrderingObservations.set(normalizedUserId, {
    barrier: createForegroundPriorityOrderingBarrier(barrierTarget),
    events: [],
    truncated: false,
  });
}

export function clearForegroundPriorityOrderingObservation(userId: string): boolean {
  const normalizedUserId = normalizeForegroundPriorityOrderingUserId(userId);
  const observation = foregroundPriorityOrderingObservations.get(normalizedUserId);
  if (!observation) {
    return false;
  }

  foregroundPriorityOrderingObservations.delete(normalizedUserId);
  releaseForegroundPriorityOrderingBarrierState(observation.barrier);
  return true;
}

export function readForegroundPriorityOrderingObservation(
  userId: string,
): HostedLocalForegroundPriorityOrderingObservationState {
  const observation = foregroundPriorityOrderingObservations.get(
    normalizeForegroundPriorityOrderingUserId(userId),
  );
  if (!observation) {
    return {
      barrierState: "disabled",
      barrierTarget: "none",
      events: [],
      state: "unarmed",
      truncated: false,
    };
  }

  return {
    barrierState: observation.barrier.state,
    barrierTarget: observation.barrier.target,
    events: observation.events.map((event) => ({ ...event })),
    state: "armed",
    truncated: observation.truncated,
  };
}

export function releaseForegroundPriorityOrderingBarrier(userId: string): boolean {
  const observation = foregroundPriorityOrderingObservations.get(
    normalizeForegroundPriorityOrderingUserId(userId),
  );
  return observation
    ? releaseForegroundPriorityOrderingBarrierState(observation.barrier)
    : false;
}

export function recordForegroundPriorityAssistantProviderStart(userId: string): void {
  const normalizedUserId = normalizeForegroundPriorityOrderingUserId(userId);
  if (!foregroundPriorityOrderingObservations.has(normalizedUserId)) {
    throw new Error(
      "Hosted-local foreground-priority provider start requires an armed observation.",
    );
  }
  recordForegroundPriorityOrderingEvent(normalizedUserId, {
    kind: "assistant_provider_started",
  });
}

export function wrapForegroundPriorityOrderingObservationForTest(
  handler: HostedLocalForegroundPriorityOrderingOutboundHandler,
  surface: HostedLocalForegroundPriorityOrderingSurface,
): HostedLocalForegroundPriorityOrderingOutboundHandler {
  return async (request, env, ctx) => {
    const userId = request.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)?.trim() ?? "";
    if (userId.length === 0 || !foregroundPriorityOrderingObservations.has(userId)) {
      return await handler(request, env, ctx);
    }

    switch (surface) {
      case "snapshot-store":
        return await observeForegroundPrioritySnapshotRequest(
          userId,
          request,
          () => handler(request, env, ctx),
        );
      case "web-control":
        return await observeForegroundPriorityWebControlRequest(
          userId,
          request,
          () => handler(request, env, ctx),
        );
    }
  };
}

async function observeForegroundPrioritySnapshotRequest(
  userId: string,
  request: Request,
  run: () => Promise<Response>,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (request.method === "POST" && pathname === "/workspace-snapshots/start") {
    recordForegroundPriorityOrderingEvent(userId, { kind: "snapshot_started" });
  }
  return await run();
}

async function observeForegroundPriorityWebControlRequest(
  userId: string,
  request: Request,
  run: () => Promise<Response>,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (request.method !== "POST") {
    return await run();
  }

  if (pathname === HOSTED_RUNTIME_MAILBOX_FETCH_PATH) {
    const requestSummary = await readMailboxFetchRequestSummary(request);
    const response = await run();
    const summary = await readMailboxFetchConversationSummary(response);
    recordForegroundPriorityOrderingEvent(userId, {
      ...summary,
      ...requestSummary,
      kind: "mailbox_fetch_finished",
      responseStatus: response.status,
    });
    if (
      response.ok
      && requestSummary.conversationLaneRequested === true
      && requestSummary.probeKind === "checkpoint_interrupt_rearm"
      && summary.conversationItemCount === 0
      && foregroundPriorityOrderingObservationHasEvent(
        userId,
        "snapshot_started",
      )
    ) {
      await enterForegroundPriorityOrderingBarrier(
        userId,
        "empty_conversation_probe",
      );
    }
    return response;
  }

  if (pathname !== HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH) {
    return await run();
  }
  const reason = await readWorkspaceCheckpointReason(request);
  recordForegroundPriorityOrderingEvent(userId, {
    kind: "workspace_checkpoint_started",
    reason,
  });
  const response = await run();
  if (
    reason === "canonical_runtime_commit"
    && response.ok
    && await isForegroundPriorityCommittedCanonicalCheckpointResponse(response)
  ) {
    recordForegroundPriorityOrderingEvent(userId, {
      kind: "canonical_checkpoint_committed",
    });
    await enterForegroundPriorityOrderingBarrier(
      userId,
      "canonical_post_commit",
    );
  }
  return response;
}

async function readWorkspaceCheckpointReason(request: Request): Promise<
  | "canonical_runtime_commit"
  | "idle_shutdown"
  | "other"
  | null
> {
  const body: unknown = await request.clone().json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const reason = "reason" in body ? body.reason : null;
  if (reason === "canonical_runtime_commit" || reason === "idle_shutdown") {
    return reason;
  }
  return typeof reason === "string" && reason.trim().length > 0
    ? "other"
    : null;
}

function recordForegroundPriorityOrderingEvent(
  userId: string,
  event: HostedLocalForegroundPriorityOrderingEventInput,
): void {
  const observation = foregroundPriorityOrderingObservations.get(userId);
  if (!observation) {
    return;
  }
  if (observation.events.length >= HOSTED_LOCAL_FOREGROUND_PRIORITY_ORDERING_EVENT_LIMIT) {
    observation.truncated = true;
    return;
  }

  observation.events.push({
    ...event,
    ordinal: observation.events.length + 1,
  } as HostedLocalForegroundPriorityOrderingEvent);
}

function foregroundPriorityOrderingObservationHasEvent(
  userId: string,
  kind: HostedLocalForegroundPriorityOrderingEvent["kind"],
): boolean {
  return foregroundPriorityOrderingObservations.get(userId)?.events.some(
    (event) => event.kind === kind,
  ) ?? false;
}

async function readMailboxFetchRequestSummary(
  request: Request,
): Promise<{
  conversationLaneRequested: boolean | null;
  probeKind:
    | "checkpoint_interrupt"
    | "checkpoint_interrupt_rearm"
    | "other"
    | "runtime_wake"
    | null;
}> {
  const body: unknown = await request.clone().json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { conversationLaneRequested: null, probeKind: null };
  }
  const lanes = "lanes" in body && Array.isArray(body.lanes)
    ? body.lanes
    : null;
  if (lanes === null) {
    return { conversationLaneRequested: null, probeKind: null };
  }
  const requestId = "requestId" in body && typeof body.requestId === "string"
    ? body.requestId
    : null;
  return {
    conversationLaneRequested: lanes.some((lane) =>
      lane
      && typeof lane === "object"
      && !Array.isArray(lane)
      && "lane" in lane
      && lane.lane === "conversation"
    ),
    probeKind: classifyForegroundPriorityOrderingProbeKind(requestId),
  };
}

function classifyForegroundPriorityOrderingProbeKind(
  requestId: string | null,
):
  | "checkpoint_interrupt"
  | "checkpoint_interrupt_rearm"
  | "other"
  | "runtime_wake"
  | null {
  if (requestId === null) {
    return null;
  }
  if (requestId.includes(":checkpoint-interrupt-rearm-")) {
    return "checkpoint_interrupt_rearm";
  }
  if (requestId.includes(":checkpoint-interrupt-")) {
    return "checkpoint_interrupt";
  }
  return requestId.includes(":runtime-wake:") ? "runtime_wake" : "other";
}

async function readMailboxFetchConversationSummary(response: Response): Promise<{
  conversationItemCount: number | null;
  conversationSeqEnd: string | null;
}> {
  const body: unknown = await response.clone().json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { conversationItemCount: null, conversationSeqEnd: null };
  }
  const items = "items" in body && Array.isArray(body.items) ? body.items : null;
  if (items === null) {
    return { conversationItemCount: null, conversationSeqEnd: null };
  }

  let conversationItemCount = 0;
  let conversationSeqEnd: bigint | null = null;
  for (const item of items) {
    if (
      !item
      || typeof item !== "object"
      || Array.isArray(item)
      || !("lane" in item)
      || item.lane !== "conversation"
    ) {
      continue;
    }
    conversationItemCount += 1;
    const laneSeq = "laneSeq" in item
      ? readForegroundPriorityOrderingSeq(item.laneSeq)
      : null;
    if (laneSeq !== null && (conversationSeqEnd === null || laneSeq > conversationSeqEnd)) {
      conversationSeqEnd = laneSeq;
    }
  }

  return {
    conversationItemCount,
    conversationSeqEnd: conversationSeqEnd?.toString() ?? null,
  };
}

function readForegroundPriorityOrderingSeq(value: unknown): bigint | null {
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return BigInt(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  return null;
}

function createForegroundPriorityOrderingBarrier(
  target: HostedLocalForegroundPriorityOrderingBarrierTarget,
): HostedLocalForegroundPriorityOrderingBarrier {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    release,
    released,
    state: target === "none" ? "disabled" : "armed",
    target,
  };
}

async function enterForegroundPriorityOrderingBarrier(
  userId: string,
  target: Exclude<HostedLocalForegroundPriorityOrderingBarrierTarget, "none">,
): Promise<void> {
  const barrier = foregroundPriorityOrderingObservations.get(userId)?.barrier;
  if (!barrier || barrier.target !== target || barrier.state !== "armed") {
    return;
  }
  barrier.state = "entered";
  await barrier.released;
}

function releaseForegroundPriorityOrderingBarrierState(
  barrier: HostedLocalForegroundPriorityOrderingBarrier,
): boolean {
  if (barrier.state === "disabled" || barrier.state === "released") {
    return false;
  }
  barrier.state = "released";
  barrier.release();
  return true;
}

function normalizeForegroundPriorityOrderingUserId(userId: string): string {
  const normalizedUserId = userId.trim();
  if (normalizedUserId.length === 0) {
    throw new TypeError(
      "Hosted-local foreground-priority ordering observation requires a user id.",
    );
  }
  return normalizedUserId;
}

async function isForegroundPriorityCommittedCanonicalCheckpointResponse(
  response: Response,
): Promise<boolean> {
  const body: unknown = await response.clone().json().catch(() => null);
  return Boolean(
    body
      && typeof body === "object"
      && !Array.isArray(body)
      && "checkpointed" in body
      && body.checkpointed === true,
  );
}
