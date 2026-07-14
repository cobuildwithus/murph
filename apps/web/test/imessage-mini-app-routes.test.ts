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
  assertActiveHostedMemberAccessAllowed: vi.fn(),
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  authenticateAgentSessionByTokenHash: vi.fn(),
  createAgentSession: vi.fn(),
  readJsonObject: vi.fn(async (request: Request) => await request.json()),
  requirePrivyMemberAuthFromBearerToken: vi.fn(),
  revokeAgentSession: vi.fn(),
  transaction: vi.fn(),
  transactionQuery: vi.fn(async () => []),
}));

const transactionClient = {
  $queryRaw: mocks.transactionQuery,
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
  assertHostedLaunchRequiredConsentGranted: mocks.assertHostedLaunchRequiredConsentGranted,
}));
vi.mock("@/src/lib/device-sync/prisma-store/agent-sessions", () => ({
  createHostedAgentSession: mocks.createAgentSession,
  PrismaHostedAgentSessionStore: class {
    authenticateAgentSessionByTokenHash = mocks.authenticateAgentSessionByTokenHash;
    revokeAgentSession = mocks.revokeAgentSession;
  },
}));

type EnrollmentRoute = typeof import("../app/api/device-sync/companion/imessage-mini-app/enrollment/route");
type ProofActionRoute = typeof import("../app/api/device-sync/companion/imessage-mini-app/proof-action/route");

let enrollmentRoute: EnrollmentRoute;
let proofActionRoute: ProofActionRoute;

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
    proofActionRoute = await import("../app/api/device-sync/companion/imessage-mini-app/proof-action/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readJsonObject.mockImplementation(async (request: Request) =>
      await request.json()
    );
    mocks.requirePrivyMemberAuthFromBearerToken.mockResolvedValue({
      member: { id: "member-1" },
    });
    mocks.createAgentSession.mockImplementation(async (input) => ({
      ...ACTIVE_SESSION,
      expiresAt: input.expiresAt,
    }));
    mocks.authenticateAgentSessionByTokenHash.mockResolvedValue({
      status: "active",
      session: ACTIVE_SESSION,
    });
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
    expect(mocks.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ user: { id: "member-1" } }),
      transactionClient,
    );
    expect(invocationOrder(mocks.transactionQuery, 1)).toBeLessThan(
      invocationOrder(mocks.assertActiveHostedMemberAccessAllowed),
    );
    expect(invocationOrder(mocks.assertActiveHostedMemberAccessAllowed)).toBeLessThan(
      invocationOrder(mocks.assertHostedLaunchRequiredConsentGranted),
    );
    expect(invocationOrder(mocks.assertHostedLaunchRequiredConsentGranted)).toBeLessThan(
      invocationOrder(mocks.createAgentSession),
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
      expect(mocks.createAgentSession).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          expiresAt: "2026-07-11T12:00:00.000Z",
          label: "Murph Messages mini app",
          now: "2026-07-10T12:00:00.000Z",
          tokenHash: createHash("sha256")
            .update(`murph:imessage-mini-app:v1\0${firstToken}`)
            .digest("hex"),
          user: { id: "member-1" },
        }),
        transactionClient,
      );
      expect(JSON.stringify(mocks.createAgentSession.mock.calls[0])).not.toContain(firstToken);
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
    expect(mocks.createAgentSession).not.toHaveBeenCalled();
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
    expect(mocks.createAgentSession).not.toHaveBeenCalled();
  });

  it("re-checks account access and consent before accepting a proof choice", async () => {
    const request = jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/proof-action",
      MESSAGES_TOKEN,
      "POST",
      {
        schemaVersion: 1,
        cardId: "privy-proof-v1",
        choice: "morning",
        idempotencyKey: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
      },
    );

    const response = await proofActionRoute.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: "member-1",
      prisma,
    });
    expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenCalledWith({
      memberId: "member-1",
      prisma,
    });
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 1,
      authenticated: true,
      cardId: "privy-proof-v1",
      choice: "morning",
    });
  });

  it("fails closed when the credential owner no longer has active account access", async () => {
    mocks.assertActiveHostedMemberAccessAllowed.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "An active Murph plan is required.",
    }));

    const response = await proofActionRoute.POST(jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/proof-action",
      MESSAGES_TOKEN,
      "POST",
      {
        schemaVersion: 1,
        cardId: "privy-proof-v1",
        choice: "morning",
        idempotencyKey: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
      },
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "HOSTED_ACCESS_REQUIRED" },
    });
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
  });

  it("fails closed when launch consent is no longer current", async () => {
    mocks.assertHostedLaunchRequiredConsentGranted.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_CONSENT_REQUIRED",
      httpStatus: 403,
      message: "Accept the current Murph legal consent before continuing.",
    }));

    const response = await proofActionRoute.POST(jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/proof-action",
      MESSAGES_TOKEN,
      "POST",
      {
        schemaVersion: 1,
        cardId: "privy-proof-v1",
        choice: "evening",
        idempotencyKey: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
      },
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "HOSTED_CONSENT_REQUIRED" },
    });
  });

  it("rejects a device-agent token before account gates or action parsing", async () => {
    const response = await proofActionRoute.POST(jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/proof-action",
      "hbds_agent_active",
      "POST",
      { schemaVersion: 1 },
    ));

    expect(response.status).toBe(401);
    expect(mocks.authenticateAgentSessionByTokenHash).not.toHaveBeenCalled();
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
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
