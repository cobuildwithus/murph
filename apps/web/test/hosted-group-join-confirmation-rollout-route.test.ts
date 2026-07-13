import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  drainPendingHostedGroupJoinConfirmations: vi.fn(),
  isHostedGroupJoinConfirmationProducerEnabled: vi.fn(),
}));

vi.mock("@/src/lib/hosted-groups/group-join-confirmation", () => ({
  drainPendingHostedGroupJoinConfirmations:
    mocks.drainPendingHostedGroupJoinConfirmations,
  isHostedGroupJoinConfirmationProducerEnabled:
    mocks.isHostedGroupJoinConfirmationProducerEnabled,
}));

type RouteModule = typeof import(
  "../app/api/internal/hosted-groups/join-confirmations/rollout/route"
);

let route: RouteModule;

describe("hosted group join confirmation rollout route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-groups/join-confirmations/rollout/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("HOSTED_GROUP_JOIN_CONFIRMATION_ROLLOUT_TOKEN", "rollout-token");
    mocks.isHostedGroupJoinConfirmationProducerEnabled.mockReturnValue(true);
    mocks.drainPendingHostedGroupJoinConfirmations.mockResolvedValue({
      appended: 1,
      deferred: 1,
      nextCursor: "membership_2",
      scanned: 2,
      terminalSkipped: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports only enablement and whether the presented token matches", async () => {
    const unauthorized = await route.GET(new Request(
      "https://join.example.test/api/internal/hosted-groups/join-confirmations/rollout",
    ));
    await expect(unauthorized.json()).resolves.toEqual({
      authorized: false,
      enabled: true,
    });

    const authorized = await route.GET(new Request(
      "https://join.example.test/api/internal/hosted-groups/join-confirmations/rollout",
      { headers: { authorization: "Bearer rollout-token" } },
    ));
    await expect(authorized.json()).resolves.toEqual({
      authorized: true,
      enabled: true,
    });
  });

  it("rejects an unauthorized drain before reading work", async () => {
    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/hosted-groups/join-confirmations/rollout",
      {
        body: JSON.stringify({ cursor: null, limit: 2 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(401);
    expect(mocks.drainPendingHostedGroupJoinConfirmations).not.toHaveBeenCalled();
  });

  it("runs one authorized bounded drain page", async () => {
    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/hosted-groups/join-confirmations/rollout",
      {
        body: JSON.stringify({ cursor: "membership_0", limit: 2 }),
        headers: {
          authorization: "Bearer rollout-token",
          "content-type": "application/json",
        },
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.drainPendingHostedGroupJoinConfirmations).toHaveBeenCalledWith({
      cursor: "membership_0",
      limit: 2,
    });
    await expect(response.json()).resolves.toEqual({
      appended: 1,
      deferred: 1,
      nextCursor: "membership_2",
      scanned: 2,
      terminalSkipped: 0,
    });
  });
});
