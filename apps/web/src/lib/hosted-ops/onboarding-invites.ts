import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import type { SupportedContentType } from "@linqapp/sdk/resources";
import { createHash } from "node:crypto";

import { getPrisma } from "../prisma";
import { readHostedPhoneHint } from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  buildHostedInviteUrl,
  issueHostedInviteTx,
} from "../hosted-onboarding/invite-service";
import {
  createHostedLinqMediaChat,
  sendHostedLinqChatMessage,
  sendHostedLinqVoiceMemo,
  uploadHostedLinqAttachment,
} from "../hosted-onboarding/linq-client";
import {
  lookupHostedMemberRoutingByHomeLinqChatId,
  lookupHostedMemberRoutingByPendingLinqChatId,
  readHostedMemberRoutingState,
  upsertHostedMemberPendingLinqBindingTx,
} from "../hosted-onboarding/hosted-member-routing-store";
import { ensureHostedMemberForPhoneTx } from "../hosted-onboarding/member-identity-service";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  normalizeNullableString,
} from "../hosted-onboarding/shared";
import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { getHostedOnboardingEnvironment } from "../hosted-onboarding/runtime";

export const HOSTED_OPS_ONBOARDING_VOICE_MEMO_MAX_BYTES = 10 * 1024 * 1024;

const HOSTED_OPS_ONBOARDING_INVITE_MESSAGE_MAX_LENGTH = 1_800;
const HOSTED_OPS_ONBOARDING_REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/u;
const HOSTED_OPS_ONBOARDING_LINQ_CHAT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,256}$/u;
const HOSTED_OPS_ONBOARDING_DEFAULT_INVITE_MESSAGE =
  "Murph setup link:\n{{inviteUrl}}\n\nReply here when you are in.";

type HostedOpsOnboardingInviteDeliveryMode = "existing_chat" | "new_chat";

export interface HostedOpsOnboardingVoiceMemoInput {
  bytes: Uint8Array;
  contentType: SupportedContentType;
  extension: string;
  sizeBytes: number;
}

export interface HostedOpsOnboardingInviteInput {
  deliveryMode: string;
  inviteMessage?: string | null;
  linqChatId?: string | null;
  linqFromPhoneNumber?: string | null;
  prisma?: PrismaClient;
  recipientPhoneNumber: string;
  requestId: string;
  voiceMemo?: HostedOpsOnboardingVoiceMemoInput | null;
}

export interface HostedOpsOnboardingInviteResult {
  chatId: string;
  deliveryMode: HostedOpsOnboardingInviteDeliveryMode;
  inviteExpiresAt: string | null;
  inviteId: string | null;
  invitePreviouslyMarkedSent: boolean;
  linqFromPhoneHint: string | null;
  memberId: string;
  newChatCreated: boolean;
  openerMessageId: string | null;
  recipientPhoneHint: string;
  sentAt: string;
  textMessageSent: boolean;
  voiceMemo: {
    error: string | null;
    requested: boolean;
    sent: boolean;
  };
}

interface HostedOpsOnboardingVoiceMemoContentType {
  contentType: SupportedContentType;
  extension: string;
}

const AUDIO_AAC = {
  contentType: "audio/aac",
  extension: "aac",
} satisfies HostedOpsOnboardingVoiceMemoContentType;
const AUDIO_AIFF = {
  contentType: "audio/x-aiff",
  extension: "aiff",
} satisfies HostedOpsOnboardingVoiceMemoContentType;
const AUDIO_AMR = {
  contentType: "audio/amr",
  extension: "amr",
} satisfies HostedOpsOnboardingVoiceMemoContentType;
const AUDIO_CAF = {
  contentType: "audio/x-caf",
  extension: "caf",
} satisfies HostedOpsOnboardingVoiceMemoContentType;
const AUDIO_M4A = {
  contentType: "audio/x-m4a",
  extension: "m4a",
} satisfies HostedOpsOnboardingVoiceMemoContentType;
const AUDIO_MP3 = {
  contentType: "audio/mpeg",
  extension: "mp3",
} satisfies HostedOpsOnboardingVoiceMemoContentType;
const AUDIO_WAV = {
  contentType: "audio/x-wav",
  extension: "wav",
} satisfies HostedOpsOnboardingVoiceMemoContentType;

const HOSTED_OPS_ONBOARDING_VOICE_MEMO_MIME_TYPES = new Map<
  string,
  HostedOpsOnboardingVoiceMemoContentType
