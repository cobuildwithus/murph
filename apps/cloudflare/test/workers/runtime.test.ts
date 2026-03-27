import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHostedExecutionSignature } from "../../src/auth.js";
import { createHostedBundleStore } from "../../src/bundle-store.js";
import { createHostedExecutionJournalStore } from "../../src/execution-journal.js";
import { readHostedExecutionEnvironment } from "../../src/env.js";
import { handleRunnerOutboundRequest } from "../../src/runner-outbound.js";

import type {
  HostedExecutionDispatchRequest,
  HostedExecutionUserStatus,
} from "@healthybob/runtime-state";

interface UserRunnerRpcStub {
  clearUserEnv(userId: string): Promise<{ configuredUserEnvKeys: string[]; userId: string }>;
  dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus>;
  getUserEnvStatus(userId: string): Promise<{ configuredUserEnvKeys: string[]; userId: string }>;
  status(userId: string): Promise<HostedExecutionUserStatus>;
  updateUserEnv(
    userId: string,
    update: { env: Record<string, string | null>; mode: "merge" | "replace" },
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }>;
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
    await expect(getUserRunnerStub("member_invalid").status("member_invalid")).resolves.toMatchObject({
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
      await createSignedDispatchRequest("/internal/events", dispatch),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      bundleRefs: {
        agentState: expect.objectContaining({
          key: `users/${dispatch.event.userId}/agent-state.bundle.json`,
        }),
        vault: expect.objectContaining({
          key: `users/${dispatch.event.userId}/vault.bundle.json`,
        }),
      },
      lastEventId: "evt_signed_runtime",
      nextWakeAt: "2026-03-26T12:01:00.000Z",
      pendingEventCount: 0,
      retryingEventId: null,
      userId: dispatch.event.userId,
    });
    await expect(readBundleText(dispatch.event.userId, "agent-state")).resolves.toBe(
      `agent-state:${dispatch.eventId}`,
    );
    await expect(readBundleText(dispatch.event.userId, "vault")).resolves.toBe(
      `vault:${dispatch.eventId}`,
    );
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
      await expect(stub.status(userId)).resolves.toMatchObject({
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
    await expect(getUserRunnerStub(userId).getUserEnvStatus(userId)).resolves.toEqual({
      configuredUserEnvKeys: ["OPENAI_API_KEY"],
      userId,
    });
    await expect(getUserRunnerStub(userId).clearUserEnv(userId)).resolves.toEqual({
      configuredUserEnvKeys: [],
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
      linqChatId: "chat_123",
      normalizedPhoneNumber: "+15551234567",
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
      "x-hb-execution-signature": signature,
      "x-hb-execution-timestamp": timestamp,
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

async function readBundleText(userId: string, kind: "agent-state" | "vault"): Promise<string | null> {
  const bundle = await createBundleStore().readBundle(userId, kind);

  if (!bundle) {
    return null;
  }

  return new TextDecoder().decode(bundle);
}

function callRunnerOutbound(request: Request, userId: string): Promise<Response> {
  return handleRunnerOutboundRequest(
    request,
    env as unknown as Parameters<typeof handleRunnerOutboundRequest>[1],
    userId,
  );
}

function getUserRunnerStub(userId: string): UserRunnerRpcStub {
  return ((env as { USER_RUNNER: { getByName(name: string): UserRunnerRpcStub } }).USER_RUNNER)
    .getByName(userId);
}
