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
