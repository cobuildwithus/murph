import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), active: vi.fn(), group: vi.fn(), decide: vi.fn() }));
vi.mock("../src/lib/hosted-onboarding/app-session", () => ({ getHostedAppSessionFromRequest: mocks.session }));
vi.mock("../src/lib/hosted-onboarding/member-access", () => ({ readActiveHostedMemberAccess: mocks.active, isHostedThreadContainerMember: mocks.group,
  activeHostedPersonAccessWhere: () => ({ suspendedAt: null }) }));
vi.mock("../src/lib/custom-connections/action-requests", () => ({ decideActionRequest: mocks.decide }));
import { POST } from "../app/api/settings/custom-connections/requests/[requestId]/route";

const REQUEST_ID = `car_${"a".repeat(32)}`;
const session = { member: { id: "member-a" }, sessionId: "browser-session" };
function post(body: unknown, headers: Record<string, string> = { origin: "https://www.withmurph.ai" }) {
  return POST(new Request(`https://www.withmurph.ai/api/settings/custom-connections/requests/${REQUEST_ID}`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ requestId: REQUEST_ID }) });
}
beforeEach(() => {
  vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://www.withmurph.ai");
  mocks.session.mockResolvedValue(session); mocks.active.mockResolvedValue(true); mocks.group.mockResolvedValue(false);
  mocks.decide.mockResolvedValue({ status: "declined" });
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe("the member's answer to a request Murph made", () => {
  it("passes only the decision, with the request and session, to the request's owner", async () => {
    const response = await post({ decision: "decline" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: { status: "declined" } });
    expect(mocks.decide).toHaveBeenCalledWith(expect.objectContaining({ session }), REQUEST_ID, "decline");
  });
  it("is hidden from signed-out visitors and group chats", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await post({ decision: "confirm" })).status).toBe(404);
    mocks.session.mockResolvedValue(session); mocks.group.mockResolvedValue(true);
    expect((await post({ decision: "confirm" })).status).toBe(404);
    expect(mocks.decide).not.toHaveBeenCalled();
  });
  it.each([
    ["another site", { origin: "https://other.example.com" }],
    ["no origin", {} as Record<string, string>],
  ])("refuses a confirmation from %s", async (_case, headers) => {
    expect((await post({ decision: "confirm" }, headers)).status).toBe(403);
    expect(mocks.decide).not.toHaveBeenCalled();
  });
  it.each([
    { decision: "confirm", arguments: { text: "something else" } },
    { decision: "confirm", tool: "delete_note" },
    { decision: "approve" },
    {},
  ])("refuses a body that carries anything but the decision: %j", async (body) => {
    expect((await post(body)).status).not.toBe(200);
    expect(mocks.decide).not.toHaveBeenCalled();
  });
});
