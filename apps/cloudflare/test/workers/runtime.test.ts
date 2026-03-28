import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHostedExecutionSignature } from "../../src/auth.js";
import { createHostedBundleStore } from "../../src/bundle-store.js";
import { createHostedExecutionJournalStore } from "../../src/execution-journal.js";
import { readHostedExecutionEnvironment } from "../../src/env.js";
import { handleRunnerOutboundRequest } from "../../src/runner-outbound.js";

const RUNNER_PROXY_TOKEN = "runner-proxy-token";
const RUNNER_PROXY_TOKEN_HEADER = "x-hosted-execution-runner-proxy-token";

import type {
  HostedExecutionDispatchResult,
  HostedExecutionDispatchRequest,
  HostedExecutionBundleRef,
  HostedExecutionUserStatus,
} from "@murph/runtime-state";

interface UserRunnerRpcStub {
  bootstrapUser(userId: string): Promise<{ userId: string }>;
  clearUserEnv(): Promise<{ configuredUserEnvKeys: string[]; userId: string }>;
  dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus>;
  dispatchWithOutcome(input: HostedExecutionDispatchRequest): Promise<HostedExecutionDispatchResult>;
  getUserEnvStatus(): Promise<{ configuredUserEnvKeys: string[]; userId: string }>;
  status(): Promise<HostedExecutionUserStatus>;
  updateUserEnv(update: { env: Record<string, string | null>; mode: "merge" | "replace" }): Promise<{
    configuredUserEnvKeys: string[];
    userId: string;
  }>;
}

