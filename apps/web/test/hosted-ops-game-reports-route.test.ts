import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  reviewGameReport: vi.fn(),
}));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest: mocks.requireActiveHostedAppSessionFromRequest,
}));
vi.mock("@/src/lib/game/report-review", () => ({ reviewGameReport: mocks.reviewGameReport }));

import { POST } from "../app/api/ops/game-reports/route";

const base = "https://www.withmurph.ai";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", base);
  vi.stubEnv("HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS", "");
  vi.stubEnv("HOSTED_OPS_MEMBER_IDS", "member_operator");
  mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({ member: { id: "member_operator" } });
  mocks.reviewGameReport.mockResolvedValue({ found: true });
});
afterEach(() => vi.unstubAllEnvs());

function request(body: unknown, origin = base) {
  return new Request(`${base}/api/ops/game-reports`, {
    body: JSON.stringify(body), headers: { "Content-Type": "application/json", Origin: origin }, method: "POST",
  });
}

describe("game report review Ops boundary", () => {
  it("applies only the actions an operator chose, then answers with the report", async () => {
    const response = await POST(request({ reportId: "report_0001", removePost: true, suspendMember: "yes" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, reportId: "report_0001" });
    expect(mocks.reviewGameReport).toHaveBeenCalledWith({ endGames: false, removePost: true, reportId: "report_0001", suspendMember: false });
  });

  it("hides the action from anyone but an operator, and refuses foreign origins and bad ids", async () => {
    expect((await POST(request({ reportId: "report_0001" }, "https://untrusted.example"))).status).toBe(403);
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({ member: { id: "member_other" } });
    expect((await POST(request({ reportId: "report_0001" }))).status).toBe(404);
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({ member: { id: "member_operator" } });
    expect((await POST(request({ reportId: "x" }))).status).toBe(400);
    mocks.reviewGameReport.mockResolvedValue({ found: false });
    expect((await POST(request({ reportId: "report_0002" }))).status).toBe(404);
    expect(mocks.reviewGameReport).toHaveBeenCalledTimes(1);
  });
});
