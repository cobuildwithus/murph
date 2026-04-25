import { beforeEach, describe, expect, it, vi } from "vitest";
const hostedExecutionMocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );

  return {
    ...actual,
    emitHostedExecutionStructuredLog: hostedExecutionMocks.emitHostedExecutionStructuredLog,
  };
});

import { HOSTED_INGRESS_PAYLOAD_SCHEMA } from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  appendHostedEmailIngressWakeInWeb: vi.fn(),
  drainHostedRuns: vi.fn(),
  fetchHostedExecutionWebControlPlaneResponse: vi.fn(),
  nudgeHostedRun: vi.fn(),
  readHostedExecutionEnvironment: vi.fn(),
  resolveHostedExecutionUserCryptoContext: vi.fn(),
  resolveUserRunnerStub: vi.fn(),
}));

vi.mock("../src/env.ts", () => ({
  readHostedExecutionEnvironment: mocks.readHostedExecutionEnvironment,
}));

vi.mock("../src/web-control-plane-email-ingress.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/web-control-plane-email-ingress.ts")>(
    "../src/web-control-plane-email-ingress.ts",
  );

  return {
    ...actual,
    appendHostedEmailIngressWakeInWeb: mocks.appendHostedEmailIngressWakeInWeb,
  };
});

vi.mock("../src/web-control-plane.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/web-control-plane.ts")>(
    "../src/web-control-plane.ts",
  );

  return {
    ...actual,
    fetchHostedExecutionWebControlPlaneResponse: mocks.fetchHostedExecutionWebControlPlaneResponse,
  };
});

vi.mock("../src/worker-routes/shared.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/worker-routes/shared.ts")>(
    "../src/worker-routes/shared.ts",
  );

  return {
    ...actual,
    resolveHostedExecutionUserCryptoContext: mocks.resolveHostedExecutionUserCryptoContext,
    resolveUserRunnerStub: mocks.resolveUserRunnerStub,
  };
});

import {
  createHostedEmailUserAddress,
  readHostedEmailRawMessage,
  writeHostedEmailRawMessage,
} from "../src/hosted-email.ts";
import { handleHostedEmailIngress } from "../src/hosted-email/worker-ingress.ts";
import type { WorkerEnvironmentSource } from "../src/worker-routes/shared.ts";

import {
  createTestRootKey,
  MemoryEncryptedR2Bucket,
} from "./test-helpers.js";

const TEST_KEY = createTestRootKey(21);
const TEST_ENVIRONMENT = {
  hostedWebBaseUrl: "https://web.example.test",
  platformEnvelopeKey: TEST_KEY,
  platformEnvelopeKeyId: "v1",
  platformEnvelopeKeysById: {
    v1: TEST_KEY,
  },
  webCallbackSigning: {
    keyId: "v1",
    privateKeyJwkJson: "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"x\",\"y\":\"y\",\"d\":\"d\"}",
  },
  webControlTimeoutMs: 30_000,
};
const AUTHENTICATED_SENDER = {
  dkimAligned: false,
  dmarcPass: true,
  spfAligned: false,
};

