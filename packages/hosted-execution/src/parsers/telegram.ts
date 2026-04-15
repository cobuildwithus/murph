import {
  HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
  type HostedExecutionTelegramMessageReceivedEvent,
} from "../contracts.ts";

import {
  requireArray,
  requireObject,
  requireString,
  readNullableNumber,
  readNullableStringValue,
} from "./assertions.ts";

export function parseHostedExecutionTelegramMessage(
  value: unknown,
): HostedExecutionTelegramMessageReceivedEvent["telegramMessage"] {
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
    schema: parseHostedExecutionTelegramMessageSchema(record.schema),
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
  };
}

function parseHostedExecutionTelegramAttachment(
  value: unknown,
  label: string,
): NonNullable<HostedExecutionTelegramMessageReceivedEvent["telegramMessage"]["attachments"]>[number] {
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
): NonNullable<HostedExecutionTelegramMessageReceivedEvent["telegramMessage"]["attachments"]>[number]["kind"] {
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
): HostedExecutionTelegramMessageReceivedEvent["telegramMessage"]["schema"] {
  const schema = requireString(value, "Hosted execution Telegram message telegramMessage.schema");

  if (schema === HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA) {
    return schema;
  }

  throw new TypeError("Hosted execution Telegram message telegramMessage.schema is unsupported.");
}
