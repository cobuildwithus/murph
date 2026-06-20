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

import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_EMAIL_THREAD_TARGET_MAX_LENGTH,
  parseHostedEmailThreadTarget,
} from "@murphai/runtime-state";

const mocks = vi.hoisted(() => ({
  appendHostedEmailIngressWakeInWeb: vi.fn(),
  fetchHostedExecutionWebControlPlaneResponse: vi.fn(),
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
  readHostedEmailRawMessageRecoveryRef,
  writeHostedEmailRawMessage,
} from "../src/hosted-email.ts";
import { handleHostedEmailIngress as handleHostedEmailIngressImpl } from "../src/hosted-email/worker-ingress.ts";
import type { WorkerEnvironmentSource } from "../src/worker-routes/shared.ts";

import {
  createTestRootKey,
  MemoryEncryptedR2Bucket,
} from "./test-helpers.js";

type HostedEmailWorkerTestEnv = WorkerEnvironmentSource;

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

type HostedEmailWorkerIngressTestMessage = Parameters<typeof handleHostedEmailIngressImpl>[0] & {
  authenticatedSender?: typeof AUTHENTICATED_SENDER | null;
};

function handleHostedEmailIngress(
  message: HostedEmailWorkerIngressTestMessage,
  env: Parameters<typeof handleHostedEmailIngressImpl>[1],
  ctx?: Parameters<typeof handleHostedEmailIngressImpl>[2],
) {
  const { authenticatedSender, ...workerMessage } = message;

  return handleHostedEmailIngressImpl(workerMessage, env, ctx, {
    trustedSenderVerifier: () => authenticatedSender ?? null,
  });
}

describe("hosted email worker ingress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedExecutionEnvironment.mockReturnValue(TEST_ENVIRONMENT);
    mocks.resolveHostedExecutionUserCryptoContext.mockResolvedValue({
      rootKey: TEST_KEY,
      rootKeyId: "v1",
    });
    mocks.appendHostedEmailIngressWakeInWeb.mockResolvedValue({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: {
        createdAt: "2026-04-17T00:00:00.000Z",
        dedupeKey: "email:raw_123",
        expiresAt: null,
        id: "mailbox_item_123",
        kind: "conversation.message",
        lane: "conversation",
        laneSeq: "24",
        occurredAt: "2026-04-17T00:00:00.000Z",
        payloadBytes: 128,
        payloadInlineCiphertext: "ciphertext_inline_123",
        payloadRef: null,
        payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "user_123",
      },
    });
    mocks.resolveUserRunnerStub.mockResolvedValue({});
  });

  it("rejects alias ingress when the web-owned alias lookup misses before raw-message persistence and dispatch", async () => {
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

  it("does not treat forged raw authentication-result headers as direct-public sender proof", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
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
        to: "assistant@mail.example.test",
      }),
      setReject,
      to: "assistant@mail.example.test",
    }, createWorkerEnv(bucket));

    expect(setReject).not.toHaveBeenCalled();
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).not.toHaveBeenCalled();
    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
    expect(listHostedEmailMessageKeys(bucket)).toEqual([]);
  });

  it("accepts signed reply-alias ingress when no trusted sender verifier is configured", async () => {
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
    const setReject = vi.fn();

    await handleHostedEmailIngressImpl({
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: replyAliasAddress,
      }),
      setReject,
      to: replyAliasAddress,
    }, createWorkerEnv(bucket));

    expect(setReject).not.toHaveBeenCalled();
    expect(mocks.appendHostedEmailIngressWakeInWeb).toHaveBeenCalledTimes(1);
    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
    expect(listHostedEmailMessageKeys(bucket)).toHaveLength(1);
  });

  it("persists and nudges alias ingress only after the web-owned signed alias lookup succeeds", async () => {
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
    const env = createWorkerEnv(bucket);

    await handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: replyAliasAddress,
      }),
      to: replyAliasAddress,
    }, env);

    expect(mocks.appendHostedEmailIngressWakeInWeb).toHaveBeenCalledTimes(1);
    const [appendInput] = mocks.appendHostedEmailIngressWakeInWeb.mock.calls[0] ?? [];
    expect(appendInput).toMatchObject({
      body: {
        eventId: expect.any(String),
        from: "Owner <owner@example.com>",
        identityId: "assistant@mail.example.test",
        occurredAt: expect.any(String),
        selfAddress: replyAliasAddress,
        subject: "hello",
        textPreview: "hello from murph",
        to: [replyAliasAddress],
      },
      boundUserId: "user_123",
      timeoutMs: 30_000,
    });
    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();

    const rawMessageKey = appendInput?.body?.rawMessageKey;
    expect(typeof rawMessageKey).toBe("string");
    expect(appendInput?.body?.messageId).toBeNull();
    expect(appendInput?.body?.threadKey).toBe(rawMessageKey);
    const threadTarget = parseHostedEmailThreadTarget(
      appendInput?.body?.threadTarget,
    );
    expect(threadTarget).toMatchObject({
      lastMessageId: null,
      subject: "hello",
      to: ["owner@example.com"],
    });
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

  it("preserves long hosted email thread targets without truncation", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    mocks.appendHostedEmailIngressWakeInWeb.mockResolvedValue(undefined);
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
    const env = createWorkerEnv(bucket);
    const references = Array.from(
      { length: 12 },
      (_, index) => `<${"r".repeat(180)}-${index}@example.test>`,
    );

    await handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmail({
        extraHeaders: [
          `Message-ID: <${"m".repeat(180)}@example.test>`,
          `References: ${references.join(" ")}`,
        ],
        from: "Owner <owner@example.com>",
        to: replyAliasAddress,
      }),
      to: replyAliasAddress,
    }, env);

    const [appendInput] = mocks.appendHostedEmailIngressWakeInWeb.mock.calls[0] ?? [];
    const threadTargetValue = appendInput?.body?.threadTarget;
    expect(typeof threadTargetValue).toBe("string");
    expect(threadTargetValue?.length).toBeGreaterThan(2_048);
    expect(threadTargetValue?.length).toBeLessThanOrEqual(
      HOSTED_EMAIL_THREAD_TARGET_MAX_LENGTH,
    );
    expect(threadTargetValue?.endsWith("...")).toBe(false);
    const threadTarget = parseHostedEmailThreadTarget(threadTargetValue);
    expect(threadTarget?.lastMessageId).toBe(`<${"m".repeat(180)}@example.test>`);
    expect(threadTarget?.references).toHaveLength(12);
  });

  it("does not include original hosted email image attachment sizes in prompt projection", async () => {
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
    const env = createWorkerEnv(bucket);

    await handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmailWithAttachment({
        attachmentBase64: Buffer.from("original image bytes").toString("base64"),
        attachmentContentType: "image/png",
        attachmentFileName: "photo.png",
        body: "hello with attachment",
        from: "Owner <owner@example.com>",
        to: replyAliasAddress,
      }),
      to: replyAliasAddress,
    }, env);

    expect(mocks.appendHostedEmailIngressWakeInWeb).toHaveBeenCalledTimes(1);
    const [appendInput] = mocks.appendHostedEmailIngressWakeInWeb.mock.calls[0] ?? [];
    expect(appendInput?.body?.attachmentSummaries).toEqual([
      {
        contentType: "image/png",
        fileName: "photo.png",
        sizeBytes: null,
      },
    ]);
  });

  it("omits prompt projection metadata when parsed email body text is unavailable", async () => {
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
    const env = createWorkerEnv(bucket);

    await handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmail({
        body: "",
        from: "Owner <owner@example.com>",
        to: replyAliasAddress,
      }),
      to: replyAliasAddress,
    }, env);

    expect(mocks.appendHostedEmailIngressWakeInWeb).toHaveBeenCalledTimes(1);
    const [appendInput] = mocks.appendHostedEmailIngressWakeInWeb.mock.calls[0] ?? [];
    expect(appendInput?.body).toMatchObject({
      eventId: expect.any(String),
      identityId: "assistant@mail.example.test",
      occurredAt: expect.any(String),
      selfAddress: replyAliasAddress,
    });
    expect(appendInput?.body).not.toHaveProperty("attachmentSummaries");
    expect(appendInput?.body).not.toHaveProperty("cc");
    expect(appendInput?.body).not.toHaveProperty("from");
    expect(appendInput?.body).not.toHaveProperty("subject");
    expect(appendInput?.body).not.toHaveProperty("textPreview");
    expect(appendInput?.body).not.toHaveProperty("to");
  });

  it("posts hosted email appends to the mailbox callback route", async () => {
    const actualEmailIngressClient = await vi.importActual<
      typeof import("../src/web-control-plane-email-ingress.ts")
    >("../src/web-control-plane-email-ingress.ts");
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValueOnce(new Response(
      JSON.stringify({
        dedupeConflict: false,
        duplicate: false,
        inserted: true,
        item: {
          createdAt: "2026-04-17T00:00:00.000Z",
          dedupeKey: "email:raw_123",
          expiresAt: null,
          id: "mailbox_item_123",
          kind: "conversation.message",
          lane: "conversation",
          laneSeq: "24",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payloadBytes: 128,
          payloadInlineCiphertext: "ciphertext_inline_123",
          payloadRef: null,
          payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
          updatedAt: "2026-04-17T00:00:00.000Z",
          userId: "user_123",
        },
      }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    await expect(actualEmailIngressClient.appendHostedEmailIngressWakeInWeb({
      baseUrl: "https://web.example.test",
      body: {
        eventId: "email:raw_123",
        identityId: "identity_123",
        occurredAt: "2026-04-17T00:00:00.000Z",
        rawMessageKey: "raw_123",
        selfAddress: "assistant@example.test",
      },
      boundUserId: "user_123",
      callbackSigning: TEST_ENVIRONMENT.webCallbackSigning,
      fetchImpl: fetch,
      timeoutMs: 30_000,
    })).resolves.toMatchObject({
      item: {
        id: "mailbox_item_123",
        lane: "conversation",
        laneSeq: "24",
      },
    });
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/api/internal/hosted-mailbox/email-ingress",
      }),
    );
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
    const env = createWorkerEnv(bucket);

    await handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: "assistant@mail.example.test",
      }),
      to: "assistant@mail.example.test",
    }, env);

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
    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
    expect(listHostedEmailMessageKeys(bucket)).toHaveLength(1);
  });

  it("relies on the web append route to signal Temporal after appending the mailbox item", async () => {
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
    const env = createWorkerEnv(bucket);

    await handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: "assistant@mail.example.test",
      }),
      to: "assistant@mail.example.test",
    }, env);

    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
    expect(mocks.appendHostedEmailIngressWakeInWeb).toHaveBeenCalledTimes(1);
  });

  it("does not use a direct Durable Object nudge on the email handoff path", async () => {
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
    const env = createWorkerEnv(bucket);

    await handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: "assistant@mail.example.test",
      }),
      to: "assistant@mail.example.test",
    }, env);

    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
    expect(mocks.appendHostedEmailIngressWakeInWeb).toHaveBeenCalledTimes(1);
  });

  it("does not branch on direct nudge acceptance before completing email ingress", async () => {
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
    const env = createWorkerEnv(bucket);

    await handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: "assistant@mail.example.test",
      }),
      to: "assistant@mail.example.test",
    }, env);

    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
    expect(mocks.appendHostedEmailIngressWakeInWeb).toHaveBeenCalledTimes(1);
  });

  it("does not create a post-append Worker waitUntil nudge handoff", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const waitUntil = vi.fn();

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
    const env = createWorkerEnv(bucket);

    await handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: "assistant@mail.example.test",
      }),
      to: "assistant@mail.example.test",
    }, env, { waitUntil });

    expect(waitUntil).not.toHaveBeenCalled();
    expect(mocks.appendHostedEmailIngressWakeInWeb).toHaveBeenCalledTimes(1);
  });

  it("keeps newly written raw email blobs when the canonical append fails with a permanent client HTTP response", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const raw = buildRawEmail({
      from: "Owner <owner@example.com>",
      to: "assistant@mail.example.test",
    });
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
      raw,
      to: "assistant@mail.example.test",
    }, createWorkerEnv(bucket))).rejects.toThrow(/HTTP 422/u);

    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
    expect(mocks.appendHostedEmailIngressWakeInWeb).toHaveBeenCalledTimes(1);
    const [appendInput] = mocks.appendHostedEmailIngressWakeInWeb.mock.calls[0] ?? [];
    const rawMessageKey = appendInput?.body?.rawMessageKey;
    expect(typeof rawMessageKey).toBe("string");
    expect(listHostedEmailMessageKeys(bucket)).toHaveLength(1);
    expect(listHostedEmailRecoveryKeys(bucket)).toHaveLength(1);
    await expect(readHostedEmailRawMessage({
      bucket,
      key: TEST_KEY,
      keyId: "v1",
      rawMessageKey,
      userId: "user_456",
    })).resolves.toEqual(new TextEncoder().encode(raw));
  });

  it("keeps shared raw email blobs when duplicate append attempts split success and definitive failure", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const raw = buildRawEmail({
      from: "Owner <owner@example.com>",
      to: "assistant@mail.example.test",
    });
    const appendError = Object.assign(
      new Error("Hosted email ingress wake append failed with HTTP 422."),
      {
        status: 422,
        statusCode: 422,
      },
    );

    mocks.appendHostedEmailIngressWakeInWeb
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(appendError);
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockImplementation(() =>
      Promise.resolve(new Response(
        JSON.stringify({
          userId: "user_456",
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        },
      )),
    );

    const results = await Promise.allSettled([
      handleHostedEmailIngress({
        authenticatedSender: AUTHENTICATED_SENDER,
        from: "owner@example.com",
        raw,
        to: "assistant@mail.example.test",
      }, createWorkerEnv(bucket)),
      handleHostedEmailIngress({
        authenticatedSender: AUTHENTICATED_SENDER,
        from: "owner@example.com",
        raw,
        to: "assistant@mail.example.test",
      }, createWorkerEnv(bucket)),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
    expect(mocks.appendHostedEmailIngressWakeInWeb).toHaveBeenCalledTimes(2);
    const rawMessageKeys = mocks.appendHostedEmailIngressWakeInWeb.mock.calls
      .map(([appendInput]) => appendInput?.body?.rawMessageKey);
    expect(new Set(rawMessageKeys).size).toBe(1);
    const [rawMessageKey] = rawMessageKeys;
    expect(typeof rawMessageKey).toBe("string");
    expect(listHostedEmailMessageKeys(bucket)).toHaveLength(1);
    await expect(readHostedEmailRawMessage({
      bucket,
      key: TEST_KEY,
      keyId: "v1",
      rawMessageKey,
      userId: "user_456",
    })).resolves.toEqual(new TextEncoder().encode(raw));
  });

  it("keeps newly written raw email blobs when older web rejects a long envelope with HTTP 400", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const appendError = Object.assign(
      new Error("Hosted email ingress wake append failed with HTTP 400."),
      {
        status: 400,
        statusCode: 400,
      },
    );
    const references = Array.from(
      { length: 12 },
      (_, index) => `<${"r".repeat(180)}-${index}@example.test>`,
    );
    const raw = buildRawEmail({
      extraHeaders: [
        `Message-ID: <${"m".repeat(180)}@example.test>`,
        `References: ${references.join(" ")}`,
      ],
      from: "Owner <owner@example.com>",
      to: "assistant@mail.example.test",
    });

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
    }, createWorkerEnv(bucket))).rejects.toThrow(/HTTP 400/u);

    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
    expect(mocks.appendHostedEmailIngressWakeInWeb).toHaveBeenCalledTimes(1);
    const [appendInput] = mocks.appendHostedEmailIngressWakeInWeb.mock.calls[0] ?? [];
    const rawMessageKey = appendInput?.body?.rawMessageKey;
    expect(typeof rawMessageKey).toBe("string");
    const threadTargetValue = appendInput?.body?.threadTarget;
    expect(typeof threadTargetValue).toBe("string");
    expect(threadTargetValue?.length).toBeGreaterThan(2_048);
    expect(threadTargetValue?.length).toBeLessThanOrEqual(
      HOSTED_EMAIL_THREAD_TARGET_MAX_LENGTH,
    );
    expect(listHostedEmailMessageKeys(bucket)).toHaveLength(1);
    const [recoveryObjectKey] = listHostedEmailRecoveryKeys(bucket);
    expect(typeof recoveryObjectKey).toBe("string");
    expect(recoveryObjectKey).not.toContain("user_456");
    expect(recoveryObjectKey).not.toContain(rawMessageKey);
    await expect(readHostedEmailRawMessageRecoveryRef({
      bucket,
      key: TEST_KEY,
      keyId: "v1",
      objectKey: recoveryObjectKey,
      userId: "user_456",
    })).resolves.toMatchObject({
      eventId: `email:${rawMessageKey}`,
      identityId: "assistant@mail.example.test",
      rawMessageKey,
      rawMessageObjectKey: listHostedEmailMessageKeys(bucket)[0],
      routeAddress: "assistant@mail.example.test",
      userId: "user_456",
    });
    await expect(readHostedEmailRawMessage({
      bucket,
      key: TEST_KEY,
      keyId: "v1",
      rawMessageKey,
      userId: "user_456",
    })).resolves.toEqual(new TextEncoder().encode(raw));
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

    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
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
    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
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
    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
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
    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
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

