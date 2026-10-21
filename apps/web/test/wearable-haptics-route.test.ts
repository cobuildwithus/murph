import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ callback: vi.fn(), bearer: vi.fn(), tool: vi.fn(), exchange: vi.fn() }));
vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({ requireHostedCloudflareCallbackJsonRequest: m.callback }));
vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({ requireActiveHostedMemberAuthFromBearerToken: m.bearer }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/src/lib/wearable-haptics/service", () => ({ requestWearableHaptic: m.tool, exchangeWearableCommands: m.exchange }));
import { POST as internal } from "../app/api/internal/companion/wearables/route";
import { POST as companion } from "../app/api/companion/wearables/route";
const body = { authority: { kind: "accepted_input", assistantInputId: "ain_" + "a".repeat(32) }, request: { action: "haptic", wearable: "whoop", operation: "buzz" } };
function request(value: unknown) { return new Request("https://example.test/api/companion/wearables", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); }
describe("wearable haptic authenticated routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.callback.mockImplementation(async (request: Request) => ({ payload: await request.json(), userId: "member-bound" }));
    m.bearer.mockResolvedValue({ member: { id: "member-bound" } });
    m.tool.mockResolvedValue({ ...body.request, status: "queued" });
    m.exchange.mockResolvedValue({ active: true, commands: [] });
  });
  it("binds internal commands to signed member and transaction authority", async () => {
    expect((await internal(request(body))).status).toBe(200);
    expect(m.tool).toHaveBeenCalledExactlyOnceWith({ memberId: "member-bound", runtimeIdentity: null, request: body });
    expect(m.callback).toHaveBeenCalledWith(expect.any(Request), { maxBodyBytes: 2048, runtimeAuthority: "caller_transaction" });
  });
  it("binds companion polling to bearer member with no model-selected member", async () => {
    const poll = { action: "poll", wearable: "garmin", sessionId: "00000000-0000-4000-8000-000000000001" };
    const response = await companion(request(poll));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(m.exchange).toHaveBeenCalledExactlyOnceWith("member-bound", poll);
    m.exchange.mockClear();
    expect((await companion(request({ ...poll, memberId: "other" }))).status).toBe(400);
    expect(m.exchange).not.toHaveBeenCalled();
  });
  it("rejects extra effect parameters and authentication failures before dispatch", async () => {
    expect((await internal(request({ ...body, request: { ...body.request, delayMinutes: 10 } }))).status).toBe(400);
    expect(m.tool).not.toHaveBeenCalled();
    m.bearer.mockRejectedValue(new Error("Synthetic authentication failure"));
    expect((await companion(request({ action: "connect", wearable: "whoop", sessionId: "00000000-0000-4000-8000-000000000001" }))).status).toBeGreaterThanOrEqual(400);
    expect(m.exchange).not.toHaveBeenCalled();
  });
});
