import { createHash } from "node:crypto";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import { isRecord } from "../src/lib/primitives";
import { createBearerRequest } from "./route-test-helpers";

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
const MESSAGES_TOKEN = `hbds_imessage_${"a".repeat(43)}`;

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  assertActiveHostedMemberAccessAllowed: vi.fn(),
  assertHostedHistoricalLaunchConsentGranted: vi.fn(),
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  authenticateAgentSessionByTokenHash: vi.fn(),
  readJsonObject: vi.fn(async (request: Request) => await request.json()),
  readHostedMailboxWakeByDedupeKey: vi.fn(),
  requirePrivyMemberAuthFromBearerToken: vi.fn(),
  revokeAgentSession: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  transaction: vi.fn(),
  transactionQuery: vi.fn(async () => []),
  upsertAgentSession: vi.fn(),
}));

const transactionClient = {
  $queryRaw: mocks.transactionQuery,
  deviceAgentSession: {
    upsert: mocks.upsertAgentSession,
  },
  marker: "transaction",
};
const prisma = {
  $transaction: mocks.transaction,
  marker: "prisma",
};

mocks.transaction.mockImplementation(async (
  callback: (tx: typeof transactionClient) => Promise<unknown>,
) => await callback(transactionClient));

vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => prisma }));
vi.mock("@/src/lib/http", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/http")>(),
  readJsonObject: mocks.readJsonObject,
}));
vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requirePrivyMemberAuthFromBearerToken:
    mocks.requirePrivyMemberAuthFromBearerToken,
}));
vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  assertActiveHostedMemberAccessAllowed: mocks.assertActiveHostedMemberAccessAllowed,
}));
vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedHistoricalLaunchConsentGranted: mocks.assertHostedHistoricalLaunchConsentGranted,
  assertHostedLaunchRequiredConsentGranted: mocks.assertHostedLaunchRequiredConsentGranted,
}));
vi.mock("@/src/lib/device-sync/prisma-store/agent-sessions", () => ({
  PrismaHostedAgentSessionStore: class {
    authenticateAgentSessionByTokenHash = mocks.authenticateAgentSessionByTokenHash;
    revokeAgentSession = mocks.revokeAgentSession;
  },
}));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
  readHostedMailboxWakeByDedupeKey: mocks.readHostedMailboxWakeByDedupeKey,
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

type EnrollmentRoute = typeof import("../app/api/device-sync/companion/imessage-mini-app/enrollment/route");
type MemberActionRoute = typeof import("../app/api/device-sync/companion/imessage-mini-app/member-actions/route");
type MemberActionStatusRoute = typeof import("../app/api/device-sync/companion/imessage-mini-app/member-actions/[actionId]/route");

let enrollmentRoute: EnrollmentRoute;
let memberActionRoute: MemberActionRoute;
let memberActionStatusRoute: MemberActionStatusRoute;

function jsonRequest(url: string, token: string, method: "POST" | "DELETE", body?: unknown) {
  return createBearerRequest(url, token, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    method,
  });
}

