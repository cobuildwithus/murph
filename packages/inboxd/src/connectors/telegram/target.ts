const TELEGRAM_BUSINESS_TARGET_MARKER = ":business:";
const TELEGRAM_DIRECT_MESSAGES_TOPIC_TARGET_MARKER = ":dm-topic:";
const TELEGRAM_TOPIC_TARGET_MARKER = ":topic:";

export interface TelegramThreadTarget {
  businessConnectionId: string | null;
  chatId: string;
  directMessagesTopicId: number | null;
  messageThreadId: number | null;
}

export function serializeTelegramThreadTarget(input: TelegramThreadTarget): string {
  let target = input.chatId;

  if (input.businessConnectionId) {
    target += `:business:${encodeURIComponent(input.businessConnectionId)}`;
  }

  if (input.directMessagesTopicId !== null) {
    target += `:dm-topic:${input.directMessagesTopicId}`;
  } else if (input.messageThreadId !== null) {
    target += `:topic:${input.messageThreadId}`;
  }

  return target;
}

export function parseTelegramThreadTarget(target: string): TelegramThreadTarget | null {
  const normalizedTarget = normalizeTextValue(target);
  if (!normalizedTarget) {
    return null;
  }

  const firstMarkerIndex = firstTelegramMarkerIndex(normalizedTarget);
  const chatId =
    firstMarkerIndex < 0
      ? normalizedTarget
      : normalizeTextValue(normalizedTarget.slice(0, firstMarkerIndex));

  if (!chatId) {
    return null;
  }

  let businessConnectionId: string | null = null;
  let directMessagesTopicId: number | null = null;
  let messageThreadId: number | null = null;
  let remainder =
    firstMarkerIndex < 0 ? "" : normalizedTarget.slice(firstMarkerIndex);

  while (remainder.length > 0) {
    const marker = matchingTelegramMarker(remainder);
    if (!marker) {
      return null;
    }

    remainder = remainder.slice(marker.length);
    const nextMarkerIndex = firstTelegramMarkerIndex(remainder);
    const rawValue =
      nextMarkerIndex < 0 ? remainder : remainder.slice(0, nextMarkerIndex);
    remainder = nextMarkerIndex < 0 ? "" : remainder.slice(nextMarkerIndex);

    if (marker === TELEGRAM_BUSINESS_TARGET_MARKER) {
      if (businessConnectionId !== null) {
        return null;
      }

      businessConnectionId = normalizeTelegramBusinessConnectionId(rawValue);
      if (businessConnectionId === null) {
        return null;
      }
      continue;
    }

    const parsedInteger = parseTelegramTargetPositiveInteger(rawValue);
    if (parsedInteger === null) {
      return null;
    }

    if (marker === TELEGRAM_TOPIC_TARGET_MARKER) {
      if (messageThreadId !== null || directMessagesTopicId !== null) {
        return null;
      }

      messageThreadId = parsedInteger;
      continue;
    }

    if (directMessagesTopicId !== null || messageThreadId !== null) {
      return null;
    }

    directMessagesTopicId = parsedInteger;
  }

  return {
    businessConnectionId,
    chatId,
    directMessagesTopicId,
    messageThreadId,
  };
}

function firstTelegramMarkerIndex(target: string): number {
  const indexes = [
    target.indexOf(TELEGRAM_BUSINESS_TARGET_MARKER),
    target.indexOf(TELEGRAM_DIRECT_MESSAGES_TOPIC_TARGET_MARKER),
    target.indexOf(TELEGRAM_TOPIC_TARGET_MARKER),
  ].filter((value) => value >= 0);

  if (indexes.length === 0) {
    return -1;
  }

  return Math.min(...indexes);
}

function matchingTelegramMarker(target: string): string | null {
  if (target.startsWith(TELEGRAM_BUSINESS_TARGET_MARKER)) {
    return TELEGRAM_BUSINESS_TARGET_MARKER;
  }

  if (target.startsWith(TELEGRAM_DIRECT_MESSAGES_TOPIC_TARGET_MARKER)) {
    return TELEGRAM_DIRECT_MESSAGES_TOPIC_TARGET_MARKER;
  }

  if (target.startsWith(TELEGRAM_TOPIC_TARGET_MARKER)) {
    return TELEGRAM_TOPIC_TARGET_MARKER;
  }

  return null;
}

function normalizeTelegramBusinessConnectionId(rawValue: string): string | null {
  const normalized = normalizeTextValue(rawValue);
  if (!normalized) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(normalized);
    return decoded.trim() ? decoded : null;
  } catch {
    return null;
  }
}

function parseTelegramTargetPositiveInteger(rawValue: string): number | null {
  const normalized = normalizeTextValue(rawValue);
  if (!normalized || !/^\d+$/u.test(normalized)) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeTextValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
