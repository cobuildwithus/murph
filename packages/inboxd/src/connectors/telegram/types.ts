export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  [key: string]: unknown;
}

export interface TelegramChat {
  id: number | string;
  type?: "private" | "group" | "supergroup" | "channel" | string;
  title?: string | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  [key: string]: unknown;
}

export interface TelegramFileBase {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_name?: string;
  mime_type?: string;
  [key: string]: unknown;
}

export interface TelegramPhotoSize extends TelegramFileBase {
  width?: number;
  height?: number;
}

export interface TelegramMessageLike {
  message_id: number;
  date?: number | null;
  edit_date?: number | null;
  message_thread_id?: number | null;
  text?: string | null;
  caption?: string | null;
  chat: TelegramChat;
  from?: TelegramUser | null;
  sender_chat?: TelegramChat | null;
  photo?: TelegramPhotoSize[] | null;
  document?: TelegramFileBase | null;
  audio?: TelegramFileBase | null;
  voice?: TelegramFileBase | null;
  video?: TelegramFileBase | null;
  video_note?: TelegramFileBase | null;
  animation?: TelegramFileBase | null;
  sticker?: TelegramFileBase | null;
  [key: string]: unknown;
}

export interface TelegramUpdateLike {
  update_id: number;
  message?: TelegramMessageLike;
  edited_message?: TelegramMessageLike;
  channel_post?: TelegramMessageLike;
  edited_channel_post?: TelegramMessageLike;
  business_message?: TelegramMessageLike;
  edited_business_message?: TelegramMessageLike;
  [key: string]: unknown;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_path?: string;
  [key: string]: unknown;
}

export interface TelegramWebhookInfo {
  url?: string;
  pending_update_count?: number;
  [key: string]: unknown;
}
