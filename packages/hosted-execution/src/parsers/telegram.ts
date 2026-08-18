import {
  HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
  type HostedExecutionTelegramAttachment,
  type HostedExecutionTelegramMessage,
} from "../contracts.ts";

import {
  requireArray,
  requireBoolean,
  requireObject,
  requireString,
  readNullableNumber,
  readNullableStringValue,
} from "./assertions.ts";

const HOSTED_TELEGRAM_REPLY_CONTEXT_PREVIEW_LIMIT = 240;
const HOSTED_TELEGRAM_SENDER_DISPLAY_NAME_MAX_CODE_POINTS = 120;

export function parseHostedExecutionTelegramMessage(
  value: unknown,
): HostedExecutionTelegramMessage {
  const record = requireObject(value, "Hosted execution Telegram message telegramMessage");
  const attachmentsValue = record.attachments;

  return {
    ...(attachmentsValue === undefined
      ? {}
      : {
          attachments: requireArray(
            attachmentsValue,
            "Hosted execution Telegram message telegramMessage.attachments",
          ).map((entry, index) =>
            parseHostedExecutionTelegramAttachment(
              entry,
              `Hosted execution Telegram message telegramMessage.attachments[${index}]`,
            ),
          ),
        }),
    ...(record.from === undefined
      ? {}
      : {
          from: readNullableStringValue(
            record.from,
            "Hosted execution Telegram message telegramMessage.from",
          ),
        }),
    ...(record.mediaGroupId === undefined
      ? {}
      : {
          mediaGroupId: readNullableStringValue(
            record.mediaGroupId,
            "Hosted execution Telegram message telegramMessage.mediaGroupId",
          ),
        }),
    messageId: requireString(
      record.messageId,
      "Hosted execution Telegram message telegramMessage.messageId",
    ),
    ...(record.replyContextPreview === undefined
      ? {}
      : {
          replyContextPreview: normalizeHostedTelegramReplyContextPreview(
            readNullableStringValue(
              record.replyContextPreview,
              "Hosted execution Telegram message telegramMessage.replyContextPreview",
            ),
          ),
        }),
    ...(record.replyToMessageId === undefined
      ? {}
      : {
          replyToMessageId: requireString(
            record.replyToMessageId,
            "Hosted execution Telegram message telegramMessage.replyToMessageId",
          ),
        }),
    schema: parseHostedExecutionTelegramMessageSchema(record.schema),
    ...(record.senderDisplayName === undefined
      ? {}
      : {
          senderDisplayName: parseHostedTelegramSenderDisplayName(
            record.senderDisplayName,
            "Hosted execution Telegram message telegramMessage.senderDisplayName",
          ),
        }),
    ...(record.senderUsername === undefined
      ? {}
      : {
          senderUsername: readNullableStringValue(
            record.senderUsername,
            "Hosted execution Telegram message telegramMessage.senderUsername",
          ),
        }),
    ...(record.text === undefined
      ? {}
      : {
          text: readNullableStringValue(
            record.text,
            "Hosted execution Telegram message telegramMessage.text",
          ),
        }),
    threadId: requireString(
      record.threadId,
      "Hosted execution Telegram message telegramMessage.threadId",
    ),
    ...(record.threadIsDirect === undefined
      ? {}
      : {
          threadIsDirect: requireBoolean(
            record.threadIsDirect,
            "Hosted execution Telegram message telegramMessage.threadIsDirect",
          ),
        }),
  };
}

function parseHostedTelegramSenderDisplayName(
  value: unknown,
  label: string,
): string | null {
  const displayName = readNullableStringValue(value, label);
  if (
    displayName !== null
    && Array.from(displayName).length
      > HOSTED_TELEGRAM_SENDER_DISPLAY_NAME_MAX_CODE_POINTS
  ) {
    throw new TypeError(`${label} is too long.`);
  }
  return displayName;
}

function parseHostedExecutionTelegramAttachment(
  value: unknown,
  label: string,
): HostedExecutionTelegramAttachment {
  const record = requireObject(value, label);

  return {
    fileId: requireString(record.fileId, `${label}.fileId`),
    ...(record.fileName === undefined
      ? {}
      : {
          fileName: readNullableStringValue(record.fileName, `${label}.fileName`),
        }),
    ...(record.fileSize === undefined
      ? {}
      : {
          fileSize: readNullableNumber(record.fileSize, `${label}.fileSize`),
        }),
    ...(record.fileUniqueId === undefined
      ? {}
      : {
          fileUniqueId: readNullableStringValue(record.fileUniqueId, `${label}.fileUniqueId`),
        }),
    ...(record.height === undefined
      ? {}
      : {
          height: readNullableNumber(record.height, `${label}.height`),
        }),
    kind: parseHostedExecutionTelegramAttachmentKind(record.kind, `${label}.kind`),
    ...(record.mimeType === undefined
      ? {}
      : {
          mimeType: readNullableStringValue(record.mimeType, `${label}.mimeType`),
        }),
    ...(record.width === undefined
      ? {}
      : {
          width: readNullableNumber(record.width, `${label}.width`),
        }),
  };
}

function parseHostedExecutionTelegramAttachmentKind(
  value: unknown,
  label: string,
): HostedExecutionTelegramAttachment["kind"] {
  const kind = requireString(value, label);

  if (
    kind === "animation"
    || kind === "audio"
    || kind === "document"
    || kind === "photo"
    || kind === "sticker"
    || kind === "video"
    || kind === "video_note"
    || kind === "voice"
  ) {
    return kind;
  }

  throw new TypeError(`${label} must be a supported hosted Telegram attachment kind.`);
}

function parseHostedExecutionTelegramMessageSchema(
  value: unknown,
): HostedExecutionTelegramMessage["schema"] {
  const schema = requireString(value, "Hosted execution Telegram message telegramMessage.schema");

  if (schema === HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA) {
    return schema;
  }

  throw new TypeError("Hosted execution Telegram message telegramMessage.schema is unsupported.");
}

function normalizeHostedTelegramReplyContextPreview(
  value: string | null,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value.length > HOSTED_TELEGRAM_REPLY_CONTEXT_PREVIEW_LIMIT
    ? `${value.slice(0, HOSTED_TELEGRAM_REPLY_CONTEXT_PREVIEW_LIMIT - 3)}...`
    : value;
}
