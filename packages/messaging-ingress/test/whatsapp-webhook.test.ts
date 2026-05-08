import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { test } from "vitest";

import {
  buildWhatsAppWebhookEventId,
  isWhatsAppWebhookPayloadError,
  isWhatsAppWebhookVerificationError,
  parseWhatsAppInboundTexts,
  parseWhatsAppWebhookBody,
  verifyAndParseWhatsAppWebhookRequest,
  verifyWhatsAppWebhookSignature,
} from "../src/whatsapp-webhook.ts";

test("verifyAndParseWhatsAppWebhookRequest validates the Meta signature envelope", () => {
  const payload = JSON.stringify(buildWhatsAppWebhookPayload());
  const signature = signWhatsAppWebhook("app-secret-123", payload);

  const body = verifyAndParseWhatsAppWebhookRequest({
    appSecret: "app-secret-123",
    headers: new Headers({
      "x-hub-signature-256": signature,
    }),
    rawBody: payload,
  });

  assert.equal(body.object, "whatsapp_business_account");
});

test("verifyAndParseWhatsAppWebhookRequest rejects invalid signatures", () => {
  const payload = JSON.stringify(buildWhatsAppWebhookPayload());

  assert.throws(
    () =>
      verifyAndParseWhatsAppWebhookRequest({
        appSecret: "app-secret-123",
        headers: {
          "x-hub-signature-256": "sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        rawBody: payload,
      }),
    (error: unknown) =>
      isWhatsAppWebhookVerificationError(error)
      && /Invalid WhatsApp webhook signature/u.test(error.message),
  );
});

test("verifyWhatsAppWebhookSignature rejects malformed signatures before timing-safe compare", () => {
  const payload = JSON.stringify(buildWhatsAppWebhookPayload());
  const signature = signWhatsAppWebhook("app-secret-123", payload);

  assert.equal(
    verifyWhatsAppWebhookSignature({
      appSecret: "app-secret-123",
      rawBody: payload,
      signature: signature.toUpperCase(),
    }),
    true,
  );

  assert.equal(
    verifyWhatsAppWebhookSignature({
      appSecret: "app-secret-123",
      rawBody: payload,
      signature: `${signature}ff`,
    }),
    false,
  );
  assert.equal(
    verifyWhatsAppWebhookSignature({
      appSecret: "app-secret-123",
      rawBody: payload,
      signature: "sha1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    false,
  );
});

test("parseWhatsAppWebhookBody rejects non-object and malformed JSON payloads", () => {
  assert.throws(
    () => parseWhatsAppWebhookBody("[1,2,3]"),
    (error: unknown) =>
      isWhatsAppWebhookPayloadError(error)
      && /payload must be an object/u.test(error.message),
  );
  assert.throws(
    () => parseWhatsAppWebhookBody("{"),
    (error: unknown) =>
      isWhatsAppWebhookPayloadError(error)
      && /valid JSON/u.test(error.message),
  );
  assert.throws(
    () => parseWhatsAppWebhookBody(JSON.stringify({ entry: {} })),
    (error: unknown) =>
      isWhatsAppWebhookPayloadError(error)
      && /field entry must be an array/u.test(error.message),
  );
  assert.throws(
    () => parseWhatsAppWebhookBody(JSON.stringify({ entry: [{ changes: {} }] })),
    (error: unknown) =>
      isWhatsAppWebhookPayloadError(error)
      && /entry\[0\]\.changes must be an array/u.test(error.message),
  );
  assert.throws(
    () =>
      parseWhatsAppWebhookBody(JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: {},
                },
              },
            ],
          },
        ],
      })),
    (error: unknown) =>
      isWhatsAppWebhookPayloadError(error)
      && /value\.messages must be an array/u.test(error.message),
  );
});

test("parseWhatsAppInboundTexts extracts trimmed inbound text and sparse raw metadata", () => {
  const [message] = parseWhatsAppInboundTexts(buildWhatsAppWebhookPayload());

  assert.deepEqual(message, {
    contactProfileName: "Casey",
    externalMessageId: "wamid.message-123",
    fromWaId: "15551234567",
    phoneNumberId: "phone-number-id-123",
    provider: "whatsapp",
    receivedAt: new Date("2024-04-01T00:00:00.000Z"),
    sparseRaw: {
      changeField: "messages",
      entryId: "waba-entry-123",
      id: "wamid.message-123",
      phoneNumberId: "phone-number-id-123",
      timestamp: "1711929600",
      type: "text",
    },
    text: "log meal eggs",
  });
});

test("parseWhatsAppInboundTexts ignores statuses, non-WhatsApp changes, non-text messages, and empty text", () => {
  const messages = parseWhatsAppInboundTexts({
    entry: [
      {
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              statuses: [{ id: "status-123" }],
            },
          },
          {
            value: {
              messaging_product: "instagram",
              messages: [
                {
                  from: "15551234567",
                  id: "ignored-product",
                  text: { body: "hello" },
                  type: "text",
                },
              ],
            },
          },
          {
            value: {
              messaging_product: "whatsapp",
              messages: [
                {
                  from: "15551234567",
                  id: "ignored-image",
                  type: "image",
                },
                {
                  from: "15551234567",
                  id: "ignored-empty",
                  text: { body: "   " },
                  type: "text",
                },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(messages, []);
});

test("parseWhatsAppInboundTexts redacts local paths from sparse raw metadata", () => {
  const [message] = parseWhatsAppInboundTexts(buildWhatsAppWebhookPayload({
    entryId: "<HOME_DIR>/private/waba",
  }));

  assert.deepEqual(message.sparseRaw, {
    changeField: "messages",
    entryId: "<REDACTED_PATH>",
    id: "wamid.message-123",
    phoneNumberId: "phone-number-id-123",
    timestamp: "1711929600",
    type: "text",
  });
});

test("buildWhatsAppWebhookEventId requires a message id", () => {
  assert.equal(
    buildWhatsAppWebhookEventId(" wamid.message-123 "),
    "whatsapp:message:wamid.message-123",
  );
  assert.throws(
    () => buildWhatsAppWebhookEventId(" "),
    /message id is required/u,
  );
});

function signWhatsAppWebhook(secret: string, payload: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

function buildWhatsAppWebhookPayload(input: {
  entryId?: string;
} = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: input.entryId ?? "waba-entry-123",
        changes: [
          {
            field: "messages",
            value: {
              contacts: [
                {
                  profile: {
                    name: "Casey",
                  },
                  wa_id: "15551234567",
                },
              ],
              messaging_product: "whatsapp",
              messages: [
                {
                  from: "15551234567",
                  id: "wamid.message-123",
                  text: {
                    body: " log meal eggs ",
                  },
                  timestamp: "1711929600",
                  type: "text",
                },
              ],
              metadata: {
                display_phone_number: "15559876543",
                phone_number_id: "phone-number-id-123",
              },
            },
          },
        ],
      },
    ],
  };
}
