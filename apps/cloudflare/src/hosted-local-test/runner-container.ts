import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
} from "@murphai/hosted-execution/routes";

import {
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS,
  CLOUDFLARE_HOSTED_TRANSCRIBE_HOST,
} from "../internal-hosts.ts";
import {
  readHostedExecutionEnvironment,
} from "../env.ts";
import {
  RunnerContainer as BaseRunnerContainer,
} from "../runner-container.ts";
import {
  handleHostedRunnerGeminiOutbound,
  handleHostedRunnerOpenAiOutbound,
  HOSTED_RUNNER_OUTBOUND_BY_HOST,
} from "../runner-egress-intercept.ts";
import {
  hostedLocalGeminiVideoAnalysisFetch,
} from "./gemini-video-analysis.ts";
import {
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../runner-outbound/headers.ts";
import type {
  RunnerOutboundEnvironmentSource,
} from "../runner-outbound.ts";
import type {
  WorkerAiBindingLike,
} from "../worker-contracts.ts";
import {
  asWorkerStringEnvironment,
} from "../worker-contracts.ts";
import {
  armForegroundPriorityOrderingObservation,
  clearForegroundPriorityOrderingObservation,
  readForegroundPriorityOrderingObservation,
  recordForegroundPriorityAssistantProviderStart,
  releaseForegroundPriorityOrderingBarrier,
  wrapForegroundPriorityOrderingObservationForTest,
  type HostedLocalForegroundPriorityOrderingControlInput,
  type HostedLocalForegroundPriorityOrderingControlResult,
} from "./foreground-priority-ordering.ts";

export interface HostedLocalTestRunnerOutboundContext {
  containerId?: string;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export type HostedLocalTestRunnerOutboundHandler = (
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  ctx: HostedLocalTestRunnerOutboundContext,
) => Promise<Response>;

export class RunnerContainer extends BaseRunnerContainer {
  private loseCompletedInvocationResultForTest = false;

  override async invoke(
    payload: Parameters<BaseRunnerContainer["invoke"]>[0],
  ) {
    const result = await super.invoke(payload);
    if (!this.loseCompletedInvocationResultForTest) {
      return result;
    }
    this.loseCompletedInvocationResultForTest = false;
    return await new Promise<never>(() => {});
  }

  async armGeneratedImageProviderBarrierForTest(
    _input: { userId: string },
  ): Promise<{ ok: true }> {
    armGeneratedImageProviderBarrier();
    return { ok: true };
  }

  async releaseGeneratedImageProviderBarrierForTest(
    _input: { userId: string },
  ): Promise<{ ok: true }> {
    releaseGeneratedImageProviderBarrier();
    return { ok: true };
  }

  async armCanonicalCheckpointLostAckForTest(
    input: { userId: string },
  ): Promise<{ ok: true }> {
    armCanonicalCheckpointLostAck(input.userId);
    return { ok: true };
  }

  async armCanonicalCheckpointPublicationBarrierForTest(
    input: { userId: string },
  ): Promise<{ ok: true }> {
    armCanonicalCheckpointPublicationBarrier(input.userId);
    return { ok: true };
  }

  async armIdleSnapshotStartBarrierForTest(
    input: { userId: string },
  ): Promise<{ ok: true }> {
    armIdleSnapshotStartBarrier(input.userId);
    return { ok: true };
  }

  async foregroundPriorityOrderingControlForTest(
    input: HostedLocalForegroundPriorityOrderingControlInput,
  ): Promise<HostedLocalForegroundPriorityOrderingControlResult> {
    switch (input.action) {
      case "arm":
        armForegroundPriorityOrderingObservation(
          input.userId,
          input.barrierTarget ?? "none",
        );
        return { ok: true };
      case "clear":
        return {
          cleared: clearForegroundPriorityOrderingObservation(input.userId),
          ok: true,
        };
      case "record-provider-start":
        recordForegroundPriorityAssistantProviderStart(input.userId);
        return { ok: true };
      case "release":
        return {
          ok: true,
          released: releaseForegroundPriorityOrderingBarrier(input.userId),
        };
      case "status":
        return readForegroundPriorityOrderingObservation(input.userId);
    }
  }

  async armSnapshotPublicationCorruptionForTest(
    input: { userId: string },
  ): Promise<{ ok: true }> {
    armSnapshotPublicationCorruption(input.userId);
    return { ok: true };
  }

  async armShutdownCheckpointPublicationBarrierForTest(
    input: { userId: string },
  ): Promise<{ ok: true }> {
    armShutdownCheckpointPublicationBarrier(input.userId);
    return { ok: true };
  }

  async beginShutdownCheckpointGracefulStopForTest(
    _input: { userId: string },
  ): Promise<{ ok: true }> {
    // Cloudflare rollouts send SIGTERM. Container.destroy() sends SIGKILL, so
    // use the graceful stop primitive without aborting the active runtime
    // request first. The armed outbound barrier can then hold the shutdown
    // checkpoint publication itself.
    await this.stop("SIGTERM");
    return { ok: true };
  }

  async readShutdownCheckpointPublicationBarrierForTest(
    input: { userId: string },
  ): Promise<{ state: HostedLocalShutdownCheckpointPublicationBarrierState }> {
    return {
      state: readShutdownCheckpointPublicationBarrierState(input.userId),
    };
  }

  async releaseShutdownCheckpointPublicationBarrierForTest(
    input: { userId: string },
  ): Promise<{ ok: true; released: boolean }> {
    return {
      ok: true,
      released: releaseShutdownCheckpointPublicationBarrier(input.userId),
    };
  }

  async expireActivityForTest(_input: { userId: string }): Promise<{ ok: true }> {
    await this.onActivityExpired();
    return { ok: true };
  }

  async dropActiveOperationForTest(input: {
    loseCompletedInvocationResult?: boolean;
    userId: string;
  }): Promise<{ ok: true }> {
    Object.assign(this, {
      workspaceInvocationOperations: [],
    });
    if (input.loseCompletedInvocationResult === true) {
      this.loseCompletedInvocationResultForTest = true;
    }
    return { ok: true };
  }
}

// The hosted-local generated wrangler config omits the Workers AI binding for
// the test-routes profile (dev profiles get the real binding), so the
// transcribe egress handler would fail closed in E2E. Inject a
// deterministic fake binding here (test entrypoint composition only) so the
// audio E2E proves the full production chain — container parser drain ->
// remote-transcription provider -> murph-transcribe.worker handler ->
// AI binding -> transcript evidence — with only the model call faked.
const hostedLocalTestAiBinding: WorkerAiBindingLike = {
  async run(_model: string, input: Record<string, unknown>) {
    if (typeof input.audio !== "string" || input.audio.length === 0) {
      throw new TypeError("Hosted-local test AI binding requires base64 audio input.");
    }

    return {
      segments: [
        { end: 1.4, start: 0, text: "Remember to" },
        { end: 2.5, start: 1.4, text: "log the voice note" },
      ],
      text: "Remember to log the voice note",
      transcription_info: { duration: 2.5, language: "en" },
    };
  },
};

// Scope the fake-binding wrap to the transcribe host only: it is the single
// AI-reading egress route today, and a future AI-reading handler must not
// silently inherit the fake in E2E. Note @cloudflare/containers keys
// outboundByHost by class NAME, so this assignment replaces the shared
// "RunnerContainer" registry entry for any module graph that imports this
// file — the production entrypoint graph must never import hosted-local-test
// (pinned by apps/cloudflare/test/hosted-local-test-runner-container.test.ts).
const transcribeHandler =
  HOSTED_RUNNER_OUTBOUND_BY_HOST[CLOUDFLARE_HOSTED_TRANSCRIBE_HOST];
if (!transcribeHandler) {
  throw new Error("Hosted-local test composition requires the transcribe outbound handler.");
}

const webControlPlaneHandler: HostedLocalTestRunnerOutboundHandler =
  HOSTED_RUNNER_OUTBOUND_BY_HOST[CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane];
if (!webControlPlaneHandler) {
  throw new Error("Hosted-local test composition requires the web control-plane outbound handler.");
}

const workspaceSnapshotStoreHandler: HostedLocalTestRunnerOutboundHandler | undefined =
  HOSTED_RUNNER_OUTBOUND_BY_HOST[CLOUDFLARE_HOSTED_RUNTIME_HOSTS.workspaceSnapshotStore];
const effectsPortHandler: HostedLocalTestRunnerOutboundHandler | undefined =
  HOSTED_RUNNER_OUTBOUND_BY_HOST[CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort];
const openAiHandler: HostedLocalTestRunnerOutboundHandler | undefined =
  HOSTED_RUNNER_OUTBOUND_BY_HOST["api.openai.com"];
if (!workspaceSnapshotStoreHandler || !effectsPortHandler || !openAiHandler) {
  throw new Error("Hosted-local test composition requires snapshot and image egress handlers.");
}
const canonicalCheckpointLostAckUserIds = new Set<string>();
const snapshotPublicationCorruptionUserIds = new Set<string>();

export type HostedLocalShutdownCheckpointPublicationBarrierState =
  | "armed"
  | "entered"
  | "unarmed";

interface HostedLocalShutdownCheckpointPublicationBarrier {
  entered: boolean;
  target: "canonical_runtime_commit" | "idle_shutdown" | "snapshot_start";
  release(): void;
  released: Promise<void>;
}

const shutdownCheckpointPublicationBarriers =
  new Map<string, HostedLocalShutdownCheckpointPublicationBarrier>();

export function armCanonicalCheckpointLostAck(userId: string): void {
  const normalizedUserId = userId.trim();
  if (normalizedUserId.length === 0) {
    throw new TypeError("Hosted-local canonical checkpoint lost-ack control requires a user id.");
  }
  canonicalCheckpointLostAckUserIds.add(normalizedUserId);
}

export function wrapCanonicalCheckpointLostAckForTest(
  handler: HostedLocalTestRunnerOutboundHandler,
): HostedLocalTestRunnerOutboundHandler {
  return async (request, env, ctx) => {
    const userId = request.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)?.trim() ?? "";
    if (
      userId.length === 0
      || !canonicalCheckpointLostAckUserIds.has(userId)
      || !await isCanonicalRuntimeCheckpointRequest(request)
    ) {
      return await handler(request, env, ctx);
    }

    // Claim atomically after request classification and before awaiting the
    // real handler so concurrent checkpoints cannot receive the same one-shot
    // fault. Restore the arm if the real checkpoint does not commit successfully.
    if (!canonicalCheckpointLostAckUserIds.delete(userId)) {
      return await handler(request, env, ctx);
    }
    let committedResponse: Response;
    try {
      committedResponse = await handler(request, env, ctx);
    } catch (error) {
      canonicalCheckpointLostAckUserIds.add(userId);
      throw error;
    }
    if (
      !committedResponse.ok
      || !await isCommittedCanonicalRuntimeCheckpointResponse(committedResponse)
    ) {
      canonicalCheckpointLostAckUserIds.add(userId);
      return committedResponse;
    }

    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        faultKind: "canonical_checkpoint_lost_ack",
        committedStatus: committedResponse.status,
      },
      level: "warn",
      message:
        "Hosted-local test dropped a canonical checkpoint acknowledgement after the real checkpoint committed.",
      phase: "wake.running",
      userId,
    });
    return new Response(JSON.stringify({
      error: "Synthetic hosted-local canonical checkpoint acknowledgement loss.",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 503,
    });
  };
}

