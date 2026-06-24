import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

import { createRouteContext } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  readHostedConnectedAppIntent: vi.fn(),
  requireActiveHostedAppSession: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  startHostedConnectedAppConnection: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/connected-apps/service", () => ({
  readHostedConnectedAppIntent: mocks.readHostedConnectedAppIntent,
  startHostedConnectedAppConnection: mocks.startHostedConnectedAppConnection,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSession: mocks.requireActiveHostedAppSession,
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

type ConnectPageModule = typeof import(
  "../app/integrations/connect/[claim]/page"
);
type ConnectStartRouteModule = typeof import(
  "../app/integrations/connect/[claim]/start/route"
);

let connectPage: ConnectPageModule;
let connectStartRoute: ConnectStartRouteModule;

const CLAIM = "cai_0123456789abcdefghijklmnoABCDE";

describe("hosted connected-app connect page and start route", () => {
  beforeAll(async () => {
    connectPage = await import("../app/integrations/connect/[claim]/page");
    connectStartRoute = await import(
      "../app/integrations/connect/[claim]/start/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
    mocks.requireActiveHostedAppSession.mockResolvedValue(createSession());
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue(
      createSession(),
    );
    mocks.readHostedConnectedAppIntent.mockResolvedValue(createIntent());
    mocks.startHostedConnectedAppConnection.mockResolvedValue({
      redirectUrl: "https://provider.example.test/link/abc",
    });
  });

  it("renders the auth-required state without reading the intent when not signed in", async () => {
    mocks.requireActiveHostedAppSession.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "AUTH_REQUIRED",
        httpStatus: 401,
        message: "Sign in to continue.",
      }),
    );

    const markup = renderToStaticMarkup(await connectPage.default({
      params: Promise.resolve({ claim: CLAIM }),
    }));

    assert.match(markup, /Sign in to continue/);
    assert.match(markup, /Log in or sign up/);
    expect(mocks.readHostedConnectedAppIntent).not.toHaveBeenCalled();
  });

  it("does not hide non-auth page errors behind the auth-required state", async () => {
    const accessError = hostedOnboardingError({
      code: "HOSTED_MEMBER_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Hosted member access is required.",
    });
    mocks.requireActiveHostedAppSession.mockRejectedValueOnce(accessError);

    await expect(connectPage.default({
      params: Promise.resolve({ claim: CLAIM }),
    })).rejects.toThrow(accessError);

    expect(mocks.readHostedConnectedAppIntent).not.toHaveBeenCalled();
  });

  it("does not reveal the app label when the intent belongs to another member", async () => {
    mocks.readHostedConnectedAppIntent.mockResolvedValueOnce(createIntent({
      alias: "private-work-calendar",
      memberId: "member_other",
      toolkit: "googlecalendar",
    }));

    const markup = renderToStaticMarkup(await connectPage.default({
      params: Promise.resolve({ claim: CLAIM }),
    }));

    assert.match(markup, /Connection link unavailable/);
    assert.equal(markup.includes("private-work-calendar"), false);
    assert.equal(markup.includes("Google Calendar"), false);
  });

  it("renders same-member connect pages with long-label wrapping and the auto-redirect launcher", async () => {
    mocks.readHostedConnectedAppIntent.mockResolvedValueOnce(createIntent({
      alias: "work-account-with-a-long-unbroken-display-name",
      toolkit: "gmail",
    }));

    const markup = renderToStaticMarkup(await connectPage.default({
      params: Promise.resolve({ claim: CLAIM }),
    }));

    assert.match(
      markup,
      /Connect work-account-with-a-long-unbroken-display-name Gmail/,
    );
    assert.match(markup, /break-words/);
    // The launcher renders an initial "Connecting…" status; the actual POST +
    // navigation fires from the client effect, not from a form action.
    assert.match(markup, /Connecting…/);
    assert.equal(markup.includes("<form"), false);
    assert.equal(markup.includes(`/integrations/connect/${CLAIM}/start`), false);
  });

  it("requires a hosted app session before starting a connection", async () => {
    mocks.requireActiveHostedAppSessionFromRequest.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "AUTH_REQUIRED",
        httpStatus: 401,
        message: "Sign in to continue.",
      }),
    );

    const response = await connectStartRoute.POST(
      createMutationRequest(`/integrations/connect/${CLAIM}/start`),
      createRouteContext({ claim: CLAIM }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toMatch(/application\/json/u);
    expect(await response.json()).toEqual({ error: "connection_unavailable" });
    expect(mocks.startHostedConnectedAppConnection).not.toHaveBeenCalled();
  });

  it("starts the connection and returns the provider URL as JSON", async () => {
    const response = await connectStartRoute.POST(
      createMutationRequest(`/integrations/connect/${CLAIM}/start`),
      createRouteContext({ claim: CLAIM }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/json/u);
    expect(await response.json()).toEqual({
      redirectUrl: "https://provider.example.test/link/abc",
    });
    expect(mocks.startHostedConnectedAppConnection).toHaveBeenCalledWith({
      claim: CLAIM,
      memberId: "member_123",
    });
  });

  it("returns the error httpStatus as JSON when starting the connection fails", async () => {
    mocks.startHostedConnectedAppConnection.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "CONNECTED_APPS_INTENT_UNAVAILABLE",
        httpStatus: 410,
        message: "This connected-app link is no longer valid.",
      }),
    );

    const response = await connectStartRoute.POST(
      createMutationRequest(`/integrations/connect/${CLAIM}/start`),
      createRouteContext({ claim: CLAIM }),
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("content-type")).toMatch(/application\/json/u);
    expect(await response.json()).toEqual({ error: "connection_unavailable" });
  });
});

function createMutationRequest(path: string): Request {
  return new Request(`https://join.example.test${path}`, {
    headers: { origin: "https://join.example.test" },
    method: "POST",
  });
}

function createSession() {
  return {
    expiresAt: new Date("2035-06-22T12:00:00.000Z"),
    member: {
      id: "member_123",
      status: "active",
    },
    privyUserId: "privy_123",
    sessionId: "hws_test",
  };
}

function createIntent(input: {
  alias?: string | null;
  completedAt?: Date | null;
  connectedAccountId?: string | null;
  expiresAt?: Date;
  memberId?: string;
  startedAt?: Date | null;
  toolkit?: string;
} = {}) {
  return {
    alias: input.alias ?? "work",
    claimHash: "claim_hash",
    completedAt: input.completedAt ?? null,
    connectedAccountId: input.connectedAccountId ?? null,
    expiresAt: input.expiresAt ?? new Date("2035-06-22T12:15:00.000Z"),
    memberId: input.memberId ?? "member_123",
    startedAt: input.startedAt ?? null,
    toolkit: input.toolkit ?? "gmail",
  };
}
