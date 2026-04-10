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
  is_direct_messages?: boolean | null;
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

export interface TelegramDirectMessagesTopic {
  topic_id?: number | null;
  title?: string | null;
  [key: string]: unknown;
}

export interface TelegramContact {
  first_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  user_id?: number | null;
  vcard?: string | null;
  [key: string]: unknown;
}

export interface TelegramLocation {
  latitude?: number | null;
  longitude?: number | null;
  [key: string]: unknown;
}

export interface TelegramVenue {
  title?: string | null;
  address?: string | null;
  location?: TelegramLocation | null;
  [key: string]: unknown;
}

export interface TelegramPollOption {
  text?: string | null;
  [key: string]: unknown;
}

export interface TelegramPoll {
  question?: string | null;
  options?: TelegramPollOption[] | null;
  [key: string]: unknown;
}

export interface TelegramTextQuote {
  text?: string | null;
  [key: string]: unknown;
}

export interface TelegramMessageLike {
  message_id: number;
  date?: number | null;
  edit_date?: number | null;
  business_connection_id?: string | null;
  direct_messages_topic?: TelegramDirectMessagesTopic | null;
  media_group_id?: string | null;
  message_thread_id?: number | null;
  text?: string | null;
  caption?: string | null;
  chat: TelegramChat;
  from?: TelegramUser | null;
  sender_chat?: TelegramChat | null;
  sender_business_bot?: TelegramUser | null;
  reply_to_message?: TelegramMessageLike | null;
  quote?: TelegramTextQuote | null;
  photo?: TelegramPhotoSize[] | null;
  document?: TelegramFileBase | null;
  audio?: TelegramFileBase | null;
  voice?: TelegramFileBase | null;
  video?: TelegramFileBase | null;
  video_note?: TelegramFileBase | null;
  animation?: TelegramFileBase | null;
  sticker?: TelegramFileBase | null;
  contact?: TelegramContact | null;
  location?: TelegramLocation | null;
  venue?: TelegramVenue | null;
  poll?: TelegramPoll | null;
  [key: string]: unknown;
}

export interface TelegramUpdateLike {
  update_id: number;
  message?: TelegramMessageLike;
  business_message?: TelegramMessageLike;
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
