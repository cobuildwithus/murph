import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";
import {
  HOSTED_RUNTIME_MAILBOX_FETCH_PATH,
  HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
} from "@murphai/hosted-execution/routes";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

import {
  armCanonicalCheckpointPublicationBarrier,
  armCanonicalCheckpointLostAck,
  armSnapshotPublicationCorruption,
  armIdleSnapshotStartBarrier,
  armShutdownCheckpointPublicationBarrier,
  HOSTED_LOCAL_LINQ_ATTACHMENT_UPLOAD_HOST,
  readShutdownCheckpointPublicationBarrierState,
  releaseShutdownCheckpointPublicationBarrier,
  RunnerContainer as HostedLocalTestRunnerContainer,
  wrapCanonicalCheckpointLostAckForTest,
  wrapSnapshotPublicationCorruptionForTest,
  wrapShutdownCheckpointPublicationBarrierForTest,
} from "../src/hosted-local-test/runner-container.ts";
import {
  armForegroundPriorityOrderingObservation,
  clearForegroundPriorityOrderingObservation,
  readForegroundPriorityOrderingObservation,
  recordForegroundPriorityAssistantProviderStart,
  releaseForegroundPriorityOrderingBarrier,
  wrapForegroundPriorityOrderingObservationForTest,
} from "../src/hosted-local-test/foreground-priority-ordering.ts";
import {
  HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS,
  HOSTED_RUNNER_OUTBOUND_BY_HOST,
} from "../src/runner-egress-intercept.ts";
import {
  createHostedProviderEgressCredential,
} from "../src/hosted-provider-egress-credential.ts";
import {
  HOSTED_EXECUTION_RUNNER_GENERATED_IMAGE_UPLOAD_PATH,
} from "../src/runner-effects-contract.ts";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../src/runner-outbound/headers.ts";
import type {
  RunnerOutboundEnvironmentSource,
} from "../src/runner-outbound.ts";
import {
  createHostedExecutionTestEnv,
} from "./hosted-execution-fixtures.ts";

const TRANSCRIBE_URL = "http://murph-transcribe.worker/v1/transcribe";
const PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET = "provider-egress-signing-secret";
const RUNNER_CONTAINER_NAME = "member_123--v-version_1";