async function isCommittedCanonicalRuntimeCheckpointResponse(
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

async function isCanonicalRuntimeCheckpointRequest(request: Request): Promise<boolean> {
  const url = new URL(request.url);
  if (
    request.method !== "POST"
    || url.pathname !== HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH
  ) {
    return false;
  }

  const body: unknown = await request.clone().json().catch(() => null);
  return Boolean(
    body
    && typeof body === "object"
    && !Array.isArray(body)
    && "reason" in body
    && body.reason === "canonical_runtime_commit",
  );
}

export function armSnapshotPublicationCorruption(userId: string): void {
  const normalizedUserId = userId.trim();
  if (normalizedUserId.length === 0) {
    throw new TypeError("Hosted-local snapshot publication corruption control requires a user id.");
  }
  snapshotPublicationCorruptionUserIds.add(normalizedUserId);
}

export function armShutdownCheckpointPublicationBarrier(userId: string): void {
  armCheckpointPublicationBarrier(userId, "idle_shutdown");
}

export function armCanonicalCheckpointPublicationBarrier(userId: string): void {
  armCheckpointPublicationBarrier(userId, "canonical_runtime_commit");
}

export function armIdleSnapshotStartBarrier(userId: string): void {
  armCheckpointPublicationBarrier(userId, "snapshot_start");
}

function armCheckpointPublicationBarrier(
  userId: string,
  target: "canonical_runtime_commit" | "idle_shutdown" | "snapshot_start",
): void {
  const normalizedUserId = normalizeShutdownCheckpointPublicationBarrierUserId(userId);
  if (shutdownCheckpointPublicationBarriers.has(normalizedUserId)) {
    throw new Error(
      "A hosted-local shutdown checkpoint publication barrier is already armed for this user.",
    );
  }

  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  shutdownCheckpointPublicationBarriers.set(normalizedUserId, {
    entered: false,
    target,
    release,
    released,
  });
}

export function readShutdownCheckpointPublicationBarrierState(
  userId: string,
): HostedLocalShutdownCheckpointPublicationBarrierState {
  const barrier = shutdownCheckpointPublicationBarriers.get(
    normalizeShutdownCheckpointPublicationBarrierUserId(userId),
  );
  if (!barrier) {
    return "unarmed";
  }
  return barrier.entered ? "entered" : "armed";
}

export function releaseShutdownCheckpointPublicationBarrier(userId: string): boolean {
  const normalizedUserId = normalizeShutdownCheckpointPublicationBarrierUserId(userId);
  const barrier = shutdownCheckpointPublicationBarriers.get(normalizedUserId);
  if (!barrier) {
    return false;
  }

  shutdownCheckpointPublicationBarriers.delete(normalizedUserId);
  barrier.release();
  return true;
}

export function wrapShutdownCheckpointPublicationBarrierForTest(
  handler: HostedLocalTestRunnerOutboundHandler,
): HostedLocalTestRunnerOutboundHandler {
  return async (request, env, ctx) => {
    const userId = request.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)?.trim() ?? "";
    const barrier = userId.length > 0
      ? shutdownCheckpointPublicationBarriers.get(userId)
      : null;
    if (
      !barrier
      || !await isCheckpointPublicationRequestForReason(
        request,
        barrier.target,
      )
    ) {
      return await handler(request, env, ctx);
    }

    barrier.entered = true;
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        barrierKind: `${barrier.target}_checkpoint_publication`,
      },
      message:
        "Hosted-local test paused checkpoint publication before the real checkpoint commit.",
      phase: "checkpoint",
      userId,
    });
    await barrier.released;
    if (request.signal.aborted) {
      throw request.signal.reason instanceof Error
        ? request.signal.reason
        : new DOMException(
            "Hosted-local shutdown checkpoint publication was interrupted.",
            "AbortError",
          );
    }
    return await handler(request, env, ctx);
  };
}

