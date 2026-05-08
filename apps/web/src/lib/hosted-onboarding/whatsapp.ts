import {
  timingSafeEqual,
} from "node:crypto";

import {
  buildWhatsAppWebhookEventId,
  isWhatsAppWebhookPayloadError,
  isWhatsAppWebhookVerificationError,
  parseWhatsAppInboundTexts,
  verifyAndParseWhatsAppWebhookRequest,
  type WhatsAppInboundText,
  type WhatsAppWebhookBody,
} from "@murphai/messaging-ingress/whatsapp-webhook";

import { hostedOnboardingError } from "./errors";
import { normalizeNullableString } from "./shared";

export type HostedWhatsAppInboundText = WhatsAppInboundText;

export function resolveHostedWhatsAppWebhookChallenge(input: {
  challenge: string | null;
  mode: string | null;
  verifyToken: string | null;
}): string {
  const expectedVerifyToken = readRequiredHostedWhatsAppEnv({
    code: "WHATSAPP_WEBHOOK_VERIFY_TOKEN_NOT_CONFIGURED",
    name: "WHATSAPP_VERIFY_TOKEN",
  });
  const challenge = normalizeNullableString(input.challenge);
  const mode = normalizeNullableString(input.mode);
  const verifyToken = normalizeNullableString(input.verifyToken);

  if (
    mode !== "subscribe"
    || !challenge
    || !verifyToken
    || !safeEqualText(verifyToken, expectedVerifyToken)
  ) {
    throw hostedOnboardingError({
      code: "WHATSAPP_WEBHOOK_VERIFY_TOKEN_INVALID",
      httpStatus: 403,
      message: "Invalid WhatsApp webhook verification request.",
    });
  }

  return challenge;
}

export function verifyAndParseHostedWhatsAppWebhookRequest(input: {
  rawBody: string;
  signature: string | null;
}): WhatsAppWebhookBody {
  const appSecret = readRequiredHostedWhatsAppEnv({
    code: "WHATSAPP_WEBHOOK_APP_SECRET_NOT_CONFIGURED",
    name: "WHATSAPP_APP_SECRET",
  });

  try {
    return verifyAndParseWhatsAppWebhookRequest({
      appSecret,
      headers: {
        "x-hub-signature-256": input.signature ?? undefined,
      },
      rawBody: input.rawBody,
    });
  } catch (error) {
    if (isWhatsAppWebhookVerificationError(error)) {
      throw hostedOnboardingError({
        code: "WHATSAPP_WEBHOOK_SIGNATURE_INVALID",
        httpStatus: 401,
        message: "Invalid WhatsApp webhook signature.",
      });
    }

    if (isWhatsAppWebhookPayloadError(error)) {
      throw hostedOnboardingError({
        code: "WHATSAPP_WEBHOOK_PAYLOAD_INVALID",
        httpStatus: 400,
        message: "Invalid WhatsApp webhook payload.",
      });
    }

    throw error;
  }
}

export function parseHostedWhatsAppInboundTexts(
  body: WhatsAppWebhookBody,
): HostedWhatsAppInboundText[] {
  return parseWhatsAppInboundTexts(body);
}

export function buildHostedWhatsAppWebhookEventId(messageId: string): string {
  return buildWhatsAppWebhookEventId(messageId);
}

function readRequiredHostedWhatsAppEnv(input: {
  code: string;
  name: string;
}): string {
  const value = normalizeNullableString(process.env[input.name]);

  if (!value) {
    throw hostedOnboardingError({
      code: input.code,
      httpStatus: 500,
      message: `${input.name} must be configured for WhatsApp webhooks.`,
    });
  }

  return value;
}

function safeEqualText(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.byteLength === expectedBuffer.byteLength
    && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
