import { describe, expect, it } from "vitest";

import {
  canQueuePreparedDeviceWebhook,
  createDeviceWebhookTransportPrivateKeyring,
  DEVICE_WEBHOOK_ADMISSION_HANDLER_MAX_DURATION_SECONDS,
  DEVICE_WEBHOOK_ADMISSION_TIMEOUT_MS,
  openDeviceWebhookQueueEnvelope,
  parseDeviceWebhookQueueEnvelope,
  readDeviceWebhookQueuePersistenceFailureCode,
  reencryptDeviceWebhookQueueEnvelopeForPersistence,
  sealDeviceWebhookQueueEnvelope,
} from "../src/device-webhook-queue.ts";
import {
  DEVICE_SYNC_PREPARED_WEBHOOK_SCHEMA,
  type PreparedDeviceSyncWebhookV1,
} from "@murphai/device-syncd/prepared-webhook";

describe("device webhook queue transport", () => {
  it("keeps Web's hard duration below the Queue callback timeout", () => {
    expect(DEVICE_WEBHOOK_ADMISSION_TIMEOUT_MS).toBeGreaterThan(
      DEVICE_WEBHOOK_ADMISSION_HANDLER_MAX_DURATION_SECONDS * 1_000 + 10_000,
    );
  });
  it("round-trips only provider-authenticated prepared meaning through ciphertext-only Queue state", async () => {
    const keys = await createRecipientKeys();
    const preparedWebhook = createPreparedWebhook();
    const envelope = await sealDeviceWebhookQueueEnvelope({
      env: "test",
      preparedWebhook,
      recipientKeyId: "automation:test",
      recipientPublicJwk: keys.publicJwk,
    });

    const visible = JSON.stringify(envelope);
    expect(visible).not.toContain("whoop");
    expect(visible).not.toContain("opaque-account");
    expect(visible).not.toContain("demo.updated");
    expect(new TextEncoder().encode(visible).byteLength).toBeLessThanOrEqual(120 * 1024);

    const payload = await openDeviceWebhookQueueEnvelope({
      env: "test",
      envelope: parseDeviceWebhookQueueEnvelope(envelope),
      privateKeyring: createDeviceWebhookTransportPrivateKeyring({
        activePrivateJwk: keys.privateJwk,
        activeRecipientKeyId: "automation:test",
      }),
    });
    expect(payload.preparedWebhook).toEqual(preparedWebhook);
    expect(payload).not.toHaveProperty("headers");
    expect(payload).not.toHaveProperty("rawBodyBase64");
  });

  it("fails closed for a wrong environment or tampered ciphertext", async () => {
    const keys = await createRecipientKeys();
    const privateKeyring = createDeviceWebhookTransportPrivateKeyring({
      activePrivateJwk: keys.privateJwk,
      activeRecipientKeyId: "automation:test",
    });
    const envelope = await sealDeviceWebhookQueueEnvelope({
      env: "test",
      preparedWebhook: createPreparedWebhook(),
      recipientKeyId: "automation:test",
      recipientPublicJwk: keys.publicJwk,
    });

    await expectPersistenceFailureCode(
      openDeviceWebhookQueueEnvelope({
        env: "production",
        envelope,
        privateKeyring,
      }),
      "transport_context_mismatch",
    );

    const tampered = structuredClone(envelope);
    tampered.encryptedPayload.ciphertext = replaceFirstBase64Character(
      tampered.encryptedPayload.ciphertext,
    );
    await expectPersistenceFailureCode(
      openDeviceWebhookQueueEnvelope({
        env: "test",
        envelope: tampered,
        privateKeyring,
      }),
      "transport_payload_open_failed",
    );
  });

  it("distinguishes unavailable recipients from a mismatched private key", async () => {
    const sealingKeys = await createRecipientKeys();
    const workerKeys = await createRecipientKeys();
    const envelope = await sealDeviceWebhookQueueEnvelope({
      env: "test",
      preparedWebhook: createPreparedWebhook(),
      recipientKeyId: "automation:sealing",
      recipientPublicJwk: sealingKeys.publicJwk,
    });

    await expectPersistenceFailureCode(
      openDeviceWebhookQueueEnvelope({
        env: "test",
        envelope,
        privateKeyring: createDeviceWebhookTransportPrivateKeyring({
          activePrivateJwk: workerKeys.privateJwk,
          activeRecipientKeyId: "automation:worker",
        }),
      }),
      "transport_recipient_key_unavailable",
    );
    await expectPersistenceFailureCode(
      openDeviceWebhookQueueEnvelope({
        env: "test",
        envelope,
        privateKeyring: createDeviceWebhookTransportPrivateKeyring({
          activePrivateJwk: workerKeys.privateJwk,
          activeRecipientKeyId: "automation:sealing",
        }),
      }),
      "transport_root_key_unwrap_failed",
    );
  });

  it("rejects malformed prepared meaning at the Queue contract boundary", () => {
    const malformed = {
      ...createPreparedWebhook(),
      schema: "murph.device-sync-prepared-webhook.v2",
    };
    expect(canQueuePreparedDeviceWebhook(malformed as PreparedDeviceSyncWebhookV1)).toBe(false);
  });

  it("decrypts an old envelope through a decrypt-only rotation key", async () => {
    const oldKeys = await createRecipientKeys();
    const activeKeys = await createRecipientKeys();
    const envelope = await sealDeviceWebhookQueueEnvelope({
      env: "test",
      preparedWebhook: createPreparedWebhook(),
      recipientKeyId: "automation:old",
      recipientPublicJwk: oldKeys.publicJwk,
    });

    const privateKeyring = createDeviceWebhookTransportPrivateKeyring({
      activePrivateJwk: activeKeys.privateJwk,
      activeRecipientKeyId: "automation:active",
      keyringJson: JSON.stringify({
        "automation:old": {
          privateJwk: oldKeys.privateJwk,
          recipient: "cloudflare-automation-secret",
          status: "decrypt_only",
        },
      }),
    });
    await expect(openDeviceWebhookQueueEnvelope({
      env: "test",
      envelope,
      privateKeyring,
    })).resolves.toMatchObject({
      preparedWebhook: { provider: "whoop" },
    });

    const persisted = await reencryptDeviceWebhookQueueEnvelopeForPersistence({
      activeRecipientKeyId: "automation:active",
      env: "test",
      envelope,
      privateKeyring,
    });
    expect(persisted.transportId).not.toBe(envelope.transportId);
    await expect(openDeviceWebhookQueueEnvelope({
      env: "test",
      envelope: persisted,
      privateKeyring: createDeviceWebhookTransportPrivateKeyring({
        activePrivateJwk: activeKeys.privateJwk,
        activeRecipientKeyId: "automation:active",
      }),
    })).resolves.toMatchObject({
      preparedWebhook: { provider: "whoop" },
    });
  });

  it("classifies an unusable active persistence key before Queue storage", async () => {
    const oldKeys = await createRecipientKeys();
    const activeKeys = await createRecipientKeys();
    const envelope = await sealDeviceWebhookQueueEnvelope({
      env: "test",
      preparedWebhook: createPreparedWebhook(),
      recipientKeyId: "automation:old",
      recipientPublicJwk: oldKeys.publicJwk,
    });
    const privateKeyring = createDeviceWebhookTransportPrivateKeyring({
      activePrivateJwk: {
        ...activeKeys.privateJwk,
        x: "not-base64url",
      },
      activeRecipientKeyId: "automation:active",
      keyringJson: JSON.stringify({
        "automation:old": {
          privateJwk: oldKeys.privateJwk,
          recipient: "cloudflare-automation-secret",
          status: "decrypt_only",
        },
      }),
    });

    await expectPersistenceFailureCode(
      reencryptDeviceWebhookQueueEnvelopeForPersistence({
        activeRecipientKeyId: "automation:active",
        env: "test",
        envelope,
        privateKeyring,
      }),
      "persistence_reseal_failed",
    );
  });
});

function createPreparedWebhook(): PreparedDeviceSyncWebhookV1 {
  return {
    acceptanceMode: "durable_webhook_work",
    eventType: "demo.updated",
    externalAccountId: "opaque-account",
    jobs: [],
    provider: "whoop",
    receivedAt: "2026-02-02T00:00:00.000Z",
    schema: DEVICE_SYNC_PREPARED_WEBHOOK_SCHEMA,
    traceId: "1".repeat(64),
  };
}

async function createRecipientKeys(): Promise<{
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}> {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  return {
    privateJwk: await crypto.subtle.exportKey("jwk", keys.privateKey),
    publicJwk: await crypto.subtle.exportKey("jwk", keys.publicKey),
  };
}

async function expectPersistenceFailureCode(
  promise: Promise<unknown>,
  expectedCode: ReturnType<typeof readDeviceWebhookQueuePersistenceFailureCode>,
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected device webhook Queue persistence to fail.");
  } catch (error) {
    expect(readDeviceWebhookQueuePersistenceFailureCode(error)).toBe(expectedCode);
  }
}

function replaceFirstBase64Character(value: string): string {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}
