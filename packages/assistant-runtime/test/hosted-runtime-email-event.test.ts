import assert from "node:assert/strict";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildHostedExecutionEmailMessageReceivedDispatch } from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  normalizeParsedEmailMessage: vi.fn(),
  parseRawEmailMessage: vi.fn(),
  resolveHostedEmailSelfAddresses: vi.fn(),
  withHostedInboxPipeline: vi.fn(),
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

vi.mock("../src/hosted-runtime/events/inbox-pipeline.ts", () => ({
  withHostedInboxPipeline: mocks.withHostedInboxPipeline,
}));

import { ingestHostedEmailMessage } from "../src/hosted-runtime/events/email.ts";

afterEach(() => {
  vi.clearAllMocks();
});

describe("ingestHostedEmailMessage", () => {
  it("fails closed when the raw email payload is unavailable", async () => {
    const dispatch = buildHostedExecutionEmailMessageReceivedDispatch({
      eventId: "evt_email",
      identityId: "assistant@mail.example.test",
      occurredAt: "2026-04-08T00:00:00.000Z",
      rawMessageKey: "raw_123",
      userId: "member_123",
    });

    await expect(
      ingestHostedEmailMessage(
        "/tmp/assistant-runtime-email",
        dispatch,
        {
          async commit() {},
          async deletePreparedSideEffect() {},
          async readRawEmailMessage() {
            return null;
          },
          async readSideEffect() {
            return null;
          },
          async sendEmail() {},
          async writeSideEffect(record) {
            return record;
          },
        },
        {},
      ),
    ).rejects.toThrow(
      "Hosted email message fetch failed for member_123/raw_123.",
    );
    expect(mocks.parseRawEmailMessage).not.toHaveBeenCalled();
    expect(mocks.withHostedInboxPipeline).not.toHaveBeenCalled();
  });

  it("normalizes the parsed email and hands the capture to the inbox pipeline", async () => {
    const dispatch = buildHostedExecutionEmailMessageReceivedDispatch({
      eventId: "evt_email",
      identityId: "assistant@mail.example.test",
      occurredAt: "2026-04-08T00:00:00.000Z",
      rawMessageKey: "raw_123",
      selfAddress: "user@example.com",
      userId: "member_123",
    });
    const rawMessage = Uint8Array.from([1, 2, 3, 4]);
    const parsedMessage = {
      subject: "hello",
    };
    const capture = {
      source: "email",
    };
    const processCapture = vi.fn(async () => {});

    mocks.parseRawEmailMessage.mockReturnValue(parsedMessage);
    mocks.resolveHostedEmailSelfAddresses.mockReturnValue([
      "assistant@mail.example.test",
      "user@example.com",
    ]);
    mocks.normalizeParsedEmailMessage.mockResolvedValue(capture);
    mocks.withHostedInboxPipeline.mockImplementation(async (_vaultRoot, callback) => callback({
      processCapture,
    }));

    await ingestHostedEmailMessage(
      "/tmp/assistant-runtime-email",
      dispatch,
      {
        async commit() {},
        async deletePreparedSideEffect() {},
        async readRawEmailMessage() {
          return rawMessage;
        },
        async readSideEffect() {
          return null;
        },
        async sendEmail() {},
        async writeSideEffect(record) {
          return record;
        },
      },
      {},
    );

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
    expect(mocks.withHostedInboxPipeline).toHaveBeenCalledWith(
      "/tmp/assistant-runtime-email",
      expect.any(Function),
    );
    expect(processCapture).toHaveBeenCalledWith(capture);
  });
});
