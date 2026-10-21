import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  origin: vi.fn(), auth: vi.fn(), access: vi.fn(), consent: vi.fn(), gate: vi.fn(),
  control: vi.fn(), ensure: vi.fn(), owner: vi.fn(),
}));
vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({ assertHostedOnboardingMutationOrigin: mocks.origin }));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({ requireHostedAppSessionFromRequest: mocks.auth }));
vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({ assertActiveHostedMemberAccessAllowed: mocks.access }));
vi.mock("@/src/lib/legal/consent", () => ({ assertHostedHistoricalLaunchConsentGranted: mocks.consent }));
vi.mock("@/src/lib/hosted-orchestration/runtime-usage-decision", () => ({ resolveHostedRuntimeAiUsageGate: mocks.gate }));
vi.mock("@/src/lib/hosted-execution/runtime-owner-control", () => ({ executeHostedRuntimeOwnerCommand: mocks.owner }));
vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured: () => ({ controlVoice: mocks.control, ensureRuntimeProcessing: mocks.ensure }),
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({}) }));
import { POST } from "../app/api/voice/route";

const reserve = { action: "reserve", callId: "call-synthetic" };
const connect = { action: "connect", callId: reserve.callId, attemptId: "attempt-synthetic", leaseGeneration: "3", sdp: "v=0\r\noffer" };
const request = (body: unknown) => new Request("https://example.test/api/voice", { method: "POST", body: JSON.stringify(body) });
const denied = () => hostedOnboardingError({ code: "DENIED", httpStatus: 403, message: "Denied." });

describe("authenticated browser voice control", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ member: { id: "member-synthetic" } });
    mocks.gate.mockResolvedValue({ status: "allowed" });
    mocks.control.mockResolvedValue({ kind: "connected", sdp: "v=0\r\nanswer" });
    mocks.ensure.mockResolvedValue({ kind: "runtime_processing_accepted", runtimeAttemptId: "attempt-synthetic" });
    mocks.owner.mockResolvedValue({ cutover: "postgres", owner: { attemptId: "attempt-synthetic", generation: "3", phase: "active" } });
  });

  it("returns only the current owner fence after a successful reservation", async () => {
    const response = await POST(request(reserve));
    expect(await response.json()).toEqual({ kind: "reserved", callId: reserve.callId, attemptId: "attempt-synthetic", leaseGeneration: "3" });
    expect(mocks.ensure).toHaveBeenCalledWith({
      userId: "member-synthetic", voiceCallId: reserve.callId,
      orchestrationAttemptId: "voice-call-synthetic", commandTimeoutMs: 25000,
    });
    expect(mocks.control).not.toHaveBeenCalled();
  });

  it("forwards SDP only for the authenticated member and original runtime fence", async () => {
    const response = await POST(request(connect));
    expect(response.status).toBe(200);
    expect(mocks.control).toHaveBeenCalledWith({ userId: "member-synthetic", request: connect });
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it.each(["origin", "auth", "access", "consent"] as const)("rejects %s failure before any runtime command", async (boundary) => {
    if (boundary === "origin") mocks.origin.mockImplementationOnce(() => { throw denied(); });
    else mocks[boundary].mockRejectedValueOnce(denied());
    expect((await POST(request(connect))).status).toBe(403);
    expect(mocks.control).not.toHaveBeenCalled();
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it.each([
    { status: "denied", decision: { reason: "ai_usage_limit_exceeded" } },
    { status: "health_data_consent_withdrawn" },
  ])("rejects unavailable usage or withdrawn consent", async (gate) => {
    mocks.gate.mockResolvedValueOnce(gate);
    expect((await POST(request(reserve))).status).toBe(gate.status === "denied" ? 429 : 403);
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it("allows authenticated close after access, usage, or consent changes", async () => {
    mocks.access.mockRejectedValue(denied());
    mocks.consent.mockRejectedValue(denied());
    mocks.control.mockResolvedValueOnce({ kind: "closed", providerConfirmed: true, seconds: 12 });
    const { sdp: _sdp, ...close } = { ...connect, action: "close" };
    expect((await POST(request(close))).status).toBe(200);
    expect(mocks.control).toHaveBeenCalledWith({ userId: "member-synthetic", request: close });
    expect(mocks.gate).not.toHaveBeenCalled();
  });

  it.each([{ ...connect, userId: "other-member" }, { ...reserve, userId: "other-member" }, { ...connect, sdp: "invalid" }])(
    "rejects arbitrary member authority and malformed control", async (body) => {
      expect((await POST(request(body))).status).toBe(400);
      expect(mocks.control).not.toHaveBeenCalled();
      expect(mocks.ensure).not.toHaveBeenCalled();
    },
  );

  it("does not return a reservation for a replaced runtime", async () => {
    mocks.owner.mockResolvedValueOnce({ cutover: "postgres", owner: { attemptId: "new-attempt", generation: "4", phase: "active" } });
    expect(await (await POST(request(reserve))).json()).toEqual({ kind: "not_ready" });
  });

  it.each([{ kind: "retry_later" }, { accepted: true }])("fails closed on pending or old Worker admission", async (result) => {
    mocks.ensure.mockResolvedValueOnce(result);
    expect(await (await POST(request(reserve))).json()).toEqual({ kind: "not_ready" });
    expect(mocks.owner).not.toHaveBeenCalled();
  });
});
