import {
  requireObject,
  requireString,
  readNullableNumber,
  readNullableStringValue,
  readOptionalNullableString,
  readOptionalStringArray,
} from "./parsers/assertions.ts";
import type { HostedExecutionEmailAttachmentSummary } from "./contracts.ts";
import { HOSTED_EMAIL_THREAD_TARGET_MAX_LENGTH } from "@murphai/runtime-state";

const HOSTED_EMAIL_PROMPT_ADDRESS_MAX_COUNT = 8;
const HOSTED_EMAIL_PROMPT_ATTACHMENT_MAX_COUNT = 12;
const HOSTED_EMAIL_PROMPT_SUBJECT_MAX_CHARS = 240;
const HOSTED_EMAIL_PROMPT_TEXT_PREVIEW_MAX_CHARS = 4_000;
const HOSTED_EMAIL_PROMPT_FILE_NAME_MAX_CHARS = 160;
const HOSTED_EMAIL_PROMPT_CONTENT_TYPE_MAX_CHARS = 120;
const HOSTED_EMAIL_PROMPT_ADDRESS_MAX_CHARS = 160;
export const HOSTED_EMAIL_PROMPT_SELF_ADDRESS_MAX_CHARS = 320;
const HOSTED_EMAIL_PROMPT_MESSAGE_ID_MAX_CHARS = 512;
const HOSTED_EMAIL_PROMPT_THREAD_KEY_MAX_CHARS = 512;
const HOSTED_EMAIL_PROMPT_THREAD_TARGET_MAX_CHARS =
  HOSTED_EMAIL_THREAD_TARGET_MAX_LENGTH;

export interface HostedEmailIngressWakeAppendRequest {
  attachmentSummaries?: HostedExecutionEmailAttachmentSummary[];
  cc?: string[];
  eventId: string;
  from?: string | null;
  identityId: string | null;
  messageId?: string | null;
  occurredAt: string;
  rawMessageKey: string;
  selfAddress?: string | null;
  subject?: string | null;
  textPreview?: string | null;
  threadKey?: string | null;
  threadTarget?: string | null;
  to?: string[];
}

export function parseHostedEmailIngressWakeAppendRequest(
  value: unknown,
): HostedEmailIngressWakeAppendRequest {
  const record = requireObject(value, "Hosted email ingress wake append request");

  return {
    ...(record.attachmentSummaries === undefined
      ? {}
      : {
          attachmentSummaries: parseHostedEmailIngressAttachmentSummaries(
            record.attachmentSummaries,
            "Hosted email ingress wake append request attachmentSummaries",
            HOSTED_EMAIL_PROMPT_ATTACHMENT_MAX_COUNT,
          ),
        }),
    ...(record.cc === undefined
      ? {}
      : {
          cc: readBoundedOptionalStringArray(
            record.cc,
            "Hosted email ingress wake append request cc",
            HOSTED_EMAIL_PROMPT_ADDRESS_MAX_COUNT,
            HOSTED_EMAIL_PROMPT_ADDRESS_MAX_CHARS,
          ),
        }),
    eventId: requireString(record.eventId, "Hosted email ingress wake append request eventId"),
    ...(record.from === undefined
      ? {}
      : {
          from: readBoundedOptionalNullableString(
            record.from,
            "Hosted email ingress wake append request from",
            HOSTED_EMAIL_PROMPT_ADDRESS_MAX_CHARS,
          ),
        }),
    identityId: readNullableStringValue(
      record.identityId,
      "Hosted email ingress wake append request identityId",
    ),
    ...(record.messageId === undefined
      ? {}
      : {
          messageId: readBoundedOptionalNullableString(
            record.messageId,
            "Hosted email ingress wake append request messageId",
            HOSTED_EMAIL_PROMPT_MESSAGE_ID_MAX_CHARS,
          ),
        }),
    occurredAt: requireString(
      record.occurredAt,
      "Hosted email ingress wake append request occurredAt",
    ),
    rawMessageKey: requireString(
      record.rawMessageKey,
      "Hosted email ingress wake append request rawMessageKey",
    ),
    ...(record.selfAddress === undefined
      ? {}
      : {
          selfAddress: readBoundedOptionalNullableString(
            record.selfAddress,
            "Hosted email ingress wake append request selfAddress",
            HOSTED_EMAIL_PROMPT_SELF_ADDRESS_MAX_CHARS,
          ),
        }),
    ...(record.subject === undefined
      ? {}
      : {
          subject: readBoundedOptionalNullableString(
            record.subject,
            "Hosted email ingress wake append request subject",
            HOSTED_EMAIL_PROMPT_SUBJECT_MAX_CHARS,
          ),
        }),
    ...(record.textPreview === undefined
      ? {}
      : {
          textPreview: readBoundedOptionalNullableString(
            record.textPreview,
            "Hosted email ingress wake append request textPreview",
            HOSTED_EMAIL_PROMPT_TEXT_PREVIEW_MAX_CHARS,
          ),
        }),
    ...(record.threadKey === undefined
      ? {}
      : {
          threadKey: readBoundedOptionalNullableString(
            record.threadKey,
            "Hosted email ingress wake append request threadKey",
            HOSTED_EMAIL_PROMPT_THREAD_KEY_MAX_CHARS,
          ),
        }),
    ...(record.threadTarget === undefined
      ? {}
      : {
          threadTarget: readBoundedOptionalNullableString(
            record.threadTarget,
            "Hosted email ingress wake append request threadTarget",
            HOSTED_EMAIL_PROMPT_THREAD_TARGET_MAX_CHARS,
          ),
        }),
    ...(record.to === undefined
      ? {}
      : {
          to: readBoundedOptionalStringArray(
            record.to,
            "Hosted email ingress wake append request to",
            HOSTED_EMAIL_PROMPT_ADDRESS_MAX_COUNT,
            HOSTED_EMAIL_PROMPT_ADDRESS_MAX_CHARS,
          ),
        }),
  };
}

