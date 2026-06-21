import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HostedResendPlainTextEmailError,
  readHostedResendPlainTextEmailConfig,
  sendHostedResendPlainTextEmail,
} from "@/src/lib/hosted-onboarding/resend-plain-text-email";

describe("hosted Resend plain-text email sender", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads shared sender env config and clamps the timeout", () => {
    expect(readHostedResendPlainTextEmailConfig({
      HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <founder@example.com>",
      HOSTED_SIGNUP_WELCOME_EMAIL_TIMEOUT_MS: "500",
      RESEND_API_KEY: "re_test",
    })).toEqual({
      apiKey: "re_test",
      from: "Murph <founder@example.com>",
      timeoutMs: 1_000,
    });

    expect(readHostedResendPlainTextEmailConfig({
      HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <founder@example.com>",
      HOSTED_SIGNUP_WELCOME_EMAIL_TIMEOUT_MS: "50000",
      RESEND_API_KEY: "re_test",
    })).toMatchObject({
      timeoutMs: 30_000,
    });

    expect(readHostedResendPlainTextEmailConfig({
      HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <founder@example.com>",
    })).toBeNull();
  });

  it("sends a plain-text Resend request with provider idempotency", async () => {
    const signal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const fetchMock: typeof fetch = async (input, init) => {
      expect(input).toBe("https://api.resend.com/emails");
      expect(init?.method).toBe("POST");
      expect(init?.signal).toBe(signal);
      expect(init?.headers).toMatchObject({
        Authorization: expect.stringMatching(/^Bearer\s+\S+$/u),
        "Content-Type": "application/json",
        "Idempotency-Key": "message/idempotency-key",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        from: "Murph <founder@example.com>",
        subject: "Subject",
        text: "Plain text only.",
        to: ["member@example.com"],
      });

      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };

    await expect(sendHostedResendPlainTextEmail({
      config: {
        apiKey: "re_test",
        from: "Murph <founder@example.com>",
        timeoutMs: 1_000,
      },
      fetchImpl: fetchMock,
      idempotencyKey: "message/idempotency-key",
      subject: "Subject",
      text: "Plain text only.",
      to: ["member@example.com"],
    })).resolves.toEqual({
      providerMessageId: "resend_email_123",
    });
    expect(timeoutSpy).toHaveBeenCalledWith(1_000);
  });

  it("tolerates successful Resend responses without a parseable provider id", async () => {
    await expect(sendHostedResendPlainTextEmail({
      config: {
        apiKey: "re_test",
        from: "Murph <founder@example.com>",
        timeoutMs: 1_000,
      },
      fetchImpl: async () => new Response("accepted", { status: 202 }),
      idempotencyKey: "message/idempotency-key",
      subject: "Subject",
      text: "Plain text only.",
      to: ["member@example.com"],
    })).resolves.toEqual({
      providerMessageId: null,
    });
  });

  it("throws sanitized provider metadata when Resend rejects the request", async () => {
    await expect(sendHostedResendPlainTextEmail({
      config: {
        apiKey: "re_sensitive_test",
        from: "Murph <founder@example.com>",
        timeoutMs: 1_000,
      },
      fetchImpl: async () => new Response("invalid key", { status: 401 }),
      idempotencyKey: "message/idempotency-key",
      subject: "Subject",
      text: "Plain text only.",
      to: ["member@example.com"],
    })).rejects.toMatchObject({
      code: "RESEND_SEND_FAILED",
      providerStatus: 401,
    } satisfies Partial<HostedResendPlainTextEmailError>);
  });
});
