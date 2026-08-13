import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { HostedAgentSessionService } from "../src/lib/hosted-agent-sessions";
import {
  IMESSAGE_MINI_APP_BEARER_TOKEN_PREFIX,
  IMessageMiniAppService,
  validateIMessageMiniAppEnrollmentBody,
  validateIMessageMiniAppMemberAction,
  type IMessageMiniAppSessionStore,
} from "../src/lib/imessage-mini-app/service";

const ACTIVE_SESSION = {
  id: "dsa_messages",
  userId: "member-1",
  label: "Murph Messages mini app",
  createdAt: "2026-07-10T12:00:00.000Z",
  updatedAt: "2026-07-10T12:00:00.000Z",
  expiresAt: "2026-07-11T12:00:00.000Z",
  lastSeenAt: "2026-07-10T12:00:00.000Z",
  revokedAt: null,
  revokeReason: null,
  replacedBySessionId: null,
};

function createStore(overrides: Partial<IMessageMiniAppSessionStore> = {}) {
  return {
    authenticateAgentSessionByTokenHash: vi.fn(async () => ({
      status: "active" as const,
      session: ACTIVE_SESSION,
    })),
    revokeAgentSession: vi.fn(async (input) => ({
      ...ACTIVE_SESSION,
      revokedAt: input.now,
      revokeReason: input.reason,
    })),
    ...overrides,
  } satisfies IMessageMiniAppSessionStore;
}

function createRequest(token?: string) {
  return new Request("https://example.test/api/device-sync/companion/imessage-mini-app/member-actions", {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    method: "POST",
  });
}

function validMessagesToken() {
  return `${IMESSAGE_MINI_APP_BEARER_TOKEN_PREFIX}${"a".repeat(43)}`;
}

function createHashIndexedStore(tokenHash: string) {
  const store = createStore({
    authenticateAgentSessionByTokenHash: vi.fn(async (candidateHash) => candidateHash === tokenHash
      ? {
          status: "active" as const,
          session: ACTIVE_SESSION,
        }
      : {
          status: "missing" as const,
          session: null,
        }),
  });

  return store;
}

async function authenticateWithHistoricalUnscopedAgentReader(
  token: string,
  store: IMessageMiniAppSessionStore,
) {
  return store.authenticateAgentSessionByTokenHash(
    createHash("sha256").update(token).digest("hex"),
    "2026-07-10T12:00:00.000Z",
  );
}

