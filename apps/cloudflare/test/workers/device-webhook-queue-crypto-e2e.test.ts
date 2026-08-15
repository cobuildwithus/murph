import { describe, expect, it } from "vitest";

import {
  createDeviceWebhookTransportPrivateKeyring,
  openDeviceWebhookQueueEnvelope,
  reencryptDeviceWebhookQueueEnvelopeForPersistence,
  sealDeviceWebhookQueueEnvelope,
} from "@murphai/cloudflare-hosted-control/device-webhook-queue";
import {
  DEVICE_SYNC_PREPARED_WEBHOOK_SCHEMA,
  type PreparedDeviceSyncWebhookV1,
} from "@murphai/device-syncd/prepared-webhook";

describe("device webhook Queue crypto in workerd", () => {
  it("opens an old transport envelope and reseals it to the active persistence key", async () => {
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

    const persisted = await reencryptDeviceWebhookQueueEnvelopeForPersistence({
      activeRecipientKeyId: "automation:active",
      env: "test",
      envelope,
      privateKeyring,
    });

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
  const privateJwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  return {
    privateJwk,
    publicJwk: {
      crv: publicJwk.crv,
      ext: true,
      key_ops: [],
      kty: publicJwk.kty,
      x: publicJwk.x,
      y: publicJwk.y,
    },
  };
}