describe("iMessage mini-app routes", () => {
  beforeAll(async () => {
    enrollmentRoute = await import("../app/api/device-sync/companion/imessage-mini-app/enrollment/route");
    memberActionRoute = await import("../app/api/device-sync/companion/imessage-mini-app/member-actions/route");
    memberActionStatusRoute = await import("../app/api/device-sync/companion/imessage-mini-app/member-actions/[actionId]/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readJsonObject.mockImplementation(async (request: Request) =>
      await request.json()
    );
    mocks.requirePrivyMemberAuthFromBearerToken.mockResolvedValue({
      member: { id: "member-1" },
    });
    mocks.upsertAgentSession.mockImplementation(async (input) => ({
      ...input.create,
      revokedAt: null,
      revokeReason: null,
      replacedBySessionId: null,
    }));
    mocks.authenticateAgentSessionByTokenHash.mockResolvedValue({
      status: "active",
      session: ACTIVE_SESSION,
    });
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: {
        id: "mailbox-action-1",
        lane: "system",
        laneSeq: "7",
      },
    });
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member-1",
    });
    mocks.readHostedMailboxWakeByDedupeKey.mockResolvedValue(null);
    mocks.revokeAgentSession.mockResolvedValue({
      ...ACTIVE_SESSION,
      revokedAt: "2026-07-10T12:10:00.000Z",
      revokeReason: "imessage_app_request",
    });
  });

  it("exchanges a verified Privy member session for a scoped derived credential", async () => {
    const request = jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/enrollment",
      "privy-identity-proof",
      "POST",
      { schemaVersion: 1 },
    );

    const response = await enrollmentRoute.POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.requirePrivyMemberAuthFromBearerToken).toHaveBeenCalledWith(
      request,
      prisma,
    );
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: "member-1",
      prisma: transactionClient,
    });
    expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenCalledWith({
      memberId: "member-1",
      prisma: transactionClient,
    });
    expect(mocks.transactionQuery).toHaveBeenCalledTimes(2);
    expect(mocks.upsertAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ userId: "member-1" }),
      update: expect.objectContaining({ userId: "member-1" }),
    }));
    expect(invocationOrder(mocks.transactionQuery, 1)).toBeLessThan(
      invocationOrder(mocks.assertActiveHostedMemberAccessAllowed),
    );
    expect(invocationOrder(mocks.assertActiveHostedMemberAccessAllowed)).toBeLessThan(
      invocationOrder(mocks.assertHostedLaunchRequiredConsentGranted),
    );
    expect(invocationOrder(mocks.assertHostedLaunchRequiredConsentGranted)).toBeLessThan(
      invocationOrder(mocks.upsertAgentSession),
    );
    expect(body).toMatchObject({
      schemaVersion: 1,
      credential: {
        token: expect.stringMatching(/^hbds_imessage_/u),
      },
    });
    expect(JSON.stringify(body)).not.toContain("privy-identity-proof");
  });

  it("finishes and validates the bounded enrollment body before identity or authority reads", async () => {
    const body = deferred<Record<string, unknown>>();
    mocks.readJsonObject.mockReturnValueOnce(body.promise);
    const request = jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/enrollment",
      "privy-identity-proof",
      "POST",
      { schemaVersion: 1 },
    );

    const responsePromise = enrollmentRoute.POST(request);
    await Promise.resolve();

    expect(mocks.requirePrivyMemberAuthFromBearerToken).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();

    body.resolve({ schemaVersion: 1 });
    await expect(responsePromise).resolves.toMatchObject({ status: 200 });
    expect(mocks.readJsonObject).toHaveBeenCalledWith(request, {
      limitBytes: 1_024,
    });
  });

  it("mints a fresh scoped hash-only credential inside each fenced transaction", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    try {
      const firstResponse = await enrollmentRoute.POST(jsonRequest(
        "https://example.test/api/device-sync/companion/imessage-mini-app/enrollment",
        "privy-identity-proof",
        "POST",
        { schemaVersion: 1 },
      ));
      const secondResponse = await enrollmentRoute.POST(jsonRequest(
        "https://example.test/api/device-sync/companion/imessage-mini-app/enrollment",
        "privy-identity-proof",
        "POST",
        { schemaVersion: 1 },
      ));
      const firstBody = await firstResponse.json();
      const secondBody = await secondResponse.json();
      const firstToken = readCredentialToken(firstBody);
      const secondToken = readCredentialToken(secondBody);

      expect(firstToken).toMatch(/^hbds_imessage_[A-Za-z0-9_-]{43}$/u);
      expect(secondToken).not.toBe(firstToken);
      expect(firstBody).toMatchObject({
        credential: { expiresAt: "2026-07-11T12:00:00.000Z" },
      });
      const expectedSessionId = `dsa_imessage_${createHash("sha256")
        .update("murph:imessage-mini-app:session:v1\0member-1")
        .digest("hex")}`;
      expect(mocks.upsertAgentSession).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: expectedSessionId },
          create: expect.objectContaining({
            id: expectedSessionId,
            userId: "member-1",
            expiresAt: new Date("2026-07-11T12:00:00.000Z"),
            label: "Murph Messages mini app",
            tokenHash: createHash("sha256")
              .update(`murph:imessage-mini-app:v1\0${firstToken}`)
              .digest("hex"),
          }),
          update: expect.objectContaining({
            createdAt: new Date("2026-07-10T12:00:00.000Z"),
            expiresAt: new Date("2026-07-11T12:00:00.000Z"),
            revokedAt: null,
            revokeReason: null,
            replacedBySessionId: null,
          }),
        }),
      );
      expect(mocks.upsertAgentSession.mock.calls[1]?.[0]).toMatchObject({
        where: { id: expectedSessionId },
      });
      expect(JSON.stringify(mocks.upsertAgentSession.mock.calls)).not.toContain(firstToken);
      expect(JSON.stringify(mocks.upsertAgentSession.mock.calls)).not.toContain(secondToken);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an invalid enrollment envelope before identity or authority reads", async () => {
    const response = await enrollmentRoute.POST(jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/enrollment",
      "privy-identity-proof",
      "POST",
      { schemaVersion: 2 },
    ));

    expect(response.status).toBe(400);
    expect(mocks.requirePrivyMemberAuthFromBearerToken).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("fails enrollment closed when the locked member no longer has active access", async () => {
    mocks.assertActiveHostedMemberAccessAllowed.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "An active Murph plan is required.",
    }));

    const response = await enrollmentRoute.POST(jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/enrollment",
      "privy-identity-proof",
      "POST",
      { schemaVersion: 1 },
    ));

    expect(response.status).toBe(403);
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
    expect(mocks.upsertAgentSession).not.toHaveBeenCalled();
  });

  it("fails enrollment closed when launch consent is no longer current", async () => {
    mocks.assertHostedLaunchRequiredConsentGranted.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_CONSENT_REQUIRED",
      httpStatus: 403,
      message: "Accept the current Murph legal consent before continuing.",
    }));

    const response = await enrollmentRoute.POST(jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/enrollment",
      "privy-identity-proof",
      "POST",
      { schemaVersion: 1 },
    ));

    expect(response.status).toBe(403);
    expect(mocks.upsertAgentSession).not.toHaveBeenCalled();
  });

  it("durably accepts a typed member action before signaling the runtime", async () => {
    const request = jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/member-actions",
      MESSAGES_TOKEN,
      "POST",
      validMemberActionRequest(),
    );

    const response = await memberActionRoute.POST(request);

    expect(response.status).toBe(202);
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: "member-1",
      prisma: transactionClient,
    });
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).toHaveBeenCalledWith({
      memberId: "member-1",
      prisma: transactionClient,
    });
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "member.action.requested:2f1c1fdc-c7b0-4d90-b902-8e6295959243",
        kind: "member.action.requested",
        userId: "member-1",
      }),
      tx: transactionClient,
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member-1",
      knownCheckpoint: {
        lane: "system",
        laneSeq: "7",
        userId: "member-1",
      },
      mailboxItemId: "mailbox-action-1",
      prisma,
    });
    expect(invocationOrder(mocks.appendHostedMailboxEnvelopeTx)).toBeLessThan(
      invocationOrder(mocks.signalHostedMailboxAppendRuntime),
    );
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
      duplicate: false,
      schemaVersion: 1,
    });
  });

  it("fails closed when the credential owner no longer has active account access", async () => {
    mocks.assertActiveHostedMemberAccessAllowed.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "An active Murph plan is required.",
    }));

    const response = await memberActionRoute.POST(jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/member-actions",
      MESSAGES_TOKEN,
      "POST",
      validMemberActionRequest(),
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "HOSTED_ACCESS_REQUIRED" },
    });
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("re-signals an exact duplicate action with the original stable timestamp", async () => {
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: true,
      inserted: false,
      item: {
        id: "mailbox-action-1",
        lane: "system",
        laneSeq: "7",
      },
    });
    const body = validMemberActionRequest();

    const response = await memberActionRoute.POST(jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/member-actions",
      MESSAGES_TOKEN,
      "POST",
      body,
    ));

    expect(response.status).toBe(202);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({ occurredAt: body.requestedAt }),
      tx: transactionClient,
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({ duplicate: true });
  });

  it("reads pending and terminal action status from the authenticated member mailbox", async () => {
    const actionId = "2f1c1fdc-c7b0-4d90-b902-8e6295959243";
    const request = createBearerRequest(
      `https://example.test/api/device-sync/companion/imessage-mini-app/member-actions/${actionId}`,
      MESSAGES_TOKEN,
      { method: "GET" },
    );

    const pending = await memberActionStatusRoute.GET(request, {
      params: Promise.resolve({ actionId }),
    });
    expect(pending.status).toBe(200);
    await expect(pending.json()).resolves.toEqual({
      actionId,
      schemaVersion: 1,
      status: "pending",
    });

    mocks.readHostedMailboxWakeByDedupeKey.mockResolvedValueOnce({
      eventId: `member.action.completed:${actionId}`,
      kind: "member.action.completed",
      occurredAt: "2026-08-12T15:00:01.000Z",
      outcome: {
        actionId,
        completedAt: "2026-08-12T15:00:01.000Z",
        reason: null,
        schemaVersion: 1,
        status: "applied",
      },
      userId: "member-1",
    });
    const terminal = await memberActionStatusRoute.GET(request, {
      params: Promise.resolve({ actionId }),
    });
    await expect(terminal.json()).resolves.toMatchObject({
      actionId,
      status: "applied",
    });
    expect(mocks.readHostedMailboxWakeByDedupeKey).toHaveBeenLastCalledWith({
      dedupeKey: `member.action.completed:${actionId}`,
      prisma,
      userId: "member-1",
    });
  });

  it("rejects a malformed member action status identity", async () => {
    const response = await memberActionStatusRoute.GET(createBearerRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/member-actions/not-an-action",
      MESSAGES_TOKEN,
      { method: "GET" },
    ), {
      params: Promise.resolve({ actionId: "not-an-action" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.readHostedMailboxWakeByDedupeKey).not.toHaveBeenCalled();
  });

  it("fails closed when launch consent was never granted", async () => {
    mocks.assertHostedHistoricalLaunchConsentGranted.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_CONSENT_REQUIRED",
      httpStatus: 403,
      message: "Accept the Murph legal consent before continuing.",
    }));

    const response = await memberActionRoute.POST(jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/member-actions",
      MESSAGES_TOKEN,
      "POST",
      validMemberActionRequest(),
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "HOSTED_CONSENT_REQUIRED" },
    });
  });

  it("rejects a device-agent token before account gates or action parsing", async () => {
    const response = await memberActionRoute.POST(jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/member-actions",
      "hbds_agent_active",
      "POST",
      validMemberActionRequest(),
    ));

    expect(response.status).toBe(401);
    expect(mocks.authenticateAgentSessionByTokenHash).not.toHaveBeenCalled();
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
  });

  it("rejects an action-id collision without signaling the runtime", async () => {
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValueOnce({
      dedupeConflict: true,
      duplicate: true,
      inserted: false,
      item: {
        id: "mailbox-action-1",
        lane: "system",
        laneSeq: "7",
      },
    });

    const response = await memberActionRoute.POST(jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/member-actions",
      MESSAGES_TOKEN,
      "POST",
      validMemberActionRequest(),
    ));

    expect(response.status).toBe(409);
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("revokes the derived credential without requiring the member to remain active", async () => {
    const response = await enrollmentRoute.DELETE(jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/enrollment",
      MESSAGES_TOKEN,
      "DELETE",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ schemaVersion: 1, revoked: true });
    expect(mocks.revokeAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      reason: "imessage_app_request",
      sessionId: "dsa_messages",
    }));
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function validMemberActionRequest() {
  return {
    action: {
      expectedWorkout: {
        actionBinding: "a".repeat(64),
        exercises: [{ name: "Leg press", sets: [{ logged: false }] }],
      },
      kind: "workout.live.apply",
      mutations: [{
        exerciseName: "Leg press",
        exercisePosition: 1,
        expectedResult: null,
        kind: "set.put",
        requiresExistingSet: true,
        result: { kind: "weight_reps", reps: 8, weight: 180, weightUnit: "lb" },
        setPosition: 1,
      }],
      version: 1,
    },
    actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
    requestedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}

function readCredentialToken(body: unknown): string {
  if (
    !isRecord(body)
    || !isRecord(body.credential)
    || typeof body.credential.token !== "string"
  ) {
    throw new TypeError("Expected an iMessage enrollment credential token.");
  }
  return body.credential.token;
}

function invocationOrder(
  mock: { mock: { invocationCallOrder: number[] } },
  index = 0,
): number {
  const order = mock.mock.invocationCallOrder[index];
  if (order === undefined) {
    throw new TypeError("Expected the mocked call to have an invocation order.");
  }
  return order;
}