describe("iMessage mini-app service", () => {
  it("keeps a newly stored Messages credential unreachable to the historical unscoped device-agent reader", async () => {
    const token = validMessagesToken();
    const tokenHash = createHash("sha256")
      .update(`murph:imessage-mini-app:v1\0${token}`)
      .digest("hex");
    const store = createHashIndexedStore(tokenHash);
    const historicalAgentHash = createHash("sha256")
      .update(token)
      .digest("hex");

    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(tokenHash).not.toBe(historicalAgentHash);
    await expect(
      authenticateWithHistoricalUnscopedAgentReader(token, store),
    ).resolves.toEqual({ status: "missing", session: null });

    const memberAction = new IMessageMiniAppService({
      request: createRequest(token),
      store,
    });
    await expect(memberAction.requireCredential()).resolves.toEqual(ACTIVE_SESSION);
  });

  it("fails closed for a branch-era Messages row stored under the historical unscoped hash", async () => {
    const token = validMessagesToken();
    const historicalTokenHash = createHash("sha256").update(token).digest("hex");
    const store = createStore({
      authenticateAgentSessionByTokenHash: vi.fn(async (candidateHash) => (
        candidateHash === historicalTokenHash
          ? {
              status: "active" as const,
              session: ACTIVE_SESSION,
            }
          : {
              status: "missing" as const,
              session: null,
            }
      )),
    });
    const memberAction = new IMessageMiniAppService({
      request: createRequest(token),
      store,
    });

    await expect(memberAction.requireCredential()).rejects.toMatchObject({
      code: "IMESSAGE_MINI_APP_AUTH_INVALID",
      httpStatus: 401,
    });
    expect(store.authenticateAgentSessionByTokenHash).toHaveBeenCalledTimes(1);
    expect(store.authenticateAgentSessionByTokenHash).not.toHaveBeenCalledWith(
      historicalTokenHash,
      expect.any(String),
    );
  });

  it("accepts only an active Messages-scoped credential", async () => {
    const store = createStore();
    const service = new IMessageMiniAppService({
      request: createRequest(validMessagesToken()),
      store,
    });

    await expect(service.requireCredential()).resolves.toEqual(ACTIVE_SESSION);
    expect(store.authenticateAgentSessionByTokenHash).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f]{64}$/u),
      expect.any(String),
    );
  });

  it("rejects missing, malformed, and cross-scope credentials before a store lookup", async () => {
    for (const token of [undefined, "hbds_agent_active", "hbds_imessage_short"]) {
      const store = createStore();
      const service = new IMessageMiniAppService({ request: createRequest(token), store });

      await expect(service.requireCredential()).rejects.toMatchObject({
        httpStatus: 401,
      });
      expect(store.authenticateAgentSessionByTokenHash).not.toHaveBeenCalled();
    }
  });

  it("surfaces an expired credential distinctly", async () => {
    const store = createStore({
      authenticateAgentSessionByTokenHash: vi.fn(async () => ({
        status: "expired" as const,
        session: ACTIVE_SESSION,
      })),
    });
    const service = new IMessageMiniAppService({
      request: createRequest(validMessagesToken()),
      store,
    });

    await expect(service.requireCredential()).rejects.toMatchObject({
      code: "IMESSAGE_MINI_APP_AUTH_EXPIRED",
      httpStatus: 401,
    });
  });

  it("revokes the authenticated credential without returning token material", async () => {
    const token = validMessagesToken();
    const store = createStore();
    const service = new IMessageMiniAppService({ request: createRequest(token), store });

    await expect(service.revoke(ACTIVE_SESSION)).resolves.toEqual({
      schemaVersion: 1,
      revoked: true,
    });
    expect(store.revokeAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      expectedTokenHash: createHash("sha256")
        .update(`murph:imessage-mini-app:v1\0${token}`)
        .digest("hex"),
      reason: "imessage_app_request",
      sessionId: ACTIVE_SESSION.id,
    }));
  });

  it("keeps Messages credentials out of the more powerful device-agent scope", async () => {
    const store = createStore();
    const deviceAgentService = new HostedAgentSessionService({
      request: createRequest(validMessagesToken()),
      store: {
        ...store,
        async createAgentSession() {
          throw new Error("unused in this test");
        },
        async rotateAgentSession() {
          throw new Error("unused in this test");
        },
        async touchAgentSession() {
          throw new Error("unused in this test");
        },
      },
      pairPath: "/api/device-sync/agents/pair",
    });

    await expect(deviceAgentService.requireAgentSession()).rejects.toMatchObject({
      code: "AGENT_AUTH_INVALID",
      httpStatus: 401,
    });
    expect(store.authenticateAgentSessionByTokenHash).not.toHaveBeenCalled();
  });

  it("validates closed, versioned enrollment and member-action envelopes", () => {
    const now = new Date("2026-08-12T15:00:00.000Z");
    const request = validMemberActionRequest();
    expect(() => validateIMessageMiniAppEnrollmentBody({ schemaVersion: 1 })).not.toThrow();
    expect(validateIMessageMiniAppMemberAction(request, now)).toEqual(request);

    expect(() => validateIMessageMiniAppEnrollmentBody({
      schemaVersion: 1,
      token: "must-not-be-accepted",
    })).toThrowError(/unsupported fields/iu);
    expect(() => validateIMessageMiniAppMemberAction({
      ...request,
      token: "must-not-be-accepted",
    }, now)).toThrowError(/request is invalid/iu);
    expect(() => validateIMessageMiniAppMemberAction({
      ...request,
      actionId: "retry-1",
    }, now)).toThrowError(/request is invalid/iu);
    expect(() => validateIMessageMiniAppMemberAction({
      ...request,
      requestedAt: "2026-08-11T14:59:59.999Z",
    }, now)).toThrowError(/timestamp is outside/iu);
  });
});

function validMemberActionRequest() {
  return {
    action: {
      expectedWorkout: {
        actionBinding: "a".repeat(64),
        exercises: [{ name: "Leg press", sets: [{ logged: false }] }],
      },
      kind: "workout.live.apply" as const,
      mutations: [{
        exerciseName: "Leg press",
        exercisePosition: 1,
        expectedResult: null,
        kind: "set.put" as const,
        requiresExistingSet: true,
        result: {
          kind: "weight_reps" as const,
          reps: 8,
          weight: 180,
          weightUnit: "lb" as const,
        },
        setPosition: 1,
      }],
      version: 1 as const,
    },
    actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
    requestedAt: "2026-08-12T15:00:00.000Z",
    schemaVersion: 1 as const,
  };
}
