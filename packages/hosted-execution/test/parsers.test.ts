import { describe, expect, it } from "vitest";

import { parseHostedExecutionEvent } from "../src/parsers.ts";

describe("parseHostedExecutionEvent", () => {
  it("parses explicit member channel sync events", () => {
    expect(
      parseHostedExecutionEvent({
        kind: "member.channels.updated",
        memberChannels: {
          email: true,
          linq: false,
          telegram: true,
        },
        userId: "user-1",
      }),
    ).toEqual({
      kind: "member.channels.updated",
      memberChannels: {
        email: true,
        linq: false,
        telegram: true,
      },
      userId: "user-1",
    });
  });

  it("parses Linq first-contact targets that materialize a home thread on welcome delivery", () => {
    expect(
      parseHostedExecutionEvent({
        firstContact: {
          channel: "linq",
          fromPhoneNumber: "+15550001111",
          identityId: "hbidx:phone:v1:test",
          kind: "linq-materialize-home-thread",
          toPhoneNumber: "+15550002222",
        },
        kind: "member.activated",
        memberChannels: {
          email: false,
          linq: true,
          telegram: false,
        },
        userId: "user-1",
      }),
    ).toEqual({
      firstContact: {
        channel: "linq",
        fromPhoneNumber: "+15550001111",
        identityId: "hbidx:phone:v1:test",
        kind: "linq-materialize-home-thread",
        toPhoneNumber: "+15550002222",
      },
      kind: "member.activated",
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      userId: "user-1",
    });
  });

  it("parses Telegram message events with attachment payloads", () => {
    expect(
      parseHostedExecutionEvent({
        kind: "telegram.message.received",
        telegramMessage: {
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
          schema: "murph.hosted-telegram-message.v1",
          text: "hello",
          threadId: "thread-1",
        },
        userId: "user-1",
      }),
    ).toEqual({
      kind: "telegram.message.received",
      telegramMessage: {
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
        schema: "murph.hosted-telegram-message.v1",
        text: "hello",
        threadId: "thread-1",
      },
      userId: "user-1",
    });
  });

  it("rejects unsupported Telegram attachment kinds", () => {
    expect(() =>
      parseHostedExecutionEvent({
        kind: "telegram.message.received",
        telegramMessage: {
          attachments: [
            {
              fileId: "file-1",
              kind: "gif",
            },
          ],
          messageId: "message-1",
          schema: "murph.hosted-telegram-message.v1",
          threadId: "thread-1",
        },
        userId: "user-1",
      }),
    ).toThrow(/supported hosted Telegram attachment kind/i);
  });

  it("parses device-sync wake events with hint jobs and revoke warnings", () => {
    expect(
      parseHostedExecutionEvent({
        connectionId: "connection-1",
        hint: {
          eventType: "sleep.updated",
          jobs: [
            {
              availableAt: "2026-04-09T00:00:00Z",
              dedupeKey: null,
              kind: "reconcile",
              maxAttempts: 3,
              payload: {
                page: 1,
              },
              priority: 2,
            },
          ],
          nextReconcileAt: "2026-04-09T01:00:00Z",
          occurredAt: "2026-04-09T00:00:00Z",
          reason: "webhook",
          resourceCategory: "sleep",
          revokeWarning: {
            code: "reauthorization_required",
            message: "Reconnect your provider.",
          },
          scopes: ["sleep.read"],
          traceId: "trace-1",
        },
        kind: "device-sync.wake",
        provider: "oura",
        reason: "webhook_hint",
        userId: "user-1",
      }),
    ).toEqual({
      connectionId: "connection-1",
      hint: {
        eventType: "sleep.updated",
        jobs: [
          {
            availableAt: "2026-04-09T00:00:00Z",
            dedupeKey: null,
            kind: "reconcile",
            maxAttempts: 3,
            payload: {
              page: 1,
            },
            priority: 2,
          },
        ],
        nextReconcileAt: "2026-04-09T01:00:00Z",
        occurredAt: "2026-04-09T00:00:00Z",
        reason: "webhook",
        resourceCategory: "sleep",
        revokeWarning: {
          code: "reauthorization_required",
          message: "Reconnect your provider.",
        },
        scopes: ["sleep.read"],
        traceId: "trace-1",
      },
      kind: "device-sync.wake",
      provider: "oura",
      reason: "webhook_hint",
      userId: "user-1",
    });
  });

  it("rejects unsupported assistant cron reasons", () => {
    expect(() =>
      parseHostedExecutionEvent({
        kind: "assistant.cron.tick",
        reason: "timer",
        userId: "user-1",
      }),
    ).toThrow(/assistant\.cron\.tick reason/i);
  });

  it("rejects non-Linq channels for Linq home-thread materialization targets", () => {
    expect(() =>
      parseHostedExecutionEvent({
        firstContact: {
          channel: "email",
          fromPhoneNumber: "+15550001111",
          identityId: "assistant@example.com",
          kind: "linq-materialize-home-thread",
          toPhoneNumber: "+15550002222",
        },
        kind: "member.activated",
        memberChannels: {
          email: true,
          linq: false,
          telegram: false,
        },
        userId: "user-1",
      }),
    ).toThrow(/requires channel linq/i);
  });
});