async function isCheckpointPublicationRequestForReason(
  request: Request,
  target: "canonical_runtime_commit" | "idle_shutdown" | "snapshot_start",
): Promise<boolean> {
  if (
    target === "snapshot_start"
    && request.method === "POST"
    && new URL(request.url).pathname === "/workspace-snapshots/start"
  ) {
    return true;
  }
  if (
    target === "canonical_runtime_commit"
    && await isCanonicalRuntimeCheckpointRequest(request)
  ) {
    return true;
  }
  if (!isWorkspaceSnapshotCompleteRequest(request)) {
    return false;
  }
  const body: unknown = await request.clone().json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }
  const checkpointRequest = "checkpointRequest" in body
    ? body.checkpointRequest
    : null;
  return Boolean(
    checkpointRequest
    && typeof checkpointRequest === "object"
    && !Array.isArray(checkpointRequest)
    && "reason" in checkpointRequest
    && checkpointRequest.reason === target,
  );
}

function normalizeShutdownCheckpointPublicationBarrierUserId(userId: string): string {
  const normalizedUserId = userId.trim();
  if (normalizedUserId.length === 0) {
    throw new TypeError(
      "Hosted-local shutdown checkpoint publication barrier requires a user id.",
    );
  }
  return normalizedUserId;
}

