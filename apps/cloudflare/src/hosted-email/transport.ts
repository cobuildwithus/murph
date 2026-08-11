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
import {
  HOSTED_EMAIL_GROUP_RECIPIENTS_CALLBACK_PATH,
  parseHostedEmailGroupRecipientsCallbackResponse,
} from "@murphai/hosted-execution/hosted-email";

import type {
  HostedEmailDeliverySummary,
  HostedEmailSendRequest,
  HostedEmailSendResult,
} from "@murphai/assistant-runtime/hosted-email";
import {
  appendHostedEmailReferenceChain,
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
import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "../web-control-plane.ts";

// Display name shown by mail clients instead of the raw sender address. The
// SMTP envelope sender stays the bare address so Cloudflare's sender checks
// keep matching.
const HOSTED_EMAIL_FROM_DISPLAY_NAME = "Murph";

interface HostedEmailGroupRecipient {
  address: string;
  memberId: string;
}

type HostedEmailGroupRecipientResolution =
  | {
      recipients: HostedEmailGroupRecipient[];
      status: "ok";
    }
  | {
      status: "superseded";
    };

export class HostedEmailSendValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostedEmailSendValidationError";
  }
}

export class HostedEmailPreProviderError extends Error {
  readonly code = "ASSISTANT_EMAIL_PROVIDER_ENTRY_FAILED";
  readonly deliveryMayHaveSucceeded = false;
  readonly retryable = true;

  constructor(cause: unknown) {
    super("Hosted email delivery failed before provider entry.", { cause });
    this.name = "HostedEmailPreProviderError";
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
}): Promise<HostedEmailSendResult> {
  let prepared: Awaited<ReturnType<typeof prepareHostedEmailSend>>;
  let envelopeRecipients: readonly string[] | null = null;
  try {
    if (!input.config.domain || !input.config.signingSecret) {
      throw new Error("Hosted email routing is not configured.");
    }
    if (!input.emailBinding) {
      throw new Error("Hosted email sending is not configured.");
    }

    const preflight = assertSupportedHostedEmailSendRequest(input.request);
    if (
      (
        input.request.idempotencyKey?.startsWith("group-email-effect:")
        || input.request.idempotencyKey?.startsWith("group-newsletter:")
      )
      && !input.request.groupEmailAuthorizationProof
    ) {
      throw new Error("Hosted group email delivery requires an authorization proof.");
    }
    const groupId = resolveHostedEmailSendGroupId({
      existingThreadTarget: preflight.existingThreadTarget,
      target: input.request.target,
      targetKind: input.request.targetKind,
    });
    const replyAddress = await createHostedEmailUserAddress({
      config: input.config,
      fetchImpl: input.fetchImpl,
      groupId,
      userId: input.userId,
      webCallbackSigning: input.webCallbackSigning,
      ...(input.webControlAllowHttpHosts ? { webControlAllowHttpHosts: input.webControlAllowHttpHosts } : {}),
      webControlBaseUrl: input.webControlBaseUrl,
    });
    const groupRecipientResolution = groupId
      ? await resolveHostedEmailGroupRecipients({
          expectedGroupEmailAuthorizationProof:
            input.request.groupEmailAuthorizationProof ?? null,
          fetchImpl: input.fetchImpl,
          groupId,
          userId: input.userId,
          webCallbackSigning: input.webCallbackSigning,
          ...(input.webControlAllowHttpHosts ? { webControlAllowHttpHosts: input.webControlAllowHttpHosts } : {}),
          webControlBaseUrl: input.webControlBaseUrl,
        })
      : null;
    if (
      groupRecipientResolution?.status === "superseded"
      || (
        groupRecipientResolution?.status === "ok"
        && groupRecipientResolution.recipients.length === 0
      )
    ) {
      return {
        delivery: {
          failedCount: 0,
          sentCount: 0,
          skippedCount: 1,
          status: "failed",
        },
        target: input.request.target,
      };
    }
    const groupRecipients = groupRecipientResolution?.status === "ok"
      ? groupRecipientResolution.recipients
      : null;
    const recipientMemberId = preflight.existingThreadTarget?.recipientMemberId ?? null;
    const selectedGroupRecipients = groupRecipients
      ? recipientMemberId
        ? groupRecipients.filter((recipient) => recipient.memberId === recipientMemberId)
        : groupRecipients
      : null;
    if (recipientMemberId && selectedGroupRecipients?.length === 0) {
      return {
        delivery: {
          failedCount: 0,
          sentCount: 0,
          skippedCount: 1,
          status: "failed",
        },
        target: input.request.target,
      };
    }
    envelopeRecipients = selectedGroupRecipients?.map(
      (recipient) => recipient.address,
    ) ?? null;
    prepared = await prepareHostedEmailSend({
      config: input.config,
      existingThreadTarget: preflight.existingThreadTarget,
      groupId,
      groupRecipients: groupRecipients?.map((recipient) => recipient.address) ?? null,
      html: input.request.html ?? null,
      idempotencyKey: input.request.idempotencyKey ?? null,
      message: input.request.message,
      replyToMessageId: input.request.replyToMessageId ?? null,
      replyAddress,
      subject: input.request.subject ?? null,
      target: input.request.target,
      targetKind: input.request.targetKind,
    });

    const fanoutRecipientMemberIds =
      input.request.planGroupFanout === true && groupId && !recipientMemberId
        ? selectedGroupRecipients?.map((recipient) => recipient.memberId) ?? []
        : null;
    if (fanoutRecipientMemberIds) {
      const fanoutThreadTarget = preflight.existingThreadTarget
        ?? createHostedEmailThreadTarget({
          groupId,
          subject: prepared.threadTarget.subject,
          targetKind: "group",
        });
      return {
        fanoutRecipientMemberIds,
        target: serializeHostedEmailThreadTarget(fanoutThreadTarget),
      };
    }
  } catch (error) {
    if (error instanceof HostedEmailSendValidationError) {
      throw error;
    }
    throw new HostedEmailPreProviderError(error);
  }

  const delivery = await sendPreparedHostedEmailMimeMessages({
    binding: input.emailBinding,
    continueOnFailure: prepared.isGroupDelivery,
    fromAddress: prepared.fromAddress,
    mimeMessage: prepared.mimeMessage,
    recipients: envelopeRecipients ?? prepared.recipients,
  });

  return {
    delivery,
    target: serializeHostedEmailThreadTarget(prepared.threadTarget),
  };
}

