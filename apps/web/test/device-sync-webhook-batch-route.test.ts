import {
  DEVICE_WEBHOOK_ADMISSION_BATCH_SCHEMA,
  DEVICE_WEBHOOK_ADMISSION_MAX_BATCH_SIZE,
  DEVICE_WEBHOOK_ADMISSION_MAX_BODY_BYTES,
  DEVICE_WEBHOOK_QUEUE_PAYLOAD_SCHEMA,
  DEVICE_WEBHOOK_TRANSPORT_USER_ID,
  HOSTED_DEVICE_WEBHOOK_ADMISSION_PATH,
  type DeviceWebhookAdmissionBatchV1,
  type DeviceWebhookQueuePayloadV1,
} from "@murphai/cloudflare-hosted-control/device-webhook-queue";
import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import { encodeHostedExecutionSignedRequestPayload } from "@murphai/hosted-execution/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createIngress: vi.fn(),
  handleWebhook: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  createHostedDeviceSyncPublicIngressService: mocks.createIngress,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    $queryRaw: mocks.queryRaw,
  }),
}));

import { POST } from "../app/api/internal/device-sync/webhooks/admit-batch/route";

const ORIGINAL_CALLBACK_KEY_ID = process.env.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID;
const ORIGINAL_CALLBACK_PUBLIC_JWK = process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK;
const ORIGINAL_CALLBACK_PUBLIC_KEYRING =
  process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON;

describe("device webhook signed batch callback route", () => {
  let callbackPrivateJwkJson = "";
  let activeAdmissions = 0;
  let maxActiveAdmissions = 0;
  let replayRequests: Request[] = [];

  beforeEach(async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const [privateJwk, publicJwk] = await Promise.all([
      crypto.subtle.exportKey("jwk", keyPair.privateKey),
      crypto.subtle.exportKey("jwk", keyPair.publicKey),
    ]);
    callbackPrivateJwkJson = JSON.stringify(privateJwk);
    process.env.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID = "device-webhook-route-test";
    process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK = JSON.stringify(publicJwk);
    delete process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON;

    activeAdmissions = 0;
    maxActiveAdmissions = 0;
    replayRequests = [];
    mocks.createIngress.mockReset();
    mocks.handleWebhook.mockReset();
    mocks.queryRaw.mockReset();
    mocks.queryRaw.mockResolvedValue([{ admitted: true }]);
    mocks.createIngress.mockImplementation((request: Request) => {
      replayRequests.push(request);
      return { handleWebhook: mocks.handleWebhook };
    });
    mocks.handleWebhook.mockImplementation(async (
      provider: string,
      _rawBody: Buffer,
      _receivedAt: Date,
    ) => {
      activeAdmissions += 1;
      maxActiveAdmissions = Math.max(maxActiveAdmissions, activeAdmissions);
      await Promise.resolve();
      activeAdmissions -= 1;
      return {
        accepted: true,
        duplicate: false,
        eventType: "measurement.updated",
        provider,
        traceId: crypto.randomUUID(),
      };
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    restoreEnvironment(
      "HOSTED_WEB_CALLBACK_SIGNING_KEY_ID",
      ORIGINAL_CALLBACK_KEY_ID,
    );
    restoreEnvironment(
      "HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK",
      ORIGINAL_CALLBACK_PUBLIC_JWK,
    );
    restoreEnvironment(
      "HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON",
      ORIGINAL_CALLBACK_PUBLIC_KEYRING,
    );
  });

  it("accepts the exact signed subject and serially reconstructs 25 ordinary ingress requests", async () => {
    const batch = createAdmissionBatch(DEVICE_WEBHOOK_ADMISSION_MAX_BATCH_SIZE);
    const response = await POST(await createSignedRequest({
      body: JSON.stringify(batch),
      privateJwkJson: callbackPrivateJwkJson,
      userId: DEVICE_WEBHOOK_TRANSPORT_USER_ID,
    }));

    expect(response.status).toBe(200);
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(maxActiveAdmissions).toBe(1);
    expect(mocks.handleWebhook).toHaveBeenCalledTimes(25);
    expect(replayRequests).toHaveLength(25);
    for (const [index, entry] of batch.entries.entries()) {
      const [provider, rawBody, receivedAt] = mocks.handleWebhook.mock.calls[index]!;
      expect(provider).toBe(entry.provider);
      expect(Buffer.from(rawBody).equals(Buffer.from(entry.rawBodyBase64, "base64"))).toBe(true);
      expect(receivedAt).toEqual(new Date(entry.receivedAt));
      expect(replayRequests[index]?.url).toBe(
        `https://join.example.test/api/device-sync/webhooks/${entry.provider}`,
      );
      expect(replayRequests[index]?.headers.get("x-oura-signature")).toBe(
        entry.headers[0]?.value,
      );
    }
  });

  it("rejects a valid signature bound to the wrong subject before ordinary ingress", async () => {
    const response = await POST(await createSignedRequest({
      body: JSON.stringify(createAdmissionBatch(1)),
      privateJwkJson: callbackPrivateJwkJson,
      userId: "wrong-device-webhook-subject",
    }));

    expect(response.status).toBe(401);
    expect(mocks.createIngress).not.toHaveBeenCalled();
    expect(mocks.handleWebhook).not.toHaveBeenCalled();
  });

  it("rejects 26 entries and malformed signed JSON before ordinary ingress", async () => {
    const invalidBodies = [
      JSON.stringify(createAdmissionBatch(DEVICE_WEBHOOK_ADMISSION_MAX_BATCH_SIZE + 1)),
      "{",
    ];

    for (const body of invalidBodies) {
      const response = await POST(await createSignedRequest({
        body,
        privateJwkJson: callbackPrivateJwkJson,
        userId: DEVICE_WEBHOOK_TRANSPORT_USER_ID,
      }));
      expect(response.ok).toBe(false);
    }

    expect(mocks.createIngress).not.toHaveBeenCalled();
    expect(mocks.handleWebhook).not.toHaveBeenCalled();
  });

  it("rejects an oversized body before signature verification or ordinary ingress", async () => {
    const response = await POST(new Request(
      `https://join.example.test${HOSTED_DEVICE_WEBHOOK_ADMISSION_PATH}`,
      {
        body: "x".repeat(DEVICE_WEBHOOK_ADMISSION_MAX_BODY_BYTES + 1),
        headers: {
          "content-type": "application/json",
          [HOSTED_EXECUTION_USER_ID_HEADER]: DEVICE_WEBHOOK_TRANSPORT_USER_ID,
        },
        method: "POST",
      },
    ));

    expect(response.ok).toBe(false);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.createIngress).not.toHaveBeenCalled();
    expect(mocks.handleWebhook).not.toHaveBeenCalled();
  });
});

