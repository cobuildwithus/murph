import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../src/lib/prisma";

const mocks = vi.hoisted(() => ({ consume: vi.fn(), sendEmail: vi.fn() }));
vi.mock("../src/lib/better-auth/rate-limit", () => ({ hostedAuthRateLimitStorage: () => ({ consume: mocks.consume }) }));
vi.mock("../src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({ publicBaseUrl: "https://www.withmurph.ai", allowedMutationOrigins: [] }),
}));
vi.mock("../src/lib/hosted-onboarding/resend-plain-text-email", () => ({
  readHostedResendPlainTextEmailConfig: () => ({ apiKey: "synthetic-resend-key", from: "auth@example.test", timeoutMs: 1000 }),
  sendHostedResendPlainTextEmail: mocks.sendEmail,
}));
import { admitHostedAuthOtpRequest } from "../src/lib/better-auth/admission";
import { hostedAuthDelivery } from "../src/lib/better-auth/delivery";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("VERCEL", "");
  mocks.consume.mockResolvedValue({ allowed: true, retryAfter: null });
  mocks.sendEmail.mockResolvedValue({ providerMessageId: "synthetic-message" });
});

function request(body: unknown = { kind: "email", value: "member@example.test" }, headers: Record<string, string> = {}) {
  return new Request("https://www.withmurph.ai/api/auth/otp/send", {
    method: "POST", headers: { origin: "https://www.withmurph.ai", "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
}
const admit = (req: Request, transport: "browser" | "native" = "browser") => admitHostedAuthOtpRequest({
  request: req, transport, operation: "send", prisma: getPrisma(),
});

describe("auth request admission", () => {
  it("normalizes a bounded contact and applies independent IP, contact and resend limits", async () => {
    const result = await admit(request({ kind: "email", value: "MEMBER@example.test" }));
    expect(result.contact.value).toBe("member@example.test");
    expect(mocks.consume).toHaveBeenCalledTimes(3);
    mocks.consume.mockResolvedValueOnce({ allowed: false, retryAfter: 60 });
    await expect(admit(request())).rejects.toMatchObject({ code: "AUTH_RATE_LIMITED", httpStatus: 429 });
  });
  it.each(["browser", "native"] as const)("allows one immediate resend on %s while preserving broader limits", async (transport) => {
    await admit(request(), transport);
    expect(mocks.consume.mock.calls).toEqual([
      ["send:ip:127.0.0.1", { max: 20, window: 600 }],
      ["send:cooldown:email:member@example.test", { max: 2, window: 60 }],
      ["send:contact:email:member@example.test", { max: 5, window: 600 }],
    ]);
  });
  it.each(["email", "phone"] as const)("does not charge the ten-minute %s budget for a short-window rejection", async (kind) => {
    mocks.consume.mockImplementation(async (key: string) => ({
      allowed: !key.startsWith("send:cooldown:"), retryAfter: 35,
    }));
    await expect(admit(request({ kind, value: kind === "email" ? "member@example.test" : "+12025550142" })))
      .rejects.toMatchObject({ code: "AUTH_RATE_LIMITED", httpStatus: 429 });
    expect(mocks.consume).toHaveBeenCalledTimes(2);
    expect(mocks.consume.mock.calls.some(([key]) => key.startsWith("send:contact:"))).toBe(false);
  });
  it("retains the separate verification attempt budgets", async () => {
    await admitHostedAuthOtpRequest({ request: request({ kind: "email", value: "member@example.test", code: "654321" }),
      transport: "native", operation: "verify", prisma: getPrisma() });
    expect(mocks.consume.mock.calls).toEqual([
      ["verify:ip:127.0.0.1", { max: 100, window: 600 }],
      ["verify:contact:email:member@example.test", { max: 20, window: 600 }],
    ]);
  });
  it("rejects browser origin and credential confusion before touching limit state", async () => {
    await expect(admit(request(undefined, { origin: "https://untrusted.example" }))).rejects.toMatchObject({ httpStatus: 403 });
    await expect(admit(request(undefined, { authorization: "Bearer synthetic" }))).rejects.toMatchObject({ code: "AUTH_REQUEST_INVALID" });
    await expect(admit(request(undefined, { cookie: "murph-session=synthetic" }), "native")).rejects.toMatchObject({ code: "AUTH_REQUEST_INVALID" });
    expect(mocks.consume).not.toHaveBeenCalled();
  });
  it("rejects opaque aliases, unsupported methods and oversized contacts", async () => {
    for (const body of [
      { kind: "email", value: "synthetic@auth.invalid" }, { kind: "password", value: "synthetic" },
      { kind: "phone", value: "not-a-number" }, { kind: "email", value: "a".repeat(321) },
    ]) await expect(admit(request(body))).rejects.toMatchObject({ code: "AUTH_REQUEST_INVALID" });
    expect(mocks.consume).not.toHaveBeenCalled();
  });
  it("uses only the platform-owned address on hosted production requests", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VERCEL", "1");
    await expect(admit(request(undefined, { "x-forwarded-for": "198.51.100.2" }))).rejects.toMatchObject({ code: "AUTH_REQUEST_INVALID" });
    await admit(request(undefined, { "x-vercel-forwarded-for": "198.51.100.2", "x-forwarded-for": "203.0.113.4" }));
    expect(mocks.consume.mock.calls[0]?.[0]).toBe("send:ip:198.51.100.2");
    vi.stubEnv("VERCEL", "");
    await expect(admit(request())).rejects.toMatchObject({ code: "AUTH_REQUEST_INVALID" });
  });
});

describe("auth code delivery", () => {
  it("uses the existing email owner with a bounded code and unique delivery key", async () => {
    await hostedAuthDelivery().email({ address: "member@example.test", code: "123456" });
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^auth-/u), subject: "Your Murph sign-in code", to: ["member@example.test"],
      text: expect.stringContaining("123456"),
      html: expect.stringContaining(">123456</span>"),
    }));
    for (const code of ["invalid", "12345", "1234567", "<img src=x onerror=alert(1)>"]) {
      await expect(hostedAuthDelivery().email({ address: "member@example.test", code })).rejects.toMatchObject({ code: "AUTH_DELIVERY_UNAVAILABLE" });
    }
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });
  it("redacts provider exceptions from the public error", async () => {
    mocks.sendEmail.mockRejectedValue(new Error("synthetic upstream private detail"));
    await expect(hostedAuthDelivery().email({ address: "member@example.test", code: "123456" })).rejects.toMatchObject({
      code: "AUTH_DELIVERY_UNAVAILABLE", message: "We could not send a sign-in code. Try again shortly.",
    });
  });
});