function createCanonicalCheckpointRequest(userId: string): Request {
  return new Request(
    `http://${HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.webControlPlane}${HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH}`,
    {
      body: JSON.stringify({ reason: "canonical_runtime_commit" }),
      headers: {
        [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: userId,
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    },
  );
}

function createMailboxFetchRequest(
  userId: string,
  importedSeq = "0",
  lanes: readonly { importedSeq: string; lane: string }[] = [
    { importedSeq, lane: "conversation" },
    { importedSeq: "0", lane: "system" },
  ],
  requestId = "request-foreground-priority-ordering",
): Request {
  return new Request(
    `http://${HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.webControlPlane}`
      + HOSTED_RUNTIME_MAILBOX_FETCH_PATH,
    {
      body: JSON.stringify({
        lanes,
        limitPerLane: 25,
        requestId,
        userId,
      }),
      headers: {
        [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: userId,
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    },
  );
}

function createMailboxFetchResponse(
  userId: string,
  conversationSeqs: readonly string[],
): Response {
  return new Response(JSON.stringify({
    items: conversationSeqs.map((laneSeq, index) => ({
      id: `mailbox-synthetic-${index + 1}`,
      kind: "conversation.message",
      lane: "conversation",
      laneSeq,
      userId,
    })),
  }), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 200,
  });
}

function createSnapshotStartRequest(userId: string): Request {
  return new Request(
    `http://${HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.workspaceSnapshotStore}`
      + "/workspace-snapshots/start",
    {
      headers: { [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: userId },
      method: "POST",
    },
  );
}

function createSnapshotCompleteRequest(
  userId: string,
  encryptedObjectSha256 = "a".repeat(64),
  reason?: "canonical_runtime_commit" | "idle_shutdown",
  idleCheckpointTrigger?: "idle_window" | "runtime_wake" | "shutdown_signal",
): Request {
  return new Request(
    `http://${HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.workspaceSnapshotStore}`
      + "/workspace-snapshots/snapshot-test/complete",
    {
      body: JSON.stringify({
        archive: {
          encryptedObjectSha256,
        },
        checkpointRequest: reason
          ? {
              ...(idleCheckpointTrigger ? { idleCheckpointTrigger } : {}),
              reason,
            }
          : {},
        objectKey: `users/${userId}/workspace-snapshots/snapshot-test.enc`,
        snapshotId: "snapshot-test",
      }),
      headers: {
        [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: userId,
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    },
  );
}

async function readSnapshotCompleteSha256(request: Request): Promise<string | null> {
  const body = await request.json() as {
    archive?: { encryptedObjectSha256?: unknown };
  };
  const value = body.archive?.encryptedObjectSha256;
  return typeof value === "string" ? value : null;
}

function readHostedLocalTestOutboundByHost(): typeof HOSTED_RUNNER_OUTBOUND_BY_HOST {
  const handlers = HostedLocalTestRunnerContainer.outboundByHost;
  if (!handlers) {
    throw new Error("Hosted-local test RunnerContainer did not register outbound handlers.");
  }

  return handlers as typeof HOSTED_RUNNER_OUTBOUND_BY_HOST;
}

function createOutboundEnv(input: {
  AI?: RunnerOutboundEnvironmentSource["AI"];
  openAiApiKey?: string;
  ownsRuntimeWriteFence?: boolean;
} = {}): RunnerOutboundEnvironmentSource {
  return {
    ...createHostedExecutionTestEnv(),
    AI: input.AI,
    BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
    HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
      PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET,
    ...(input.openAiApiKey ? { OPENAI_API_KEY: input.openAiApiKey } : {}),
    RUNNER_CONTAINER: {
      get: () => ({
        readActiveRuntimeUserFence: async () => ({ active: true, attemptId: "attempt-1", leaseGeneration: "1", userId: "member_123" }),
      }),
      getByName: () => ({
        destroyInstance: async () => {},
        invoke: async () => {
          throw new Error("Runner container must not be invoked by outbound wrapper tests.");
        },
        readActiveRuntimeUserFence: async () => ({ active: true, attemptId: "attempt-1", leaseGeneration: "1", userId: "member_123" }),
        smokeHealth: async () => {
          throw new Error("Runner container smoke must not run in outbound wrapper tests.");
        },
      }),
      idFromString: (id: string) => id,
    },
    USER_RUNNER: {
      getByName: () => ({
        validateRuntimeProviderEgressCredential: async (credentialInput: { userId: string }) => ({
          attemptId: "attempt_provider_egress_credential",
          leaseGeneration: "7",
          owns: true,
          userId: credentialInput.userId,
          workspaceVersion: "4",
        }),
        validateRuntimeProviderEgressToken: async () => ({ owns: false }),
        validateRuntimeWriteFence: async () => input.ownsRuntimeWriteFence ?? false,
      }),
    },
  };
}

async function createAuthorizedTranscribeRequest(input: {
  body?: BodyInit;
  headers?: Record<string, string>;
  method?: string;
}): Promise<Request> {
  const credential = await createHostedProviderEgressCredential({
    providerKind: "workers_ai_transcribe",
    runnerContainerName: RUNNER_CONTAINER_NAME,
    source: {
      HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
        PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET,
    },
    userId: "member_123",
  });
  return new Request(TRANSCRIBE_URL, {
    body: input.body ?? null,
    headers: {
      authorization: `Bearer ${credential}`,
      ...(input.headers ?? {}),
    },
    method: input.method ?? "POST",
  });
}

async function createAuthorizedOpenAiImagesRequest(): Promise<Request> {
  const credential = await createHostedProviderEgressCredential({
    providerKind: "openai",
    runnerContainerName: RUNNER_CONTAINER_NAME,
    source: {
      HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
        PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET,
    },
    userId: "member_123",
  });
  return new Request("https://api.openai.com/v1/images/generations", {
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt: "Render a synthetic mobility setup diagram.",
    }),
    headers: {
      authorization: `Bearer ${credential}`,
      [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: "member_123",
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
}

describe("hosted-local test RunnerContainer outbound composition", () => {
  it("drops the exact operation queue used by the base container", async () => {
    const container: HostedLocalTestRunnerContainer = Object.create(
      HostedLocalTestRunnerContainer.prototype,
    );
    Object.defineProperty(container, "workspaceInvocationOperations", {
      configurable: true,
      value: [{ attemptId: "attempt_test" }],
      writable: true,
    });

    await expect(container.dropActiveOperationForTest({
      loseCompletedInvocationResult: true,
      userId: "member_drop",
    })).resolves.toEqual({ ok: true });

    expect(
      Object.getOwnPropertyDescriptor(
        container,
        "workspaceInvocationOperations",
      )?.value,
    ).toEqual([]);
    expect(
      Object.hasOwn(container, "workspaceInvocationActiveOperation"),
    ).toBe(false);
    expect(
      Object.getOwnPropertyDescriptor(
        container,
        "loseCompletedInvocationResultForTest",
      )?.value,
    ).toBe(true);
  });

  it("uses SIGTERM for the shutdown checkpoint control", async () => {
    const stop = vi.fn(async () => undefined);
    const destroy = vi.fn(async () => undefined);
    const container: HostedLocalTestRunnerContainer = Object.create(
      HostedLocalTestRunnerContainer.prototype,
    );
    Object.defineProperties(container, {
      destroy: { value: destroy },
      stop: { value: stop },
    });

    await expect(container.beginShutdownCheckpointGracefulStopForTest({
      userId: "member_shutdown_checkpoint_signal",
    })).resolves.toEqual({ ok: true });
    expect(stop).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledWith("SIGTERM");
    expect(destroy).not.toHaveBeenCalled();
  });

  it("wraps only the deterministic hosted-local fault and external-provider hosts", () => {
    const wrapped = readHostedLocalTestOutboundByHost();

    expect(Object.keys(wrapped).sort()).toEqual([
      ...Object.keys(HOSTED_RUNNER_OUTBOUND_BY_HOST),
      HOSTED_LOCAL_LINQ_ATTACHMENT_UPLOAD_HOST,
    ].sort());
    expect(wrapped).not.toBe(HOSTED_RUNNER_OUTBOUND_BY_HOST);
    for (const [host, handler] of Object.entries(HOSTED_RUNNER_OUTBOUND_BY_HOST)) {
      if (
        host === HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.transcribe
        || host === HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.openAi
        || host === HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.webControlPlane
        || host === HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.workspaceSnapshotStore
      ) {
        expect(wrapped[host]).not.toBe(handler);
      } else {
        expect(wrapped[host]).toBe(handler);
      }
    }
    expect(wrapped[HOSTED_LOCAL_LINQ_ATTACHMENT_UPLOAD_HOST]).toBeTypeOf("function");
  });

  it("records bounded typed ordering at the mailbox, checkpoint, and provider boundaries", async () => {
    const userId = "member_foreground_priority_ordering_trace";
    const realHandler = vi.fn(async (request: Request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === HOSTED_RUNTIME_MAILBOX_FETCH_PATH) {
        return createMailboxFetchResponse(userId, ["3", "4"]);
      }
      if (pathname === HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH) {
        return new Response(JSON.stringify({ checkpointed: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      return new Response("accepted", { status: 200 });
    });
    const snapshotHandler = wrapForegroundPriorityOrderingObservationForTest(
      realHandler,
      "snapshot-store",
    );
    const webHandler = wrapForegroundPriorityOrderingObservationForTest(
      realHandler,
      "web-control",
    );
    armForegroundPriorityOrderingObservation(userId);

    try {
      await snapshotHandler(
        createSnapshotStartRequest(userId),
        createOutboundEnv(),
        { containerId: "opaque-container-id" },
      );
      await webHandler(
        createMailboxFetchRequest(userId, "2"),
        createOutboundEnv(),
        { containerId: "opaque-container-id" },
      );
      await webHandler(
        createCanonicalCheckpointRequest(userId),
        createOutboundEnv(),
        { containerId: "opaque-container-id" },
      );
      recordForegroundPriorityAssistantProviderStart(userId);

      expect(readForegroundPriorityOrderingObservation(userId)).toEqual({
        barrierState: "disabled",
        barrierTarget: "none",
        events: [
          { kind: "snapshot_started", ordinal: 1 },
          {
            conversationItemCount: 2,
            conversationLaneRequested: true,
            conversationSeqEnd: "4",
            kind: "mailbox_fetch_finished",
            ordinal: 2,
            probeKind: "other",
            responseStatus: 200,
          },
          {
            kind: "workspace_checkpoint_started",
            ordinal: 3,
            reason: "canonical_runtime_commit",
          },
          { kind: "canonical_checkpoint_committed", ordinal: 4 },
          { kind: "assistant_provider_started", ordinal: 5 },
        ],
        state: "armed",
        truncated: false,
      });
    } finally {
      clearForegroundPriorityOrderingObservation(userId);
    }
  });

  it("rejects provider evidence without an armed observation", () => {
    expect(() =>
      recordForegroundPriorityAssistantProviderStart(
        "member_foreground_priority_unarmed_provider",
      )
    ).toThrow(
      "Hosted-local foreground-priority provider start requires an armed observation.",
    );
  });

  it("bounds the foreground-priority ordering trace", () => {
    const userId = "member_foreground_priority_ordering_bounded";
    armForegroundPriorityOrderingObservation(userId);

    try {
      for (let index = 0; index < 65; index += 1) {
        recordForegroundPriorityAssistantProviderStart(userId);
      }

      const observation = readForegroundPriorityOrderingObservation(userId);
      expect(observation.events).toHaveLength(64);
      expect(observation.events.at(-1)).toEqual({
        kind: "assistant_provider_started",
        ordinal: 64,
      });
      expect(observation.truncated).toBe(true);
    } finally {
      clearForegroundPriorityOrderingObservation(userId);
    }
  });

  it("holds the first empty conversation probe after an idle snapshot starts", async () => {
    const userId = "member_foreground_priority_empty_probe_barrier";
    const realHandler = vi.fn(async (request: Request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === HOSTED_RUNTIME_MAILBOX_FETCH_PATH) {
        return createMailboxFetchResponse(userId, []);
      }
      return new Response("accepted", { status: 200 });
    });
    const snapshotHandler = wrapForegroundPriorityOrderingObservationForTest(
      realHandler,
      "snapshot-store",
    );
    const webHandler = wrapForegroundPriorityOrderingObservationForTest(
      realHandler,
      "web-control",
    );
    armForegroundPriorityOrderingObservation(
      userId,
      "empty_conversation_probe",
    );

    try {
      await expect(webHandler(
        createMailboxFetchRequest(userId),
        createOutboundEnv(),
        { containerId: "opaque-container-id" },
      ).then((response) => response.status)).resolves.toBe(200);
      expect(readForegroundPriorityOrderingObservation(userId)).toMatchObject({
        barrierState: "armed",
      });

      await expect(snapshotHandler(
        createSnapshotStartRequest(userId),
        createOutboundEnv(),
        { containerId: "opaque-container-id" },
      ).then((response) => response.status)).resolves.toBe(200);

      await expect(webHandler(
        createMailboxFetchRequest(userId, "0", [
          { importedSeq: "0", lane: "system" },
        ]),
        createOutboundEnv(),
        { containerId: "opaque-container-id" },
      ).then((response) => response.status)).resolves.toBe(200);
      expect(readForegroundPriorityOrderingObservation(userId)).toMatchObject({
        barrierState: "armed",
      });

      const heldEmptyProbe = webHandler(
        createMailboxFetchRequest(
          userId,
          "0",
          [
            { importedSeq: "0", lane: "conversation" },
            { importedSeq: "0", lane: "system" },
          ],
          "hosted-invocation:checkpoint-interrupt-rearm-foreground-prefetch:1",
        ),
        createOutboundEnv(),
        { containerId: "opaque-container-id" },
      );
      await vi.waitFor(() => {
        expect(readForegroundPriorityOrderingObservation(userId)).toEqual({
          barrierState: "entered",
          barrierTarget: "empty_conversation_probe",
          events: [
            {
              conversationItemCount: 0,
              conversationLaneRequested: true,
              conversationSeqEnd: null,
              kind: "mailbox_fetch_finished",
              ordinal: 1,
              probeKind: "other",
              responseStatus: 200,
            },
            { kind: "snapshot_started", ordinal: 2 },
            {
              conversationItemCount: 0,
              conversationLaneRequested: false,
              conversationSeqEnd: null,
              kind: "mailbox_fetch_finished",
              ordinal: 3,
              probeKind: "other",
              responseStatus: 200,
            },
            {
              conversationItemCount: 0,
              conversationLaneRequested: true,
              conversationSeqEnd: null,
              kind: "mailbox_fetch_finished",
              ordinal: 4,
              probeKind: "checkpoint_interrupt_rearm",
              responseStatus: 200,
            },
          ],
          state: "armed",
          truncated: false,
        });
      });
      expect(releaseForegroundPriorityOrderingBarrier(userId)).toBe(true);
      await expect(heldEmptyProbe.then((response) => response.status)).resolves.toBe(200);
    } finally {
      clearForegroundPriorityOrderingObservation(userId);
    }
  });

  it("holds canonical acknowledgement only after the real checkpoint commits", async () => {
    const userId = "member_foreground_priority_canonical_post_commit";
    const realHandler = vi.fn(async () => new Response(
      JSON.stringify({ checkpointed: true }),
      {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      },
    ));
    const handler = wrapForegroundPriorityOrderingObservationForTest(
      realHandler,
      "web-control",
    );
    armForegroundPriorityOrderingObservation(userId, "canonical_post_commit");

    try {
      const heldCommit = handler(
        createCanonicalCheckpointRequest(userId),
        createOutboundEnv(),
        { containerId: "opaque-container-id" },
      );
      await vi.waitFor(() => {
        expect(readForegroundPriorityOrderingObservation(userId)).toEqual({
          barrierState: "entered",
          barrierTarget: "canonical_post_commit",
          events: [
            {
              kind: "workspace_checkpoint_started",
              ordinal: 1,
              reason: "canonical_runtime_commit",
            },
            { kind: "canonical_checkpoint_committed", ordinal: 2 },
          ],
          state: "armed",
          truncated: false,
        });
      });
      expect(realHandler).toHaveBeenCalledOnce();
      expect(releaseForegroundPriorityOrderingBarrier(userId)).toBe(true);
      await expect(heldCommit.then((response) => response.status)).resolves.toBe(200);
    } finally {
      clearForegroundPriorityOrderingObservation(userId);
    }
  });

  it("accepts supported nonempty private-media PUTs on the hosted-local Linq upload path", async () => {
    const handler = readHostedLocalTestOutboundByHost()[
      HOSTED_LOCAL_LINQ_ATTACHMENT_UPLOAD_HOST
    ];
    if (!handler) {
      throw new Error("Hosted-local Linq attachment upload handler is missing.");
    }
    const run = async (input: {
      body?: BodyInit;
      contentType?: string;
      method?: string;
      pathname?: string;
    }): Promise<Response> => await handler(
      new Request(
        `https://${HOSTED_LOCAL_LINQ_ATTACHMENT_UPLOAD_HOST}`
          + (input.pathname ?? "/linq-attachments/attachment_local_1"),
        {
          body: input.body,
          headers: input.contentType ? { "content-type": input.contentType } : undefined,
          method: input.method ?? "PUT",
        },
      ),
      createOutboundEnv(),
      { containerId: "opaque-container-id" },
    );

    await expect(run({
      body: "synthetic-pdf-bytes",
      contentType: "application/pdf",
    }).then((response) => response.status)).resolves.toBe(204);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith({
      component: "runner",
      details: {
        contentType: "application/pdf",
        uploadBytes: 19,
      },
      message: "Hosted-local Linq attachment upload accepted.",
      phase: "wake.running",
    });
    await expect(run({
      body: "synthetic-webp-bytes",
      contentType: "image/webp",
    }).then((response) => response.status)).resolves.toBe(204);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenLastCalledWith({
      component: "runner",
      details: {
        contentType: "image/webp",
        uploadBytes: 20,
      },
      message: "Hosted-local Linq attachment upload accepted.",
      phase: "wake.running",
    });
    await expect(run({
      body: "synthetic-pdf-bytes",
      contentType: "text/plain",
    }).then((response) => response.status)).resolves.toBe(415);
    await expect(run({
      body: "",
      contentType: "application/pdf",
    }).then((response) => response.status)).resolves.toBe(400);
    await expect(run({
      body: "synthetic-pdf-bytes",
      contentType: "application/pdf",
      pathname: "/other-upload/attachment_local_1",
    }).then((response) => response.status)).resolves.toBe(404);
  });

  it("returns the generated-image URL upload compatibility tombstone", async () => {
    const handler = readHostedLocalTestOutboundByHost()[
      HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.effectsPort
    ];
    if (!handler) {
      throw new Error("Generated-image outbound handler is missing.");
    }
    const userId = "member_123";

    const response = await handler(
      new Request(
        `http://${HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.effectsPort}`
          + HOSTED_EXECUTION_RUNNER_GENERATED_IMAGE_UPLOAD_PATH,
        {
          headers: {
            [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: "attempt-1",
            [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: "1",
            [HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER]: "4",
            [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: userId,
          },
          method: "POST",
        },
      ),
      createOutboundEnv({
        ownsRuntimeWriteFence: true,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error:
        "Legacy generated-image URL uploads have moved to private provider attachments.",
    });
  });

  it("returns priceable modality usage from the hosted-local OpenAI Images stub", async () => {
    const handler = readHostedLocalTestOutboundByHost()[
      HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.openAi
    ];
    if (!handler) {
      throw new Error("Wrapped OpenAI outbound handler is missing.");
    }

    const response = await handler(
      await createAuthorizedOpenAiImagesRequest(),
      createOutboundEnv({ openAiApiKey: "openai-worker-secret" }),
      { containerId: RUNNER_CONTAINER_NAME },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
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
    });
  });

  it("returns a synthetic 503 only after the armed canonical checkpoint commits", async () => {
    const userId = "member_canonical_lost_ack_success";
    const committedResponse = JSON.stringify({ checkpointed: true });
    const realHandler = vi.fn(async () => new Response(committedResponse, {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 200,
    }));
    const handler = wrapCanonicalCheckpointLostAckForTest(realHandler);
    armCanonicalCheckpointLostAck(userId);

    const lostAckResponse = await handler(
      createCanonicalCheckpointRequest(userId),
      createOutboundEnv(),
      { containerId: "opaque-container-id" },
    );

    expect(lostAckResponse.status).toBe(503);
    await expect(lostAckResponse.json()).resolves.toEqual({
      error: "Synthetic hosted-local canonical checkpoint acknowledgement loss.",
    });
    expect(realHandler).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          committedStatus: 200,
          faultKind: "canonical_checkpoint_lost_ack",
        }),
        userId,
      }),
    );

    const retryResponse = await handler(
      createCanonicalCheckpointRequest(userId),
      createOutboundEnv(),
      { containerId: "opaque-container-id" },
    );
    expect(retryResponse.status).toBe(200);
    await expect(retryResponse.text()).resolves.toBe(committedResponse);
    expect(realHandler).toHaveBeenCalledTimes(2);
  });

  it("keeps the one-shot fault armed when the real checkpoint does not commit", async () => {
    const userId = "member_canonical_lost_ack_upstream_failure";
    const realHandler = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ checkpointed: false }), {
        status: 200,
      }))
      .mockResolvedValue(new Response(JSON.stringify({ checkpointed: true }), {
        status: 200,
      }));
    const handler = wrapCanonicalCheckpointLostAckForTest(realHandler);
    armCanonicalCheckpointLostAck(userId);

    const failedCommitResponse = await handler(
      createCanonicalCheckpointRequest(userId),
      createOutboundEnv(),
      { containerId: "opaque-container-id" },
    );
    expect(failedCommitResponse.status).toBe(200);
    await expect(failedCommitResponse.json()).resolves.toEqual({ checkpointed: false });

    const lostAckResponse = await handler(
      createCanonicalCheckpointRequest(userId),
      createOutboundEnv(),
      { containerId: "opaque-container-id" },
    );
    expect(lostAckResponse.status).toBe(503);

    const retryResponse = await handler(
      createCanonicalCheckpointRequest(userId),
      createOutboundEnv(),
      { containerId: "opaque-container-id" },
    );
    expect(retryResponse.status).toBe(200);
    expect(realHandler).toHaveBeenCalledTimes(3);
  });

  it("claims one canonical checkpoint lost-ack fault across concurrent commits", async () => {
    const userId = "member_canonical_lost_ack_concurrent";
    const committedResponse = JSON.stringify({ checkpointed: true });
    const realHandler = vi.fn(async () => new Response(committedResponse, {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 200,
    }));
    const handler = wrapCanonicalCheckpointLostAckForTest(realHandler);
    armCanonicalCheckpointLostAck(userId);

    const responses = await Promise.all([
      handler(
        createCanonicalCheckpointRequest(userId),
        createOutboundEnv(),
        { containerId: "opaque-container-id" },
      ),
      handler(
        createCanonicalCheckpointRequest(userId),
        createOutboundEnv(),
        { containerId: "opaque-container-id" },
      ),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 503]);
    expect(realHandler).toHaveBeenCalledTimes(2);
  });

  it("corrupts one snapshot completion before the real publication validator", async () => {
    const userId = "member_snapshot_publication_corruption";
    const originalSha256 = "a".repeat(64);
    const observedSha256: Array<string | null> = [];
    const realHandler = vi.fn(async (request: Request) => {
      observedSha256.push(await readSnapshotCompleteSha256(request));
      return new Response("snapshot metadata rejected", { status: 409 });
    });
    const handler = wrapSnapshotPublicationCorruptionForTest(realHandler);
    armSnapshotPublicationCorruption(userId);

    const rejectedResponse = await handler(
      createSnapshotCompleteRequest(
        userId,
        originalSha256,
        "idle_shutdown",
        "idle_window",
      ),
      createOutboundEnv(),
      { containerId: "opaque-container-id" },
    );

    expect(rejectedResponse.status).toBe(409);
    expect(observedSha256[0]).toMatch(/^[0-9a-f]{64}$/u);
    expect(observedSha256[0]).not.toBe(originalSha256);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: {
          faultKind: "snapshot_publication_corrupt_metadata",
          validationStatus: 409,
        },
        userId,
      }),
    );

    const cleanResponse = await handler(
      createSnapshotCompleteRequest(
        userId,
        originalSha256,
        "idle_shutdown",
        "idle_window",
      ),
      createOutboundEnv(),
      { containerId: "opaque-container-id" },
    );
    expect(cleanResponse.status).toBe(409);
    expect(observedSha256).toEqual([
      `0${originalSha256.slice(1)}`,
      originalSha256,
    ]);
  });

  it("does not consume snapshot publication corruption on a pre-provider checkpoint", async () => {
    const userId = "member_snapshot_publication_pre_provider";
    const originalSha256 = "a".repeat(64);
    const observedSha256: Array<string | null> = [];
    const realHandler = vi.fn(async (request: Request) => {
      observedSha256.push(await readSnapshotCompleteSha256(request));
      return new Response("snapshot metadata rejected", { status: 409 });
    });
    const handler = wrapSnapshotPublicationCorruptionForTest(realHandler);
    armSnapshotPublicationCorruption(userId);

    await handler(
      createSnapshotCompleteRequest(userId, originalSha256, "idle_shutdown"),
      createOutboundEnv(),
      { containerId: "opaque-container-id" },
    );
    await handler(
      createSnapshotCompleteRequest(
        userId,
        originalSha256,
        "idle_shutdown",
        "runtime_wake",
      ),
      createOutboundEnv(),
      { containerId: "opaque-container-id" },
    );

    expect(observedSha256).toEqual([
      originalSha256,
      `0${originalSha256.slice(1)}`,
    ]);
  });

  it("does not consume snapshot publication corruption on malformed metadata", async () => {
    const userId = "member_snapshot_publication_malformed";
    const observedSha256: Array<string | null> = [];
    const realHandler = vi.fn(async (request: Request) => {
      observedSha256.push(await readSnapshotCompleteSha256(request));
      return new Response("snapshot metadata rejected", { status: 409 });
    });
    const handler = wrapSnapshotPublicationCorruptionForTest(realHandler);
    armSnapshotPublicationCorruption(userId);

    await handler(
      createSnapshotCompleteRequest(userId, "not-a-sha256"),
      createOutboundEnv(),
      { containerId: "opaque-container-id" },
    );
    await handler(
      createSnapshotCompleteRequest(
        userId,
        "a".repeat(64),
        "idle_shutdown",
        "idle_window",
      ),
      createOutboundEnv(),
      { containerId: "opaque-container-id" },
    );

    expect(observedSha256).toEqual([
      "not-a-sha256",
      `0${"a".repeat(63)}`,
    ]);
  });

  it("holds one matching shutdown snapshot publication until explicit release", async () => {
    const userId = "member_shutdown_checkpoint_barrier";
    const otherUserId = "member_shutdown_checkpoint_barrier_other";
    const realHandler = vi.fn(async () => new Response("checkpoint committed", { status: 200 }));
    const handler = wrapShutdownCheckpointPublicationBarrierForTest(realHandler);
    armShutdownCheckpointPublicationBarrier(userId);

    try {
      expect(readShutdownCheckpointPublicationBarrierState(userId)).toBe("armed");

      await handler(
        createSnapshotCompleteRequest(otherUserId, "a".repeat(64), "idle_shutdown"),
        createOutboundEnv(),
        { containerId: "opaque-container-id" },
      );
      await handler(
        createSnapshotCompleteRequest(userId, "a".repeat(64), "canonical_runtime_commit"),
        createOutboundEnv(),
        { containerId: "opaque-container-id" },
      );
      expect(realHandler).toHaveBeenCalledTimes(2);
      expect(readShutdownCheckpointPublicationBarrierState(userId)).toBe("armed");

      const heldPublication = handler(
        createSnapshotCompleteRequest(userId, "a".repeat(64), "idle_shutdown"),
        createOutboundEnv(),
        { containerId: "opaque-container-id" },
      );
      await vi.waitFor(() => {
        expect(readShutdownCheckpointPublicationBarrierState(userId)).toBe("entered");
      });
      expect(realHandler).toHaveBeenCalledTimes(2);
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          details: {
            barrierKind: "idle_shutdown_checkpoint_publication",
          },
          userId,
        }),
      );

      expect(releaseShutdownCheckpointPublicationBarrier(userId)).toBe(true);
      await expect(heldPublication.then((response) => response.text()))
        .resolves.toBe("checkpoint committed");
      expect(realHandler).toHaveBeenCalledTimes(3);
      expect(readShutdownCheckpointPublicationBarrierState(userId)).toBe("unarmed");

      await handler(
        createSnapshotCompleteRequest(userId, "a".repeat(64), "idle_shutdown"),
        createOutboundEnv(),
        { containerId: "opaque-container-id" },
      );
      expect(realHandler).toHaveBeenCalledTimes(4);
      expect(releaseShutdownCheckpointPublicationBarrier(userId)).toBe(false);
    } finally {
      releaseShutdownCheckpointPublicationBarrier(userId);
    }
  });

  it("holds snapshot start at the cancellation-aware boundary", async () => {
    const userId = "member_idle_snapshot_start_barrier";
    const realHandler = vi.fn(async () => new Response("snapshot started", { status: 200 }));
    const handler = wrapShutdownCheckpointPublicationBarrierForTest(realHandler);
    armIdleSnapshotStartBarrier(userId);

    try {
      const heldStart = handler(
        createSnapshotStartRequest(userId),
        createOutboundEnv(),
        { containerId: "opaque-container-id" },
      );
      await vi.waitFor(() => {
        expect(readShutdownCheckpointPublicationBarrierState(userId)).toBe("entered");
      });
      expect(realHandler).not.toHaveBeenCalled();
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          details: {
            barrierKind: "snapshot_start_checkpoint_publication",
          },
          userId,
        }),
      );

      expect(releaseShutdownCheckpointPublicationBarrier(userId)).toBe(true);
      await expect(heldStart.then((response) => response.text()))
        .resolves.toBe("snapshot started");
      expect(realHandler).toHaveBeenCalledTimes(1);
    } finally {
      releaseShutdownCheckpointPublicationBarrier(userId);
    }
  });

  it("holds one matching canonical checkpoint publication until explicit release", async () => {
    const userId = "member_canonical_checkpoint_barrier";
    const realHandler = vi.fn(async () => new Response("checkpoint committed", { status: 200 }));
    const handler = wrapShutdownCheckpointPublicationBarrierForTest(realHandler);
    armCanonicalCheckpointPublicationBarrier(userId);

    try {
      const heldPublication = handler(
        createCanonicalCheckpointRequest(userId),
        createOutboundEnv(),
        { containerId: "opaque-container-id" },
      );
      await vi.waitFor(() => {
        expect(readShutdownCheckpointPublicationBarrierState(userId)).toBe("entered");
      });
      expect(realHandler).not.toHaveBeenCalled();
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          details: {
            barrierKind: "canonical_runtime_commit_checkpoint_publication",
          },
          userId,
        }),
      );

      expect(releaseShutdownCheckpointPublicationBarrier(userId)).toBe(true);
      await expect(heldPublication.then((response) => response.text()))
        .resolves.toBe("checkpoint committed");
      expect(realHandler).toHaveBeenCalledTimes(1);
    } finally {
      releaseShutdownCheckpointPublicationBarrier(userId);
    }
  });

  it("does not publish a held shutdown checkpoint after its request is aborted", async () => {
    const userId = "member_shutdown_checkpoint_barrier_aborted";
    const realHandler = vi.fn(async () => new Response("checkpoint committed", { status: 200 }));
    const handler = wrapShutdownCheckpointPublicationBarrierForTest(realHandler);
    const abortController = new AbortController();
    const abortReason = new Error("Synthetic live-invocation wake interrupted the checkpoint.");
    const checkpointRequest = createSnapshotCompleteRequest(
      userId,
      "a".repeat(64),
      "idle_shutdown",
    );
    const abortableCheckpointRequest = new Request(checkpointRequest, {
      signal: abortController.signal,
    });
    armShutdownCheckpointPublicationBarrier(userId);

    try {
      const heldPublication = handler(
        abortableCheckpointRequest,
        createOutboundEnv(),
        { containerId: "opaque-container-id" },
      );
      await vi.waitFor(() => {
        expect(readShutdownCheckpointPublicationBarrierState(userId)).toBe("entered");
      });

      abortController.abort(abortReason);
      expect(releaseShutdownCheckpointPublicationBarrier(userId)).toBe(true);
      await expect(heldPublication).rejects.toBe(abortReason);
      expect(realHandler).not.toHaveBeenCalled();
      expect(readShutdownCheckpointPublicationBarrierState(userId)).toBe("unarmed");
    } finally {
      releaseShutdownCheckpointPublicationBarrier(userId);
    }
  });

  it("keeps the hosted-local test composition out of the production worker entry graph", async () => {
    // @cloudflare/containers keys outboundByHost by class NAME, so importing
    // the hosted-local-test subclass anywhere in the production graph would
    // replace the production RunnerContainer registry entry with the
    // fake-AI-wrapped map. Pin that the production entry files never
    // reference the test composition.
    for (const sourcePath of ["../src/index.ts", "../src/runner-container.ts"]) {
      const source = await readFile(new URL(sourcePath, import.meta.url), "utf8");
      expect(source.includes("hosted-local-test"), sourcePath).toBe(false);
    }
  });

  it("injects the deterministic fake AI binding when env.AI is absent", async () => {
    const handler = readHostedLocalTestOutboundByHost()[
      HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.transcribe
    ];
    if (!handler) {
      throw new Error("Wrapped transcribe outbound handler is missing.");
    }

    const response = await handler(
      await createAuthorizedTranscribeRequest({
        body: "wav-bytes",
        headers: { "content-type": "audio/wav" },
        method: "POST",
      }),
      createOutboundEnv(),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      durationMs: 2_500,
      language: "en",
      segments: [
        { endMs: 1_400, startMs: 0, text: "Remember to" },
        { endMs: 2_500, startMs: 1_400, text: "log the voice note" },
      ],
      text: "Remember to log the voice note",
    });
  });

  it("passes a configured env.AI binding through instead of the fake", async () => {
    const handler = readHostedLocalTestOutboundByHost()[
      HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.transcribe
    ];
    if (!handler) {
      throw new Error("Wrapped transcribe outbound handler is missing.");
    }
    const aiRun = vi.fn(async (model: string, payload: Record<string, unknown>) => {
      expect(model).toBe("@cf/openai/whisper-large-v3-turbo");
      expect(typeof payload.audio).toBe("string");
      return {
        segments: [],
        text: "Real binding transcript",
        transcription_info: { duration: 1, language: "en" },
      };
    });

    const response = await handler(
      await createAuthorizedTranscribeRequest({
        body: "wav-bytes",
        method: "POST",
      }),
      createOutboundEnv({ AI: { run: aiRun } }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      text: "Real binding transcript",
    });
    expect(aiRun).toHaveBeenCalledTimes(1);
  });

  it("rejects empty audio bodies instead of fabricating the canned transcript", async () => {
    const handler = readHostedLocalTestOutboundByHost()[
      HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.transcribe
    ];
    if (!handler) {
      throw new Error("Wrapped transcribe outbound handler is missing.");
    }

    const response = await handler(
      await createAuthorizedTranscribeRequest({ method: "POST" }),
      createOutboundEnv(),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe(
      "Hosted transcription request body must include audio bytes.",
    );
  });
});
