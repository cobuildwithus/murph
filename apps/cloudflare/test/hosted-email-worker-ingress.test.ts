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
  parseHostedEmailThreadTarget,
} from "@murphai/runtime-state";

const mocks = vi.hoisted(() => ({
  appendHostedEmailIngressWakeInWeb: vi.fn(),
  fetchHostedExecutionWebControlPlaneResponse: vi.fn(),
  nudgeHostedRunner: vi.fn(),
  readHostedExecutionEnvironment: vi.fn(),
  resolveHostedExecutionUserCryptoContext: vi.fn(),
  resolveUserRunnerStub: vi.fn(),
  runUntilIdleOrBudget: vi.fn(),
  startHostedEmailIngressNudgeWorkflowInWeb: vi.fn(),
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
    startHostedEmailIngressNudgeWorkflowInWeb: mocks.startHostedEmailIngressNudgeWorkflowInWeb,
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
    mocks.nudgeHostedRunner.mockResolvedValue({
      accepted: true,
      alarmScheduled: true,
      alreadyRunning: false,
      inFlight: false,
      nextAlarmAt: null,
    });
    mocks.startHostedEmailIngressNudgeWorkflowInWeb.mockResolvedValue({
      runId: "workflow_run_123",
    });
    mocks.runUntilIdleOrBudget.mockResolvedValue({
      nextWakeAt: null,
      status: "idle",
    });
    mocks.resolveUserRunnerStub.mockResolvedValue({
      nudgeHostedRunner: mocks.nudgeHostedRunner,
      runUntilIdleOrBudget: mocks.runUntilIdleOrBudget,
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
    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
    expect(listHostedEmailMessageKeys(bucket)).toEqual([]);
  });

  it("persists and nudges alias ingress only after the web-owned verified-email authorization succeeds", async () => {
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
    expect(mocks.nudgeHostedRunner).not.toHaveBeenCalled();
    expect(mocks.startHostedEmailIngressNudgeWorkflowInWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxItemId: "mailbox_item_123",
      }),
    );
    expect(mocks.runUntilIdleOrBudget).not.toHaveBeenCalled();

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

  it("posts hosted email nudge workflow starts to the pointer-only callback route", async () => {
    const actualEmailIngressClient = await vi.importActual<
      typeof import("../src/web-control-plane-email-ingress.ts")
    >("../src/web-control-plane-email-ingress.ts");
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValueOnce(new Response(
      JSON.stringify({
        runId: "workflow_run_123",
      }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    await expect(actualEmailIngressClient.startHostedEmailIngressNudgeWorkflowInWeb({
      baseUrl: "https://web.example.test",
      boundUserId: "user_123",
      callbackSigning: TEST_ENVIRONMENT.webCallbackSigning,
      fetchImpl: fetch,
      mailboxItemId: "mailbox_item_123",
      timeoutMs: 30_000,
    })).resolves.toEqual({
      runId: "workflow_run_123",
    });
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        body: JSON.stringify({
          mailboxItemId: "mailbox_item_123",
        }),
        method: "POST",
        path: "/api/internal/hosted-mailbox/email-ingress/nudge-workflow",
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
    expect(mocks.nudgeHostedRunner).not.toHaveBeenCalled();
    expect(mocks.startHostedEmailIngressNudgeWorkflowInWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxItemId: "mailbox_item_123",
      }),
    );
    expect(mocks.runUntilIdleOrBudget).not.toHaveBeenCalled();
    expect(listHostedEmailMessageKeys(bucket)).toHaveLength(1);
  });

  it("starts the durable email nudge workflow after appending the mailbox item", async () => {
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
    expect(mocks.nudgeHostedRunner).not.toHaveBeenCalled();
    expect(mocks.runUntilIdleOrBudget).not.toHaveBeenCalled();
    expect(mocks.startHostedEmailIngressNudgeWorkflowInWeb).toHaveBeenCalledWith({
      baseUrl: TEST_ENVIRONMENT.hostedWebBaseUrl,
      boundUserId: "user_456",
      callbackSigning: TEST_ENVIRONMENT.webCallbackSigning,
      fetchImpl: fetch,
      mailboxItemId: "mailbox_item_123",
      timeoutMs: TEST_ENVIRONMENT.webControlTimeoutMs,
    });
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

    expect(mocks.runUntilIdleOrBudget).not.toHaveBeenCalled();
    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunner).not.toHaveBeenCalled();
    expect(mocks.startHostedEmailIngressNudgeWorkflowInWeb).toHaveBeenCalledWith({
      baseUrl: TEST_ENVIRONMENT.hostedWebBaseUrl,
      boundUserId: "user_456",
      callbackSigning: TEST_ENVIRONMENT.webCallbackSigning,
      fetchImpl: fetch,
      mailboxItemId: "mailbox_item_123",
      timeoutMs: TEST_ENVIRONMENT.webControlTimeoutMs,
    });
  });

  it("does not branch on direct nudge acceptance before starting the email workflow", async () => {
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
    expect(mocks.nudgeHostedRunner).not.toHaveBeenCalled();
    expect(mocks.startHostedEmailIngressNudgeWorkflowInWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxItemId: "mailbox_item_123",
      }),
    );
  });

  it("uses the Worker execution context for post-append email workflow handoff", async () => {
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

    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
    expect(mocks.startHostedEmailIngressNudgeWorkflowInWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxItemId: "mailbox_item_123",
      }),
    );
  });

  it("keeps email ingress committed when the durable workflow handoff fails", async () => {
    const bucket = new MemoryEncryptedR2Bucket();

    mocks.startHostedEmailIngressNudgeWorkflowInWeb.mockRejectedValueOnce(
      new Error("workflow unavailable"),
    );
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

    await expect(handleHostedEmailIngress({
      authenticatedSender: AUTHENTICATED_SENDER,
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: "assistant@mail.example.test",
      }),
      to: "assistant@mail.example.test",
    }, env)).resolves.toBeUndefined();

    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunner).not.toHaveBeenCalled();
    expect(mocks.startHostedEmailIngressNudgeWorkflowInWeb).toHaveBeenCalledTimes(1);
    expect(hostedExecutionMocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "hosted.email",
        details: expect.objectContaining({
          reason: "runner-nudge-workflow-start-failed",
        }),
        level: "warn",
        message: "Hosted email runner nudge workflow failed to start after appending the canonical ingress event; ingress append remains committed.",
      }),
    );
    expect(listHostedEmailMessageKeys(bucket)).toHaveLength(1);
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

    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
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

function listHostedEmailMessageKeys(bucket: MemoryEncryptedR2Bucket): string[] {
  return [...bucket.objects.keys()].filter((key) => key.startsWith("hosted-email/messages/"));
}
