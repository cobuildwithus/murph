export {
  buildTelegramThreadId,
  extractTelegramMessage,
  normalizeTelegramMessage,
  normalizeTelegramUpdate,
  toTelegramChatMessage,
} from "./connectors/telegram/normalize.ts";
export type {
  NormalizeTelegramMessageInput,
  NormalizeTelegramUpdateInput,
  TelegramAttachmentDownloadDriver,
} from "./connectors/telegram/normalize.ts";
export {
  parseTelegramThreadTarget,
  serializeTelegramThreadTarget,
} from "./connectors/telegram/target.ts";
export type {
  TelegramThreadTarget,
} from "./connectors/telegram/target.ts";
export type {
  TelegramChat,
  TelegramFile,
  TelegramFileBase,
  TelegramMessageLike,
  TelegramPhotoSize,
  TelegramUpdateLike,
  TelegramUser,
  TelegramWebhookInfo,
} from "./connectors/telegram/types.ts";