function assertSupportedHostedEmailSendRequest(
  request: HostedEmailSendRequest,
): {
  existingThreadTarget: HostedEmailThreadTarget | null;
} {
  if (request.targetKind !== "explicit" && request.targetKind !== "thread") {
    if (request.targetKind === "group") {
      return {
        existingThreadTarget: null,
      };
    }
    throw new HostedEmailSendValidationError(
      "Hosted email delivery requires an explicit recipient, group id, or serialized thread target.",
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

  const groupThreadTarget =
    existingThreadTarget?.targetKind === "group" && existingThreadTarget.groupId
      ? existingThreadTarget
      : null;
  const primaryRecipient = existingThreadTarget
    ? groupThreadTarget
      ? null
      : existingThreadTarget.to[0] ?? null
    : normalizeHostedEmailAddressList([request.target])[0] ?? null;
  if (!primaryRecipient && !groupThreadTarget) {
    throw new HostedEmailSendValidationError(
      "Hosted email delivery requires at least one recipient email address.",
    );
  }

  return {
    existingThreadTarget,
  };
}

function resolveHostedEmailSendGroupId(input: {
  existingThreadTarget: HostedEmailThreadTarget | null;
  target: string;
  targetKind: HostedEmailSendRequest["targetKind"];
}): string | null {
  if (input.targetKind === "group") {
    return normalizeHostedEmailDeliveryGroupId(input.target);
  }
  if (input.targetKind === "thread" && input.existingThreadTarget?.targetKind === "group") {
    return input.existingThreadTarget.groupId;
  }

  return null;
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

async function sendPreparedHostedEmailMimeMessages(input: {
  binding: WorkerSendEmailBindingLike;
  continueOnFailure: boolean;
  fromAddress: string;
  mimeMessage: string;
  recipients: readonly string[];
}): Promise<HostedEmailDeliverySummary> {
  let failedCount = 0;
  let sentCount = 0;
  for (const recipient of input.recipients) {
    try {
      await sendHostedEmailMimeMessage({
        binding: input.binding,
        fromAddress: input.fromAddress,
        mimeMessage: input.mimeMessage,
        recipient,
      });
      sentCount += 1;
    } catch (error) {
      failedCount += 1;
      if (!input.continueOnFailure) {
        throw error;
      }
    }
  }

  return {
    failedCount,
    sentCount,
    skippedCount: 0,
    status: failedCount === 0
      ? "sent"
      : sentCount === 0
        ? "failed"
        : "partial_failure",
  };
}

async function resolveHostedEmailGroupRecipients(input: {
  expectedGroupEmailAuthorizationProof?: string | null;
  fetchImpl?: typeof fetch;
  groupId: string;
  userId: string;
  webCallbackSigning?: HostedWebCallbackSigningEnvironment | null;
  webControlAllowHttpHosts?: readonly string[];
  webControlBaseUrl?: string | null;
}): Promise<HostedEmailGroupRecipientResolution> {
  if (!input.webCallbackSigning || !input.webControlBaseUrl) {
    throw new Error("Hosted group email recipient callback is not configured.");
  }

  const response = await fetchHostedExecutionWebControlPlaneResponse({
    ...(input.webControlAllowHttpHosts ? { allowHttpHosts: input.webControlAllowHttpHosts } : {}),
    baseUrl: input.webControlBaseUrl,
    body: JSON.stringify({
      ...(input.expectedGroupEmailAuthorizationProof
        ? {
            expectedGroupEmailAuthorizationProof:
              input.expectedGroupEmailAuthorizationProof,
            // Keep the proof visible to the pre-generic Web callback parser
            // during the bounded deployment/rollback window. Remove this alias
            // only after the generic Web receiver is the proven rollback floor.
            expectedNewsletterAuthorizationProof:
              input.expectedGroupEmailAuthorizationProof,
          }
        : {}),
      groupId: input.groupId,
    }),
    boundUserId: input.userId,
    callbackSigning: input.webCallbackSigning,
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: HOSTED_EMAIL_GROUP_RECIPIENTS_CALLBACK_PATH,
    timeoutMs: 1_500,
  });
  if (response.status === 410) {
    return { status: "superseded" };
  }
  if (!response.ok) {
    throw new Error(`Hosted group email recipient callback failed with HTTP ${response.status}.`);
  }

  const payload = parseHostedEmailGroupRecipientsCallbackResponse(await response.json());
  const recipients = new Map<string, HostedEmailGroupRecipient>();
  for (const recipient of payload.recipients) {
    const address = normalizeHostedEmailAddress(recipient.address);
    const memberId = recipient.memberId.trim();
    if (address && memberId && !recipients.has(memberId)) {
      recipients.set(memberId, { address, memberId });
    }
  }
  return {
    recipients: [...recipients.values()],
    status: "ok",
  };
}

async function prepareHostedEmailSend(input: {
  config: HostedEmailConfig;
  existingThreadTarget: HostedEmailThreadTarget | null;
  groupId: string | null;
  groupRecipients: readonly string[] | null;
  html: string | null;
  idempotencyKey: string | null;
  message: string;
  replyToMessageId: string | null;
  replyAddress: string;
  subject: string | null;
  target: string;
  targetKind: HostedEmailSendRequest["targetKind"];
}): Promise<{
  fromAddress: string;
  isGroupDelivery: boolean;
  mimeMessage: string;
  recipients: string[];
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
  const isGroupDelivery = Boolean(input.groupId);

  // Direct/thread email stays owner-only by default. Authorized group email is
  // the explicit shared-thread exception, with recipients resolved by Web at send time.
  const groupRecipients = normalizeHostedEmailAddressList(input.groupRecipients ?? []);
  const primaryRecipient = resolveHostedEmailPrimaryRecipient({
    existingThreadTarget,
    groupRecipients,
    isGroupDelivery,
    target: input.target,
  });
  const to: string[] = isGroupDelivery
    ? [...groupRecipients]
    : primaryRecipient
      ? [primaryRecipient]
      : [];
  const cc: string[] = [];
  if (!primaryRecipient || to.length === 0) {
    throw new HostedEmailSendValidationError(
      isGroupDelivery
        ? "Hosted group email delivery requires at least one authorized recipient."
        : "Hosted email delivery requires at least one recipient email address.",
    );
  }

  if (existingThreadTarget && requestedSubject) {
    throw new HostedEmailSendValidationError(
      "Hosted email thread delivery preserves the existing subject. Do not provide a subject override when replying to a thread.",
    );
  }

  const isPlannedInitialGroupDelivery = Boolean(
    existingThreadTarget?.targetKind === "group"
    && existingThreadTarget.recipientMemberId
    && !existingThreadTarget.lastMessageId
    && existingThreadTarget.references.length === 0,
  );
  const subject = existingThreadTarget
    ? isPlannedInitialGroupDelivery
      ? existingThreadTarget.subject
        ?? normalizeHostedEmailSubject(input.config.defaultSubject)
        ?? "Murph update"
      : ensureHostedEmailReplySubject(existingThreadTarget.subject, input.config.defaultSubject)
    : requestedSubject ?? normalizeHostedEmailSubject(input.config.defaultSubject) ?? "Murph update";
  const messageId = await createHostedEmailMessageId({
    fromAddress,
    idempotencyKey: input.idempotencyKey,
  });
  const groupThreadRoot = isGroupDelivery
    ? existingThreadTarget?.references[0]
      ?? await createHostedEmailThreadRootReference({
        fromAddress,
        idempotencyKey: input.idempotencyKey,
      })
    : null;
  const previousReferences = appendHostedEmailReferenceChain({
    references: [
      groupThreadRoot,
      ...(existingThreadTarget?.references ?? []),
    ].filter((reference): reference is string => reference !== null),
    lastMessageId: replyToMessageId,
  });
  const threadTarget = createHostedEmailThreadTarget({
    cc: isGroupDelivery ? [] : cc,
    groupId: isGroupDelivery ? input.groupId : null,
    lastMessageId: messageId,
    recipientMemberId: existingThreadTarget?.recipientMemberId ?? null,
    references: appendHostedEmailReferenceChain({
      lastMessageId: messageId,
      references: previousReferences,
    }),
    subject,
    targetKind: isGroupDelivery ? "group" : "explicit",
    to: isGroupDelivery ? [] : to,
  });

  return {
    fromAddress,
    isGroupDelivery,
    mimeMessage: buildRawMimeMessage({
      bodyHtml: input.html,
      bodyText: input.message,
      cc,
      fromAddress,
      inReplyTo: replyToMessageId,
      messageId,
      mimeDate: resolveHostedEmailMimeDate(input.idempotencyKey),
      references: previousReferences,
      replyToAddress: input.replyAddress,
      subject,
      to,
    }),
    recipients: to,
    threadTarget,
  };
}

function resolveHostedEmailPrimaryRecipient(input: {
  existingThreadTarget: HostedEmailThreadTarget | null;
  groupRecipients: readonly string[];
  isGroupDelivery: boolean;
  target: string;
}): string | null {
  if (input.isGroupDelivery) {
    return input.groupRecipients[0] ?? null;
  }
  if (input.existingThreadTarget) {
    return input.existingThreadTarget.to[0] ?? null;
  }

  return normalizeHostedEmailAddressList([input.target])[0] ?? null;
}

function buildRawMimeMessage(input: {
  bodyHtml: string | null;
  bodyText: string;
  cc: string[];
  fromAddress: string;
  inReplyTo: string | null;
  messageId: string;
  mimeDate: string;
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
    formatMimeHeaderLine("Date", input.mimeDate),
    input.replyToAddress ? formatMimeHeaderLine("Reply-To", input.replyToAddress) : null,
    input.inReplyTo ? formatMimeHeaderLine("In-Reply-To", input.inReplyTo) : null,
    input.references.length > 0
      ? formatMimeHeaderLine("References", input.references.join(" "))
      : null,
    "MIME-Version: 1.0",
    input.bodyHtml
      ? formatMimeHeaderLine("Content-Type", `multipart/alternative; boundary="${createMimeBoundary(input.messageId)}"`)
      : 'Content-Type: text/plain; charset="utf-8"',
    input.bodyHtml ? null : "Content-Transfer-Encoding: base64",
  ].filter((value): value is string => value !== null);

  if (input.bodyHtml) {
    const boundary = createMimeBoundary(input.messageId);
    const parts = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      wrapMimeBase64(encodeUtf8Base64(input.bodyText)),
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      wrapMimeBase64(encodeUtf8Base64(input.bodyHtml)),
      `--${boundary}--`,
      "",
    ];
    return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`;
  }

  return `${headers.join("\r\n")}\r\n\r\n${wrapMimeBase64(
    encodeUtf8Base64(input.bodyText),
  )}\r\n`;
}

function resolveHostedEmailMimeDate(idempotencyKey: string | null): string {
  const groupEmailOccurrenceAt = parseHostedGroupEmailOccurrenceAt(idempotencyKey);
  return (groupEmailOccurrenceAt ?? new Date()).toUTCString();
}

function parseHostedGroupEmailOccurrenceAt(idempotencyKey: string | null): Date | null {
  const trimmed = idempotencyKey?.trim() ?? "";
  const match = /^(?:group-email-effect|group-newsletter):[^:]+:(.+):[^:]+$/u
    .exec(trimmed);
  const occurrenceAt = match?.[1] ?? "";
  if (!occurrenceAt) {
    return null;
  }

  const parsed = new Date(occurrenceAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

async function createHostedEmailThreadRootReference(input: {
  fromAddress: string;
  idempotencyKey: string | null;
}): Promise<string | null> {
  const idempotencyKey = input.idempotencyKey?.trim() ?? "";
  if (idempotencyKey.length === 0) {
    return null;
  }
  const domain = input.fromAddress.split("@")[1] ?? "localhost";
  return `<hosted-thread.${await sha256HostedEmailHex(`${input.fromAddress}\u0000${idempotencyKey}`)}@${domain}>`;
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

function normalizeHostedEmailDeliveryGroupId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || /[\r\n]/u.test(trimmed)) {
    return null;
  }

  return trimmed;
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

function createMimeBoundary(messageId: string): string {
  return `hosted-alt-${messageId.replace(/[^A-Za-z0-9]/gu, "").slice(0, 40) || randomHostedEmailKey()}`;
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
