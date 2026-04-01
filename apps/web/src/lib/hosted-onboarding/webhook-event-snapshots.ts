import type {
  LinqMessagePart,
  LinqMessageReceivedEvent,
} from "@murphai/inboxd/linq-webhook";
import type {
  TelegramChat,
  TelegramFileBase,
  TelegramMessageLike,
  TelegramPhotoSize,
  TelegramUpdateLike,
  TelegramUser,
} from "@murphai/inboxd/telegram-webhook";

type HostedTelegramContact = Exclude<TelegramMessageLike["contact"], null | undefined>;
type HostedTelegramDirectMessagesTopic = Exclude<
  TelegramMessageLike["direct_messages_topic"],
  null | undefined
>;
type HostedTelegramLocation = Exclude<TelegramMessageLike["location"], null | undefined>;
type HostedTelegramPoll = Exclude<TelegramMessageLike["poll"], null | undefined>;
type HostedTelegramTextQuote = Exclude<TelegramMessageLike["quote"], null | undefined>;
type HostedTelegramVenue = Exclude<TelegramMessageLike["venue"], null | undefined>;

export function minimizeHostedLinqMessageReceivedEvent(
  event: LinqMessageReceivedEvent,
): Record<string, unknown> {
  return compactRecord({
    api_version: event.api_version,
    created_at: event.created_at,
    data: compactRecord({
      chat_id: event.data.chat_id,
      from: event.data.from,
      is_from_me: event.data.is_from_me,
      message: compactRecord({
        effect: pickHostedLinqMessageEffect(event.data.message.effect),
        id: event.data.message.id,
        parts: event.data.message.parts.map((part) => pickHostedLinqMessagePart(part)),
        reply_to: pickHostedLinqReplyTo(event.data.message.reply_to),
      }),
      received_at: event.data.received_at,
      recipient_phone: event.data.recipient_phone,
      service: event.data.service,
    }),
    event_id: event.event_id,
    event_type: event.event_type,
    partner_id: event.partner_id,
    trace_id: event.trace_id,
  });
}

export function minimizeHostedTelegramUpdate(
  update: TelegramUpdateLike,
): Record<string, unknown> {
  return compactRecord({
    business_message: pickHostedTelegramMessage(update.business_message),
    message: pickHostedTelegramMessage(update.message),
    update_id: update.update_id,
  });
}

function pickHostedLinqMessagePart(part: LinqMessagePart): Record<string, unknown> {
  if (part.type === "text") {
    return compactRecord({
      type: part.type,
      value: part.value,
    });
  }

  return compactRecord({
    attachment_id: part.attachment_id,
    filename: part.filename,
    mime_type: part.mime_type,
    size: part.size,
    type: part.type,
  });
}

function pickHostedLinqMessageEffect(
  value: LinqMessageReceivedEvent["data"]["message"]["effect"],
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  return compactRecord({
    name: value.name,
    type: value.type,
  });
}

function pickHostedLinqReplyTo(
  value: LinqMessageReceivedEvent["data"]["message"]["reply_to"],
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  return compactRecord({
    message_id: value.message_id,
    part_index: value.part_index,
  });
}

function pickHostedTelegramMessage(
  message: TelegramMessageLike | null | undefined,
): Record<string, unknown> | null {
  if (!message) {
    return null;
  }

  return compactRecord({
    animation: pickHostedTelegramFile(message.animation),
    audio: pickHostedTelegramFile(message.audio),
    business_connection_id: message.business_connection_id,
    caption: message.caption,
    chat: pickHostedTelegramChat(message.chat),
    contact: pickHostedTelegramContact(message.contact),
    date: message.date,
    direct_messages_topic: pickHostedTelegramDirectMessagesTopic(message.direct_messages_topic),
    document: pickHostedTelegramFile(message.document),
    edit_date: message.edit_date,
    from: pickHostedTelegramUser(message.from),
    location: pickHostedTelegramLocation(message.location),
    media_group_id: message.media_group_id,
    message_id: message.message_id,
    message_thread_id: message.message_thread_id,
    photo: message.photo?.map((photo) => pickHostedTelegramPhotoSize(photo)) ?? message.photo ?? undefined,
    poll: pickHostedTelegramPoll(message.poll),
    quote: pickHostedTelegramQuote(message.quote),
    reply_to_message: pickHostedTelegramReplyMessage(message.reply_to_message),
    sender_business_bot: pickHostedTelegramUser(message.sender_business_bot),
    sender_chat: pickHostedTelegramChat(message.sender_chat),
    sticker: pickHostedTelegramFile(message.sticker),
    text: message.text,
    venue: pickHostedTelegramVenue(message.venue),
    video: pickHostedTelegramFile(message.video),
    video_note: pickHostedTelegramFile(message.video_note),
    voice: pickHostedTelegramFile(message.voice),
  });
}

