import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  feedbackRead: vi.fn(), feedbackList: vi.fn(), taskList: vi.fn(),
  admit: vi.fn(), decrypt: vi.fn(), access: vi.fn(),
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({
  hostedProductFeedback: { findUnique: mocks.feedbackRead, findMany: mocks.feedbackList },
  hostedOperatorTask: { findMany: mocks.taskList },
}) }));
vi.mock("@/src/lib/hosted-ops/operator-task", () => ({
  admitHostedOperatorTask: mocks.admit, decryptOperatorTaskResult: mocks.decrypt,
}));
vi.mock("@/src/lib/hosted-ops/access", () => ({ requireHostedOpsRequestAccess: mocks.access }));
import { GET, POST } from "@/app/api/ops/feedback/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ member: { id: "operator_synthetic" } });
  mocks.feedbackRead.mockResolvedValue({ memberId: "private_member_synthetic" });
  mocks.admit.mockResolvedValue({ id: "opt_synthetic", status: "queued", expiresAt: "2026-09-08T12:10:00.000Z", memberId: "private_member_synthetic", result: { answer: "private result" } });
});
const submit = (body: object) => new Request("https://web.example.test/api/ops/feedback", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const requestBody = { feedbackId: "feedback_synthetic", question: "Which schema rejected the synthetic request?", idempotencyKey: "synthetic-retry" };

describe("feedback diagnostics Ops API", () => {
  it("derives the target on the server and returns no private task fields", async () => {
    const request = submit(requestBody);
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "opt_synthetic", status: "queued", expiresAt: "2026-09-08T12:10:00.000Z" });
    expect(mocks.access).toHaveBeenCalledWith(request, { requireMutationOrigin: true });
    expect(mocks.admit).toHaveBeenCalledWith(expect.objectContaining({ memberId: "private_member_synthetic", feedbackId: "feedback_synthetic", kind: "diagnostic", idempotencyKey: "synthetic-retry" }));
  });
  it("rejects a caller-selected member and does not admit unlinked feedback", async () => {
    expect((await POST(submit({ ...requestBody, memberId: "other" }))).status).toBe(400);
    mocks.feedbackRead.mockResolvedValue({ memberId: null });
    expect((await POST(submit(requestBody))).status).toBe(409);
    expect(mocks.admit).not.toHaveBeenCalled();
  });
  it("authenticates before reading feedback", async () => {
    mocks.access.mockRejectedValue(new Error("denied"));
    await GET(new Request("https://web.example.test/api/ops/feedback"));
    expect(mocks.feedbackList).not.toHaveBeenCalled();
  });
  it("returns a bounded de-identified feedback page", async () => {
    mocks.feedbackList.mockResolvedValue([{ id: "feedback_synthetic", kind: "frustration", summary: "Tool failed for synthetic@example.test", createdAt: new Date("2026-09-08T12:00:00Z") }]);
    const response = await GET(new Request("https://web.example.test/api/ops/feedback"));
    expect(JSON.stringify(await response.json())).not.toContain("synthetic@example.test");
    expect(mocks.feedbackList).toHaveBeenCalledWith(expect.objectContaining({ take: 21, select: { id: true, kind: true, summary: true, createdAt: true } }));
  });
  it("sanitizes diagnostic answers and never exposes member linkage or expired ciphertext", async () => {
    const row = { id: "opt_synthetic", memberId: "private_member_synthetic", feedbackId: "feedback_synthetic", status: "completed", createdAt: new Date(), completedAt: new Date(), expiresAt: new Date(Date.now() + 60000), resultEncrypted: "ciphertext" };
    mocks.taskList.mockResolvedValue([row]);
    mocks.decrypt.mockResolvedValue({ outcome: "answered", answer: "Schema mismatch. Contact synthetic@example.test" });
    const response = await GET(new Request("https://web.example.test/api/ops/feedback?feedbackId=feedback_synthetic"));
    const body = JSON.stringify(await response.json());
    expect(body).toContain("Schema mismatch");
    for (const privateText of ["private_member_synthetic", "ciphertext", "synthetic@example.test"]) expect(body).not.toContain(privateText);
    mocks.decrypt.mockClear();
    mocks.taskList.mockResolvedValue([{ ...row, completedAt: new Date("2020-01-01") }]);
    await GET(new Request("https://web.example.test/api/ops/feedback?feedbackId=feedback_synthetic"));
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
});