describe("hosted email worker ingress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedExecutionEnvironment.mockReturnValue(TEST_ENVIRONMENT);
    mocks.resolveHostedExecutionUserCryptoContext.mockResolvedValue({
      rootKey: TEST_KEY,
      rootKeyId: "v1",
    });
    mocks.appendHostedEmailIngressWakeInWeb.mockResolvedValue({
      duplicate: false,
      inserted: true,
      updatedExisting: false,
      wake: {
        behavior: "ordered",
        createdAt: "2026-04-17T00:00:00.000Z",
        dedupeKey: "email:raw_123",
        id: "wake_123",
        kind: "conversation.message",
        occurredAt: "2026-04-17T00:00:00.000Z",
        payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
        quarantineCode: null,
        quarantinedAt: null,
        seq: "24",
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "user_123",
      },
    });
    mocks.drainHostedRuns.mockResolvedValue({
      committedSeq: "24",
      requestedTargetSeq: null,
      targetReached: true,
    });
    mocks.nudgeHostedRun.mockResolvedValue({
      accepted: true,
      alarmScheduled: true,
      alreadyRunning: false,
    });
    mocks.resolveUserRunnerStub.mockResolvedValue({
      drainHostedRuns: mocks.drainHostedRuns,
      nudgeHostedRun: mocks.nudgeHostedRun,
    });
  });

  it("rejects alias ingress from an unauthorized sender before raw-message persistence and dispatch", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    mocks.fetchHostedExecutionWebControlPlaneResponse
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ ok: true }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          userId: null,
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        },
      ));
    const replyAliasAddress = await createHostedEmailUserAddress({
      config: createHostedEmailConfig(),
      userId: "user_123",
      webCallbackSigning: TEST_ENVIRONMENT.webCallbackSigning,
      webControlBaseUrl: TEST_ENVIRONMENT.hostedWebBaseUrl,
    });
    const setReject = vi.fn();

    await handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "attacker@example.com",
      raw: buildRawEmail({
        from: "Attacker <attacker@example.com>",
        to: replyAliasAddress,
      }),
      setReject,
      to: replyAliasAddress,
    }, createWorkerEnv(bucket));

    expect(setReject).toHaveBeenCalledWith("Hosted email message was not accepted.");
    expect(mocks.drainHostedRuns).not.toHaveBeenCalled();
    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
    expect(mocks.resolveHostedExecutionUserCryptoContext).not.toHaveBeenCalled();
    expect(listHostedEmailMessageKeys(bucket)).toEqual([]);
    expect(hostedExecutionMocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.email",
        details: {
          hasEnvelopeFrom: true,
          hasHeaderFrom: true,
          hasRecipientAddress: true,
          reason: "ingress-route-miss-rejected",
        },
        level: "warn",
      }),
    );
  });

  it("does not treat forged raw authentication-result headers as provider-authenticated sender proof", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValueOnce(new Response(
      JSON.stringify({ ok: true }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));
    const replyAliasAddress = await createHostedEmailUserAddress({
      config: createHostedEmailConfig(),
      userId: "user_123",
      webCallbackSigning: TEST_ENVIRONMENT.webCallbackSigning,
      webControlBaseUrl: TEST_ENVIRONMENT.hostedWebBaseUrl,
    });
    const setReject = vi.fn();

    await handleHostedEmailIngress({
      authenticatedSender: null,
      from: "owner@example.com",
      raw: buildRawEmail({
        extraHeaders: [
          "Authentication-Results: mx.cloudflare.net; dkim=pass header.d=example.com; dmarc=pass header.from=example.com; spf=pass smtp.mailfrom=owner@example.com",
          "ARC-Authentication-Results: i=1; mx.cloudflare.net; dkim=pass header.d=example.com; dmarc=pass header.from=example.com; spf=pass smtp.mailfrom=owner@example.com",
        ],
        from: "Owner <owner@example.com>",
        to: replyAliasAddress,
      }),
      setReject,
      to: replyAliasAddress,
    }, createWorkerEnv(bucket));

    expect(setReject).toHaveBeenCalledWith("Hosted email message was not accepted.");
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedRuns).not.toHaveBeenCalled();
    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
    expect(listHostedEmailMessageKeys(bucket)).toEqual([]);
  });

  it("persists and dispatches alias ingress only after the web-owned verified-email authorization succeeds", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      void promise;
    });
    mocks.fetchHostedExecutionWebControlPlaneResponse
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ ok: true }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          userId: "user_123",
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        },
      ));
    const replyAliasAddress = await createHostedEmailUserAddress({
      config: createHostedEmailConfig(),
      userId: "user_123",
      webCallbackSigning: TEST_ENVIRONMENT.webCallbackSigning,
      webControlBaseUrl: TEST_ENVIRONMENT.hostedWebBaseUrl,
    });

    await handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: replyAliasAddress,
      }),
      to: replyAliasAddress,
    }, createWorkerEnv(bucket), { waitUntil });

    expect(mocks.appendHostedEmailIngressWakeInWeb).toHaveBeenCalledTimes(1);
    const [appendInput] = mocks.appendHostedEmailIngressWakeInWeb.mock.calls[0] ?? [];
    expect(appendInput).toMatchObject({
      body: {
        eventId: expect.any(String),
        identityId: "assistant@mail.example.test",
        occurredAt: expect.any(String),
        selfAddress: replyAliasAddress,
      },
      boundUserId: "user_123",
      timeoutMs: 30_000,
    });
    expect(mocks.drainHostedRuns).toHaveBeenCalledWith();
    expect(waitUntil).toHaveBeenCalledTimes(1);

    const rawMessageKey = appendInput?.body?.rawMessageKey;
    expect(typeof rawMessageKey).toBe("string");
    await expect(readHostedEmailRawMessage({
      bucket,
      key: TEST_KEY,
      keyId: "v1",
      rawMessageKey,
      userId: "user_123",
    })).resolves.toEqual(new TextEncoder().encode(buildRawEmail({
      from: "Owner <owner@example.com>",
      to: replyAliasAddress,
    })));
  });

  it("routes fixed public-sender ingress through the web-owned direct-public-sender authorization lookup", async () => {
    const bucket = new MemoryEncryptedR2Bucket();

    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      JSON.stringify({
        userId: "user_456",
      }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    await handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: "assistant@mail.example.test",
      }),
      to: "assistant@mail.example.test",
    }, createWorkerEnv(bucket));

    expect(mocks.appendHostedEmailIngressWakeInWeb).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedEmailIngressWakeInWeb).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        eventId: expect.any(String),
        identityId: "assistant@mail.example.test",
        occurredAt: expect.any(String),
        rawMessageKey: expect.any(String),
        selfAddress: "assistant@mail.example.test",
      }),
      boundUserId: "user_456",
    }));
    expect(mocks.nudgeHostedRun).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedRuns).toHaveBeenCalledWith();
    expect(listHostedEmailMessageKeys(bucket)).toHaveLength(1);
  });

  it("returns after nudging when the hosted email drain is already running", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    mocks.nudgeHostedRun.mockResolvedValueOnce({
      accepted: true,
      alarmScheduled: true,
      alreadyRunning: true,
    });
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      JSON.stringify({
        userId: "user_456",
      }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    await handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: "assistant@mail.example.test",
      }),
      to: "assistant@mail.example.test",
    }, createWorkerEnv(bucket));

    expect(mocks.nudgeHostedRun).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedRuns).not.toHaveBeenCalled();
  });

  it("falls back to the retry-arm nudge when the direct email drain call fails", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      void promise;
    });

    mocks.drainHostedRuns.mockRejectedValue(new Error("drain failed"));

    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      JSON.stringify({
        userId: "user_456",
      }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    mocks.resolveUserRunnerStub.mockResolvedValue({
      drainHostedRuns: mocks.drainHostedRuns,
      nudgeHostedRun: mocks.nudgeHostedRun,
    });

    await handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: "assistant@mail.example.test",
      }),
      to: "assistant@mail.example.test",
    }, createWorkerEnv(bucket), { waitUntil });

    expect(mocks.drainHostedRuns).toHaveBeenCalledWith();
    expect(mocks.nudgeHostedRun).toHaveBeenCalledTimes(2);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("deletes newly written raw email blobs when the canonical append fails with a permanent client HTTP response", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const appendError = Object.assign(
      new Error("Hosted email ingress wake append failed with HTTP 422."),
      {
        status: 422,
        statusCode: 422,
      },
    );

    mocks.appendHostedEmailIngressWakeInWeb.mockRejectedValueOnce(appendError);
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      JSON.stringify({
        userId: "user_456",
      }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    await expect(handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: "assistant@mail.example.test",
      }),
      to: "assistant@mail.example.test",
    }, createWorkerEnv(bucket))).rejects.toThrow(/HTTP 422/u);

    expect(mocks.drainHostedRuns).not.toHaveBeenCalled();
    expect(listHostedEmailMessageKeys(bucket)).toEqual([]);
  });

  it("keeps newly written raw email blobs when the canonical append fails with a transient HTTP response", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const appendError = Object.assign(
      new Error("Hosted email ingress wake append failed with HTTP 503."),
      {
        status: 503,
        statusCode: 503,
      },
    );

    mocks.appendHostedEmailIngressWakeInWeb.mockRejectedValueOnce(appendError);
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      JSON.stringify({
        userId: "user_456",
      }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    await expect(handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: "assistant@mail.example.test",
      }),
      to: "assistant@mail.example.test",
    }, createWorkerEnv(bucket))).rejects.toThrow(/HTTP 503/u);

    expect(mocks.drainHostedRuns).not.toHaveBeenCalled();
    expect(listHostedEmailMessageKeys(bucket)).toHaveLength(1);
  });

  it("keeps a preexisting raw email blob when a retry append fails for the same message", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const raw = buildRawEmail({
      from: "Owner <owner@example.com>",
      to: "assistant@mail.example.test",
    });
    const existingRawMessageKey = await writeHostedEmailRawMessage({
      bucket,
      key: TEST_KEY,
      keyId: "v1",
      plaintext: new TextEncoder().encode(raw),
      userId: "user_456",
    });
    const appendError = Object.assign(
      new Error("Hosted email ingress wake append failed with HTTP 503."),
      {
        status: 503,
        statusCode: 503,
      },
    );

    mocks.appendHostedEmailIngressWakeInWeb.mockRejectedValueOnce(appendError);
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      JSON.stringify({
        userId: "user_456",
      }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    await expect(handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw,
      to: "assistant@mail.example.test",
    }, createWorkerEnv(bucket))).rejects.toThrow(/HTTP 503/u);

    expect(listHostedEmailMessageKeys(bucket)).toHaveLength(1);
    await expect(readHostedEmailRawMessage({
      bucket,
      key: TEST_KEY,
      keyId: "v1",
      rawMessageKey: existingRawMessageKey,
      userId: "user_456",
    })).resolves.toEqual(new TextEncoder().encode(raw));
  });

  it("keeps fixed public-sender misses as accept-and-drop without append, reject, or persistence", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const setReject = vi.fn();

    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      JSON.stringify({
        userId: null,
      }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    await handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: "assistant@mail.example.test",
      }),
      setReject,
      to: "assistant@mail.example.test",
    }, createWorkerEnv(bucket));

    expect(setReject).not.toHaveBeenCalled();
    expect(mocks.appendHostedEmailIngressWakeInWeb).not.toHaveBeenCalled();
    expect(mocks.drainHostedRuns).not.toHaveBeenCalled();
    expect(listHostedEmailMessageKeys(bucket)).toEqual([]);
  });

  it("surfaces fixed public-sender callback transport failures instead of treating them as clean misses", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const setReject = vi.fn();

    mocks.fetchHostedExecutionWebControlPlaneResponse.mockRejectedValue(
      new Error("callback unavailable"),
    );

    await expect(handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: "assistant@mail.example.test",
      }),
      setReject,
      to: "assistant@mail.example.test",
    }, createWorkerEnv(bucket))).rejects.toThrow(/callback unavailable/u);

    expect(setReject).not.toHaveBeenCalled();
    expect(mocks.appendHostedEmailIngressWakeInWeb).not.toHaveBeenCalled();
    expect(mocks.drainHostedRuns).not.toHaveBeenCalled();
    expect(listHostedEmailMessageKeys(bucket)).toEqual([]);
  });

  it("surfaces fixed public-sender callback HTTP failures instead of treating them as clean misses", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const setReject = vi.fn();

    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(null, {
      status: 503,
    }));

    await expect(handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: "assistant@mail.example.test",
      }),
      setReject,
      to: "assistant@mail.example.test",
    }, createWorkerEnv(bucket))).rejects.toThrow(/HTTP 503/u);

    expect(setReject).not.toHaveBeenCalled();
    expect(mocks.appendHostedEmailIngressWakeInWeb).not.toHaveBeenCalled();
    expect(mocks.drainHostedRuns).not.toHaveBeenCalled();
    expect(listHostedEmailMessageKeys(bucket)).toEqual([]);
  });
});