>([
  ["audio/aac", AUDIO_AAC],
  ["audio/aiff", AUDIO_AIFF],
  ["audio/amr", AUDIO_AMR],
  ["audio/m4a", AUDIO_M4A],
  ["audio/mp3", AUDIO_MP3],
  ["audio/mp4", AUDIO_M4A],
  ["audio/mpeg", AUDIO_MP3],
  ["audio/wav", AUDIO_WAV],
  ["audio/x-aiff", AUDIO_AIFF],
  ["audio/x-caf", AUDIO_CAF],
  ["audio/x-m4a", AUDIO_M4A],
  ["audio/x-wav", AUDIO_WAV],
]);

const HOSTED_OPS_ONBOARDING_VOICE_MEMO_EXTENSIONS = new Map<
  string,
  HostedOpsOnboardingVoiceMemoContentType
>([
  ["aac", AUDIO_AAC],
  ["aif", AUDIO_AIFF],
  ["aiff", AUDIO_AIFF],
  ["amr", AUDIO_AMR],
  ["caf", AUDIO_CAF],
  ["m4a", AUDIO_M4A],
  ["mp3", AUDIO_MP3],
  ["wav", AUDIO_WAV],
]);

export async function sendHostedOpsOnboardingInvite(
  input: HostedOpsOnboardingInviteInput,
): Promise<HostedOpsOnboardingInviteResult> {
  const prisma = input.prisma ?? getPrisma();
  const request = normalizeHostedOpsOnboardingInviteInput(input);

  if (request.deliveryMode === "new_chat") {
    assertHostedOpsOnboardingAuthorizedLinqSenderPhone(request.linqFromPhoneNumber);
    return sendHostedOpsOnboardingVoiceFirstNewChat({
      prisma,
      request,
    });
  }

  const issued = await issueHostedOpsOnboardingExistingChatInvite({
    prisma,
    request,
  });
  const inviteUrl = buildHostedInviteUrl(issued.invite.inviteCode);
  const inviteMessage = buildHostedOpsOnboardingInviteMessage({
    inviteMessage: request.inviteMessage,
    inviteUrl,
  });
  const delivery = await resolveHostedOpsOnboardingInviteDelivery({
    inviteMessage,
    memberId: issued.memberId,
    request,
  });
  const sentAt = new Date();

  await prisma.hostedInvite.updateMany({
    data: {
      sentAt,
    },
    where: {
      id: issued.invite.id,
      sentAt: null,
    },
  });

  const voiceMemo = request.voiceMemo
    ? await sendHostedOpsOnboardingVoiceMemoBestEffort({
        chatId: delivery.chatId,
        request,
      })
    : {
        error: null,
        requested: false,
        sent: false,
      };

  return {
    chatId: delivery.chatId,
    deliveryMode: "existing_chat",
    inviteExpiresAt: issued.invite.expiresAt.toISOString(),
    inviteId: issued.invite.id,
    invitePreviouslyMarkedSent: issued.invite.sentAt !== null,
    linqFromPhoneHint: request.linqFromPhoneNumber
      ? readHostedPhoneHint(request.linqFromPhoneNumber)
      : null,
    memberId: issued.memberId,
    newChatCreated: delivery.newChatCreated,
    openerMessageId: delivery.openerMessageId,
    recipientPhoneHint: readHostedPhoneHint(request.recipientPhoneNumber),
    sentAt: sentAt.toISOString(),
    textMessageSent: true,
    voiceMemo,
  };
}