function pickHostedTelegramReplyMessage(
  message: TelegramMessageLike | null | undefined,
): Record<string, unknown> | null {
  if (!message) {
    return null;
  }

  return compactRecord({
    business_connection_id: message.business_connection_id,
    caption: message.caption,
    chat: pickHostedTelegramChat(message.chat),
    contact: pickHostedTelegramContact(message.contact),
    date: message.date,
    direct_messages_topic: pickHostedTelegramDirectMessagesTopic(message.direct_messages_topic),
    from: pickHostedTelegramUser(message.from),
    location: pickHostedTelegramLocation(message.location),
    media_group_id: message.media_group_id,
    message_id: message.message_id,
    message_thread_id: message.message_thread_id,
    poll: pickHostedTelegramPoll(message.poll),
    quote: pickHostedTelegramQuote(message.quote),
    sender_business_bot: pickHostedTelegramUser(message.sender_business_bot),
    sender_chat: pickHostedTelegramChat(message.sender_chat),
    text: message.text,
    venue: pickHostedTelegramVenue(message.venue),
  });
}

function pickHostedTelegramChat(
  chat: TelegramChat | null | undefined,
): Record<string, unknown> | null {
  if (!chat) {
    return null;
  }

  return compactRecord({
    first_name: chat.first_name,
    id: chat.id,
    is_direct_messages: chat.is_direct_messages,
    last_name: chat.last_name,
    title: chat.title,
    type: chat.type,
    username: chat.username,
  });
}

function pickHostedTelegramUser(
  user: TelegramUser | null | undefined,
): Record<string, unknown> | null {
  if (!user) {
    return null;
  }

  return compactRecord({
    first_name: user.first_name,
    id: user.id,
    is_bot: user.is_bot,
    last_name: user.last_name,
    username: user.username,
  });
}

function pickHostedTelegramPhotoSize(
  photo: TelegramPhotoSize,
): Record<string, unknown> {
  return compactRecord({
    file_id: photo.file_id,
    file_name: photo.file_name,
    file_size: photo.file_size,
    file_unique_id: photo.file_unique_id,
    height: photo.height,
    mime_type: photo.mime_type,
    width: photo.width,
  });
}

function pickHostedTelegramFile(
  file: TelegramFileBase | null | undefined,
): Record<string, unknown> | null {
  if (!file) {
    return null;
  }

  return compactRecord({
    file_id: file.file_id,
    file_name: file.file_name,
    file_size: file.file_size,
    file_unique_id: file.file_unique_id,
    mime_type: file.mime_type,
  });
}

function pickHostedTelegramDirectMessagesTopic(
  topic: HostedTelegramDirectMessagesTopic | null | undefined,
): Record<string, unknown> | null {
  if (!topic) {
    return null;
  }

  return compactRecord({
    title: topic.title,
    topic_id: topic.topic_id,
  });
}

function pickHostedTelegramQuote(
  quote: HostedTelegramTextQuote | null | undefined,
): Record<string, unknown> | null {
  if (!quote) {
    return null;
  }

  return compactRecord({
    text: quote.text,
  });
}

function pickHostedTelegramContact(
  contact: HostedTelegramContact | null | undefined,
): Record<string, unknown> | null {
  if (!contact) {
    return null;
  }

  return compactRecord({
    first_name: contact.first_name,
    last_name: contact.last_name,
    phone_number: contact.phone_number,
    user_id: contact.user_id,
    vcard: contact.vcard,
  });
}

function pickHostedTelegramLocation(
  location: HostedTelegramLocation | null | undefined,
): Record<string, unknown> | null {
  if (!location) {
    return null;
  }

  return compactRecord({
    latitude: location.latitude,
    longitude: location.longitude,
  });
}

function pickHostedTelegramVenue(
  venue: HostedTelegramVenue | null | undefined,
): Record<string, unknown> | null {
  if (!venue) {
    return null;
  }

  return compactRecord({
    address: venue.address,
    location: pickHostedTelegramLocation(venue.location),
    title: venue.title,
  });
}

function pickHostedTelegramPoll(
  poll: HostedTelegramPoll | null | undefined,
): Record<string, unknown> | null {
  if (!poll) {
    return null;
  }

  return compactRecord({
    options: poll.options?.map((option) =>
      compactRecord({
        text: option.text,
      })
    ) ?? undefined,
    question: poll.question,
  });
}

function compactRecord(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
}