function createHostedEmailConfig() {
  return {
    defaultSubject: "Murph update",
    domain: "mail.example.test",
    fromAddress: "assistant@mail.example.test",
    localPart: "assistant",
    signingSecret: "super-secret-signing-key",
  };
}

function createWorkerEnv(bucket: MemoryEncryptedR2Bucket) {
  return {
    BUNDLES: bucket,
    HOSTED_EMAIL_DOMAIN: "mail.example.test",
    HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
    HOSTED_EMAIL_LOCAL_PART: "assistant",
    HOSTED_EMAIL_SIGNING_SECRET: "super-secret-signing-key",
    HOSTED_WEB_BASE_URL: "https://web.example.test",
    RUNNER_CONTAINER: {
      getByName() {
        throw new Error("RUNNER_CONTAINER should not be used in hosted-email worker-ingress tests.");
      },
    },
    USER_RUNNER: {
      getByName() {
        throw new Error("USER_RUNNER.getByName should be mocked in hosted-email worker-ingress tests.");
      },
    },
  } satisfies WorkerEnvironmentSource;
}

function buildRawEmail(input: {
  extraHeaders?: string[];
  from: string;
  to: string;
}) {
  return [
    ...(input.extraHeaders ?? []),
    `From: ${input.from}`,
    `To: ${input.to}`,
    "Subject: hello",
    "",
    "hello from murph",
  ].join("\r\n");
}

function listHostedEmailMessageKeys(bucket: MemoryEncryptedR2Bucket): string[] {
  return [...bucket.objects.keys()].filter((key) => key.startsWith("hosted-email/messages/"));
}
