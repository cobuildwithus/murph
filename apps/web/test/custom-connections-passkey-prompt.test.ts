import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticator } from "./approval-webauthn-fixture";
const mocks = vi.hoisted(() => ({ request: vi.fn(), current: vi.fn(), passkeys: vi.fn(), challenge: vi.fn() }));
vi.mock("@/src/lib/sensitive-actions/passkey-http", () => ({ readApprovalPasskeyRequest: mocks.request }));
vi.mock("@/src/lib/sensitive-actions/passkey-store", () => ({ readApprovalPasskeyState: mocks.passkeys }));
vi.mock("@/src/lib/hosted-web/public-url", async (original) => ({ ...await original<typeof import("@/src/lib/hosted-web/public-url")>(), resolveHostedPublicOrigin: () => "https://www.withmurph.ai" }));
vi.mock("@/src/lib/custom-connections/action-confirm", () => ({ ACTION_CONFIRM_KIND: "custom-connection.action.confirm", actionConfirmChallengeIsCurrent: mocks.current }));
import { POST } from "../app/api/settings/approval-passkeys/authenticate/route";

const account = authenticator();
const token = `sac_${"c".repeat(32)}`;
const session = { member: { id: "member-a" }, sessionId: "browser-session" };
const authenticate = () => POST(new Request("https://www.withmurph.ai/api/settings/approval-passkeys/authenticate", { method: "POST" }));
beforeEach(() => {
  mocks.challenge.mockResolvedValue({ kind: "custom-connection.action.confirm", memberId: "member-a", bindingHash: "d".repeat(64), expiresAt: new Date(Date.now() + 600_000) });
  mocks.request.mockResolvedValue({ body: { token }, session, prisma: { hostedSensitiveActionChallenge: { findUnique: mocks.challenge } } });
  mocks.passkeys.mockResolvedValue({ credentials: [account.credential], encrypted: "synthetic", memberId: "member-a" });
});
afterEach(() => vi.resetAllMocks());
describe("the passkey prompt for confirming a change", () => {
  it("asks for the passkey when the challenge is this session's, for one of the member's waiting requests", async () => {
    mocks.current.mockResolvedValue(true);
    const response = await authenticate();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ method: "passkey" });
    expect(mocks.current).toHaveBeenCalledWith({ bindingHash: "d".repeat(64), memberId: "member-a", sessionId: "browser-session" });
  });
  it("refuses a challenge that no waiting request in this session matches", async () => {
    mocks.current.mockResolvedValue(false);
    expect((await authenticate()).status).toBe(410);
    expect(mocks.passkeys).not.toHaveBeenCalled();
  });
});
