import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostedAuthSmsVerification } from "../src/lib/better-auth/twilio-verify";
import { runWithHostedDomainRootProviderCallsDisabled } from "../src/lib/hosted-crypto/domain-root-unwrap-cache";
import { jsonError } from "../src/lib/hosted-onboarding/http";

const account = `AC${"a".repeat(32)}`;
const service = `VA${"b".repeat(32)}`;
const sid = `VE${"c".repeat(32)}`;
const phoneNumber = "+12025550147";
const request = vi.fn<typeof fetch>();
const payload = (status: string, fields = {}) => ({
  account_sid: account, service_sid: service, sid, to: phoneNumber, channel: "sms", status, ...fields,
});

beforeEach(() => {
  vi.stubEnv("HOSTED_AUTH_TWILIO_ACCOUNT_SID", account);
  vi.stubEnv("HOSTED_AUTH_TWILIO_API_KEY_SID", `SK${"d".repeat(32)}`);
  vi.stubEnv("HOSTED_AUTH_TWILIO_API_KEY_SECRET", "synthetic-twilio-secret");
  vi.stubEnv("HOSTED_AUTH_TWILIO_VERIFY_SERVICE_SID", service);
  request.mockReset();
  vi.stubGlobal("fetch", request);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Twilio Verify SMS transport", () => {
  it("returns an actionable client error only for an explicitly rejected destination", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    request.mockResolvedValue(Response.json({ code: 60200, message: "Invalid parameter: To" }, { status: 400 }));
    const error = await hostedAuthSmsVerification().send({ phoneNumber }).catch((failure: unknown) => failure);
    const response = jsonError(error);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: {
      code: "AUTH_REQUEST_INVALID",
      message: "Check your phone number, including its country code, and try again.",
      retryable: false,
    } });
    expect(log).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it.each(["Channel", "RiskCheck"])("keeps invalid %s configuration diagnosable without blaming the phone number", async (parameter) => {
    request.mockResolvedValue(Response.json({ code: 60200, message: `Invalid parameter: ${parameter}` }, { status: 400 }));
    await expect(hostedAuthSmsVerification().send({ phoneNumber })).rejects.toMatchObject({
      code: "AUTH_DELIVERY_UNAVAILABLE", httpStatus: 503,
      cause: { message: `Twilio Verify send: provider_http; HTTP 400; code 60200; parameter ${parameter}; response parsed; parameterKind recognized.` },
    });
  });

  it.each([
    undefined, "Invalid parameter: To +12025550147", "Invalid parameter: private-contact@example.test",
  ])("does not infer a bad destination or retain private provider messages: %j", async (message) => {
    request.mockResolvedValue(Response.json({ code: 60200, message }, { status: 400 }));
    await expect(hostedAuthSmsVerification().send({ phoneNumber })).rejects.toMatchObject({
      code: "AUTH_DELIVERY_UNAVAILABLE", httpStatus: 503,
      cause: { message: `Twilio Verify send: provider_http; HTTP 400; code 60200; response parsed; parameterKind ${message ? "unrecognized" : "missing"}.` },
    });
  });

  it("logs unrecognized parameter diagnostics without retaining the rejected value", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      request.mockResolvedValue(Response.json({ code: 60200, message: `Invalid parameter: To ${phoneNumber}` }, { status: 400 }));
      const error = await hostedAuthSmsVerification().send({ phoneNumber }).catch((failure: unknown) => failure);
      const response = jsonError(error);
      expect(response.status).toBe(503);
      expect(log).toHaveBeenCalledWith("Hosted onboarding route failed.", expect.objectContaining({
        errorCauseMessage: "Twilio Verify send: provider_http; HTTP 400; code 60200; response parsed; parameterKind unrecognized.",
      }));
      expect(JSON.stringify(log.mock.calls)).not.toContain(phoneNumber);
      expect(JSON.stringify(await response.json())).not.toContain("parameterKind");
    } finally { log.mockRestore(); }
  });

  it("does not reinterpret a verification failure or server outage as an invalid send destination", async () => {
    request.mockResolvedValue(Response.json({ code: 60200, message: "Invalid parameter: To" }, { status: 400 }));
    await expect(hostedAuthSmsVerification().check({ phoneNumber, verificationSid: sid, code: "123456" }))
      .rejects.toMatchObject({ code: "AUTH_VERIFICATION_UNAVAILABLE", httpStatus: 503 });
    request.mockResolvedValue(Response.json({ code: 60200, message: "Invalid parameter: To" }, { status: 500 }));
    await expect(hostedAuthSmsVerification().send({ phoneNumber }))
      .rejects.toMatchObject({ code: "AUTH_DELIVERY_UNAVAILABLE", httpStatus: 503 });
  });

  it("keeps the provider status and numeric code in server logs while leaving the public response generic", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    request.mockResolvedValue(Response.json({ code: 60203, message: "synthetic private phone and credential", more_info: "https://example.test/private" }, { status: 429 }));
    const error = await hostedAuthSmsVerification().send({ phoneNumber }).catch((failure: unknown) => failure);
    const response = jsonError(error);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: {
      code: "AUTH_DELIVERY_UNAVAILABLE", message: "We could not send a sign-in code. Try again shortly.", retryable: false,
    } });
    expect(log).toHaveBeenCalledWith("Hosted onboarding route failed.", expect.objectContaining({
      errorCauseMessage: "Twilio Verify send: provider_http; HTTP 429; code 60203; response parsed.",
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic private");
    expect(JSON.stringify(log.mock.calls)).not.toContain("example.test/private");
    expect(request).toHaveBeenCalledOnce();
  });

  it.each(["private-code", 12, 60203.5, 100000, null])("omits invalid provider error codes: %j", async (code) => {
    request.mockResolvedValue(Response.json({ code, message: "synthetic private detail" }, { status: 403 }));
    await expect(hostedAuthSmsVerification().send({ phoneNumber })).rejects.toMatchObject({
      cause: { message: "Twilio Verify send: provider_http; HTTP 403; response parsed." },
    });
  });

  it("bounds rejected response reads and preserves HTTP failures after invalid JSON or a failed body read", async () => {
    const cancel = vi.fn();
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(4097)); }, cancel,
    });
    const broken = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("synthetic private detail")); } });
    for (const [body, kind] of [[oversized, "oversized"], ["invalid JSON", "invalid_json"], [broken, "read_failed"], [null, "missing"], ["[]", "invalid_shape"]] as const) {
      request.mockResolvedValue(new Response(body, { status: 502 }));
      await expect(hostedAuthSmsVerification().send({ phoneNumber })).rejects.toMatchObject({
        cause: { message: `Twilio Verify send: provider_http; HTTP 502; response ${kind}.` },
      });
    }
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("distinguishes missing configuration, transport, timeout and cancellation without retaining private causes", async () => {
    vi.stubEnv("HOSTED_AUTH_TWILIO_VERIFY_SERVICE_SID", "");
    await expect(hostedAuthSmsVerification().send({ phoneNumber })).rejects.toMatchObject({
      cause: { message: "Twilio Verify send: configuration." },
    });
    expect(request).not.toHaveBeenCalled();
    vi.stubEnv("HOSTED_AUTH_TWILIO_VERIFY_SERVICE_SID", service);
    request.mockRejectedValue(new TypeError("synthetic private network detail"));
    await expect(hostedAuthSmsVerification().send({ phoneNumber })).rejects.toMatchObject({ cause: { message: "Twilio Verify send: transport." } });
    request.mockRejectedValue(new DOMException("synthetic private timeout detail", "TimeoutError"));
    await expect(hostedAuthSmsVerification().send({ phoneNumber })).rejects.toMatchObject({ cause: { message: "Twilio Verify send: timeout." } });
    const controller = new AbortController();
    controller.abort();
    await expect(hostedAuthSmsVerification(controller.signal).send({ phoneNumber })).rejects.toMatchObject({ cause: { message: "Twilio Verify send: aborted." } });
  });

  it("starts a provider-generated SMS challenge with fraud controls and no custom code", async () => {
    request.mockResolvedValue(Response.json(payload("pending"), { status: 201 }));
    expect(await hostedAuthSmsVerification().send({ phoneNumber })).toBe(sid);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe(`https://verify.twilio.com/v2/Services/${service}/Verifications`);
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({ To: phoneNumber, Channel: "sms", RiskCheck: "enable" });
  });

  it("checks the exact saved verification and accepts only a matching approved SMS", async () => {
    request.mockResolvedValue(Response.json(payload("approved")));
    const verification = hostedAuthSmsVerification();
    expect(await verification.check({ phoneNumber, verificationSid: sid, code: "123456" })).toBe(true);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe(`https://verify.twilio.com/v2/Services/${service}/VerificationCheck`);
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({ VerificationSid: sid, Code: "123456" });
    for (const status of ["pending", "expired", "failed", "canceled", "max_attempts_reached"]) {
      request.mockResolvedValue(Response.json(payload(status)));
      expect(await verification.check({ phoneNumber, verificationSid: sid, code: "123456" })).toBe(false);
    }
    request.mockResolvedValue(new Response("synthetic provider detail", { status: 404 }));
    expect(await verification.check({ phoneNumber, verificationSid: sid, code: "123456" })).toBe(false);
  });

  it.each([
    { account_sid: `AC${"e".repeat(32)}` }, { service_sid: `VA${"e".repeat(32)}` },
    { sid: `VE${"e".repeat(32)}` }, { to: "+12025550148" }, { channel: "call" },
  ])("rejects provider approval with mismatched binding: %j", async (fields) => {
    request.mockResolvedValue(Response.json(payload("approved", fields)));
    await expect(hostedAuthSmsVerification().check({ phoneNumber, verificationSid: sid, code: "123456" }))
      .rejects.toMatchObject({ code: "AUTH_VERIFICATION_UNAVAILABLE", httpStatus: 503 });
  });

  it("rejects invalid configuration, contacts, and codes before network work", async () => {
    const verification = hostedAuthSmsVerification();
    expect(await verification.check({ phoneNumber, verificationSid: sid, code: "bad" })).toBe(false);
    await expect(verification.send({ phoneNumber: "invalid" })).rejects.toMatchObject({ code: "AUTH_DELIVERY_UNAVAILABLE" });
    vi.stubEnv("HOSTED_AUTH_TWILIO_VERIFY_SERVICE_SID", `MG${"b".repeat(32)}`);
    await expect(verification.send({ phoneNumber })).rejects.toMatchObject({ code: "AUTH_DELIVERY_UNAVAILABLE" });
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed on unsuccessful and malformed provider replies without exposing their bodies", async () => {
    for (const response of [new Response("synthetic private detail", { status: 403 }),
      new Response("invalid JSON"), Response.json([]), Response.json(payload("approved"))]) {
      request.mockResolvedValueOnce(response);
      await expect(hostedAuthSmsVerification().send({ phoneNumber })).rejects.toMatchObject({
        code: "AUTH_DELIVERY_UNAVAILABLE", message: "We could not send a sign-in code. Try again shortly.",
      });
    }
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("redacts provider failures, forwards cancellation and forbids calls inside transactions", async () => {
    const controller = new AbortController();
    request.mockRejectedValue(new Error("synthetic private upstream detail"));
    await expect(hostedAuthSmsVerification(controller.signal).send({ phoneNumber })).rejects.toMatchObject({
      code: "AUTH_DELIVERY_UNAVAILABLE", message: "We could not send a sign-in code. Try again shortly.",
    });
    controller.abort();
    expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    request.mockClear();
    await expect(runWithHostedDomainRootProviderCallsDisabled(() => hostedAuthSmsVerification().send({ phoneNumber })))
      .rejects.toMatchObject({ code: "AUTH_DELIVERY_UNAVAILABLE" });
    expect(request).not.toHaveBeenCalled();
  });
});