function createAdmissionBatch(count: number): DeviceWebhookAdmissionBatchV1 {
  return {
    entries: Array.from({ length: count }, (_, index) => createPayload(index)),
    schema: DEVICE_WEBHOOK_ADMISSION_BATCH_SCHEMA,
  };
}

function createPayload(index: number): DeviceWebhookQueuePayloadV1 {
  const suffix = index.toString(16).padStart(12, "0");
  const rawBody = JSON.stringify({ event: index, member: "opaque" });
  return {
    headers: [{ name: "x-oura-signature", value: `opaque-signature-${index}` }],
    provider: "oura",
    rawBodyBase64: Buffer.from(rawBody).toString("base64"),
    receivedAt: new Date(Date.parse("2026-04-10T12:00:00.000Z") + index * 1_000)
      .toISOString(),
    schema: DEVICE_WEBHOOK_QUEUE_PAYLOAD_SCHEMA,
    transportId: `00000000-0000-4000-8000-${suffix}`,
  };
}

async function createSignedRequest(input: {
  body: string;
  privateJwkJson: string;
  userId: string;
}): Promise<Request> {
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(input.privateJwkJson) as JsonWebKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    privateKey,
    encodeHostedExecutionSignedRequestPayload({
      method: "POST",
      nonce,
      path: HOSTED_DEVICE_WEBHOOK_ADMISSION_PATH,
      payload: input.body,
      timestamp,
      userId: input.userId,
    }),
  );
  return new Request(
    `https://join.example.test${HOSTED_DEVICE_WEBHOOK_ADMISSION_PATH}`,
    {
      body: input.body,
      headers: {
        "content-type": "application/json",
        [HOSTED_EXECUTION_NONCE_HEADER]: nonce,
        [HOSTED_EXECUTION_SIGNATURE_HEADER]: Buffer.from(signature).toString("base64url"),
        [HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER]: "device-webhook-route-test",
        [HOSTED_EXECUTION_TIMESTAMP_HEADER]: timestamp,
        [HOSTED_EXECUTION_USER_ID_HEADER]: input.userId,
      },
      method: "POST",
    },
  );
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
