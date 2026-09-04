import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  getHostedMurphContactContext: vi.fn(),
  resolveHealthCommonsCanonicalGoalEntry: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-contact-context", () => ({
  getHostedMurphContactContext: mocks.getHostedMurphContactContext,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/health-commons/goal-projections", () => ({
  resolveHealthCommonsCanonicalGoalEntry:
    mocks.resolveHealthCommonsCanonicalGoalEntry,
}));

import { POST } from "../app/api/goals/contact/route";

describe("goal contact resolver route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHostedMurphContactContext.mockResolvedValue({
      initialContactChannels: {
        email: false,
        telegram: false,
        text: true,
      },
      murphEmailAddress: null,
      murphPhoneNumber: "+15550100001",
    });
    mocks.getHostedPageAuthSnapshot.mockResolvedValue({
      authenticatedMember: { id: "member-1" },
    });
    mocks.resolveHealthCommonsCanonicalGoalEntry.mockReturnValue({
      startPrompt: "Hey Murph, help me lower my resting heart rate.",
    });
  });

  it("resolves a signed-in member's assigned Murph text line at request time", async () => {
    const response = await POST(goalContactRequest({
      goalRouteId: "lower-resting-heart-rate",
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    await expect(response.json()).resolves.toEqual({
      option: expect.objectContaining({
        href: `sms:+15550100001?body=${encodeURIComponent(
          "Hey Murph, help me lower my resting heart rate.",
        )}`,
        kind: "text",
      }),
    });
    expect(mocks.resolveHealthCommonsCanonicalGoalEntry).toHaveBeenCalledWith(
      "lower-resting-heart-rate",
    );
    expect(mocks.getHostedMurphContactContext).toHaveBeenCalledTimes(1);
  });

  it("accepts only one bounded canonical goal ID and never accepts free-text prompts", async () => {
    const extraTextResponse = await POST(goalContactRequest({
      goalRouteId: "lower-resting-heart-rate",
      prompt: "private health search text",
    }));
    mocks.resolveHealthCommonsCanonicalGoalEntry.mockReturnValue(null);
    const rejectedAlias = await POST(goalContactRequest({
      goalRouteId: "lower-rhr",
    }));

    expect(extraTextResponse.status).toBe(400);
    expect(rejectedAlias.status).toBe(404);
    expect(mocks.getHostedMurphContactContext).not.toHaveBeenCalled();
  });

  it("rejects stale authentication instead of returning the anonymous fallback", async () => {
    mocks.getHostedPageAuthSnapshot.mockResolvedValue({
      authenticatedMember: null,
    });

    const response = await POST(goalContactRequest({
      goalRouteId: "lower-resting-heart-rate",
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "GOAL_CONTACT_AUTH_REQUIRED" },
    });
    expect(mocks.getHostedMurphContactContext).not.toHaveBeenCalled();
  });

  it("fails closed when an assigned text route cannot be resolved", async () => {
    mocks.getHostedMurphContactContext.mockResolvedValue({
      initialContactChannels: {
        email: true,
        telegram: true,
        text: true,
      },
      murphEmailAddress: "assistant@example.test",
      murphPhoneNumber: null,
    });

    const response = await POST(goalContactRequest({
      goalRouteId: "lower-resting-heart-rate",
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "GOAL_CONTACT_UNAVAILABLE" },
    });
  });

  it("uses Telegram only when it is the authenticated member's available channel", async () => {
    mocks.getHostedMurphContactContext.mockResolvedValue({
      initialContactChannels: {
        email: false,
        telegram: true,
        text: false,
      },
      murphEmailAddress: null,
      murphPhoneNumber: null,
    });

    const response = await POST(goalContactRequest({
      goalRouteId: "lower-resting-heart-rate",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      option: { kind: "telegram" },
    });
  });
});

function goalContactRequest(payload: Record<string, unknown>): Request {
  return new Request("https://example.test/api/goals/contact", {
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}