async function issueHostedOpsOnboardingExistingChatInvite(input: {
  prisma: PrismaClient;
  request: NormalizedHostedOpsOnboardingExistingChatInviteInput;
}): Promise<{
  invite: Awaited<ReturnType<typeof issueHostedInviteTx>>;
  memberId: string;
}> {
  return input.prisma.$transaction(async (tx) => {
    const memberId = await resolveHostedOpsOnboardingExistingChatMemberId({
      linqChatId: input.request.linqChatId,
      prisma: tx,
      recipientPhoneNumber: input.request.recipientPhoneNumber,
    });
    const invite = await issueHostedInviteTx({
      channel: "linq",
      memberId,
      prisma: tx,
    });

    return {
      invite,
      memberId,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function sendHostedOpsOnboardingVoiceFirstNewChat(input: {
  prisma: PrismaClient;
  request: NormalizedHostedOpsOnboardingNewChatInviteInput;
}): Promise<HostedOpsOnboardingInviteResult> {
  const voiceMemo = input.request.voiceMemo;
  const prepared = await prepareHostedOpsOnboardingNewChat({
    prisma: input.prisma,
    request: input.request,
  });
  const memberId = prepared.memberId;
  const openIdempotencyKey = buildHostedOpsOnboardingIdempotencyKey({
    scopeKey: "voice-first-new-chat",
    step: "open",
    targetParts: [
      memberId,
      input.request.linqFromPhoneNumber,
      input.request.recipientPhoneNumber,
    ],
  });

  const attachment = await uploadHostedLinqAttachment({
    bytes: voiceMemo.bytes,
    contentType: voiceMemo.contentType,
    filename: buildHostedOpsOnboardingVoiceMemoFilename(voiceMemo.extension),
    sizeBytes: voiceMemo.sizeBytes,
  });
  const createdChat = await createHostedLinqMediaChat({
    attachmentId: attachment.attachmentId,
    from: input.request.linqFromPhoneNumber,
    // Linq idempotency is on the chat message send. Attachment creation has no
    // stable idempotency field, so retries may re-upload while this key restores
    // the accepted chat/message and lets us restore the pending binding.
    idempotencyKey: openIdempotencyKey,
    to: [input.request.recipientPhoneNumber],
  });
  const chatId = normalizeNullableString(createdChat.chatId);

  if (!chatId) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_ONBOARDING_CHAT_CREATE_FAILED",
      httpStatus: 502,
      message: "Linq did not return a chat id for the onboarding voice memo.",
      retryable: true,
    });
  }

  await input.prisma.$transaction(async (tx) => {
    await upsertHostedMemberPendingLinqBindingTx({
      existingChatPolicy: "fail",
      linqChatId: chatId,
      memberId,
      prisma: tx,
      recipientPhone: input.request.linqFromPhoneNumber,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return {
    chatId,
    deliveryMode: "new_chat",
    inviteExpiresAt: null,
    inviteId: null,
    invitePreviouslyMarkedSent: false,
    linqFromPhoneHint: readHostedPhoneHint(input.request.linqFromPhoneNumber),
    memberId,
    newChatCreated: true,
    openerMessageId: normalizeNullableString(createdChat.messageId),
    recipientPhoneHint: readHostedPhoneHint(input.request.recipientPhoneNumber),
    sentAt: new Date().toISOString(),
    textMessageSent: false,
    voiceMemo: {
      error: null,
      requested: true,
      sent: true,
    },
  };
}

async function prepareHostedOpsOnboardingNewChat(input: {
  prisma: PrismaClient;
  request: NormalizedHostedOpsOnboardingNewChatInviteInput;
}): Promise<{
  memberId: string;
}> {
  return input.prisma.$transaction(async (tx) => {
    const member = await ensureHostedMemberForPhoneTx({
      phoneNumber: input.request.recipientPhoneNumber,
      prisma: tx,
    });
    const routing = await readHostedMemberRoutingState({
      memberId: member.id,
      prisma: tx,
    });

    if (routing?.linqChatId) {
      throw hostedOnboardingError({
        code: "HOSTED_OPS_ONBOARDING_HOME_LINQ_CHAT_EXISTS",
        httpStatus: 409,
        message: "This recipient already has a Linq chat. Use existing chat mode instead.",
        retryable: false,
      });
    }

    if (routing?.pendingLinqChatId) {
      throw hostedOnboardingError({
        code: "HOSTED_OPS_ONBOARDING_PENDING_LINQ_CHAT_EXISTS",
        httpStatus: 409,
        message: "This recipient already has a pending voice-first onboarding chat. Use the existing chat or wait for their reply before sending another.",
        retryable: false,
      });
    }

    return {
      memberId: member.id,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export function resolveHostedOpsOnboardingVoiceMemoContentType(input: {
  declaredContentType: string | null | undefined;
  filename: string | null | undefined;
}): HostedOpsOnboardingVoiceMemoContentType {
  const declaredContentType = normalizeNullableString(input.declaredContentType)?.toLowerCase();
  const fromMimeType = declaredContentType
    ? HOSTED_OPS_ONBOARDING_VOICE_MEMO_MIME_TYPES.get(declaredContentType)
    : undefined;

  if (fromMimeType) {
    return fromMimeType;
  }

  const extension = normalizeNullableString(input.filename)
    ?.toLowerCase()
    .match(/\.([a-z0-9]+)$/u)?.[1];
  const fromExtension = extension
    ? HOSTED_OPS_ONBOARDING_VOICE_MEMO_EXTENSIONS.get(extension)
    : undefined;

  if (fromExtension) {
    return fromExtension;
  }

  throw hostedOnboardingError({
    code: "HOSTED_OPS_ONBOARDING_VOICE_MEMO_TYPE_UNSUPPORTED",
    httpStatus: 400,
    message: "Voice memo must be an MP3, M4A, AAC, CAF, WAV, AIFF, or AMR audio file.",
    retryable: false,
  });
}

export function buildHostedOpsOnboardingVoiceMemoFilename(extension: string): string {
  const normalizedExtension = normalizeNullableString(extension)?.toLowerCase();

  if (!normalizedExtension || !/^[a-z0-9]{2,8}$/u.test(normalizedExtension)) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_ONBOARDING_VOICE_MEMO_TYPE_UNSUPPORTED",
      httpStatus: 400,
      message: "Voice memo file type is not supported.",
      retryable: false,
    });
  }

  return `murph-ops-voice-memo.${normalizedExtension}`;
}

async function resolveHostedOpsOnboardingInviteDelivery(input: {
  inviteMessage: string;
  memberId: string;
  request: NormalizedHostedOpsOnboardingExistingChatInviteInput;
}): Promise<{
  chatId: string;
  newChatCreated: boolean;
  openerMessageId: string | null;
}> {
  await sendHostedLinqChatMessage({
    chatId: input.request.linqChatId,
    idempotencyKey: buildHostedOpsOnboardingIdempotencyKey({
      scopeKey: input.request.requestId,
      step: "invite",
      targetParts: [
        input.memberId,
        input.request.linqChatId,
      ],
    }),
    message: input.inviteMessage,
  });

  return {
    chatId: input.request.linqChatId,
    newChatCreated: false,
    openerMessageId: null,
  };
}

async function sendHostedOpsOnboardingVoiceMemoBestEffort(input: {
  chatId: string;
  request: NormalizedHostedOpsOnboardingInviteInput;
}): Promise<HostedOpsOnboardingInviteResult["voiceMemo"]> {
  if (!input.request.voiceMemo) {
    return {
      error: null,
      requested: false,
      sent: false,
    };
  }

  try {
    const attachment = await uploadHostedLinqAttachment({
      bytes: input.request.voiceMemo.bytes,
      contentType: input.request.voiceMemo.contentType,
      filename: buildHostedOpsOnboardingVoiceMemoFilename(
        input.request.voiceMemo.extension,
      ),
      sizeBytes: input.request.voiceMemo.sizeBytes,
    });

    await sendHostedLinqVoiceMemo({
      attachmentId: attachment.attachmentId,
      chatId: input.chatId,
    });
  } catch {
    return {
      error: "Voice memo delivery failed after the setup link was sent.",
      requested: true,
      sent: false,
    };
  }

  return {
    error: null,
    requested: true,
    sent: true,
  };
}

async function resolveHostedOpsOnboardingExistingChatMemberId(input: {
  linqChatId: string;
  prisma: Prisma.TransactionClient;
  recipientPhoneNumber: string;
}): Promise<string> {
  const memberId = await resolveHostedOpsOnboardingExistingLinqChatMemberId({
    linqChatId: input.linqChatId,
    prisma: input.prisma,
  });
  const phoneIdentity = await lookupHostedMemberIdentityByPhoneNumber({
    phoneNumber: input.recipientPhoneNumber,
    prisma: input.prisma,
  });

  if (!phoneIdentity || phoneIdentity.core.id !== memberId) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_ONBOARDING_RECIPIENT_PHONE_NOT_BOUND",
      httpStatus: 403,
      message: "Recipient phone is not bound to this Linq chat.",
      retryable: false,
    });
  }

  return memberId;
}

async function resolveHostedOpsOnboardingExistingLinqChatMemberId(input: {
  linqChatId: string;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<string> {
  const homeRoute = await lookupHostedMemberRoutingByHomeLinqChatId({
    linqChatId: input.linqChatId,
    prisma: input.prisma,
  });
  const pendingRoute = homeRoute
    ? null
    : await lookupHostedMemberRoutingByPendingLinqChatId({
        linqChatId: input.linqChatId,
        prisma: input.prisma,
      });
  const route = homeRoute ?? pendingRoute;

  if (route?.routing.memberId) {
    return route.routing.memberId;
  }

  throw hostedOnboardingError({
    code: "HOSTED_OPS_ONBOARDING_LINQ_CHAT_NOT_BOUND",
    httpStatus: 400,
    message:
      "Existing Linq chat is not bound to this hosted member. Use New chat to start onboarding, or wait for the inbound chat to bind before sending.",
    retryable: false,
  });
}

function assertHostedOpsOnboardingAuthorizedLinqSenderPhone(senderPhone: string): void {
  const authorizedSenderPhones = new Set<string>();

  for (const configuredPhone of getHostedOnboardingEnvironment().linqConversationPhoneNumbers) {
    const normalized = normalizePhoneNumber(configuredPhone);

    if (normalized) {
      authorizedSenderPhones.add(normalized);
    }
  }

  if (authorizedSenderPhones.size === 0) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_ONBOARDING_LINQ_CONVERSATION_PHONE_REQUIRED",
      httpStatus: 500,
      message:
        "Configure hosted Linq conversation phone numbers before creating a new onboarding chat.",
      retryable: false,
    });
  }

  if (!authorizedSenderPhones.has(senderPhone)) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_ONBOARDING_FROM_PHONE_UNAUTHORIZED",
      httpStatus: 400,
      message: "Linq sender phone must be a configured hosted conversation phone.",
      retryable: false,
    });
  }
}

