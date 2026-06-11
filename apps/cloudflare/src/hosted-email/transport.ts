/**
 * Owns outbound hosted email preparation and Cloudflare transport delivery. New
 * outbound mail always uses one stable per-user reply alias, and ingress no
 * longer keeps a compatibility lane for legacy per-thread aliases.
 */

import { EmailMessage } from "cloudflare:email";
import {
  emitHostedExecutionStructuredLog,
  sanitizeHostedExecutionStructuredLogText,
} from "@murphai/hosted-execution";

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

import type { HostedWebCallbackSigningEnvironment } from "../web-callback-auth.ts";
import type { WorkerSendEmailBindingLike } from "../worker-contracts.ts";
import type { HostedEmailConfig } from "./config.ts";
import { createHostedEmailUserAddress } from "./routes.ts";

// Display name shown by mail clients instead of the raw sender address. The
// SMTP envelope sender stays the bare address so Cloudflare's sender checks
// keep matching.
const HOSTED_EMAIL_FROM_DISPLAY_NAME = "Murph";

export class HostedEmailSendValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostedEmailSendValidationError";
  }
}

export async function sendHostedEmailMessage(input: {
  config: HostedEmailConfig;
  emailBinding?: WorkerSendEmailBindingLike;
  fetchImpl?: typeof fetch;
  request: HostedEmailSendRequest;
  userId: string;
  webCallbackSigning?: HostedWebCallbackSigningEnvironment | null;
  webControlAllowHttpHosts?: readonly string[];
  webControlBaseUrl?: string | null;
}): Promise<{
  target: string;
}> {
  if (!input.config.domain || !input.config.signingSecret) {
    throw new Error("Hosted email routing is not configured.");
  }
  if (!input.emailBinding) {
    throw new Error("Hosted email sending is not configured.");
  }

  const preflight = assertSupportedHostedEmailSendRequest(input.request);

  const replyAddress = await createHostedEmailUserAddress({
    config: input.config,
    fetchImpl: input.fetchImpl,
    userId: input.userId,
    webCallbackSigning: input.webCallbackSigning,
    ...(input.webControlAllowHttpHosts ? { webControlAllowHttpHosts: input.webControlAllowHttpHosts } : {}),
    webControlBaseUrl: input.webControlBaseUrl,
  });
  const prepared = await prepareHostedEmailSend({
    config: input.config,
    existingThreadTarget: preflight.existingThreadTarget,
    idempotencyKey: input.request.idempotencyKey ?? null,
    message: input.request.message,
    replyToMessageId: input.request.replyToMessageId ?? null,
    replyAddress,
    subject: input.request.subject ?? null,
    target: input.request.target,
    targetKind: input.request.targetKind,
  });

  await sendHostedEmailMimeMessage({
    binding: input.emailBinding,
    fromAddress: prepared.fromAddress,
    mimeMessage: prepared.mimeMessage,
    recipient: prepared.recipient,
  });

  return {
    target: serializeHostedEmailThreadTarget(prepared.threadTarget),
  };
}

function assertSupportedHostedEmailSendRequest(
  request: HostedEmailSendRequest,
): {
  existingThreadTarget: HostedEmailThreadTarget | null;
} {
  if (request.targetKind !== "explicit" && request.targetKind !== "thread") {
    throw new HostedEmailSendValidationError(
      "Hosted email delivery requires an explicit recipient or a serialized thread target.",
    );
  }

  const existingThreadTarget = request.targetKind === "thread"
    ? parseHostedEmailThreadTarget(request.target)
    : null;
  if (request.targetKind === "thread" && !existingThreadTarget) {
    throw new HostedEmailSendValidationError(
      "Hosted email thread delivery requires a serialized thread target.",
    );
  }

  if (existingThreadTarget && normalizeHostedEmailSubject(request.subject)) {
    throw new HostedEmailSendValidationError(
      "Hosted email thread delivery preserves the existing subject. Do not provide a subject override when replying to a thread.",
    );
  }

  const primaryRecipient = existingThreadTarget
    ? existingThreadTarget.to[0] ?? null
    : normalizeHostedEmailAddressList([request.target])[0] ?? null;
  if (!primaryRecipient) {
    throw new HostedEmailSendValidationError(
      "Hosted email delivery requires at least one recipient email address.",
    );
  }

  return {
    existingThreadTarget,
  };
}

