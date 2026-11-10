import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
const mocks = vi.hoisted(() => ({ access: vi.fn(), start: vi.fn(), operate: vi.fn(), overview: vi.fn() }));
vi.mock("@/src/lib/hosted-ops/access", () => ({ requireHostedOpsRequestAccess: mocks.access }));
vi.mock("@/src/lib/hosted-ops/linq-group-line-move", () => ({ startHostedLinqGroupLineMove: mocks.start, operateHostedLinqGroupLineMove: mocks.operate }));
vi.mock("@/src/lib/hosted-ops/linq-group-line-move-overview", () => ({ readHostedLinqGroupLineMoveOverview: mocks.overview }));
import { GET, POST } from "../app/api/ops/linq-group-line-move/route";
const origin = "https://ops.example.test";
const moveId = "00000000-0000-4000-8000-000000000001";
const request = (body: unknown) => new Request(`${origin}/api/ops/linq-group-line-move`, {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
});
describe("group line move ops access and request contract", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.access.mockResolvedValue({ member: { id: "synthetic-operator" } });
    mocks.start.mockResolvedValue({ moveId, status: "reserved" });
    mocks.operate.mockResolvedValue({ moveId, status: "adopted" });
    mocks.overview.mockResolvedValue({ moves: [], candidates: [], nextMoveId: null, nextContainerRef: null });
  });
  it("uses the rehome mutation guard and accepts opaque start coordinates", async () => {
    const body = { operation: "start", containerRef: "opaque-room", targetLineLookupKey: "opaque-line" };
    const input = request(body), response = await POST(input);
    expect(mocks.access).toHaveBeenCalledWith(input, { requireMutationOrigin: true });
    expect(mocks.start).toHaveBeenCalledWith(body);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ moveId, status: "reserved" });
  });
  it.each(["resume", "cancel", "retry_leave"])("dispatches %s only by move id", async operation => {
    expect((await POST(request({ operation, moveId }))).status).toBe(200);
    expect(mocks.operate).toHaveBeenCalledWith({ operation, moveId });
  });
  it.each([
    { operation: "start", containerRef: "opaque-room" },
    { operation: "start", containerRef: "opaque-room", targetLineLookupKey: "opaque-line", notice: "forbidden" },
    { operation: "cancel", moveId: "invalid" },
    { operation: "unknown", moveId },
  ])("rejects invalid or extra mutation fields", async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.operate).not.toHaveBeenCalled();
  });
  it("guards and passes bounded overview cursors and filters", async () => {
    const input = new Request(`${origin}/api/ops/linq-group-line-move?status=reserved&sourceLineLookupKey=opaque-line&afterMoveId=${moveId}&afterContainerRef=opaque-room`);
    expect((await GET(input)).status).toBe(200);
    expect(mocks.access).toHaveBeenCalledWith(input);
    expect(mocks.overview).toHaveBeenCalledWith({ status: "reserved", sourceLineLookupKey: "opaque-line", afterMoveId: moveId, afterContainerRef: "opaque-room" });
    expect((await GET(new Request(`${origin}/api/ops/linq-group-line-move?status=bad`))).status).toBe(400);
  });
  it.each(["GET", "POST"])("stops unauthorized %s before database/provider work", async method => {
    mocks.access.mockRejectedValue(hostedOnboardingError({ code: "OPS_REQUIRED", message: "Ops required.", httpStatus: 403 }));
    const response = method === "GET" ? await GET(new Request(origin)) : await POST(request({ operation: "resume", moveId }));
    expect(response.status).toBe(403);
    expect(mocks.overview).not.toHaveBeenCalled(); expect(mocks.operate).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
});
