import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ record: vi.fn(), auth: vi.fn() }));
vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({ requireHostedCloudflareCallbackJsonRequest: mocks.auth }));
vi.mock("@/src/lib/hosted-execution/product-feedback", () => ({ recordHostedProductFeedback: mocks.record }));
import { POST } from "../app/api/internal/hosted-execution/usage/feedback/route";
const audit = { idempotencyKey: "a".repeat(64), kind: "feature_request", relatedChangelogItemIds: [], summary: "Usage optimization audit: Reduce repeated large outputs." };
function request(feedback: unknown) { return new Request("https://synthetic.example/api/internal/hosted-execution/usage/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feedback }) }); }
describe("dedicated usage feedback consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockImplementation(async (request: Request) => ({ payload: await request.json(), userId: "synthetic-bound-member" }));
    mocks.record.mockResolvedValue({ feedbackId: "product_feedback_synthetic", recorded: true });
  });
  it("authenticates and binds the audit to the signed member", async () => {
    const response = await POST(request(audit));
    expect(response.status).toBe(200);
    expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), { maxBodyBytes: 16384 });
    expect(mocks.record).toHaveBeenCalledWith({ feedback: audit, memberId: "synthetic-bound-member" });
  });
  it.each([
    { ...audit, summary: "Ordinary feedback" },
    { ...audit, kind: "frustration", summary: "Support escalation: Contact support." },
    { ...audit, relatedChangelogItemIds: ["some-feature"] },
    { ...audit, summary: "Usage optimization audit:" },
    { ...audit, summary: "Usage optimization audit:" + "x".repeat(1800) },
  ])("rejects other authority and malformed audit shapes", async feedback => {
    const response = await POST(request(feedback));
    expect(response.status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
