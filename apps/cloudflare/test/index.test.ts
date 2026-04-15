import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostedExecutionDispatchRequest } from "@murphai/hosted-execution";
import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";

import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures";

const mockedAuth = vi.hoisted(() => ({
  verifyHostedExecutionVercelOidcRequest: vi.fn(async () => true),
}));

vi.mock("../src/auth-adapter.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/auth-adapter.ts")>(
    "../src/auth-adapter.ts",
  );

  return {
    ...actual,
    verifyHostedExecutionVercelOidcRequest: mockedAuth.verifyHostedExecutionVercelOidcRequest,
  };
});

const { default: worker } = await import("../src/index.ts");

afterEach(() => {
  mockedAuth.verifyHostedExecutionVercelOidcRequest.mockReset().mockResolvedValue(true);
  vi.restoreAllMocks();
});

describe("cloudflare worker routes", () => {
  it("serves the service banner for root and health and 404s unknown routes", async () => {
    const rootResponse = await worker.fetch(
      new Request("https://runner.example.test/"),
      {} as never,
    );

    expect(rootResponse.status).toBe(200);
    await expect(rootResponse.json()).resolves.toEqual({
      ok: true,
      service: "cloudflare-hosted-runner",
    });

    const healthResponse = await worker.fetch(
      new Request("https://runner.example.test/health"),
      {} as never,
    );

    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toEqual({
      ok: true,
      service: "cloudflare-hosted-runner",
    });

    const unknownResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/events"),
      createWorkerEnv(),
    );

    expect(unknownResponse.status).toBe(404);
    await expect(unknownResponse.json()).resolves.toEqual({
      error: "Not found",
    });
  });

  it("dispatches through the canonical internal dispatch route", async () => {
    const stub = createUserRunnerStub();
    const dispatch = createDispatch("evt_123");

    const response = await worker.fetch(
      createInternalRequest("/internal/dispatch", {
        body: JSON.stringify(dispatch),
        headers: {
          "content-type": "application/json; charset=utf-8",
          [HOSTED_EXECUTION_USER_ID_HEADER]: dispatch.event.userId,
        },
        method: "POST",
      }),
      createWorkerEnv(stub),
    );

    expect(response.status).toBe(200);
    expect(stub.dispatchWithOutcome).toHaveBeenCalledWith(dispatch);
  });

  it("rejects dispatches when OIDC auth fails or the bound user header is missing", async () => {
    const stub = createUserRunnerStub();
    const dispatch = createDispatch("evt_123");

    mockedAuth.verifyHostedExecutionVercelOidcRequest.mockResolvedValueOnce(false);
    const unauthorizedResponse = await worker.fetch(
      createInternalRequest("/internal/dispatch", {
        body: JSON.stringify(dispatch),
        headers: {
          "content-type": "application/json; charset=utf-8",
          [HOSTED_EXECUTION_USER_ID_HEADER]: dispatch.event.userId,
        },
        method: "POST",
      }),
      createWorkerEnv(stub),
    );

    expect(unauthorizedResponse.status).toBe(401);

    const missingHeaderResponse = await worker.fetch(
      createInternalRequest("/internal/dispatch", {
        body: JSON.stringify(dispatch),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      createWorkerEnv(stub),
    );

    expect(missingHeaderResponse.status).toBe(401);
    await expect(missingHeaderResponse.json()).resolves.toEqual({
      error: `${HOSTED_EXECUTION_USER_ID_HEADER} header is required for hosted execution user-bound control routes.`,
    });
    expect(stub.dispatchWithOutcome).not.toHaveBeenCalled();
  });

  it("injects the route user into manual runs and returns 429 when the queue backpressures", async () => {
    const stub = createUserRunnerStub({
      dispatch: vi.fn(async (input: HostedExecutionDispatchRequest) => ({
        backpressuredEventIds: [input.eventId],
        bundleRef: null,
        inFlight: false,
        lastError: null,
        lastEventId: input.eventId,
        lastRunAt: null,
        nextWakeAt: null,
        pendingEventCount: 1,
        poisonedEventIds: [],
        retryingEventId: null,
        userId: input.event.userId,
      })),
    });

    const response = await worker.fetch(
      createInternalRequest("/internal/users/member_123/run", {
        body: JSON.stringify({ note: "manual" }),
        headers: {
          [HOSTED_EXECUTION_USER_ID_HEADER]: "member_123",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      createWorkerEnv(stub),
    );

    expect(response.status).toBe(429);
    expect(stub.dispatch).toHaveBeenCalledTimes(1);
    expect(stub.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      }),
      eventId: expect.stringMatching(/^manual:/u),
    }));
  });

  it("reads canonical per-user status and per-event status from the durable object", async () => {
    const stub = createUserRunnerStub({
      getEventStatus: vi.fn(async ({ eventId }: { eventId: string }) => ({
        acknowledgedAt: "2026-04-16T10:05:00.000Z",
        eventId,
        state: "completed",
      })),
      status: vi.fn(async () => ({
        backpressuredEventIds: [],
        bundleRef: null,
        inFlight: false,
        lastError: null,
        lastEventId: "evt_done",
        lastRunAt: "2026-04-16T10:05:00.000Z",
        nextWakeAt: null,
        pendingEventCount: 0,
        poisonedEventIds: [],
        retryingEventId: null,
        userId: "member_123",
      })),
    });

    const statusResponse = await worker.fetch(
      createInternalRequest("/internal/users/member_123/status", {
        headers: {
          [HOSTED_EXECUTION_USER_ID_HEADER]: "member_123",
        },
        method: "GET",
      }),
      createWorkerEnv(stub),
    );

    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toMatchObject({
      lastEventId: "evt_done",
      userId: "member_123",
    });

    const eventStatusResponse = await worker.fetch(
      createInternalRequest("/internal/users/member_123/events/evt_done/status", {
        headers: {
          [HOSTED_EXECUTION_USER_ID_HEADER]: "member_123",
        },
        method: "GET",
      }),
      createWorkerEnv(stub),
    );

    expect(eventStatusResponse.status).toBe(200);
    await expect(eventStatusResponse.json()).resolves.toEqual({
      acknowledgedAt: "2026-04-16T10:05:00.000Z",
      eventId: "evt_done",
      state: "completed",
    });
  });
});

