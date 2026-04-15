import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  fetchHostedExecutionWebControlPlaneResponse: vi.fn(),
  readHostedExecutionEnvironment: vi.fn(),
  resolveHostedExecutionUserCryptoContext: vi.fn(),
  resolveUserRunnerStub: vi.fn(),
}));

vi.mock("../src/env.ts", () => ({
  readHostedExecutionEnvironment: mocks.readHostedExecutionEnvironment,
}));

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
} from "../src/hosted-email.ts";
import { handleHostedEmailIngress } from "../src/hosted-email/worker-ingress.ts";
import type { WorkerEnvironmentSource } from "../src/worker-routes/shared.ts";

import {
  createTestRootKey,
  MemoryEncryptedR2Bucket,
} from "./test-helpers.js";

const TEST_KEY = createTestRootKey(21);
const TEST_ENVIRONMENT = {
  platformEnvelopeKey: TEST_KEY,
  platformEnvelopeKeyId: "v1",
  platformEnvelopeKeysById: {
    v1: TEST_KEY,
  },
  webCallbackSigning: {
    keyId: "v1",
    privateKeyJwkJson: "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"x\",\"y\":\"y\",\"d\":\"d\"}",
  },
};

describe("hosted email worker ingress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedExecutionEnvironment.mockReturnValue(TEST_ENVIRONMENT);
    mocks.resolveHostedExecutionUserCryptoContext.mockResolvedValue({
      rootKey: TEST_KEY,
      rootKeyId: "v1",
    });
    mocks.resolveUserRunnerStub.mockResolvedValue({
      dispatch: mocks.dispatch,
    });
  });

  it("rejects alias ingress from an unauthorized sender before raw-message persistence and dispatch", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const replyAliasAddress = await createHostedEmailUserAddress({
      bucket,
      config: createHostedEmailConfig(),
      key: TEST_KEY,
      keyId: "v1",
      userId: "user_123",
    });
    const setReject = vi.fn();

    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      JSON.stringify({
        authorized: false,
      }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    await handleHostedEmailIngress({
      from: "attacker@example.com",
      raw: buildRawEmail({
        from: "Attacker <attacker@example.com>",
        to: replyAliasAddress,
      }),
      setReject,
      to: replyAliasAddress,
    }, createWorkerEnv(bucket));

    expect(setReject).toHaveBeenCalledWith("Hosted email message was not accepted.");
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.resolveUserRunnerStub).not.toHaveBeenCalled();
    expect(mocks.resolveHostedExecutionUserCryptoContext).not.toHaveBeenCalled();
    expect(listHostedEmailMessageKeys(bucket)).toEqual([]);
  });

  it("persists and dispatches alias ingress only after the web-owned verified-email authorization succeeds", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const replyAliasAddress = await createHostedEmailUserAddress({
      bucket,
      config: createHostedEmailConfig(),
      key: TEST_KEY,
      keyId: "v1",
      userId: "user_123",
    });

    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      JSON.stringify({
        authorized: true,
      }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    await handleHostedEmailIngress({
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: replyAliasAddress,
      }),
      to: replyAliasAddress,
    }, createWorkerEnv(bucket));

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    const [dispatch] = mocks.dispatch.mock.calls[0] ?? [];
    expect(dispatch).toMatchObject({
      event: {
        identityId: "assistant@mail.example.test",
        kind: "email.message.received",
        selfAddress: replyAliasAddress,
        userId: "user_123",
      },
    });

    const rawMessageKey = dispatch?.event?.rawMessageKey;
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
      from: "owner@example.com",
      raw: buildRawEmail({
        from: "Owner <owner@example.com>",
        to: "assistant@mail.example.test",
      }),
      to: "assistant@mail.example.test",
    }, createWorkerEnv(bucket));

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        identityId: "assistant@mail.example.test",
        selfAddress: "assistant@mail.example.test",
        userId: "user_456",
      }),
    }));
    expect(listHostedEmailMessageKeys(bucket)).toHaveLength(1);
  });
});

function createHostedEmailConfig() {
  return {
    apiBaseUrl: "https://api.cloudflare.com/client/v4",
    cloudflareAccountId: "acct_123",
    cloudflareApiToken: "token_123",
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
    HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID: "acct_123",
    HOSTED_EMAIL_CLOUDFLARE_API_TOKEN: "token_123",
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
  from: string;
  to: string;
}) {
  return [
    `From: ${input.from}`,
    `To: ${input.to}`,
    "Subject: hello",
    "",
    "hello from murph",
  ].join("\r\n");
}

function listHostedEmailMessageKeys(bucket: MemoryEncryptedR2Bucket): string[] {
  return [...bucket.objects.keys()].filter((key) => key.startsWith("transient/hosted-email/messages/"));
}
