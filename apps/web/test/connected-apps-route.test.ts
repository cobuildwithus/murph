import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

import { createRouteContext } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  readHostedConnectedAppIntent: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  startHostedConnectedAppConnection: vi.fn(),
}));

vi.mock("@/src/lib/connected-apps/service", () => ({
  readHostedConnectedAppIntent: mocks.readHostedConnectedAppIntent,
  startHostedConnectedAppConnection: mocks.startHostedConnectedAppConnection,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest: mocks.requireActiveHostedAppSessionFromRequest,
}));

type ConnectedAppStartRouteModule = typeof import(
  "../app/integrations/connect/[claim]/route"
);

let connectedAppStartRoute: ConnectedAppStartRouteModule;

const CLAIM = "cai_0123456789abcdefghijklmnoABCDE";

describe("hosted connected-app connect route", () => {
  beforeAll(async () => {
    connectedAppStartRoute = await import("../app/integrations/connect/[claim]/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: {
        id: "member_123",
      },
      sessionId: "hws_test",
    });
    mocks.readHostedConnectedAppIntent.mockResolvedValue(createIntent());
  });

  it("requires a hosted app session before reading or displaying the intent", async () => {
    mocks.requireActiveHostedAppSessionFromRequest.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "AUTH_REQUIRED",
        httpStatus: 401,
        message: "Sign in to continue.",
      }),
    );

    const response = await connectedAppStartRoute.GET(
      new Request(`https://join.example.test/integrations/connect/${CLAIM}`),
      createRouteContext({ claim: CLAIM }),
    );

    expect(response.status).toBe(401);
    expect(mocks.readHostedConnectedAppIntent).not.toHaveBeenCalled();
    await expect(response.text()).resolves.toContain("Sign in to continue.");
  });

  it("does not reveal the app label when the intent belongs to another member", async () => {
    mocks.readHostedConnectedAppIntent.mockResolvedValueOnce(createIntent({
      alias: "private-work-calendar",
      memberId: "member_other",
      toolkit: "googlecalendar",
    }));

    const response = await connectedAppStartRoute.GET(
      new Request(`https://join.example.test/integrations/connect/${CLAIM}`),
      createRouteContext({ claim: CLAIM }),
    );
    const body = await response.text();

    expect(response.status).toBe(403);
    expect(body).toContain("Connection link unavailable");
    expect(body).not.toContain("private-work-calendar");
    expect(body).not.toContain("Google Calendar");
  });

  it("renders same-member connect pages with long-label wrapping", async () => {
    mocks.readHostedConnectedAppIntent.mockResolvedValueOnce(createIntent({
      alias: "work-account-with-a-long-unbroken-display-name",
      toolkit: "gmail",
    }));

    const response = await connectedAppStartRoute.GET(
      new Request(`https://join.example.test/integrations/connect/${CLAIM}`),
      createRouteContext({ claim: CLAIM }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Connect work-account-with-a-long-unbroken-display-name Gmail");
    expect(body).toContain("overflow-wrap: anywhere");
  });
});

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
    expiresAt: input.expiresAt ?? new Date("2026-06-22T12:15:00.000Z"),
    memberId: input.memberId ?? "member_123",
    startedAt: input.startedAt ?? null,
    toolkit: input.toolkit ?? "gmail",
  };
}