function createInternalRequest(
  path: string,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers ?? {});
  headers.set("authorization", "Bearer test-oidc-token");

  return new Request(`https://runner.example.test${path}`, {
    ...init,
    headers,
  });
}

function createWorkerEnv(
  stub = createUserRunnerStub(),
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    ...createHostedExecutionTestEnv(),
    BUNDLES: createBucketStore(),
    RUNNER_CONTAINER: {
      getByName() {
        return {
          async destroyInstance() {},
          async invoke() {
            throw new Error("Runner container should not be invoked by route tests.");
          },
        };
      },
    },
    USER_RUNNER: {
      getByName() {
        return stub;
      },
    },
    ...overrides,
  } as never;
}

function createBucketStore() {
  return {
    async delete() {},
    async get() {
      return null;
    },
    async put() {},
  };
}

function createDispatch(eventId: string): HostedExecutionDispatchRequest {
  return {
    event: {
      kind: "assistant.cron.tick",
      reason: "manual",
      userId: "member_123",
    },
    eventId,
    occurredAt: "2026-04-16T10:00:00.000Z",
  };
}

function createUserRunnerStub(overrides: Record<string, unknown> = {}) {
  return {
    bootstrapUser: vi.fn(async (userId: string) => ({ userId })),
    dispatch: vi.fn(async (input: HostedExecutionDispatchRequest) => ({
      backpressuredEventIds: [],
      bundleRef: null,
      inFlight: false,
      lastError: null,
      lastEventId: input.eventId,
      lastRunAt: null,
      nextWakeAt: null,
      pendingEventCount: 0,
      poisonedEventIds: [],
      retryingEventId: null,
      userId: input.event.userId,
    })),
    dispatchWithOutcome: vi.fn(async (input: HostedExecutionDispatchRequest) => ({
      event: {
        acknowledgedAt: "2026-04-16T10:00:00.000Z",
        eventId: input.eventId,
        state: "queued" as const,
      },
      status: {
        backpressuredEventIds: [],
        bundleRef: null,
        inFlight: false,
        lastError: null,
        lastEventId: input.eventId,
        lastRunAt: null,
        nextWakeAt: null,
        pendingEventCount: 1,
        poisonedEventIds: [],
        retryingEventId: null,
        userId: input.event.userId,
      },
    })),
    getEventStatus: vi.fn(async ({ eventId }: { eventId: string }) => ({
      acknowledgedAt: "2026-04-16T10:00:00.000Z",
      eventId,
      state: "queued" as const,
    })),
    status: vi.fn(async () => ({
      backpressuredEventIds: [],
      bundleRef: null,
      inFlight: false,
      lastError: null,
      lastEventId: null,
      lastRunAt: null,
      nextWakeAt: null,
      pendingEventCount: 0,
      poisonedEventIds: [],
      retryingEventId: null,
      userId: "member_123",
    })),
    ...overrides,
  };
}
