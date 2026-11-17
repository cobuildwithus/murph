import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), active: vi.fn(), group: vi.fn(), decide: vi.fn(), challenge: vi.fn() }));
vi.mock("../src/lib/hosted-onboarding/app-session", () => ({ getHostedAppSessionFromRequest: mocks.session }));
vi.mock("../src/lib/hosted-onboarding/member-access", () => ({ readActiveHostedMemberAccess: mocks.active, isHostedThreadContainerMember: mocks.group,
  activeHostedPersonAccessWhere: () => ({ suspendedAt: null }) }));
vi.mock("../src/lib/custom-connections/action-confirm", () => ({ decideActionRequest: mocks.decide, issueActionConfirmChallenge: mocks.challenge }));
import { POST } from "../app/api/settings/custom-connections/requests/[requestId]/route";
import { POST as CHALLENGE } from "../app/api/settings/custom-connections/requests/[requestId]/challenge/route";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const REQUEST_ID = `car_${"a".repeat(32)}`;
const session = { member: { id: "member-a" }, sessionId: "browser-session" };
const SIGNED = { method: "passkey", token: `sac_${"b".repeat(32)}`, assertion: { id: "credential" } };
function post(body: unknown, headers: Record<string, string> = { origin: "https://www.withmurph.ai" }) {
  return POST(new Request(`https://www.withmurph.ai/api/settings/custom-connections/requests/${REQUEST_ID}`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ requestId: REQUEST_ID }) });
}
function challenge(headers: Record<string, string> = { origin: "https://www.withmurph.ai" }) {
  return CHALLENGE(new Request(`https://www.withmurph.ai/api/settings/custom-connections/requests/${REQUEST_ID}/challenge`, { method: "POST", headers }),
    { params: Promise.resolve({ requestId: REQUEST_ID }) });
}
beforeEach(() => {
  vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://www.withmurph.ai");
  mocks.session.mockResolvedValue(session); mocks.active.mockResolvedValue(true); mocks.group.mockResolvedValue(false);
  mocks.decide.mockResolvedValue({ status: "declined" });
  mocks.challenge.mockResolvedValue({ expiresAt: "2026-11-16T19:00:00.000Z", message: "Murph sensitive action authorization", token: SIGNED.token });
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe("the member's answer to a request Murph made", () => {
  it("passes a decline, and a confirmation with its passkey signature, to the request's owner", async () => {
    const declined = await post({ decision: "decline" });
    expect(declined.status).toBe(200);
    expect(await declined.json()).toEqual({ outcome: { status: "declined" } });
    expect(mocks.decide).toHaveBeenLastCalledWith(expect.objectContaining({ session }), REQUEST_ID, { decision: "decline" });
    expect((await post({ decision: "confirm", authorization: SIGNED })).status).toBe(200);
    expect(mocks.decide).toHaveBeenLastCalledWith(expect.objectContaining({ session }), REQUEST_ID, { decision: "confirm", authorization: SIGNED });
  });
  it("shows the passkey step's own message when it refuses", async () => {
    mocks.decide.mockRejectedValue(hostedOnboardingError({ code: "SENSITIVE_ACTION_AUTHORIZATION_REQUIRED", httpStatus: 400, message: "Secure approval is required to continue." }));
    const refused = await post({ decision: "confirm" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: { code: "SENSITIVE_ACTION_AUTHORIZATION_REQUIRED", message: "Secure approval is required to continue." } });
  });
  it("is hidden from signed-out visitors and group chats", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await post({ decision: "confirm" })).status).toBe(404);
    expect((await challenge()).status).toBe(404);
    mocks.session.mockResolvedValue(session); mocks.group.mockResolvedValue(true);
    expect((await post({ decision: "confirm" })).status).toBe(404);
    expect((await challenge()).status).toBe(404);
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.challenge).not.toHaveBeenCalled();
  });
  it.each([
    ["another site", { origin: "https://other.example.com" }],
    ["no origin", {} as Record<string, string>],
  ])("refuses a confirmation or a challenge from %s", async (_case, headers) => {
    expect((await post({ decision: "confirm" }, headers)).status).toBe(403);
    expect((await challenge(headers)).status).toBe(403);
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.challenge).not.toHaveBeenCalled();
  });
  it.each([
    { decision: "confirm", authorization: SIGNED, arguments: { text: "something else" } },
    { decision: "confirm", tool: "delete_note" },
    { decision: "decline", authorization: SIGNED },
    { decision: "approve" },
    {},
  ])("refuses a body that carries anything but the decision and its signature: %j", async (body) => {
    expect((await post(body)).status).not.toBe(200);
    expect(mocks.decide).not.toHaveBeenCalled();
  });
  it("issues a challenge for the member's session", async () => {
    const issued = await challenge();
    expect(issued.status).toBe(200);
    expect(await issued.json()).toMatchObject({ token: SIGNED.token });
    expect(mocks.challenge).toHaveBeenCalledWith(expect.objectContaining({ session }), REQUEST_ID);
  });
});
