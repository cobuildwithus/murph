import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { HostedAgentSessionService } from "../src/lib/hosted-agent-sessions";
import {
  IMESSAGE_MINI_APP_BEARER_TOKEN_PREFIX,
  IMessageMiniAppService,
  validateIMessageMiniAppEnrollmentBody,
  validateIMessageMiniAppProofAction,
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
    createAgentSession: vi.fn(async (input) => ({
      ...ACTIVE_SESSION,
      createdAt: input.now ?? ACTIVE_SESSION.createdAt,
      updatedAt: input.now ?? ACTIVE_SESSION.updatedAt,
      expiresAt: input.expiresAt,
      userId: input.user.id,
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
  return new Request("https://example.test/api/device-sync/companion/imessage-mini-app/proof-action", {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    method: "POST",
  });
}

function validMessagesToken() {
  return `${IMESSAGE_MINI_APP_BEARER_TOKEN_PREFIX}${"a".repeat(43)}`;
}

function createHashIndexedStore() {
  let tokenHash: string | null = null;
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
    createAgentSession: vi.fn(async (input) => {
      tokenHash = input.tokenHash;
      return {
        ...ACTIVE_SESSION,
        createdAt: input.now ?? ACTIVE_SESSION.createdAt,
        updatedAt: input.now ?? ACTIVE_SESSION.updatedAt,
        expiresAt: input.expiresAt,
        userId: input.user.id,
      };
    }),
  });

  return {
    store,
    readTokenHash: () => tokenHash,
  };
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
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("mints a random 24-hour credential whose stored record contains only its hash", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    const store = createStore();
    const service = new IMessageMiniAppService({ request: createRequest(), store });

    const response = await service.enroll("member-1");
    const secondResponse = await service.enroll("member-1");

    expect(response.credential.token).toMatch(/^hbds_imessage_[A-Za-z0-9_-]{43}$/u);
    expect(secondResponse.credential.token).not.toBe(response.credential.token);
    expect(response.credential.expiresAt).toBe("2026-07-11T12:00:00.000Z");
    expect(store.createAgentSession).toHaveBeenNthCalledWith(1, expect.objectContaining({
      expiresAt: "2026-07-11T12:00:00.000Z",
      label: "Murph Messages mini app",
      tokenHash: createHash("sha256")
        .update(`murph:imessage-mini-app:v1\0${response.credential.token}`)
        .digest("hex"),
      user: { id: "member-1" },
    }));
    expect(JSON.stringify(vi.mocked(store.createAgentSession).mock.calls[0])).not.toContain(
      response.credential.token,
    );
  });

  it("keeps a newly stored Messages credential unreachable to the historical unscoped device-agent reader", async () => {
    const { store, readTokenHash } = createHashIndexedStore();
    const enrollment = new IMessageMiniAppService({ request: createRequest(), store });

    const response = await enrollment.enroll("member-1");
    const historicalAgentHash = createHash("sha256")
      .update(response.credential.token)
      .digest("hex");

    expect(readTokenHash()).toMatch(/^[0-9a-f]{64}$/u);
    expect(readTokenHash()).not.toBe(historicalAgentHash);
    await expect(
      authenticateWithHistoricalUnscopedAgentReader(response.credential.token, store),
    ).resolves.toEqual({ status: "missing", session: null });

    const proofAction = new IMessageMiniAppService({
      request: createRequest(response.credential.token),
      store,
    });
    await expect(proofAction.requireCredential()).resolves.toEqual(ACTIVE_SESSION);
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
    const proofAction = new IMessageMiniAppService({
      request: createRequest(token),
      store,
    });

    await expect(proofAction.requireCredential()).rejects.toMatchObject({
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
    const store = createStore();
    const service = new IMessageMiniAppService({ request: createRequest(), store });

    await expect(service.revoke(ACTIVE_SESSION)).resolves.toEqual({
      schemaVersion: 1,
      revoked: true,
    });
    expect(store.revokeAgentSession).toHaveBeenCalledWith(expect.objectContaining({
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

  it("validates closed, versioned enrollment and proof-action envelopes", () => {
    expect(() => validateIMessageMiniAppEnrollmentBody({ schemaVersion: 1 })).not.toThrow();
    expect(validateIMessageMiniAppProofAction({
      schemaVersion: 1,
      cardId: "privy-proof-v1",
      choice: "afternoon",
      idempotencyKey: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
    })).toEqual({
      schemaVersion: 1,
      cardId: "privy-proof-v1",
      choice: "afternoon",
      idempotencyKey: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
    });

    expect(() => validateIMessageMiniAppEnrollmentBody({
      schemaVersion: 1,
      token: "must-not-be-accepted",
    })).toThrowError(/unsupported fields/iu);
    expect(() => validateIMessageMiniAppProofAction({
      schemaVersion: 1,
      cardId: "privy-proof-v1",
      choice: "anything",
      idempotencyKey: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
    })).toThrowError(/choice is not supported/iu);
    expect(() => validateIMessageMiniAppProofAction({
      schemaVersion: 1,
      cardId: "privy-proof-v1",
      choice: "morning",
      idempotencyKey: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
      token: "must-not-be-accepted",
    })).toThrowError(/unsupported fields/iu);
    expect(() => validateIMessageMiniAppProofAction({
      schemaVersion: 1,
      cardId: "privy-proof-v1",
      choice: "morning",
      idempotencyKey: "retry-1",
    })).toThrowError(/idempotencyKey must be a UUID/iu);
  });
});