export function wrapSnapshotPublicationCorruptionForTest(
  handler: HostedLocalTestRunnerOutboundHandler,
): HostedLocalTestRunnerOutboundHandler {
  return async (request, env, ctx) => {
    const userId = request.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)?.trim() ?? "";
    if (
      userId.length === 0
      || !snapshotPublicationCorruptionUserIds.has(userId)
      || !await isTerminalIdleCheckpointSnapshotCompleteRequest(request)
    ) {
      return await handler(request, env, ctx);
    }

    // Consume before reading the body so concurrent completions cannot receive
    // the same one-shot mutation. Malformed requests do not consume the arm.
    snapshotPublicationCorruptionUserIds.delete(userId);
    const corruptedRequest = await corruptWorkspaceSnapshotCompleteRequest(request);
    if (!corruptedRequest) {
      snapshotPublicationCorruptionUserIds.add(userId);
      return await handler(request, env, ctx);
    }

    let response: Response;
    try {
      response = await handler(corruptedRequest, env, ctx);
    } catch (error) {
      snapshotPublicationCorruptionUserIds.add(userId);
      throw error;
    }

    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        faultKind: "snapshot_publication_corrupt_metadata",
        validationStatus: response.status,
      },
      level: "warn",
      message:
        "Hosted-local test corrupted snapshot completion metadata before real publication validation.",
      phase: "checkpoint",
      userId,
    });
    return response;
  };
}