describe("cloudflare worker runtime suite", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("rejects invalid signed dispatches before they reach the user runner", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));

    const response = await exports.default.fetch(
      await createSignedDispatchRequest("/internal/dispatch", createDispatch("evt_invalid"), {
        timestamp: "2026-03-26T11:50:00.000Z",
      }),
    );

    expect(response.status).toBe(401);
    const stub = getUserRunnerStub("member_invalid");
    await expect(stub.bootstrapUser("member_invalid")).resolves.toEqual({
      userId: "member_invalid",
    });
    await expect(stub.status()).resolves.toMatchObject({
      lastEventId: null,
      pendingEventCount: 0,
      userId: "member_invalid",
    });
  });

  it("accepts signed dispatches in the Workers runtime and writes durable bundle state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));

    const dispatch = createDispatch("evt_signed_runtime");
    const response = await exports.default.fetch(
      await createSignedDispatchRequest("/internal/dispatch", dispatch),
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as HostedExecutionDispatchResult;
    expect(payload).toMatchObject({
      event: {
        eventId: "evt_signed_runtime",
        state: "completed",
      },
      status: {
        bundleRefs: {
          agentState: expect.objectContaining({
            key: expect.stringMatching(/^bundles\/agent-state\/[0-9a-f]+\.bundle\.json$/u),
          }),
          vault: expect.objectContaining({
            key: expect.stringMatching(/^bundles\/vault\/[0-9a-f]+\.bundle\.json$/u),
          }),
        },
        lastEventId: "evt_signed_runtime",
        nextWakeAt: "2026-03-26T12:01:00.000Z",
        pendingEventCount: 0,
        retryingEventId: null,
        userId: dispatch.event.userId,
      },
    });
    await expect(readBundleText(payload.status.bundleRefs.agentState)).resolves.toBe(
      `agent-state:${dispatch.eventId}`,
    );
    await expect(readBundleText(payload.status.bundleRefs.vault)).resolves.toBe(
      `vault:${dispatch.eventId}`,
    );
  });

  it("keeps the removed internal events alias hidden in the Workers runtime", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const userId = "member_removed_alias";

    const response = await exports.default.fetch(
      await createSignedDispatchRequest("/internal/events", createDispatch("evt_removed_alias", userId)),
    );

    expect(response.status).toBe(404);
    await expect(getUserRunnerStub(userId).bootstrapUser(userId)).resolves.toEqual({
      userId,
    });
    await expect(getUserRunnerStub(userId).status()).resolves.toMatchObject({
      lastEventId: null,
      pendingEventCount: 0,
      userId,
    });
  });

  it("supports direct Durable Object RPC and alarm execution inside the Workers runtime", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));

    const userId = "member_alarm";
    const stub = getUserRunnerStub(userId);
    const initialStatus = await stub.dispatch(createDispatch("evt_alarm_seed", userId));

    expect(initialStatus.lastEventId).toBe("evt_alarm_seed");
    await expect(runDurableObjectAlarm(stub as never)).resolves.toBeTypeOf("boolean");
    await vi.waitFor(async () => {
      await expect(stub.status()).resolves.toMatchObject({
        lastEventId: expect.stringMatching(/^alarm:/u),
        pendingEventCount: 0,
        retryingEventId: null,
        userId,
      });
    });
  });

  it("supports operator control routes for manual runs and per-user env updates", async () => {
    const userId = "member_control";

    const envUpdateResponse = await exports.default.fetch(
      new Request(`https://runner.example.test/internal/users/${userId}/env`, {
        body: JSON.stringify({
          env: {
            OPENAI_API_KEY: "test-key",
          },
          mode: "merge",
        }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
    );

    expect(envUpdateResponse.status).toBe(200);
    await expect(envUpdateResponse.json()).resolves.toEqual({
      configuredUserEnvKeys: ["OPENAI_API_KEY"],
      userId,
    });

    const statusResponse = await exports.default.fetch(
      new Request(`https://runner.example.test/internal/users/${userId}/run`, {
        body: JSON.stringify({ note: "manual" }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
    );

    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toMatchObject({
      lastEventId: expect.stringMatching(/^manual:/u),
      pendingEventCount: 0,
      userId,
    });
    await expect(getUserRunnerStub(userId).getUserEnvStatus()).resolves.toEqual({
      configuredUserEnvKeys: ["OPENAI_API_KEY"],
      userId,
    });
    await expect(getUserRunnerStub(userId).clearUserEnv()).resolves.toEqual({
      configuredUserEnvKeys: [],
      userId,
    });
  });

  it("rejects removed and unknown hosted user env keys at the worker control boundary", async () => {
    const userId = "member_control_env_reject";

    const rejectedResponse = await exports.default.fetch(
      new Request(`https://runner.example.test/internal/users/${userId}/env`, {
        body: JSON.stringify({
          env: {
            AGENTMAIL_API_BASE_URL: "https://legacy-mail.example.test/v0",
            AGENTMAIL_TIMEOUT_MS: "5000",
            FFMPEG_THREADS: "2",
            PARSER_FFMPEG_PATH: "/usr/local/bin/ffmpeg",
          },
          mode: "merge",
        }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
    );

    expect(rejectedResponse.status).toBe(400);
    await expect(rejectedResponse.json()).resolves.toEqual({
      error: "Hosted user env key is not allowed: AGENTMAIL_API_BASE_URL",
    });
    await expect(getUserRunnerStub(userId).getUserEnvStatus()).resolves.toEqual({
      configuredUserEnvKeys: [],
      userId,
    });

    const acceptedResponse = await exports.default.fetch(
      new Request(`https://runner.example.test/internal/users/${userId}/env`, {
        body: JSON.stringify({
          env: {
            AGENTMAIL_API_KEY: "agentmail-secret",
            AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
            FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
          },
          mode: "merge",
        }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
    );

    expect(acceptedResponse.status).toBe(200);
    await expect(acceptedResponse.json()).resolves.toEqual({
      configuredUserEnvKeys: [
        "AGENTMAIL_API_KEY",
        "AGENTMAIL_BASE_URL",
        "FFMPEG_COMMAND",
      ],
      userId,
    });
  });

  it("persists bundle journaling through the internal runner outbound handlers in the Workers runtime", async () => {
    const userId = "member_journal";
    const eventId = "evt_finalize_runtime";

    const commitResponse = await callRunnerOutbound(
      new Request(`http://commit.worker/events/${eventId}/commit`, {
        body: JSON.stringify({
          bundles: {
            agentState: btoa("agent-state-commit"),
            vault: btoa("vault-commit"),
          },
          currentBundleRefs: {
            agentState: null,
            vault: null,
          },
          result: {
            eventsHandled: 1,
            summary: "committed",
          },
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      userId,
    );

    expect(commitResponse.status).toBe(200);

    const finalizeResponse = await callRunnerOutbound(
      new Request(`http://commit.worker/events/${eventId}/finalize`, {
        body: JSON.stringify({
          bundles: {
            agentState: btoa("agent-state-final"),
            vault: btoa("vault-final"),
          },
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      userId,
    );

    expect(finalizeResponse.status).toBe(200);
    await expect(createJournalStore().readCommittedResult(userId, eventId)).resolves.toMatchObject({
      eventId,
      finalizedAt: expect.any(String),
      result: {
        summary: "committed",
      },
    });
  });
});

function createDispatch(
  eventId: string,
  userId = "member_invalid",
): HostedExecutionDispatchRequest {
  return {
    event: {
      kind: "member.activated",
      userId,
    },
    eventId,
    occurredAt: "2026-03-26T12:00:00.000Z",
  };
}

async function createSignedDispatchRequest(
  path: string,
  dispatch: HostedExecutionDispatchRequest,
  input: {
    timestamp?: string;
  } = {},
): Promise<Request> {
  const payload = JSON.stringify(dispatch);
  const timestamp = input.timestamp ?? "2026-03-26T12:00:00.000Z";
  const signature = await createHostedExecutionSignature({
    payload,
    secret: "dispatch-secret",
    timestamp,
  });

  return new Request(`https://runner.example.test${path}`, {
    body: payload,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-hosted-execution-signature": signature,
      "x-hosted-execution-timestamp": timestamp,
    },
    method: "POST",
  });
}

function createJournalStore() {
  const environment = readHostedExecutionEnvironment(
    env as unknown as Readonly<Record<string, string | undefined>>,
  );
  return createHostedExecutionJournalStore({
    bucket: (env as { BUNDLES: never }).BUNDLES,
    key: environment.bundleEncryptionKey,
    keyId: environment.bundleEncryptionKeyId,
  });
}

function createBundleStore() {
  const environment = readHostedExecutionEnvironment(
    env as unknown as Readonly<Record<string, string | undefined>>,
  );
  return createHostedBundleStore({
    bucket: (env as { BUNDLES: never }).BUNDLES,
    key: environment.bundleEncryptionKey,
    keyId: environment.bundleEncryptionKeyId,
  });
}

async function readBundleText(bundleRef: HostedExecutionBundleRef | null): Promise<string | null> {
  const bundle = await createBundleStore().readBundle(bundleRef);

  if (!bundle) {
    return null;
  }

  return new TextDecoder().decode(bundle);
}

function callRunnerOutbound(request: Request, userId: string): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set(RUNNER_PROXY_TOKEN_HEADER, RUNNER_PROXY_TOKEN);
  return handleRunnerOutboundRequest(
    new Request(request, { headers }),
    env as unknown as Parameters<typeof handleRunnerOutboundRequest>[1],
    userId,
    RUNNER_PROXY_TOKEN,
  );
}

function getUserRunnerStub(userId: string): UserRunnerRpcStub {
  return ((env as { USER_RUNNER: { getByName(name: string): UserRunnerRpcStub } }).USER_RUNNER)
    .getByName(userId);
}
