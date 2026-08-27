import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  admitHostedOperatorTask: vi.fn(),
  requireHostedOpsRequestAccess: vi.fn(),
  resolveHostedOperatorTaskMemberId: vi.fn(),
}));

vi.mock("@/src/lib/hosted-ops/access", () => ({
  requireHostedOpsRequestAccess: mocks.requireHostedOpsRequestAccess,
}));
vi.mock("@/src/lib/hosted-ops/operator-task", () => ({
  admitHostedOperatorTask: mocks.admitHostedOperatorTask,
  listHostedOperatorTasks: vi.fn().mockResolvedValue([]),
  resolveHostedOperatorTaskMemberId: mocks.resolveHostedOperatorTaskMemberId,
}));

import { POST } from "@/app/api/ops/operator-tasks/route";

describe("hosted operator task Ops route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedOpsRequestAccess.mockResolvedValue({
      member: { id: "hbm_operator" },
    });
    mocks.resolveHostedOperatorTaskMemberId.mockResolvedValue("hbm_target");
    mocks.admitHostedOperatorTask.mockResolvedValue({
      completedAt: null,
      createdAt: "2026-08-25T18:00:00.000Z",
      expiresAt: "2026-08-25T18:10:00.000Z",
      id: "opt_synthetic",
      kind: "diagnostic",
      memberId: "hbm_target",
      result: null,
      source: "ops",
      status: "queued",
    });
  });

  it("resolves exact phone digits before one allowlisted admission", async () => {
    const request = new Request("https://web.example.test/api/ops/operator-tasks", {
      body: JSON.stringify({
        idempotencyKey: "idem-synthetic",
        kind: "diagnostic",
        memberId: "3537",
        prompt: "Inspect the selected automation identity.",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedOpsRequestAccess).toHaveBeenCalledWith(request, {
      requireMutationOrigin: true,
    });
    expect(mocks.resolveHostedOperatorTaskMemberId).toHaveBeenCalledWith({
      query: "3537",
    });
    expect(mocks.admitHostedOperatorTask).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "idem-synthetic",
      kind: "diagnostic",
      memberId: "hbm_target",
      prompt: "Inspect the selected automation identity.",
      requestedByMemberId: "hbm_operator",
      source: "ops",
    }));
  });
});
