/**
 * Owns outbound hosted email preparation and Cloudflare transport delivery. New
 * outbound mail always uses one stable per-user reply alias while ingress keeps
 * temporary support for legacy per-thread aliases separately in the routing
 * module.
 */

import type { HostedEmailSendRequest } from "@murphai/assistant-runtime";
import {
  createHostedEmailThreadTarget,
  ensureHostedEmailReplySubject,
  normalizeHostedEmailAddressList,
  parseHostedEmailThreadTarget,
  serializeHostedEmailThreadTarget,
  type HostedEmailThreadTarget,
} from "@murphai/runtime-state";

import type { R2BucketLike } from "../bundle-store.ts";
import type { HostedEmailConfig } from "./config.ts";
import { createHostedEmailUserAddress } from "./routes.ts";

export async function sendHostedEmailMessage(input: {
  bucket: R2BucketLike;
  config: HostedEmailConfig;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  request: HostedEmailSendRequest;
  userId: string;
}): Promise<{
  target: string;
}> {
  if (!input.config.domain || !input.config.signingSecret) {
    throw new Error("Hosted email routing is not configured.");
  }
  if (!input.config.cloudflareAccountId || !input.config.cloudflareApiToken) {
    throw new Error("Hosted email sending is not configured.");
  }

  const replyAddress = await createHostedEmailUserAddress({
    bucket: input.bucket,
    config: input.config,
    key: input.key,
    keyId: input.keyId,
    keysById: input.keysById,
    userId: input.userId,
  });
  const prepared = await prepareHostedEmailSend({
    config: input.config,
    message: input.request.message,
    replyAddress,
    target: input.request.target,
    targetKind: input.request.targetKind,
  });

  const response = await fetch(
    `${input.config.apiBaseUrl}/accounts/${encodeURIComponent(input.config.cloudflareAccountId)}/email/sending/send_raw`,
    {
      body: JSON.stringify({
        from: prepared.fromAddress,
        mime_message: prepared.mimeMessage,
        recipients: prepared.recipients,
      }),
      headers: {
        authorization: `Bearer ${input.config.cloudflareApiToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    },
  );

  const payload = await response.json().catch(() => null) as {
    errors?: Array<{ message?: string | null }>;
    messages?: Array<{ message?: string | null }>;
    result?: {
      delivered?: string[];
      permanent_bounces?: string[];
      queued?: string[];
    };
    success?: boolean;
  } | null;

  if (!response.ok || payload?.success === false) {
    const details = [
      ...(payload?.errors ?? []),
      ...(payload?.messages ?? []),
    ]
      .map((entry) => entry.message?.trim())
      .filter((entry): entry is string => Boolean(entry));
    throw new Error(
      details[0] ?? `Hosted email send failed with HTTP ${response.status}.`,
    );
  }

  return {
    target: serializeHostedEmailThreadTarget(prepared.threadTarget),
  };
}

async function prepareHostedEmailSend(input: {
  config: HostedEmailConfig;
  message: string;
  replyAddress: string;
  target: string;
  targetKind: HostedEmailSendRequest["targetKind"];
}): Promise<{
  fromAddress: string;
  mimeMessage: string;
  recipients: string[];
  threadTarget: HostedEmailThreadTarget;
}> {
  const fromAddress = input.config.fromAddress;
  if (!fromAddress) {
    throw new Error("Hosted email sender identity is not configured.");
  }

  const existingThreadTarget = input.targetKind === "thread"
    ? parseHostedEmailThreadTarget(input.target)
    : null;
  if (input.targetKind === "thread" && !existingThreadTarget) {
    throw new Error("Hosted email thread delivery requires a serialized thread target.");
  }

  const to = existingThreadTarget
    ? existingThreadTarget.to
    : normalizeHostedEmailAddressList([input.target]);
  const cc = existingThreadTarget?.cc ?? [];
  if (to.length === 0) {
    throw new Error("Hosted email delivery requires at least one recipient email address.");
  }

  const subject = existingThreadTarget
    ? ensureHostedEmailReplySubject(existingThreadTarget.subject, input.config.defaultSubject)
    : input.config.defaultSubject;
  const messageId = createHostedEmailMessageId(fromAddress);
  const threadTarget = createHostedEmailThreadTarget({
    cc,
    lastMessageId: messageId,
    references: [
      ...(existingThreadTarget?.references ?? []),
      existingThreadTarget?.lastMessageId,
      messageId,
    ].filter((value): value is string => Boolean(value && value.trim())),
    replyAliasAddress: input.replyAddress,
    replyKey: null,
    subject,
    to,
  });

  return {
    fromAddress,
    mimeMessage: buildRawMimeMessage({
      bodyText: input.message,
      cc,
      fromAddress,
      inReplyTo: existingThreadTarget?.lastMessageId ?? null,
      messageId,
      references: existingThreadTarget?.references ?? [],
      replyToAddress: input.replyAddress,
      routingAddress: input.replyAddress,
      subject,
      to,
    }),
    recipients: normalizeHostedEmailAddressList([...to, ...cc]),
    threadTarget,
  };
}

function buildRawMimeMessage(input: {
  bodyText: string;
  cc: string[];
  fromAddress: string;
  inReplyTo: string | null;
  messageId: string;
  references: string[];
  replyToAddress: string | null;
  routingAddress: string | null;
  subject: string;
  to: string[];
}): string {
  const headers = [
    `From: ${input.fromAddress}`,
    `To: ${input.to.join(", ")}`,
    input.cc.length > 0 ? `Cc: ${input.cc.join(", ")}` : null,
    `Subject: ${encodeMimeHeader(input.subject)}`,
    `Message-ID: ${input.messageId}`,
    `Date: ${new Date().toUTCString()}`,
    input.replyToAddress ? `Reply-To: ${input.replyToAddress}` : null,
    input.routingAddress ? `X-Murph-Route: ${input.routingAddress}` : null,
    input.inReplyTo ? `In-Reply-To: ${input.inReplyTo}` : null,
    input.references.length > 0 ? `References: ${input.references.join(" ")}` : null,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
  ].filter((value): value is string => value !== null);

  return `${headers.join("\r\n")}\r\n\r\n${wrapMimeBase64(
    encodeUtf8Base64(input.bodyText),
  )}\r\n`;
}

function createHostedEmailMessageId(fromAddress: string): string {
  const domain = fromAddress.split("@")[1] ?? "localhost";
  return `<hosted.${Date.now().toString(36)}.${randomHostedEmailKey()}@${domain}>`;
}

function wrapMimeBase64(value: string): string {
  return value.replace(/.{1,76}/gu, "$&\r\n").trimEnd();
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function encodeMimeHeader(value: string): string {
  return /[^\x20-\x7E]/u.test(value)
    ? `=?UTF-8?B?${encodeUtf8Base64(value)}?=`
    : value;
}

function randomHostedEmailKey(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
