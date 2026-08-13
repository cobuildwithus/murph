import { describe, expect, it } from "vitest";

import {
  canQueuePreparedDeviceWebhook,
  createDeviceWebhookTransportPrivateKeyring,
  DEVICE_WEBHOOK_ADMISSION_HANDLER_MAX_DURATION_SECONDS,
  DEVICE_WEBHOOK_ADMISSION_TIMEOUT_MS,
  openDeviceWebhookQueueEnvelope,
  parseDeviceWebhookQueueEnvelope,
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

    await expect(openDeviceWebhookQueueEnvelope({
      env: "production",
      envelope,
      privateKeyring,
    })).rejects.toThrow("context mismatch");

    const tampered = structuredClone(envelope);
    tampered.encryptedPayload.ciphertext = replaceFirstBase64Character(
      tampered.encryptedPayload.ciphertext,
    );
    await expect(openDeviceWebhookQueueEnvelope({
      env: "test",
      envelope: tampered,
      privateKeyring,
    })).rejects.toThrow();
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

    await expect(openDeviceWebhookQueueEnvelope({
      env: "test",
      envelope,
      privateKeyring: createDeviceWebhookTransportPrivateKeyring({
        activePrivateJwk: activeKeys.privateJwk,
        activeRecipientKeyId: "automation:active",
        keyringJson: JSON.stringify({
          "automation:old": {
            privateJwk: oldKeys.privateJwk,
            recipient: "cloudflare-automation-secret",
            status: "decrypt_only",
          },
        }),
      }),
    })).resolves.toMatchObject({
      preparedWebhook: { provider: "whoop" },
    });
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

function replaceFirstBase64Character(value: string): string {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}
