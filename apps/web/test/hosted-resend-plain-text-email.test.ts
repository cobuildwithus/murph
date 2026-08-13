import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HostedResendPlainTextEmailError,
  readHostedResendPlainTextEmailConfig,
  sendHostedResendPlainTextEmail,
  sendHostedResendPlainTextEmailBatch,
} from "@/src/lib/hosted-onboarding/resend-plain-text-email";

describe("hosted Resend plain-text email sender", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
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

  it("sends a plain-text Resend SDK request with provider idempotency", async () => {
    const signal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const fetchMock: typeof fetch = async (input, init) => {
      expect(input).toBe("https://api.resend.com/emails");
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBe(signal);
      expectResendSdkHeaders(init?.headers, {
        idempotencyKey: "message/idempotency-key",
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

  it("preserves an explicit empty idempotency header", async () => {
    const fetchMock: typeof fetch = async (_input, init) => {
      expect(new Headers(init?.headers).get("idempotency-key")).toBe("");
      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };

    await sendHostedResendPlainTextEmail({
      config: {
        apiKey: "re_test",
        from: "Murph <founder@example.com>",
        timeoutMs: 1_000,
      },
      fetchImpl: fetchMock,
      idempotencyKey: "",
      subject: "Subject",
      text: "Plain text only.",
      to: ["member@example.com"],
    });
  });

  it("keeps fixed SDK transport defaults despite ambient overrides", async () => {
    vi.stubEnv("RESEND_BASE_URL", "http://127.0.0.1:4999");
    vi.stubEnv("RESEND_USER_AGENT", "unexpected-agent");
    const fetchMock: typeof fetch = async (input, init) => {
      expect(input).toBe("https://api.resend.com/emails");
      expect(new Headers(init?.headers).get("user-agent")).toBe(
        "resend-node:6.18.0",
      );
      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };

    await sendHostedResendPlainTextEmail({
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
    });
  });

  it("combines the caller abort with the timeout for a local E2E origin", async () => {
    const callerSignal = new AbortController().signal;
    const timeoutSignal = new AbortController().signal;
    const combinedSignal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutSignal);
    const anySpy = vi.spyOn(AbortSignal, "any")
      .mockReturnValue(combinedSignal);
    const fetchMock: typeof fetch = async (input, init) => {
      expect(input).toBe("http://127.0.0.1:4321/emails");
      expect(init?.signal).toBe(combinedSignal);
      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };

    await sendHostedResendPlainTextEmail({
      config: {
        apiBaseUrl: "http://127.0.0.1:4321",
        apiKey: "re_test",
        from: "Murph <founder@example.com>",
        timeoutMs: 1_000,
      },
      fetchImpl: fetchMock,
      idempotencyKey: "message/idempotency-key",
      signal: callerSignal,
      subject: "Subject",
      text: "Plain text only.",
      to: ["member@example.com"],
    });

    expect(timeoutSpy).toHaveBeenCalledWith(1_000);
    expect(anySpy).toHaveBeenCalledWith([callerSignal, timeoutSignal]);
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
    const consoleErrorSpy = vi.spyOn(console, "error")
      .mockImplementation(() => undefined);
    const cancel = vi.fn();

    await expect(sendHostedResendPlainTextEmail({
      config: {
        apiKey: "re_sensitive_test",
        from: "Murph <founder@example.com>",
        timeoutMs: 1_000,
      },
      fetchImpl: async () => new Response(
        new ReadableStream({ cancel }),
        { status: 401 },
      ),
      idempotencyKey: "message/idempotency-key",
      subject: "Subject",
      text: "Plain text only.",
      to: ["member@example.com"],
    })).rejects.toMatchObject({
      code: "RESEND_SEND_FAILED",
      message: "Hosted Resend email send failed.",
      providerStatus: 401,
    } satisfies Partial<HostedResendPlainTextEmailError>);
    expect(cancel).toHaveBeenCalledOnce();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("does not retry or translate an ambiguous transport failure", async () => {
    const transportFailure = new Error("transport outcome unknown");
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw transportFailure;
    });

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
    })).rejects.toBe(transportFailure);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends separate plain-text emails through one idempotent SDK batch", async () => {
    const signal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const fetchMock: typeof fetch = async (input, init) => {
      expect(input).toBe("https://api.resend.com/emails/batch");
      expect(init?.method).toBe("POST");
      expect(init?.signal).toBe(signal);
      expectResendSdkHeaders(init?.headers, {
        batchValidation: "strict",
        idempotencyKey: "batch/idempotency-key",
      });
      expect(JSON.parse(String(init?.body))).toEqual([
        {
          from: "Murph <founder@example.com>",
          subject: "Subject",
          text: "Plain text only.",
          to: ["first@example.com"],
        },
        {
          from: "Murph <founder@example.com>",
          subject: "Subject",
          text: "Plain text only.",
          to: ["second@example.com"],
        },
      ]);

      return new Response(JSON.stringify({
        data: [
          { id: "email_1" },
          { id: "" },
          { id: 42 },
          { id: "email_2", provider_extra: "ignored" },
        ],
      }), { status: 200 });
    };

    await expect(sendHostedResendPlainTextEmailBatch({
      config: {
        apiKey: "re_test",
        from: "Murph <founder@example.com>",
        timeoutMs: 1_000,
      },
      emails: [
        { subject: "Subject", text: "Plain text only.", to: ["first@example.com"] },
        { subject: "Subject", text: "Plain text only.", to: ["second@example.com"] },
      ],
      fetchImpl: fetchMock,
      idempotencyKey: "batch/idempotency-key",
    })).resolves.toEqual({
      providerMessageIds: ["email_1", "email_2"],
    });
    expect(timeoutSpy).toHaveBeenCalledWith(1_000);
  });

  it("returns only sanitized metadata when a batch is rejected", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(sendHostedResendPlainTextEmailBatch({
      config: {
        apiKey: "re_sensitive_test",
        from: "Murph <founder@example.com>",
        timeoutMs: 1_000,
      },
      emails: [
        { subject: "Private subject", text: "Private text", to: ["private@example.com"] },
      ],
      fetchImpl: async () => new Response("private failure", { status: 429 }),
      idempotencyKey: "batch/idempotency-key",
    })).rejects.toMatchObject({
      code: "RESEND_BATCH_SEND_FAILED",
      message: "Hosted Resend email batch send failed.",
      providerStatus: 429,
    } satisfies Partial<HostedResendPlainTextEmailError>);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});

function expectResendSdkHeaders(
  value: HeadersInit | undefined,
  input: {
    batchValidation?: "strict";
    idempotencyKey: string;
  },
): void {
  const headers = new Headers(value);

  expect(headers.get("authorization")).toMatch(/^Bearer\s+\S+$/u);
  expect(headers.get("content-type")).toBe("application/json");
  expect(headers.get("idempotency-key")).toBe(input.idempotencyKey);
  expect(headers.get("user-agent")).toBe("resend-node:6.18.0");
  expect(headers.get("x-batch-validation")).toBe(
    input.batchValidation ?? null,
  );
}