type NormalizedHostedOpsOnboardingInviteInput =
  | NormalizedHostedOpsOnboardingExistingChatInviteInput
  | NormalizedHostedOpsOnboardingNewChatInviteInput;

interface NormalizedHostedOpsOnboardingExistingChatInviteInput {
  deliveryMode: "existing_chat";
  inviteMessage: string | null;
  linqChatId: string;
  linqFromPhoneNumber: string;
  recipientPhoneNumber: string;
  requestId: string;
  voiceMemo: HostedOpsOnboardingVoiceMemoInput | null;
}

interface NormalizedHostedOpsOnboardingNewChatInviteInput {
  deliveryMode: "new_chat";
  inviteMessage: string | null;
  linqChatId: string;
  linqFromPhoneNumber: string;
  recipientPhoneNumber: string;
  requestId: string;
  voiceMemo: HostedOpsOnboardingVoiceMemoInput;
}

function normalizeHostedOpsOnboardingInviteInput(
  input: HostedOpsOnboardingInviteInput,
): NormalizedHostedOpsOnboardingInviteInput {
  const deliveryMode = normalizeHostedOpsOnboardingDeliveryMode(input.deliveryMode);
  const recipientPhoneNumber = normalizeHostedOpsOnboardingPhoneNumber(
    input.recipientPhoneNumber,
    "HOSTED_OPS_ONBOARDING_RECIPIENT_PHONE_INVALID",
    "A valid recipient phone number is required.",
  );
  const requestId = normalizeHostedOpsOnboardingRequestId(input.requestId);
  const inviteMessage = normalizeHostedOpsOnboardingMessage(
    input.inviteMessage,
    HOSTED_OPS_ONBOARDING_INVITE_MESSAGE_MAX_LENGTH,
    "HOSTED_OPS_ONBOARDING_INVITE_MESSAGE_TOO_LONG",
    "Invite message is too long.",
  );
  const voiceMemo = normalizeHostedOpsOnboardingVoiceMemo(input.voiceMemo);
  if (deliveryMode === "existing_chat") {
    return {
      deliveryMode,
      inviteMessage,
      linqChatId: normalizeHostedOpsOnboardingLinqChatId(input.linqChatId),
      linqFromPhoneNumber: "",
      recipientPhoneNumber,
      requestId,
      voiceMemo,
    };
  }

  return {
    deliveryMode,
    inviteMessage,
    linqChatId: "",
    linqFromPhoneNumber: normalizeHostedOpsOnboardingPhoneNumber(
      input.linqFromPhoneNumber,
      "HOSTED_OPS_ONBOARDING_FROM_PHONE_INVALID",
      "A valid Linq sender phone number is required for a new chat.",
    ),
    recipientPhoneNumber,
    requestId,
    voiceMemo: requireHostedOpsOnboardingVoiceMemoForNewChat(voiceMemo),
  };
}

