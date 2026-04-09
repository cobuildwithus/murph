import { describe, expect, it } from "vitest";

import type { HostedExecutionTelegramAttachment } from "../src/contracts.ts";

import {
  buildHostedExecutionDispatchRef,
  readHostedExecutionDispatchRef,
} from "../src/dispatch-ref.ts";
import {
  buildHostedExecutionEmailMessageReceivedDispatch,
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedExecutionMemberActivatedDispatch,
  buildHostedExecutionTelegramMessageReceivedDispatch,
  buildHostedExecutionDeviceSyncWakeDispatch,
} from "../src/builders.ts";
import {
  readHostedEmailCapabilities,
  resolveHostedEmailSelfAddresses,
  resolveHostedEmailSenderIdentity,
} from "../src/hosted-email.ts";
import {
  buildHostedExecutionOutboxPayload,
  readHostedExecutionOutboxPayload,
  readHostedExecutionStagedPayloadId,
  resolveHostedExecutionCanonicalOutboxPayloadStorage,
} from "../src/outbox-payload.ts";
import { parseHostedExecutionOutboxPayload } from "../src/parsers.ts";

const occurredAt = "2026-04-08T00:00:00.000Z";

describe("hosted execution builders", () => {
  it("preserves optional member activation first-contact data when present", () => {
    const dispatch = buildHostedExecutionMemberActivatedDispatch({
      eventId: "member-activated-1",
      firstContact: {
        channel: "email",
        identityId: "assistant@example.com",
        threadId: "thread_123",
        threadIsDirect: true,
      },
      memberId: "user_123",
      occurredAt,
    });

    expect(dispatch.event).toMatchObject({
      firstContact: {
        channel: "email",
        identityId: "assistant@example.com",
        threadId: "thread_123",
        threadIsDirect: true,
      },
      kind: "member.activated",
      userId: "user_123",
    });
  });

  it("copies linq event objects and preserves explicit null message ids", () => {
    const linqEvent = {
      delivery: "incoming",
      nested: { traceId: "trace_123" },
    };
    const dispatch = buildHostedExecutionLinqMessageReceivedDispatch({
      eventId: "linq-1",
      linqEvent,
      linqMessageId: null,
      occurredAt,
      phoneLookupKey: "phone_lookup_123",
      userId: "user_123",
    });

    linqEvent.delivery = "mutated";

    expect(dispatch.event.kind).toBe("linq.message.received");
    if (dispatch.event.kind !== "linq.message.received") {
      throw new Error("Expected a linq.message.received event.");
    }

    expect(dispatch.event.linqEvent).toEqual({
      delivery: "incoming",
      nested: { traceId: "trace_123" },
    });
    expect(dispatch.event.linqEvent).not.toBe(linqEvent);
    expect(dispatch.event.linqMessageId).toBeNull();
  });

  it("deep-copies telegram attachment arrays and attachment entries", () => {
    const attachments: HostedExecutionTelegramAttachment[] = [
      {
        fileId: "file_1",
        fileName: "photo.jpg",
        kind: "photo" as const,
      },
    ];
    const dispatch = buildHostedExecutionTelegramMessageReceivedDispatch({
      eventId: "telegram-1",
      occurredAt,
      telegramMessage: {
        attachments,
        messageId: "message_123",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello",
        threadId: "thread_123",
      },
      userId: "user_123",
    });

    attachments[0]!.fileName = "mutated.jpg";
    attachments.push({
      fileId: "file_2",
      kind: "document",
    });

    if (dispatch.event.kind !== "telegram.message.received") {
      throw new Error("Expected a telegram.message.received event.");
    }

    expect(dispatch.event.telegramMessage.attachments).toEqual([
      {
        fileId: "file_1",
        fileName: "photo.jpg",
        kind: "photo",
      },
    ]);
    expect(dispatch.event.telegramMessage.attachments).not.toBe(attachments);
    expect(dispatch.event.telegramMessage.attachments?.[0]).not.toBe(attachments[0]);
  });

  it("keeps telegram messages without attachments free of synthetic attachment fields", () => {
    const dispatch = buildHostedExecutionTelegramMessageReceivedDispatch({
      eventId: "telegram-2",
      occurredAt,
      telegramMessage: {
        messageId: "message_456",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello again",
        threadId: "thread_456",
      },
      userId: "user_123",
    });

    if (dispatch.event.kind !== "telegram.message.received") {
      throw new Error("Expected a telegram.message.received event.");
    }

    expect(dispatch.event.telegramMessage).not.toHaveProperty("attachments");
  });

  it("distinguishes omitted versus explicit nullable email self addresses", () => {
    const omitted = buildHostedExecutionEmailMessageReceivedDispatch({
      eventId: "email-omitted",
      identityId: "identity_123",
      occurredAt,
      rawMessageKey: "raw_123",
      userId: "user_123",
    });
    const explicitNull = buildHostedExecutionEmailMessageReceivedDispatch({
      eventId: "email-null",
      identityId: "identity_123",
      occurredAt,
      rawMessageKey: "raw_123",
      selfAddress: null,
      userId: "user_123",
    });

    expect("selfAddress" in omitted.event).toBe(false);
    expect(explicitNull.event).toMatchObject({
      kind: "email.message.received",
      selfAddress: null,
    });
  });

  it("omits optional linq and device-sync fields when not provided and preserves explicit nulls when they are", () => {
    const linqDispatch = buildHostedExecutionLinqMessageReceivedDispatch({
      eventId: "linq-2",
      linqEvent: { delivery: "incoming" },
      occurredAt,
      phoneLookupKey: "phone_lookup_456",
      userId: "user_123",
    });
    const deviceSyncDispatch = buildHostedExecutionDeviceSyncWakeDispatch({
      connectionId: null,
      eventId: "device-sync-1",
      hint: null,
      occurredAt,
      provider: null,
      reason: "connected",
      runtimeSnapshot: null,
      userId: "user_123",
    });

    expect(linqDispatch.event).not.toHaveProperty("linqMessageId");
    expect(deviceSyncDispatch.event).toMatchObject({
      connectionId: null,
      hint: null,
      kind: "device-sync.wake",
      provider: null,
      reason: "connected",
      runtimeSnapshot: null,
      userId: "user_123",
    });
  });
});