function parseHostedEmailIngressAttachmentSummaries(
  value: unknown,
  label: string,
  maxCount: number,
): HostedExecutionEmailAttachmentSummary[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  if (value.length > maxCount) {
    throw new TypeError(`${label} must include at most ${maxCount} items.`);
  }

  return value.map((entry, index) => {
    const record = requireObject(entry, `${label}[${index}]`);
    return {
      ...(record.contentType === undefined
        ? {}
        : {
            contentType: readBoundedOptionalNullableString(
              record.contentType,
              `${label}[${index}] contentType`,
              HOSTED_EMAIL_PROMPT_CONTENT_TYPE_MAX_CHARS,
            ),
          }),
      ...(record.fileName === undefined
        ? {}
        : {
            fileName: readBoundedOptionalNullableString(
              record.fileName,
              `${label}[${index}] fileName`,
              HOSTED_EMAIL_PROMPT_FILE_NAME_MAX_CHARS,
            ),
          }),
      ...(record.sizeBytes === undefined
        ? {}
        : {
            sizeBytes: readNullableNumber(
              record.sizeBytes,
              `${label}[${index}] sizeBytes`,
            ),
          }),
    };
  });
}

function readBoundedOptionalStringArray(
  value: unknown,
  label: string,
  maxCount: number,
  maxChars: number,
): string[] | undefined {
  const values = readOptionalStringArray(value, label);
  if (values === undefined) {
    return undefined;
  }
  if (values.length > maxCount) {
    throw new TypeError(`${label} must include at most ${maxCount} items.`);
  }
  for (const [index, entry] of values.entries()) {
    assertBoundedHostedEmailPromptString(entry, `${label}[${index}]`, maxChars);
  }
  return values;
}

function readBoundedOptionalNullableString(
  value: unknown,
  label: string,
  maxChars: number,
): string | null | undefined {
  const text = readOptionalNullableString(value, label);
  if (text !== undefined && text !== null) {
    assertBoundedHostedEmailPromptString(text, label, maxChars);
  }
  return text;
}

function assertBoundedHostedEmailPromptString(
  value: string,
  label: string,
  maxChars: number,
): void {
  if (value.length > maxChars) {
    throw new TypeError(`${label} must be at most ${maxChars} characters.`);
  }
}