function normalizeHostedOpsOnboardingDeliveryMode(
  value: string,
): HostedOpsOnboardingInviteDeliveryMode {
  if (value === "existing_chat" || value === "new_chat") {
    return value;
  }

  throw hostedOnboardingError({
    code: "HOSTED_OPS_ONBOARDING_DELIVERY_MODE_INVALID",
    httpStatus: 400,
    message: "Choose whether to send to an existing chat or create a new one.",
    retryable: false,
  });
}

function normalizeHostedOpsOnboardingPhoneNumber(
  value: string | null | undefined,
  code: string,
  message: string,
): string {
  const normalized = normalizePhoneNumber(value);

  if (!normalized) {
    throw hostedOnboardingError({
      code,
      httpStatus: 400,
      message,
      retryable: false,
    });
  }

  return normalized;
}

function normalizeHostedOpsOnboardingRequestId(value: string): string {
  const normalized = normalizeNullableString(value);

  if (!normalized || !HOSTED_OPS_ONBOARDING_REQUEST_ID_PATTERN.test(normalized)) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_ONBOARDING_REQUEST_ID_INVALID",
      httpStatus: 400,
      message: "Request id is invalid.",
      retryable: false,
    });
  }

  return normalized;
}

function normalizeHostedOpsOnboardingLinqChatId(value: string | null | undefined): string {
  const normalized = normalizeNullableString(value);

  if (!normalized || !HOSTED_OPS_ONBOARDING_LINQ_CHAT_ID_PATTERN.test(normalized)) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_ONBOARDING_LINQ_CHAT_ID_REQUIRED",
      httpStatus: 400,
      message: "Linq chat id is required for an existing chat.",
      retryable: false,
    });
  }

  return normalized;
}

