import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ active: vi.fn(), group: vi.fn(), callback: vi.fn(), authority: vi.fn(), session: vi.fn(), csrf: vi.fn() }));
vi.mock("../src/lib/hosted-execution/cloudflare-callback-auth", () => ({ requireHostedCloudflareCallbackRequest: mocks.callback }));
vi.mock("@murphai/hosted-execution/auth", () => ({ readHostedExecutionRuntimeAuthority: mocks.authority }));
vi.mock("../src/lib/hosted-onboarding/member-access", () => ({ readActiveHostedMemberAccess: mocks.active, isHostedThreadContainerMember: mocks.group }));
vi.mock("../src/lib/hosted-onboarding/app-session", () => ({ getHostedAppSessionFromRequest: mocks.session }));
vi.mock("../src/lib/hosted-onboarding/csrf", () => ({ assertHostedOnboardingMutationOrigin: mocks.csrf }));
import { connectionMemberActive, requireConnectionCallback, requireConnectionSession } from "../src/lib/custom-connections/access";
import { connectionErrorResponse } from "../src/lib/custom-connections/errors";
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe("custom connection admission", () => {
  it.each(["not_allowlisted", "inactive", "synthetic"])("denies %s members", async (kind) => {
    vi.stubEnv("HOSTED_CUSTOM_CONNECTION_MEMBER_IDS", kind === "not_allowlisted" ? "other-member" : "member-a");
    mocks.active.mockResolvedValue(kind !== "inactive"); mocks.group.mockResolvedValue(kind === "synthetic");
    expect(await connectionMemberActive("member-a")).toBe(false);
  });
  it("requires a present fence even after signature verification", async () => {
    mocks.callback.mockResolvedValue("member-a"); mocks.authority.mockReturnValue(null);
    await expect(requireConnectionCallback(new Request("https://www.withmurph.ai/api/internal/custom-connections/manifest", { method: "POST" }))).rejects.toThrow();
    expect(mocks.callback).toHaveBeenCalledTimes(1);
  });
  it("propagates stale fence rejection from the canonical verifier", async () => {
    mocks.callback.mockRejectedValue(new Error("stale fence"));
    await expect(requireConnectionCallback(new Request("https://www.withmurph.ai"))).rejects.toThrow();
    expect(mocks.authority).not.toHaveBeenCalled();
  });
  it("hides settings from anonymous sessions and applies canonical CSRF to mutations", async () => {
    mocks.session.mockResolvedValue(null);
    await expect(requireConnectionSession(new Request("https://www.withmurph.ai"))).rejects.toMatchObject({ status: 404 });
    vi.stubEnv("HOSTED_CUSTOM_CONNECTION_MEMBER_IDS", "member-a");
    mocks.session.mockResolvedValue({ member: { id: "member-a" } }); mocks.active.mockResolvedValue(true); mocks.group.mockResolvedValue(false);
    mocks.csrf.mockImplementation(() => { throw new Error("foreign origin"); });
    await expect(requireConnectionSession(new Request("https://www.withmurph.ai"), true)).rejects.toThrow();
  });
  it("does not reflect secret-bearing upstream exceptions", async () => {
    const response = connectionErrorResponse(new Error("access_token=synthetic-secret refresh_token=synthetic-rotation"));
    expect(await response.text()).not.toContain("synthetic-");
  });
});
