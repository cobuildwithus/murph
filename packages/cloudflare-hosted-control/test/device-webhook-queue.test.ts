import { describe, expect, it } from "vitest";

import {
  canQueueDeviceWebhook,
  copyDeviceWebhookTransportHeaders,
  createDeviceWebhookTransportPrivateKeyring,
  decodeDeviceWebhookRawBody,
  DEVICE_WEBHOOK_QUEUE_MAX_RAW_BODY_BYTES,
  DEVICE_WEBHOOK_ADMISSION_HANDLER_MAX_DURATION_SECONDS,
  DEVICE_WEBHOOK_ADMISSION_TIMEOUT_MS,
  openDeviceWebhookQueueEnvelope,
  parseDeviceWebhookQueueEnvelope,
  sealDeviceWebhookQueueEnvelope,
} from "../src/device-webhook-queue.ts";

describe("device webhook queue transport", () => {
  it("keeps Web's hard duration below the Queue callback timeout", () => {
    expect(DEVICE_WEBHOOK_ADMISSION_TIMEOUT_MS).toBeGreaterThan(
      DEVICE_WEBHOOK_ADMISSION_HANDLER_MAX_DURATION_SECONDS * 1_000 + 10_000,
    );
  });
  it("round-trips exact bytes and signature headers through ciphertext-only Queue state", async () => {
    const keys = await createRecipientKeys();
    const rawBody = Uint8Array.from([0, 1, 2, 127, 128, 255]);
    const envelope = await sealDeviceWebhookQueueEnvelope({
      env: "test",
      headers: [
        { name: "x-whoop-signature", value: "distinctive-signature" },
        { name: "x-whoop-signature-timestamp", value: "1770000000" },
      ],
      provider: "whoop",
      rawBody,
      receivedAt: "2026-02-02T00:00:00.000Z",
      recipientKeyId: "automation:test",
      recipientPublicJwk: keys.publicJwk,
    });

    const visible = JSON.stringify(envelope);
    expect(visible).not.toContain("whoop");
    expect(visible).not.toContain("distinctive-signature");
    expect(visible).not.toContain("1770000000");
    expect(visible).not.toContain("rawBodyBase64");
    expect(new TextEncoder().encode(visible).byteLength).toBeLessThanOrEqual(120 * 1024);

    const payload = await openDeviceWebhookQueueEnvelope({
      env: "test",
      envelope: parseDeviceWebhookQueueEnvelope(envelope),
      privateKeyring: createDeviceWebhookTransportPrivateKeyring({
        activePrivateJwk: keys.privateJwk,
        activeRecipientKeyId: "automation:test",
      }),
    });
    expect(payload.provider).toBe("whoop");
    expect(payload.headers).toEqual([
      { name: "x-whoop-signature", value: "distinctive-signature" },
      { name: "x-whoop-signature-timestamp", value: "1770000000" },
    ]);
    expect(decodeDeviceWebhookRawBody(payload)).toEqual(rawBody);
  });

  it("fails closed for a wrong environment or tampered ciphertext", async () => {
    const keys = await createRecipientKeys();
    const privateKeyring = createDeviceWebhookTransportPrivateKeyring({
      activePrivateJwk: keys.privateJwk,
      activeRecipientKeyId: "automation:test",
    });
    const envelope = await sealDeviceWebhookQueueEnvelope({
      env: "test",
      headers: [],
      provider: "oura",
      rawBody: new TextEncoder().encode("{}"),
      receivedAt: "2026-02-02T00:00:00.000Z",
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

  it("keeps oversized bodies on the synchronous ingress path", () => {
    expect(canQueueDeviceWebhook({
      headers: [],
      rawBody: new Uint8Array(DEVICE_WEBHOOK_QUEUE_MAX_RAW_BODY_BYTES),
    })).toBe(true);
    expect(canQueueDeviceWebhook({
      headers: [],
      rawBody: new Uint8Array(DEVICE_WEBHOOK_QUEUE_MAX_RAW_BODY_BYTES + 1),
    })).toBe(false);
  });

  it("rejects unrelated or duplicate transport headers at the contract boundary", () => {
    expect(canQueueDeviceWebhook({
      headers: [{ name: "authorization", value: "private" }],
      rawBody: new Uint8Array(),
    })).toBe(false);
    expect(canQueueDeviceWebhook({
      headers: [
        { name: "x-oura-signature", value: "one" },
        { name: "X-Oura-Signature", value: "two" },
      ],
      rawBody: new Uint8Array(),
    })).toBe(false);
  });

  it("copies only each supported provider's signature contract", () => {
    const headers = new Headers({
      authorization: "private",
      cookie: "private",
      "svix-id": "junction-id",
      "svix-signature": "junction-signature",
      "svix-timestamp": "1770000000",
      "x-oura-signature": "oura-signature",
      "x-oura-timestamp": "1770000001",
      "x-strava-signature": "strava-signature",
      "x-whoop-signature": "whoop-signature",
      "x-whoop-signature-timestamp": "1770000002",
    });

    expect(copyDeviceWebhookTransportHeaders(headers)).toEqual([
      { name: "svix-id", value: "junction-id" },
      { name: "svix-signature", value: "junction-signature" },
      { name: "svix-timestamp", value: "1770000000" },
      { name: "x-oura-signature", value: "oura-signature" },
      { name: "x-oura-timestamp", value: "1770000001" },
      { name: "x-strava-signature", value: "strava-signature" },
      { name: "x-whoop-signature", value: "whoop-signature" },
      { name: "x-whoop-signature-timestamp", value: "1770000002" },
    ]);
  });

  it("decrypts an old envelope through a decrypt-only rotation key", async () => {
    const oldKeys = await createRecipientKeys();
    const activeKeys = await createRecipientKeys();
    const envelope = await sealDeviceWebhookQueueEnvelope({
      env: "test",
      headers: [],
      provider: "oura",
      rawBody: new TextEncoder().encode("{}"),
      receivedAt: "2026-02-02T00:00:00.000Z",
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
    })).resolves.toMatchObject({ provider: "oura" });
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

function replaceFirstBase64Character(value: string): string {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}
