import { describe, expect, it } from "vitest";

import {
  requireArray,
  requireBoolean,
  requireNumber,
  requireObject,
  requireString,
  requireStringArray,
  readNullableNumber,
  readNullableString,
  readNullableStringValue,
  readOptionalNullableString,
  readOptionalStringArray,
} from "../src/parsers/assertions.ts";
import { parseHostedExecutionTelegramMessage } from "../src/parsers/telegram.ts";

describe("parser assertions", () => {
  it("accepts valid primitive and collection inputs", () => {
    const objectValue = { ok: true };
    const arrayValue = ["a", "b"];

    expect(requireObject(objectValue, "object")).toBe(objectValue);
    expect(requireString("value", "string")).toBe("value");
    expect(requireNumber(42, "number")).toBe(42);
    expect(requireBoolean(false, "boolean")).toBe(false);
    expect(readNullableString("value", "nullable-string")).toBe("value");
    expect(readNullableString(null, "nullable-string")).toBeNull();
    expect(readNullableStringValue("", "nullable-string-value")).toBe("");
    expect(readNullableStringValue(undefined, "nullable-string-value")).toBeNull();
    expect(readNullableNumber(7, "nullable-number")).toBe(7);
    expect(readNullableNumber(undefined, "nullable-number")).toBeNull();
    expect(readOptionalNullableString(undefined, "optional-nullable-string")).toBeUndefined();
    expect(readOptionalNullableString(null, "optional-nullable-string")).toBeNull();
    expect(readOptionalNullableString("value", "optional-nullable-string")).toBe("value");
    expect(requireArray(arrayValue, "array")).toBe(arrayValue);
    expect(requireStringArray(arrayValue, "string-array")).toEqual(arrayValue);
    expect(readOptionalStringArray(undefined, "optional-string-array")).toBeUndefined();
    expect(readOptionalStringArray(arrayValue, "optional-string-array")).toEqual(arrayValue);
  });

  it("fails closed on invalid primitive and collection inputs", () => {
    expect(() => requireObject([], "object")).toThrow(/must be an object/i);
    expect(() => requireString("", "string")).toThrow(/non-empty string/i);
    expect(() => requireNumber(Number.NaN, "number")).toThrow(/finite number/i);
    expect(() => requireBoolean("true", "boolean")).toThrow(/must be a boolean/i);
    expect(() => readNullableString(1, "nullable-string")).toThrow(/non-empty string/i);
    expect(() => readNullableStringValue(1, "nullable-string-value")).toThrow(/string or null/i);
    expect(() => readNullableNumber("7", "nullable-number")).toThrow(/finite number/i);
    expect(() => requireArray({}, "array")).toThrow(/must be an array/i);
    expect(() => requireStringArray(["ok", 1], "string-array")).toThrow(/\[1\].*non-empty string/i);
  });
});

describe("telegram parser", () => {
  it("parses telegram messages with and without optional fields", () => {
    expect(parseHostedExecutionTelegramMessage({
      attachments: [
        {
          fileId: "file-1",
          fileName: "photo.jpg",
          fileSize: 42,
          fileUniqueId: "unique-1",
          height: 720,
          kind: "photo",
          mimeType: "image/jpeg",
          width: 1280,
        },
      ],
      mediaGroupId: null,
      messageId: "message-1",
      replyContextPreview: "Replying to: Earlier message",
      replyToMessageId: "earlier-message-1",
      schema: "murph.hosted-telegram-message.v1",
      text: "hello",
      threadId: "thread-1",
      threadIsDirect: false,
    })).toEqual({
      attachments: [
        {
          fileId: "file-1",
          fileName: "photo.jpg",
          fileSize: 42,
          fileUniqueId: "unique-1",
          height: 720,
          kind: "photo",
          mimeType: "image/jpeg",
          width: 1280,
        },
      ],
      mediaGroupId: null,
      messageId: "message-1",
      replyContextPreview: "Replying to: Earlier message",
      replyToMessageId: "earlier-message-1",
      schema: "murph.hosted-telegram-message.v1",
      text: "hello",
      threadId: "thread-1",
      threadIsDirect: false,
    });

    expect(parseHostedExecutionTelegramMessage({
      messageId: "message-2",
      schema: "murph.hosted-telegram-message.v1",
      threadId: "thread-2",
    })).toEqual({
      messageId: "message-2",
      schema: "murph.hosted-telegram-message.v1",
      threadId: "thread-2",
    });
  });

  it("bounds overlong telegram reply context previews at the shared hosted-execution boundary", () => {
    const preview = parseHostedExecutionTelegramMessage({
      messageId: "message-3",
      replyContextPreview: `Replying to: ${"x".repeat(400)}`,
      schema: "murph.hosted-telegram-message.v1",
      threadId: "thread-3",
    }).replyContextPreview;

    expect(preview).toHaveLength(240);
    expect(preview).toMatch(/^Replying to: /u);
    expect(preview).toMatch(/\.\.\.$/u);
  });

  it("rejects invalid telegram attachment, schema, and shape values", () => {
    expect(() =>
      parseHostedExecutionTelegramMessage({
        attachments: [
          {
            fileId: "file-1",
            kind: "gif",
          },
        ],
        messageId: "message-1",
        schema: "murph.hosted-telegram-message.v1",
        threadId: "thread-1",
      }),
    ).toThrow(/supported hosted Telegram attachment kind/i);

    expect(() =>
      parseHostedExecutionTelegramMessage({
        messageId: "message-1",
        schema: "murph.hosted-telegram-message.v2",
        threadId: "thread-1",
      }),
    ).toThrow(/schema is unsupported/i);

    expect(() =>
      parseHostedExecutionTelegramMessage({
        attachments: {},
        messageId: "message-1",
        schema: "murph.hosted-telegram-message.v1",
        threadId: "thread-1",
      }),
    ).toThrow(/attachments must be an array/i);

    expect(() =>
      parseHostedExecutionTelegramMessage({
        messageId: "message-1",
        replyToMessageId: 42,
        schema: "murph.hosted-telegram-message.v1",
        threadId: "thread-1",
      }),
    ).toThrow(/replyToMessageId must be a non-empty string/i);

    expect(() =>
      parseHostedExecutionTelegramMessage({
        messageId: "message-1",
        schema: "murph.hosted-telegram-message.v1",
        threadId: "thread-1",
        threadIsDirect: "false",
      }),
    ).toThrow(/threadIsDirect must be a boolean/i);
  });
});