async function isTerminalIdleCheckpointSnapshotCompleteRequest(
  request: Request,
): Promise<boolean> {
  if (!isWorkspaceSnapshotCompleteRequest(request)) {
    return false;
  }
  const body: unknown = await request.clone().json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }
  const checkpointRequest = "checkpointRequest" in body ? body.checkpointRequest : null;
  if (
    !checkpointRequest
    || typeof checkpointRequest !== "object"
    || Array.isArray(checkpointRequest)
    || !("idleCheckpointTrigger" in checkpointRequest)
  ) {
    return false;
  }
  return checkpointRequest.idleCheckpointTrigger === "idle_window"
    || checkpointRequest.idleCheckpointTrigger === "runtime_wake"
    || checkpointRequest.idleCheckpointTrigger === "shutdown_signal";
}

function isWorkspaceSnapshotCompleteRequest(request: Request): boolean {
  return request.method === "POST"
    && /^\/workspace-snapshots\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/complete$/u.test(
      new URL(request.url).pathname,
    );
}

async function corruptWorkspaceSnapshotCompleteRequest(
  request: Request,
): Promise<Request | null> {
  const body: unknown = await request.clone().json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const archive = "archive" in body ? body.archive : null;
  if (!archive || typeof archive !== "object" || Array.isArray(archive)) {
    return null;
  }
  const encryptedObjectSha256 = "encryptedObjectSha256" in archive
    ? archive.encryptedObjectSha256
    : null;
  if (
    typeof encryptedObjectSha256 !== "string"
    || !/^[0-9a-f]{64}$/u.test(encryptedObjectSha256)
  ) {
    return null;
  }

  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, {
    body: JSON.stringify({
      ...body,
      archive: {
        ...archive,
        encryptedObjectSha256:
          `${encryptedObjectSha256[0] === "0" ? "1" : "0"}${encryptedObjectSha256.slice(1)}`,
      },
    }),
    headers,
    method: request.method,
  });
}

export const HOSTED_LOCAL_LINQ_ATTACHMENT_UPLOAD_HOST = "uploads.example.test";
let generatedImageProviderBarrier: Promise<void> | null = null;
let releaseGeneratedImageProvider: (() => void) | null = null;

function armGeneratedImageProviderBarrier(): void {
  if (generatedImageProviderBarrier) {
    throw new Error("Hosted-local generated image provider barrier is already armed.");
  }
  generatedImageProviderBarrier = new Promise<void>((resolve) => {
    releaseGeneratedImageProvider = resolve;
  });
}

function releaseGeneratedImageProviderBarrier(): void {
  const release = releaseGeneratedImageProvider;
  generatedImageProviderBarrier = null;
  releaseGeneratedImageProvider = null;
  release?.();
}

