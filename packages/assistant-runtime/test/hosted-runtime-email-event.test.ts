import assert from "node:assert/strict";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionEmailMessageReceivedDispatch,
  buildHostedExecutionWakeFromDispatch,
  isHostedEmailConversationMessageWake,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  normalizeParsedEmailMessage: vi.fn(),
  parseRawEmailMessage: vi.fn(),
  resolveHostedEmailSelfAddresses: vi.fn(),
}));

vi.mock("@murphai/inboxd/connectors/email/normalize-parsed", () => ({
  normalizeParsedEmailMessage: mocks.normalizeParsedEmailMessage,
}));

vi.mock("@murphai/inboxd/connectors/email/parsed", () => ({
  parseRawEmailMessage: mocks.parseRawEmailMessage,
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    resolveHostedEmailSelfAddresses: mocks.resolveHostedEmailSelfAddresses,
  };
});

import { buildHostedEmailCapture } from "../src/hosted-runtime/events/email.ts";

afterEach(() => {
  vi.clearAllMocks();
});

describe("buildHostedEmailCapture", () => {
  it("fails closed when the raw email payload is unavailable", async () => {
    const dispatch = buildHostedExecutionEmailMessageReceivedDispatch({
      eventId: "evt_email",
      identityId: "assistant@mail.example.test",
      occurredAt: "2026-04-08T00:00:00.000Z",
      rawMessageKey: "raw_123",
      userId: "member_123",
    });
    const wake = buildHostedExecutionWakeFromDispatch(dispatch);
    if (!isHostedEmailConversationMessageWake(wake)) {
      throw new Error("Expected email conversation wake.");
    }

    await expect(
      buildHostedEmailCapture(
        wake,
        {
          async deletePreparedAssistantDelivery() {},
          async readRawEmailMessage() {
            return null;
          },
          async readAssistantDeliveryRecord() {
            return null;
          },
          async sendEmail() {},
          async writeAssistantDeliveryRecord(record) {
            return record;
          },
        },
      ),
    ).rejects.toThrow(
      "Hosted email message fetch failed for member_123/raw_123.",
    );
    expect(mocks.parseRawEmailMessage).not.toHaveBeenCalled();
  });

  it("normalizes the parsed email into a capture", async () => {
    const dispatch = buildHostedExecutionEmailMessageReceivedDispatch({
      eventId: "evt_email",
      identityId: "assistant@mail.example.test",
      occurredAt: "2026-04-08T00:00:00.000Z",
      rawMessageKey: "raw_123",
      selfAddress: "user@example.com",
      userId: "member_123",
    });
    const wake = buildHostedExecutionWakeFromDispatch(dispatch);
    if (!isHostedEmailConversationMessageWake(wake)) {
      throw new Error("Expected email conversation wake.");
    }
    const rawMessage = Uint8Array.from([1, 2, 3, 4]);
    const parsedMessage = {
      subject: "hello",
    };
    const capture = {
      source: "email",
    };
    mocks.parseRawEmailMessage.mockReturnValue(parsedMessage);
    mocks.resolveHostedEmailSelfAddresses.mockReturnValue([
      "assistant@mail.example.test",
      "user@example.com",
    ]);
    mocks.normalizeParsedEmailMessage.mockResolvedValue(capture);

    await expect(buildHostedEmailCapture(
      wake,
      {
        async deletePreparedAssistantDelivery() {},
        async readRawEmailMessage() {
          return rawMessage;
        },
        async readAssistantDeliveryRecord() {
          return null;
        },
        async sendEmail() {},
        async writeAssistantDeliveryRecord(record) {
          return record;
        },
      },
    )).resolves.toEqual(capture);

    expect(mocks.parseRawEmailMessage).toHaveBeenCalledWith(rawMessage);
    expect(mocks.resolveHostedEmailSelfAddresses).toHaveBeenCalledWith({
      extra: ["user@example.com"],
      senderIdentity: "assistant@mail.example.test",
    });
    expect(mocks.normalizeParsedEmailMessage).toHaveBeenCalledWith({
      accountAddress: "assistant@mail.example.test",
      accountId: "assistant@mail.example.test",
      message: parsedMessage,
      selfAddresses: [
        "assistant@mail.example.test",
        "user@example.com",
      ],
      source: "email",
      threadTarget: null,
    });
  });
});