function createWorkerEnv(bucket: MemoryEncryptedR2Bucket): HostedEmailWorkerTestEnv {
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
    RUNNER_CONTAINER_SMOKE: {
      getByName() {
        throw new Error("RUNNER_CONTAINER_SMOKE should not be used in hosted-email worker-ingress tests.");
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
  body?: string;
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
    input.body ?? "hello from murph",
  ].join("\r\n");
}

function buildRawEmailWithAttachment(input: {
  attachmentBase64: string;
  attachmentContentType: string;
  attachmentFileName: string;
  body: string;
  from: string;
  to: string;
}) {
  const boundary = "murph-test-boundary";

  return [
    `From: ${input.from}`,
    `To: ${input.to}`,
    "Subject: hello",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    input.body,
    `--${boundary}`,
    `Content-Type: ${input.attachmentContentType}; name="${input.attachmentFileName}"`,
    `Content-Disposition: attachment; filename="${input.attachmentFileName}"`,
    "Content-Transfer-Encoding: base64",
    "",
    input.attachmentBase64,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function listHostedEmailMessageKeys(bucket: MemoryEncryptedR2Bucket): string[] {
  return [...bucket.objects.keys()]
    .filter((key) => key.startsWith("hosted-email/messages/") && key.endsWith(".eml"));
}

function listHostedEmailRecoveryKeys(bucket: MemoryEncryptedR2Bucket): string[] {
  return [...bucket.objects.keys()]
    .filter((key) => key.startsWith("hosted-email/messages/") && key.endsWith(".recovery.json"));
}
