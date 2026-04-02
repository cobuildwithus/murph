import { describe, expect, it } from "vitest";

import { parseHostedDeviceSyncRuntimeApplyRequest } from "@/src/lib/device-sync/internal-runtime";
import { sanitizeHostedLinqEventForStorage } from "@/src/lib/hosted-onboarding/contact-privacy";
import { minimizeHostedLinqMessageReceivedEvent } from "@/src/lib/hosted-onboarding/webhook-event-snapshots";

describe("hosted contact privacy", () => {
  it("preserves Linq attachment URLs in minimized webhook snapshots", () => {
    const minimized = minimizeHostedLinqMessageReceivedEvent({
      api_version: "2026-04-01",
      created_at: "2026-04-01T00:00:00.000Z",
      data: {
        chat_id: "chat_123",
        from: "+15551230000",
        is_from_me: false,
        message: {
          effect: null,
          id: "msg_123",
          parts: [
            {
              attachment_id: "att_123",
              filename: "lab-results.pdf",
              mime_type: "application/pdf",
              size: 1234,
              type: "media",
              url: "https://cdn.linqapp.com/media/lab-results.pdf",
            },
            {
              mime_type: "audio/m4a",
              size: 4321,
              type: "voice_memo",
              url: "https://cdn.linqapp.com/media/voice.m4a",
            },
          ],
          reply_to: null,
        },
        received_at: "2026-04-01T00:00:00.000Z",
        recipient_phone: "+15557654321",
        service: "imessage",
      },
      event_id: "evt_123",
      event_type: "message.received",
      partner_id: "partner_123",
      trace_id: "trace_123",
    } as never);

    expect(minimized.data).toMatchObject({
      message: {
        parts: [
          {
            attachment_id: "att_123",
            filename: "lab-results.pdf",
            mime_type: "application/pdf",
            size: 1234,
            type: "media",
            url: "https://cdn.linqapp.com/media/lab-results.pdf",
          },
          {
            mime_type: "audio/m4a",
            size: 4321,
            type: "voice_memo",
            url: "https://cdn.linqapp.com/media/voice.m4a",
          },
        ],
      },
    });
  });

  it("retains allowlisted Linq CDN attachment URLs before storage while preserving id redaction", () => {
    const sanitized = sanitizeHostedLinqEventForStorage({
      data: {
        chat_id: "chat_123",
        from: "+15551230000",
        message: {
          id: "msg_123",
          parts: [
            {
              attachment_id: "att_123",
              filename: "lab-results.pdf",
              mime_type: "application/pdf",
              size: 1234,
              type: "media",
              url: "https://cdn.linqapp.com/media/lab-results.pdf",
            },
            {
              mime_type: "audio/m4a",
              size: 4321,
              type: "voice_memo",
              url: "https://cdn.linqapp.com/media/voice.m4a",
            },
            {
              filename: "ignored.jpg",
              mime_type: "image/jpeg",
              size: 111,
              type: "media",
              url: "https://example.com/media/ignored.jpg",
            },
          ],
          reply_to: {
            message_id: "msg_122",
          },
        },
        recipient_phone: "+15557654321",
      },
    });

    expect(sanitized.data).toMatchObject({
      from: expect.stringMatching(/^hbid:linq\.from:/u),
      message: {
        id: expect.stringMatching(/^hbid:linq\.message:/u),
        parts: [
          {
            attachment_id: "att_123",
            filename: "lab-results.pdf",
            mime_type: "application/pdf",
            size: 1234,
            type: "media",
            url: "https://cdn.linqapp.com/media/lab-results.pdf",
          },
          {
            mime_type: "audio/m4a",
            size: 4321,
            type: "voice_memo",
            url: "https://cdn.linqapp.com/media/voice.m4a",
          },
          {
            filename: "ignored.jpg",
            mime_type: "image/jpeg",
            size: 111,
            type: "media",
          },
        ],
        reply_to: {
          message_id: expect.stringMatching(/^hbid:linq\.message:/u),
        },
      },
      recipient_phone: expect.stringMatching(/^hbid:linq\.recipient:/u),
    });
    expect((sanitized.data as { message: { parts: Array<Record<string, unknown>> } }).message.parts[2])
      .not.toHaveProperty("url");
  });

  it("can omit the shared Linq recipient phone from stored dispatch snapshots", () => {
    const sanitized = sanitizeHostedLinqEventForStorage({
      data: {
        from: "+15551230000",
        message: {
          id: "msg_123",
          parts: [
            {
              type: "text",
              value: "hello",
            },
          ],
        },
        recipient_phone: "+15557654321",
      },
    }, {
      omitRecipientPhone: true,
    });

    expect(sanitized.data).toMatchObject({
      from: expect.stringMatching(/^hbid:linq\.from:/u),
      message: {
        id: expect.stringMatching(/^hbid:linq\.message:/u),
      },
    });
    expect(sanitized.data).not.toHaveProperty("recipient_phone");
  });

  it("rejects duplicate connection updates in a single runtime apply request", () => {
    expect(() => parseHostedDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connectionId: "conn_123",
          localState: {
            clearError: true,
          },
        },
        {
          connection: {
            status: "active",
          },
          connectionId: "conn_123",
        },
      ],
      userId: "user_123",
    })).toThrow(/connectionId must be unique/i);
  });
});