async function sendHostedEmailMimeMessage(input: {
  binding: WorkerSendEmailBindingLike;
  fromAddress: string;
  mimeMessage: string;
  recipient: string;
}): Promise<void> {
  try {
    await input.binding.send(
      new EmailMessage(input.fromAddress, input.recipient, input.mimeMessage),
    );
  } catch (error) {
    const details = error instanceof Error
      ? error.message.trim()
      : typeof error === "string"
        ? error.trim()
        : "Hosted email send failed.";
    const normalizedDetails =
      sanitizeHostedExecutionStructuredLogText(details)
      ?? "Hosted email send failed.";
    const wrappedError = new Error(
      normalizedDetails === "Hosted email send failed."
        ? normalizedDetails
        : `Hosted email send failed. ${normalizedDetails}`,
      { cause: error },
    );
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: {
        fromAddressPresent: input.fromAddress.length > 0,
        recipientPresent: input.recipient.length > 0,
      },
      error: wrappedError,
      level: "warn",
      message: "Hosted email send failed.",
      phase: "outbox",
      userId: null,
    });
    throw wrappedError;
  }
}

async function prepareHostedEmailSend(input: {
  config: HostedEmailConfig;
  existingThreadTarget: HostedEmailThreadTarget | null;
  idempotencyKey: string | null;
  message: string;
  replyToMessageId: string | null;
  replyAddress: string;
  subject: string | null;
  target: string;
  targetKind: HostedEmailSendRequest["targetKind"];
}): Promise<{
  fromAddress: string;
  mimeMessage: string;
  recipient: string;
  threadTarget: HostedEmailThreadTarget;
}> {
  const fromAddress = normalizeHostedEmailAddress(input.config.fromAddress);
  if (!fromAddress) {
    throw new Error("Hosted email sender identity is not configured.");
  }

  const existingThreadTarget = input.existingThreadTarget;
  const requestedSubject = normalizeHostedEmailSubject(input.subject);
  const replyToMessageId = normalizeHostedEmailMessageReference(input.replyToMessageId)
    ?? existingThreadTarget?.lastMessageId
    ?? null;

  // Hosted email stays owner-only by default. Even when inbound normalization
  // captured reply-all participants, outbound replies collapse back to the
  // primary recipient so send retries remain atomic.
  const primaryRecipient = existingThreadTarget
    ? existingThreadTarget.to[0] ?? null
    : normalizeHostedEmailAddressList([input.target])[0] ?? null;
  const to = [primaryRecipient];
  const cc: string[] = [];

  if (existingThreadTarget && requestedSubject) {
    throw new HostedEmailSendValidationError(
      "Hosted email thread delivery preserves the existing subject. Do not provide a subject override when replying to a thread.",
    );
  }

  const subject = existingThreadTarget
    ? ensureHostedEmailReplySubject(existingThreadTarget.subject, input.config.defaultSubject)
    : requestedSubject ?? normalizeHostedEmailSubject(input.config.defaultSubject) ?? "Murph update";
  const messageId = await createHostedEmailMessageId({
    fromAddress,
    idempotencyKey: input.idempotencyKey,
  });
  const previousReferences = uniqueHostedEmailMessageReferences([
    ...(existingThreadTarget?.references ?? []),
    replyToMessageId,
  ]);
  const threadTarget = createHostedEmailThreadTarget({
    cc,
    lastMessageId: messageId,
    references: uniqueHostedEmailMessageReferences([
      ...previousReferences,
      messageId,
    ]),
    subject,
    to,
  });

  return {
    fromAddress,
    mimeMessage: buildRawMimeMessage({
      bodyText: input.message,
      cc,
      fromAddress,
      inReplyTo: replyToMessageId,
      messageId,
      references: previousReferences,
      replyToAddress: input.replyAddress,
      subject,
      to,
    }),
    recipient: primaryRecipient,
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
    formatMimeHeaderLine("From", `${HOSTED_EMAIL_FROM_DISPLAY_NAME} <${input.fromAddress}>`),
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

async function createHostedEmailMessageId(input: {
  fromAddress: string;
  idempotencyKey: string | null;
}): Promise<string> {
  const fromAddress = input.fromAddress;
  const domain = fromAddress.split("@")[1] ?? "localhost";
  const idempotencyKey = input.idempotencyKey?.trim() ?? "";
  if (idempotencyKey.length > 0) {
    return `<hosted.${await sha256HostedEmailHex(`${fromAddress}\u0000${idempotencyKey}`)}@${domain}>`;
  }

  return `<hosted.${Date.now().toString(36)}.${randomHostedEmailKey()}@${domain}>`;
}

function normalizeHostedEmailMessageReference(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }
  if (/[\r\n]/u.test(trimmed)) {
    throw new HostedEmailSendValidationError(
      "Hosted email reply message id contains an unsafe line break.",
    );
  }

  return trimmed;
}

function uniqueHostedEmailMessageReferences(values: readonly (string | null | undefined)[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeHostedEmailMessageReference(value ?? null))
        .filter((value): value is string => value !== null),
    ),
  );
}

async function sha256HostedEmailHex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
