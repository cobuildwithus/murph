/**
 * Owns outbound hosted email preparation and Cloudflare transport delivery. New
 * outbound mail always uses one stable per-user reply alias, and ingress no
 * longer keeps a compatibility lane for legacy per-thread aliases.
 */

import { EmailMessage } from "cloudflare:email";

import type { HostedEmailSendRequest } from "@murphai/assistant-runtime/hosted-email";
import {
  createHostedEmailThreadTarget,
  ensureHostedEmailReplySubject,
  normalizeHostedEmailAddress,
  normalizeHostedEmailAddressList,
  normalizeHostedEmailSubject,
  parseHostedEmailThreadTarget,
  serializeHostedEmailThreadTarget,
  type HostedEmailThreadTarget,
} from "@murphai/runtime-state";

import type { R2BucketLike } from "../bundle-store.ts";
import type { WorkerSendEmailBindingLike } from "../worker-contracts.ts";
import type { HostedEmailConfig } from "./config.ts";
import { createHostedEmailUserAddress } from "./routes.ts";

export class HostedEmailSendValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostedEmailSendValidationError";
  }
}

export async function sendHostedEmailMessage(input: {
  bucket: R2BucketLike;
  config: HostedEmailConfig;
  emailBinding?: WorkerSendEmailBindingLike;
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
  if (!input.emailBinding) {
    throw new Error("Hosted email sending is not configured.");
  }

  assertSupportedHostedEmailSendRequest(input.request, input.config);

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

  await sendHostedEmailMimeMessage({
    binding: input.emailBinding,
    fromAddress: prepared.fromAddress,
    mimeMessage: prepared.mimeMessage,
    recipients: prepared.recipients,
  });

  return {
    target: serializeHostedEmailThreadTarget(prepared.threadTarget),
  };
}

function assertSupportedHostedEmailSendRequest(
  request: HostedEmailSendRequest,
  config: HostedEmailConfig,
): void {
  const configuredSender = normalizeHostedEmailAddress(config.fromAddress);
  const requestedSender = normalizeHostedEmailAddress(request.identityId);

  if (requestedSender && configuredSender && requestedSender !== configuredSender) {
    throw new HostedEmailSendValidationError(
      `Hosted email sender identity is config-owned and must remain ${configuredSender}.`,
    );
  }
}

async function sendHostedEmailMimeMessage(input: {
  binding: WorkerSendEmailBindingLike;
  fromAddress: string;
  mimeMessage: string;
  recipients: string[];
}): Promise<void> {
  // Cloudflare's raw MIME EmailMessage constructor targets one envelope
  // recipient at a time, so fan out the same MIME payload across recipients.
  const deliveryResults = await Promise.allSettled(
    input.recipients.map((recipient) =>
      input.binding.send(new EmailMessage(input.fromAddress, recipient, input.mimeMessage))
    ),
  );

  const failures = deliveryResults.flatMap((result, index) => {
    if (result.status === "fulfilled") {
      return [];
    }

    return [formatHostedEmailSendError(input.recipients[index], result.reason)];
  });

  if (failures.length > 0) {
    throw new Error(
      failures.length === 1
        ? failures[0] ?? "Hosted email send failed."
        : `Hosted email send failed for ${failures.length} recipient(s): ${failures.join("; ")}`,
    );
  }
}

function formatHostedEmailSendError(recipient: string | undefined, error: unknown): string {
  const details = error instanceof Error
    ? error.message.trim()
    : typeof error === "string"
      ? error.trim()
      : "Hosted email send failed.";
  const normalizedDetails = details.length > 0 ? details : "Hosted email send failed.";
  return recipient ? `${recipient}: ${normalizedDetails}` : normalizedDetails;
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
  const fromAddress = normalizeHostedEmailAddress(input.config.fromAddress);
  if (!fromAddress) {
    throw new Error("Hosted email sender identity is not configured.");
  }

  if (input.targetKind === "participant") {
    throw new HostedEmailSendValidationError(
      "Hosted email participant delivery is not supported. Use an explicit recipient or a serialized thread target.",
    );
  }
  if (input.targetKind !== "explicit" && input.targetKind !== "thread") {
    throw new HostedEmailSendValidationError(
      "Hosted email delivery requires an explicit recipient or a serialized thread target.",
    );
  }

  const existingThreadTarget = input.targetKind === "thread"
    ? parseHostedEmailThreadTarget(input.target)
    : null;
  if (input.targetKind === "thread" && !existingThreadTarget) {
    throw new HostedEmailSendValidationError(
      "Hosted email thread delivery requires a serialized thread target.",
    );
  }

  const to = existingThreadTarget
    ? existingThreadTarget.to
    : normalizeHostedEmailAddressList([input.target]);
  const cc = existingThreadTarget?.cc ?? [];
  if (to.length === 0) {
    throw new HostedEmailSendValidationError(
      "Hosted email delivery requires at least one recipient email address.",
    );
  }

  const subject = existingThreadTarget
    ? ensureHostedEmailReplySubject(existingThreadTarget.subject, input.config.defaultSubject)
    : normalizeHostedEmailSubject(input.config.defaultSubject) ?? "Murph update";
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
  subject: string;
  to: string[];
}): string {
  const headers = [
    formatMimeHeaderLine("From", input.fromAddress),
    formatMimeHeaderLine("To", input.to.join(", ")),
    input.cc.length > 0 ? formatMimeHeaderLine("Cc", input.cc.join(", ")) : null,
    formatMimeHeaderLine("Subject", encodeMimeHeader(input.subject)),
    formatMimeHeaderLine("Message-ID", input.messageId),
    formatMimeHeaderLine("Date", new Date().toUTCString()),
    input.replyToAddress ? formatMimeHeaderLine("Reply-To", input.replyToAddress) : null,
    input.inReplyTo ? formatMimeHeaderLine("In-Reply-To", input.inReplyTo) : null,
    input.references.length > 0
      ? formatMimeHeaderLine("References", input.references.join(" "))
      : null,
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

function formatMimeHeaderLine(name: string, value: string): string {
  if (/[\r\n]/u.test(value)) {
    throw new Error(`Hosted email ${name} header contains an unsafe line break.`);
  }

  return `${name}: ${value}`;
}

function randomHostedEmailKey(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