describe("hosted email helpers", () => {
  it("prefers and normalizes an explicit sender identity", () => {
    expect(resolveHostedEmailSenderIdentity({
      HOSTED_EMAIL_DOMAIN: "example.com",
      HOSTED_EMAIL_FROM_ADDRESS: "Murph Assistant <Assistant+Ops@Example.com>",
      HOSTED_EMAIL_LOCAL_PART: "ignored",
    })).toBe("assistant+ops@example.com");
  });

  it("infers a sender identity from local part and domain defaults", () => {
    expect(resolveHostedEmailSenderIdentity({
      HOSTED_EMAIL_DOMAIN: "Example.com",
      HOSTED_EMAIL_LOCAL_PART: "Support",
    })).toBe("support@example.com");

    expect(resolveHostedEmailSenderIdentity({
      HOSTED_EMAIL_DOMAIN: "Example.com",
    })).toBe("assistant@example.com");
  });

  it("derives capabilities from env defaults and explicit flags", () => {
    expect(readHostedEmailCapabilities({
      HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID: "acct_123",
      HOSTED_EMAIL_CLOUDFLARE_API_TOKEN: "token_123",
      HOSTED_EMAIL_DOMAIN: "example.com",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "secret_123",
    })).toEqual({
      ingressReady: true,
      sendReady: true,
      senderIdentity: "assistant@example.com",
    });

    expect(readHostedEmailCapabilities({
      HOSTED_EMAIL_DOMAIN: "example.com",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@example.com",
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "1",
    })).toEqual({
      ingressReady: false,
      sendReady: true,
      senderIdentity: "assistant@example.com",
    });

    expect(readHostedEmailCapabilities({
      HOSTED_EMAIL_INGRESS_READY: "true",
      HOSTED_EMAIL_SEND_READY: "true",
    })).toEqual({
      ingressReady: false,
      sendReady: false,
      senderIdentity: null,
    });
  });

  it("dedupes normalized self addresses across sender, envelope, and extras", () => {
    expect(resolveHostedEmailSelfAddresses({
      envelopeTo: "Assistant@example.com",
      extra: [
        "Route <assistant+route@example.com>",
        "assistant@example.com",
        null,
        "  ",
        "Assistant+Route@Example.com",
      ],
      senderIdentity: "Assistant@Example.com",
    })).toEqual([
      "assistant@example.com",
      "assistant+route@example.com",
    ]);
  });
});

