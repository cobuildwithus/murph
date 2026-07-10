import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";
import {
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
  armCanonicalCheckpointLostAck,
  armSnapshotPublicationCorruption,
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
  HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS,
  HOSTED_RUNNER_OUTBOUND_BY_HOST,
} from "../src/runner-egress-intercept.ts";
import {
  createHostedProviderEgressCredential,
} from "../src/hosted-provider-egress-credential.ts";
import {
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

function createSnapshotCompleteRequest(
  userId: string,
  encryptedObjectSha256 = "a".repeat(64),
  reason?: "canonical_runtime_commit" | "idle_shutdown",
): Request {
  return new Request(
    `http://${HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.workspaceSnapshotStore}`
      + "/workspace-snapshots/snapshot-test/complete",
    {
      body: JSON.stringify({
        archive: {
          encryptedObjectSha256,
        },
        checkpointRequest: reason ? { reason } : {},
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
} = {}): RunnerOutboundEnvironmentSource {
  return {
    ...createHostedExecutionTestEnv(),
    AI: input.AI,
    BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
    HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
      PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET,
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
        validateRuntimeWriteFence: async () => false,
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

describe("hosted-local test RunnerContainer outbound composition", () => {
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
        || host === HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.effectsPort
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

  it("accepts only nonempty PDF PUTs on the hosted-local Linq upload path", async () => {
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
      createSnapshotCompleteRequest(userId, originalSha256),
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
      createSnapshotCompleteRequest(userId, originalSha256),
      createOutboundEnv(),
      { containerId: "opaque-container-id" },
    );
    expect(cleanResponse.status).toBe(409);
    expect(observedSha256).toEqual([
      `0${originalSha256.slice(1)}`,
      originalSha256,
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
      createSnapshotCompleteRequest(userId),
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
            barrierKind: "shutdown_checkpoint_publication",
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
