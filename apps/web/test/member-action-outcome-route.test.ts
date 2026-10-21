import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ACTION_ID = "2f1c1fdc-c7b0-4d90-b902-8e6295959243";
const OUTCOME = {
  actionId: ACTION_ID,
  completedAt: "2026-08-12T15:00:01.000Z",
  reason: null,
  schemaVersion: 1,
  status: "applied",
};

const mocks = vi.hoisted(() => ({
  recordMemberActionOutcome: vi.fn(),
  requireHostedCloudflareCallbackJsonRequest: vi.fn(),
}));

const prisma = { marker: "prisma" };

vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => prisma }));
vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackJsonRequest:
    mocks.requireHostedCloudflareCallbackJsonRequest,
}));
vi.mock("@/src/lib/member-actions/outcome", () => ({
  recordMemberActionOutcome: mocks.recordMemberActionOutcome,
}));

type Route = typeof import("../app/api/internal/hosted-mailbox/member-action-outcome/route");
let route: Route;

describe("hosted member-action outcome route", () => {
  beforeAll(async () => {
    route = await import("../app/api/internal/hosted-mailbox/member-action-outcome/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackJsonRequest.mockResolvedValue({
      payload: OUTCOME,
      userId: "member-1",
    });
    mocks.recordMemberActionOutcome.mockResolvedValue({
      dedupeConflict: false,
      duplicate: false,
      recorded: true,
      schemaVersion: 1,
    });
  });

  it("binds the typed outcome to the signed runtime member", async () => {
    const request = new Request(
      "https://example.test/api/internal/hosted-mailbox/member-action-outcome",
      { method: "POST" },
    );

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.recordMemberActionOutcome).toHaveBeenCalledWith({
      memberId: "member-1",
      outcome: OUTCOME,
      prisma,
    });
    await expect(response.json()).resolves.toEqual({ recorded: true, schemaVersion: 1 });
  });

  it("preserves a typed workout snapshot result from the signed runtime", async () => {
    const outcome = {
      ...OUTCOME,
      result: {
        cardUrl: "https://www.withmurph.ai/#murph-card=card",
        kind: "workout.live.snapshot",
        version: 1,
      },
      status: "unchanged",
    };
    mocks.requireHostedCloudflareCallbackJsonRequest.mockResolvedValueOnce({
      payload: outcome,
      userId: "member-1",
    });

    const response = await route.POST(new Request(
      "https://example.test/api/internal/hosted-mailbox/member-action-outcome",
      { method: "POST" },
    ));

    expect(response.status).toBe(200);
    expect(mocks.recordMemberActionOutcome).toHaveBeenCalledWith({
      memberId: "member-1",
      outcome,
      prisma,
    });
  });

  it("accepts an editable result larger than the former callback budget", async () => {
    const outcome = { ...OUTCOME, result: { kind: "workout.live.apply", version: 1,
      card: { schemaVersion: 6, card: { k: "w", v: 1, t: "Workout", u: null, f: null, s: "c",
        b: "a".repeat(64), d: "b".repeat(64),
        e: Array.from({ length: 8 }, (_, i) => [`Exercise ${i + 1}`, null,
          Array.from({ length: 8 }, () => ["c", null, ["n", "N".repeat(40)]])]),
      } },
    } };
    const body = JSON.stringify(outcome);
    expect(Buffer.byteLength(body)).toBeGreaterThan(4 * 1_024);
    mocks.requireHostedCloudflareCallbackJsonRequest.mockImplementationOnce(async (request, options) => {
      const received = await request.text();
      expect(Buffer.byteLength(received)).toBeLessThanOrEqual(options.maxBodyBytes);
      return { payload: JSON.parse(received), userId: "member-1" };
    });
    const response = await route.POST(new Request(
      "https://example.test/api/internal/hosted-mailbox/member-action-outcome",
      { method: "POST", body },
    ));
    expect(response.status).toBe(200);
    expect(mocks.recordMemberActionOutcome).toHaveBeenCalledWith({ memberId: "member-1", outcome, prisma });
  });

  it("rejects a malformed signed outcome before recording it", async () => {
    mocks.requireHostedCloudflareCallbackJsonRequest.mockResolvedValueOnce({
      payload: { ...OUTCOME, status: "maybe" },
      userId: "member-1",
    });

    const response = await route.POST(new Request(
      "https://example.test/api/internal/hosted-mailbox/member-action-outcome",
      { method: "POST" },
    ));

    expect(response.status).toBe(400);
    expect(mocks.recordMemberActionOutcome).not.toHaveBeenCalled();
  });

  it("rejects a different terminal result for the same action identity", async () => {
    mocks.recordMemberActionOutcome.mockResolvedValueOnce({
      dedupeConflict: true,
      duplicate: true,
      recorded: true,
      schemaVersion: 1,
    });

    const response = await route.POST(new Request(
      "https://example.test/api/internal/hosted-mailbox/member-action-outcome",
      { method: "POST" },
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MEMBER_ACTION_OUTCOME_CONFLICT" },
    });
  });
});