describe("dispatch refs and outbox payloads", () => {
  it("builds and reads reference dispatch metadata for reference-only events", () => {
    const dispatch = buildHostedExecutionEmailMessageReceivedDispatch({
      eventId: "email-ref-1",
      identityId: "identity_123",
      occurredAt,
      rawMessageKey: "raw_123",
      selfAddress: "assistant@example.com",
      userId: "user_123",
    });
    const dispatchRef = buildHostedExecutionDispatchRef(dispatch);

    expect(dispatchRef).toEqual({
      eventId: "email-ref-1",
      eventKind: "email.message.received",
      occurredAt,
      userId: "user_123",
    });
    expect(readHostedExecutionDispatchRef({
      dispatchRef,
      storage: "reference",
    })).toEqual(dispatchRef);
  });

  it("rejects invalid dispatch ref payloads", () => {
    expect(readHostedExecutionDispatchRef({
      dispatchRef: {
        eventId: "member-activated-1",
        eventKind: "member.activated",
        occurredAt,
        userId: "user_123",
      },
      storage: "reference",
    })).toBeNull();

    expect(readHostedExecutionDispatchRef({
      dispatchRef: {
        eventId: "email-ref-2",
        eventKind: "email.message.received",
        occurredAt,
        unexpected: true,
        userId: "user_123",
      },
      storage: "reference",
    })).toBeNull();

    expect(readHostedExecutionDispatchRef({
      dispatchRef: {
        eventId: " ",
        eventKind: "email.message.received",
        occurredAt,
        userId: "user_123",
      },
      storage: "reference",
    })).toBeNull();

    expect(readHostedExecutionDispatchRef({
      dispatchRef: {
        eventId: "email-ref-3",
        eventKind: "email.message.received",
        occurredAt,
        userId: "user_123",
      },
      storage: "inline",
    })).toBeNull();
  });

  it("round-trips canonical inline and reference outbox payloads", () => {
    const inlineDispatch = buildHostedExecutionMemberActivatedDispatch({
      eventId: "member-inline-1",
      memberId: "user_123",
      occurredAt,
    });
    const referenceDispatch = buildHostedExecutionEmailMessageReceivedDispatch({
      eventId: "email-ref-4",
      identityId: "identity_123",
      occurredAt,
      rawMessageKey: "raw_456",
      userId: "user_123",
    });
    const inlinePayload = buildHostedExecutionOutboxPayload(inlineDispatch, { storage: "auto" });
    const referencePayload = buildHostedExecutionOutboxPayload(referenceDispatch, {
      stagedPayloadId: "staged_123",
      storage: "auto",
    });

    expect(readHostedExecutionOutboxPayload(inlinePayload)).toEqual(inlinePayload);
    expect(readHostedExecutionOutboxPayload(referencePayload)).toEqual(referencePayload);
  });

  it("validates staged payload ids and invalid outbox payload shapes", () => {
    const referenceDispatch = buildHostedExecutionEmailMessageReceivedDispatch({
      eventId: "email-ref-5",
      identityId: "identity_123",
      occurredAt,
      rawMessageKey: "raw_789",
      userId: "user_123",
    });

    expect(() => buildHostedExecutionOutboxPayload(referenceDispatch)).toThrow(
      /require a staged payload id/i,
    );
    expect(() => buildHostedExecutionOutboxPayload(referenceDispatch, {
      stagedPayloadId: " ",
    })).toThrow(/require a staged payload id/i);

    expect(readHostedExecutionStagedPayloadId("staged_456")).toBe("staged_456");
    expect(readHostedExecutionStagedPayloadId(" ")).toBeNull();

    expect(readHostedExecutionOutboxPayload({
      dispatch: referenceDispatch,
      storage: "inline",
    })).toBeNull();

    expect(readHostedExecutionOutboxPayload({
      dispatchRef: {
        eventId: "member-inline-2",
        eventKind: "member.activated",
        occurredAt,
        userId: "user_123",
      },
      stagedPayloadId: "staged_789",
      storage: "reference",
    })).toBeNull();

    expect(readHostedExecutionOutboxPayload({
      dispatchRef: {
        eventId: "email-ref-6",
        eventKind: "email.message.received",
        occurredAt,
        userId: "user_123",
      },
      stagedPayloadId: " ",
      storage: "reference",
    })).toBeNull();

    expect(readHostedExecutionOutboxPayload({
      dispatch: buildHostedExecutionMemberActivatedDispatch({
        eventId: "member-inline-3",
        memberId: "user_123",
        occurredAt,
      }),
      dispatchRef: {
        eventId: "email-ref-7",
        eventKind: "email.message.received",
        occurredAt,
        userId: "user_123",
      },
      storage: "inline",
    })).toBeNull();

    expect(() => parseHostedExecutionOutboxPayload({
      storage: "bogus",
    })).toThrow(/outbox payload is invalid/i);
  });

  it("rejects unsupported canonical storage kinds", () => {
    expect(() => resolveHostedExecutionCanonicalOutboxPayloadStorage(
      "unknown.event" as never,
    )).toThrow(/unsupported hosted execution event kind/i);
  });
});
