import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
const mocks = vi.hoisted(() => ({ access: vi.fn(), list: vi.fn(), update: vi.fn() }));
vi.mock("@/src/lib/hosted-ops/access", () => ({ requireHostedOpsRequestAccess: mocks.access }));
vi.mock("@/src/lib/hosted-ops/linq-handle-block", () => ({ readHostedOpsLinqHandleBlocks: mocks.list, updateHostedOpsLinqHandleBlock: mocks.update }));
import { GET, POST } from "../app/api/ops/linq-handle-block/route";
const origin = "https://ops.example.test";
const request = (body: unknown) => new Request(`${origin}/api/ops/linq-handle-block`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
describe("operator blocked contact route", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.list.mockResolvedValue({ blocks: [], nextCursor: null }); mocks.update.mockResolvedValue({ ok: true }); });
  it.each(["block", "unblock"])("guards %s with the departure mutation-origin policy", async operation => {
    const input = request({ operation, contact: "synthetic@example.invalid" });
    expect((await POST(input)).status).toBe(200);
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(input, { requireMutationOrigin: true });
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ operation, contact: "synthetic@example.invalid" });
  });
  it.each(["GET", "POST"])("rejects unauthorized %s before data access", async method => {
    mocks.access.mockRejectedValue(hostedOnboardingError({ code: "OPS_REQUIRED", message: "Ops required.", httpStatus: 404 }));
    expect((await (method === "GET" ? GET(new Request(origin)) : POST(request({ operation: "block", contact: "synthetic@example.invalid" })))).status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
  });
  it.each([
    { operation: "block", contact: "" }, { operation: "block", contact: "synthetic@example.invalid", contactEncrypted: "forbidden" },
    { operation: "block", contact: "synthetic@example.invalid", reason: "invalid" }, { operation: "unblock", contactLookupKey: "forbidden" },
  ])("rejects malformed and caller-supplied storage fields", async body => {
    expect((await POST(request(body))).status).toBe(400); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("bounds list requests", async () => {
    const input = new Request(`${origin}/api/ops/linq-handle-block?after=opaque-cursor`);
    expect((await GET(input)).status).toBe(200); expect(mocks.access).toHaveBeenCalledWith(input);
    expect(mocks.list).toHaveBeenCalledWith({ after: "opaque-cursor" });
    expect((await GET(new Request(`${origin}?limit=999999`))).status).toBe(400);
  });
});
