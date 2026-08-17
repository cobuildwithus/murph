import {
  createDeviceWebhookTransportPrivateKeyring,
  openDeviceWebhookQueueEnvelope,
  reencryptDeviceWebhookQueueEnvelopeForPersistence,
  sealDeviceWebhookQueueEnvelope,
} from "@murphai/cloudflare-hosted-control/device-webhook-queue";
import { describe, expect, it } from "vitest";

describe("device webhook Queue persistence in workerd", () => {
  it("opens a transport envelope and reseals it to the active key", async () => {
    const transportKeys = await createRecipientKeys();
    const persistenceKeys = await createRecipientKeys();
    expect("d" in transportKeys.publicJwk).toBe(true);
    expect(transportKeys.publicJwk.d).toBeUndefined();
    const envelope = await sealDeviceWebhookQueueEnvelope({
      env: "test",
      preparedWebhook: {
        acceptanceMode: "level_dirty_hint",
        eventType: "demo.updated",
        externalAccountId: "opaque-account",
        jobs: [],
        provider: "junction",
        receivedAt: "2026-08-15T00:00:00.000Z",
        schema: "murph.device-sync-prepared-webhook.v1",
        traceId: "1".repeat(64),
      },
      recipientKeyId: "automation:transport",
      recipientPublicJwk: transportKeys.publicJwk,
    });
    const keyring = createDeviceWebhookTransportPrivateKeyring({
      activePrivateJwk: persistenceKeys.privateJwk,
      activeRecipientKeyId: "automation:persistence",
      keyringJson: JSON.stringify({
        "automation:transport": {
          privateJwk: transportKeys.privateJwk,
          recipient: "cloudflare-automation-secret",
          status: "decrypt_only",
        },
      }),
    });

    const persisted = await reencryptDeviceWebhookQueueEnvelopeForPersistence({
      activeRecipientKeyId: "automation:persistence",
      env: "test",
      envelope,
      privateKeyring: keyring,
    });

    await expect(openDeviceWebhookQueueEnvelope({
      env: "test",
      envelope: persisted,
      privateKeyring: keyring,
    })).resolves.toMatchObject({
      preparedWebhook: { provider: "junction" },
    });
  });
});

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