function normalizeHostedOpsOnboardingMessage(
  value: string | null | undefined,
  maxLength: number,
  tooLongCode: string,
  tooLongMessage: string,
): string | null {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    return null;
  }

  if (normalized.length > maxLength) {
    throw hostedOnboardingError({
      code: tooLongCode,
      httpStatus: 400,
      message: tooLongMessage,
      retryable: false,
    });
  }

  return normalized;
}

function normalizeHostedOpsOnboardingVoiceMemo(
  value: HostedOpsOnboardingVoiceMemoInput | null | undefined,
): HostedOpsOnboardingVoiceMemoInput | null {
  if (!value) {
    return null;
  }

  if (value.sizeBytes !== value.bytes.byteLength) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_ONBOARDING_VOICE_MEMO_INVALID",
      httpStatus: 400,
      message: "Voice memo upload is invalid.",
      retryable: false,
    });
  }

  if (value.sizeBytes <= 0 || value.sizeBytes > HOSTED_OPS_ONBOARDING_VOICE_MEMO_MAX_BYTES) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_ONBOARDING_VOICE_MEMO_TOO_LARGE",
      httpStatus: 413,
      message: "Voice memo upload is too large.",
      retryable: false,
    });
  }

  return value;
}

function requireHostedOpsOnboardingVoiceMemoForNewChat(
  value: HostedOpsOnboardingVoiceMemoInput | null,
): HostedOpsOnboardingVoiceMemoInput {
  if (value) {
    return value;
  }

  throw hostedOnboardingError({
    code: "HOSTED_OPS_ONBOARDING_VOICE_MEMO_REQUIRED",
    httpStatus: 400,
    message: "Attach a voice memo before creating a new chat.",
    retryable: false,
  });
}

function buildHostedOpsOnboardingInviteMessage(input: {
  inviteMessage: string | null;
  inviteUrl: string;
}): string {
  const template = input.inviteMessage ?? HOSTED_OPS_ONBOARDING_DEFAULT_INVITE_MESSAGE;
  const rendered = template.includes("{{inviteUrl}}")
    ? template.replaceAll("{{inviteUrl}}", input.inviteUrl)
    : `${template}\n\n${input.inviteUrl}`;

  if (rendered.length > HOSTED_OPS_ONBOARDING_INVITE_MESSAGE_MAX_LENGTH) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_ONBOARDING_INVITE_MESSAGE_TOO_LONG",
      httpStatus: 400,
      message: "Invite message is too long after the setup link is added.",
      retryable: false,
    });
  }

  return rendered;
}

function buildHostedOpsOnboardingIdempotencyKey(input: {
  scopeKey: string;
  step: "invite" | "open";
  targetParts: readonly string[];
}): string {
  const digest = createHash("sha256");

  for (const part of [input.scopeKey, ...input.targetParts]) {
    digest.update(`${part.length}:`, "utf8");
    digest.update(part, "utf8");
    digest.update("\n", "utf8");
  }

  return `ops-onboarding-invite:${input.step}:${digest.digest("hex")}`;
}
