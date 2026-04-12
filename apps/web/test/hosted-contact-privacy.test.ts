import { describe, expect, it } from "vitest";

import { minimizeLinqMessageReceivedEvent } from "@murphai/messaging-ingress/linq-webhook";

import { parseHostedDeviceSyncRuntimeApplyRequest } from "@/src/lib/device-sync/internal-runtime";
import { sanitizeHostedLinqEventForStorage } from "@/src/lib/hosted-onboarding/contact-privacy";

describe("hosted contact privacy", () => {
  it("preserves Linq attachment URLs in minimized webhook snapshots", () => {
    const minimized = minimizeLinqMessageReceivedEvent({
      api_version: "2026-04-01",
      created_at: "2026-04-01T00:00:00.000Z",
      webhook_version: "2026-02-03",
      data: {
        chat: {
          id: "chat_123",
          owner_handle: {
            handle: "+15557654321",
            id: "handle_owner_123",
            is_me: true,
            service: "iMessage",
          },
        },
        chat_id: "chat_123",
        direction: "inbound",
        from: "+15551230000",
        from_handle: {
          handle: "+15551230000",
          id: "handle_sender_legacy_123",
          service: "iMessage",
        },
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
        recipient_handle: {
          handle: "+15557654321",
          id: "handle_owner_123",
          is_me: true,
          service: "iMessage",
        },
        received_at: "2026-04-01T00:00:00.000Z",
        recipient_phone: "+15557654321",
        service: "imessage",
        sender_handle: {
          handle: "+15551230000",
          id: "handle_sender_123",
          service: "iMessage",
        },
        sent_at: "2026-04-01T00:00:00.000Z",
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
        chat: {
          id: "chat_123",
          owner_handle: {
            handle: "+15557654321",
            id: "handle_owner_123",
            is_me: true,
          },
        },
        chat_id: "chat_123",
        from: "+15551230000",
        from_handle: {
          handle: "+15551230000",
          id: "handle_sender_legacy_123",
        },
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
        recipient_handle: {
          handle: "+15557654321",
          id: "handle_owner_123",
          is_me: true,
        },
        recipient_phone: "+15557654321",
        sender_handle: {
          handle: "+15551230000",
          id: "handle_sender_123",
        },
      },
    });

    expect(sanitized.data).toMatchObject({
      chat: {
        owner_handle: {
          handle: expect.stringMatching(/^hbid:linq\.recipient:/u),
          id: "handle_owner_123",
          is_me: true,
        },
      },
      from: expect.stringMatching(/^hbid:linq\.from:/u),
      from_handle: {
        handle: expect.stringMatching(/^hbid:linq\.from:/u),
        id: "handle_sender_legacy_123",
      },
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
      recipient_handle: {
        handle: expect.stringMatching(/^hbid:linq\.recipient:/u),
        id: "handle_owner_123",
        is_me: true,
      },
      recipient_phone: expect.stringMatching(/^hbid:linq\.recipient:/u),
      sender_handle: {
        handle: expect.stringMatching(/^hbid:linq\.from:/u),
        id: "handle_sender_123",
      },
    });
    expect((sanitized.data as { message: { parts: Array<Record<string, unknown>> } }).message.parts[2])
      .not.toHaveProperty("url");
  });

  it("can omit the shared Linq recipient phone from stored dispatch snapshots", () => {
    const sanitized = sanitizeHostedLinqEventForStorage({
      data: {
        from: "+15551230000",
        sender_handle: {
          handle: "+15551230000",
          id: "handle_sender_123",
        },
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
        chat: {
          id: "chat_123",
          owner_handle: {
            handle: "+15557654321",
            id: "handle_owner_123",
            is_me: true,
          },
        },
      },
    }, {
      omitRecipientPhone: true,
    });

    expect(sanitized.data).toMatchObject({
      chat: {
        owner_handle: {
          handle: expect.stringMatching(/^hbid:linq\.recipient:/u),
          id: "handle_owner_123",
          is_me: true,
        },
      },
      from: expect.stringMatching(/^hbid:linq\.from:/u),
      message: {
        id: expect.stringMatching(/^hbid:linq\.message:/u),
      },
      sender_handle: {
        handle: expect.stringMatching(/^hbid:linq\.from:/u),
        id: "handle_sender_123",
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