const hostedLocalOpenAiImagesFetch: typeof fetch = async (input) => {
  const request = input instanceof Request ? input : new Request(input);
  const url = new URL(request.url);
  if (
    request.method !== "POST"
    || (url.pathname !== "/v1/images/generations" && url.pathname !== "/v1/images/edits")
  ) {
    return new Response("Unexpected hosted-local OpenAI Images request.", { status: 502 });
  }

  await generatedImageProviderBarrier;
  return new Response(JSON.stringify({
    data: [{ b64_json: "UklGRgAAAABXRUJQ" }],
    usage: {
      input_tokens: 12,
      input_tokens_details: {
        cached_tokens: 0,
        image_tokens: 0,
        text_tokens: 12,
      },
      output_tokens: 34,
      output_tokens_details: {
        image_tokens: 34,
        reasoning_tokens: 0,
        text_tokens: 0,
      },
      total_tokens: 46,
    },
  }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-request-id": "req_hosted_local_generated_image",
    },
    status: 200,
  });
};

const wrapOpenAiImagesForTest: HostedLocalTestRunnerOutboundHandler = (request, env, ctx) => {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/v1/images/generations" && pathname !== "/v1/images/edits") {
    return openAiHandler(request, env, ctx);
  }
  return handleHostedRunnerOpenAiOutbound(
    request,
    env,
    ctx,
    hostedLocalOpenAiImagesFetch,
  );
};

const handleHostedLocalGeminiVideoAnalysis: HostedLocalTestRunnerOutboundHandler = (
  request,
  env,
  ctx,
) => handleHostedRunnerGeminiOutbound(
  request,
  env,
  ctx,
  hostedLocalGeminiVideoAnalysisFetch,
);

const handleHostedLocalLinqAttachmentUpload: HostedLocalTestRunnerOutboundHandler = async (
  request,
) => {
  const pathname = new URL(request.url).pathname;
  if (
    request.method !== "PUT"
    || !/^\/linq-attachments\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(pathname)
  ) {
    return new Response("Not found", { status: 404 });
  }
  const contentType = request.headers.get("content-type")?.trim().toLowerCase() ?? "";
  if (
    contentType !== "application/pdf"
    && contentType !== "image/jpeg"
    && contentType !== "image/png"
    && contentType !== "image/webp"
  ) {
    return new Response("Unsupported media type", { status: 415 });
  }
  const uploadBytes = (await request.arrayBuffer()).byteLength;
  if (uploadBytes === 0) {
    return new Response("Attachment body must not be empty", { status: 400 });
  }
  emitHostedExecutionStructuredLog({
    component: "runner",
    details: {
      contentType,
      uploadBytes,
    },
    message: "Hosted-local Linq attachment upload accepted.",
    phase: "wake.running",
  });
  return new Response(null, { status: 204 });
};

const hostedLocalTestOutboundByHost: typeof HOSTED_RUNNER_OUTBOUND_BY_HOST = {
  ...HOSTED_RUNNER_OUTBOUND_BY_HOST,
  [CLOUDFLARE_HOSTED_TRANSCRIBE_HOST]: (request, env, ctx) =>
    transcribeHandler(request, env.AI ? env : { ...env, AI: hostedLocalTestAiBinding }, ctx),
  [CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane]:
    wrapForegroundPriorityOrderingObservationForTest(
      wrapShutdownCheckpointPublicationBarrierForTest(
        wrapCanonicalCheckpointLostAckForTest(webControlPlaneHandler),
      ),
      "web-control",
    ),
  [CLOUDFLARE_HOSTED_RUNTIME_HOSTS.workspaceSnapshotStore]:
    wrapForegroundPriorityOrderingObservationForTest(
      wrapShutdownCheckpointPublicationBarrierForTest(
        wrapSnapshotPublicationCorruptionForTest(workspaceSnapshotStoreHandler),
      ),
      "snapshot-store",
    ),
  [CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort]: effectsPortHandler,
  [HOSTED_LOCAL_LINQ_ATTACHMENT_UPLOAD_HOST]: handleHostedLocalLinqAttachmentUpload,
  "api.openai.com": wrapOpenAiImagesForTest,
  "generativelanguage.googleapis.com": handleHostedLocalGeminiVideoAnalysis,
};

RunnerContainer.outboundByHost = hostedLocalTestOutboundByHost;
