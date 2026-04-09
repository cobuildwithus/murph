import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { createGatewayConversationSessionKey } from "@murphai/gateway-core";
import { test } from "vitest";

import { ensureGatewayStoreBaseSchema } from "../src/store/schema.js";
import {
  hasGatewaySnapshotState,
  readGatewayTableCount,
  readSnapshotOrEmpty,
  readSnapshotState,
  rebuildSnapshotStateFrom,
  writeSnapshotState,
} from "../src/store/snapshot-state.js";
import {
  replaceOutboxSources,
  replaceSessionSources,
  upsertCaptureSources,
} from "../src/store/source-sync.js";

function createSessionSource(
  sessionId: string,
  overrides: Partial<{
    actorId: string | null;
    alias: string | null;
    channel: string | null;
    identityId: string | null;
    threadId: string | null;
    threadIsDirect: boolean | null;
    updatedAt: string;
  }> = {},
) {
  const threadId = overrides.threadId ?? "thread-default";
  return {
    alias: overrides.alias ?? null,
    binding: {
      actorId: overrides.actorId ?? "contact:default",
      channel: overrides.channel ?? "email",
      conversationKey: null,
      delivery: {
        kind: "thread" as const,
        target: threadId,
      },
      identityId: overrides.identityId ?? "identity-default",
      threadId,
      threadIsDirect: overrides.threadIsDirect ?? true,
    },
    sessionId,
    updatedAt: overrides.updatedAt ?? "2026-04-08T00:00:00.000Z",
  };
}

function createOutboxSource(
  intentId: string,
  overrides: Partial<{
    actorId: string | null;
    identityId: string | null;
    providerMessageId: string | null;
    providerThreadId: string | null;
    sentAt: string | null;
    status: "pending" | "sent" | "failed";
    threadId: string;
    updatedAt: string;
  }> = {},
) {
  const threadId = overrides.threadId ?? "thread-default";
  const updatedAt = overrides.updatedAt ?? "2026-04-08T00:01:00.000Z";
  const sentAt = overrides.sentAt ?? "2026-04-08T00:01:05.000Z";
  return {
    actorId: overrides.actorId ?? "contact:default",
    bindingDelivery: {
      kind: "thread" as const,
      target: threadId,
    },
    channel: "email",
    createdAt: updatedAt,
    delivery: {
      channel: "email",
      idempotencyKey: `gateway-send:${intentId}`,
      messageLength: 12,
      providerMessageId: overrides.providerMessageId ?? `provider-${intentId}`,
      providerThreadId: overrides.providerThreadId ?? threadId,
      sentAt,
      target: threadId,
      targetKind: "thread" as const,
    },
    identityId: overrides.identityId ?? "identity-default",
    intentId,
    message: `queued-${intentId}`,
    replyToMessageId: null,
    sentAt,
    status: overrides.status ?? "sent",
    threadId,
    threadIsDirect: true,
    updatedAt,
  };
}

function createCapture(
  captureId: string,
  overrides: Partial<{
    accountId: string | null;
    actorDisplayName: string | null;
    actorId: string | null;
    actorIsSelf: boolean;
    externalId: string | null;
    occurredAt: string;
    text: string | null;
    threadId: string;
    threadTitle: string | null;
  }> = {},
) {
  return {
    accountId: overrides.accountId ?? "identity-default",
    actor: {
      displayName: overrides.actorDisplayName ?? "Participant",
      id: overrides.actorId ?? "contact:default",
      isSelf: overrides.actorIsSelf ?? false,
    },
    attachments: [],
    captureId,
    createdAt: overrides.occurredAt ?? "2026-04-08T00:00:10.000Z",
    envelopePath: `raw/email/${captureId}.json`,
    eventId: `event-${captureId}`,
    externalId: overrides.externalId ?? `email:${captureId}`,
    occurredAt: overrides.occurredAt ?? "2026-04-08T00:00:10.000Z",
    raw: {},
    source: "email" as const,
    text: overrides.text ?? `text-${captureId}`,
    thread: {
      id: overrides.threadId ?? "thread-default",
      isDirect: true,
      title: overrides.threadTitle ?? null,
    },
  };
}

test("snapshot state reads stored events and exposes empty projections when metadata is absent", () => {
  const database = new DatabaseSync(":memory:");
  ensureGatewayStoreBaseSchema(database);

  try {
    writeSnapshotState(database, {
      events: [
        {
          schema: "murph.gateway-event.v1",
          createdAt: "2026-04-08T00:00:00.000Z",
          cursor: 3,
          kind: "conversation.updated",
          messageId: null,
          permissionRequestId: null,
          sessionKey: "session-a",
          summary: "rebuilt",
        },
        {
          schema: "murph.gateway-event.v1",
          createdAt: "2026-04-08T00:01:00.000Z",
          cursor: 9,
          kind: "permission.requested",
          messageId: null,
          permissionRequestId: "permission-1",
          sessionKey: "session-b",
          summary: "requested",
        },
      ],
      nextCursor: 9,
      snapshot: null,
    });

    const state = readSnapshotState(database);
    assert.equal(state.snapshot, null);
    assert.equal(state.nextCursor, 9);
    assert.deepEqual(
      state.events.map((event) => ({
        cursor: event.cursor,
        kind: event.kind,
      })),
      [
        { cursor: 3, kind: "conversation.updated" },
        { cursor: 9, kind: "permission.requested" },
      ],
    );
    assert.equal(hasGatewaySnapshotState(database), false);

    const emptySnapshot = readSnapshotOrEmpty(database);
    assert.deepEqual(
      {
        conversations: emptySnapshot.conversations.length,
        messages: emptySnapshot.messages.length,
        permissions: emptySnapshot.permissions.length,
      },
      {
        conversations: 0,
        messages: 0,
        permissions: 0,
      },
    );
    assert.equal(readGatewayTableCount(database, "gateway_events"), 2);
    assert.equal(readGatewayTableCount(database, "gateway_permissions"), 0);
  } finally {
    database.close();
  }
});

test("snapshot rebuild merges matching self-captures and preserves non-matching self-captures as separate messages", () => {
  const database = new DatabaseSync(":memory:");
  ensureGatewayStoreBaseSchema(database);

  try {
    replaceSessionSources(database, [
      createSessionSource("session-merge", {
        actorId: "contact:merge",
        alias: "Merged path",
        identityId: "merge@example.com",
        threadId: "thread-merge",
      }),
      createSessionSource("session-separate", {
        actorId: "contact:separate",
        alias: "Separate path",
        identityId: "separate@example.com",
        threadId: "thread-separate",
      }),
    ]);
    replaceOutboxSources(database, [
      createOutboxSource("intent-merge", {
        actorId: "contact:merge",
        identityId: "merge@example.com",
        providerMessageId: "provider-merge",
        providerThreadId: "thread-merge",
        threadId: "thread-merge",
      }),
      createOutboxSource("intent-separate", {
        actorId: "contact:separate",
        identityId: "separate@example.com",
        providerMessageId: "provider-outbox",
        providerThreadId: "thread-separate",
        threadId: "thread-separate",
      }),
    ]);
    upsertCaptureSources(database, [
      createCapture("capture-merge", {
        accountId: "merge@example.com",
        actorDisplayName: "Sender Merge",
        actorId: "contact:merge",
        actorIsSelf: true,
        externalId: "email:provider-merge",
        occurredAt: "2026-04-08T00:01:06.000Z",
        text: "delivered-merge",
        threadId: "thread-merge",
      }),
      createCapture("capture-separate", {
        accountId: "separate@example.com",
        actorDisplayName: "Sender Separate",
        actorId: "contact:separate",
        actorIsSelf: true,
        externalId: "email:provider-capture",
        occurredAt: "2026-04-08T00:01:07.000Z",
        text: "delivered-separate",
        threadId: "thread-separate",
      }),
    ]);

    rebuildSnapshotStateFrom(database, readSnapshotState(database));

    const snapshot = readSnapshotState(database).snapshot;
    assert.ok(snapshot);

    const mergedConversation = snapshot.conversations.find(
      (conversation) => conversation.title === "Merged path",
    );
    const separateConversation = snapshot.conversations.find(
      (conversation) => conversation.title === "Separate path",
    );
    assert.ok(mergedConversation);
    assert.ok(separateConversation);
    assert.equal(mergedConversation.messageCount, 1);
    assert.equal(separateConversation.messageCount, 2);

    const mergedMessages = snapshot.messages.filter(
      (message) => message.sessionKey === mergedConversation.sessionKey,
    );
    const separateMessages = snapshot.messages.filter(
      (message) => message.sessionKey === separateConversation.sessionKey,
    );
    assert.equal(mergedMessages.length, 1);
    assert.equal(mergedMessages[0]?.text, "queued-intent-merge");
    assert.equal(mergedMessages[0]?.actorDisplayName, "Sender Merge");
    assert.equal(separateMessages.length, 2);
    assert.deepEqual(
      separateMessages.map((message) => ({
        direction: message.direction,
        text: message.text,
      })),
      [
        { direction: "outbound", text: "queued-intent-separate" },
        { direction: "outbound", text: "delivered-separate" },
      ],
    );
  } finally {
    database.close();
  }
});

test("snapshot rebuild falls back through participant display name, participant id, thread id, channel, and null titles", () => {
  const database = new DatabaseSync(":memory:");
  ensureGatewayStoreBaseSchema(database);

  try {
    replaceSessionSources(database, [
      createSessionSource("session-display", {
        actorId: "contact:display",
        alias: "   ",
        identityId: "display@example.com",
        threadId: "thread-display",
      }),
      createSessionSource("session-participant", {
        actorId: "contact:participant-only",
        alias: "   ",
        identityId: null,
        threadId: "   ",
      }),
      createSessionSource("session-thread", {
        actorId: "   ",
        alias: "   ",
        channel: "custom",
        identityId: null,
        threadId: "thread-only",
        threadIsDirect: false,
      }),
    ]);
    upsertCaptureSources(database, [
      createCapture("capture-display", {
        accountId: "display@example.com",
        actorDisplayName: "Display Name",
        actorId: "contact:display",
        occurredAt: "2026-04-08T00:00:10.000Z",
        threadId: "thread-display",
        threadTitle: "   ",
      }),
    ]);

    const insertSyntheticSession = database.prepare(`
      INSERT INTO gateway_source_events (
        source_event_id,
        source_event_kind,
        source_record_id,
        route_key,
        session_key,
        source,
        identity_id,
        actor_id,
        actor_display_name,
        actor_is_self,
        alias,
        directness,
        occurred_at,
        text,
        thread_id,
        thread_title,
        reply_kind,
        reply_target,
        status,
        sent_at,
        provider_message_id,
        provider_thread_id,
        message_id
      ) VALUES (?, 'session', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
    `);
    insertSyntheticSession.run(
      "session:channel-only",
      "channel-only",
      "synthetic-channel",
      createGatewayConversationSessionKey("synthetic-channel"),
      "email",
      null,
      null,
      null,
      null,
      null,
      "2026-04-08T00:00:20.000Z",
      null,
    );
    insertSyntheticSession.run(
      "session:null-title",
      "null-title",
      "synthetic-null",
      createGatewayConversationSessionKey("synthetic-null"),
      null,
      null,
      null,
      null,
      null,
      null,
      "2026-04-08T00:00:21.000Z",
      null,
    );

    rebuildSnapshotStateFrom(database, readSnapshotState(database));

    const snapshot = readSnapshotState(database).snapshot;
    assert.ok(snapshot);
    const summaries = snapshot.conversations
      .map((conversation) => ({
        title: conversation.title,
        titleSource: conversation.titleSource,
      }))
      .sort(
        (left, right) =>
          String(left.title).localeCompare(String(right.title)) ||
          String(left.titleSource).localeCompare(String(right.titleSource)),
      );

    assert.deepEqual(summaries, [
      {
        title: "contact:participant-only",
        titleSource: "participant-id",
      },
      {
        title: "Display Name",
        titleSource: "participant-display-name",
      },
      {
        title: "email",
        titleSource: "channel",
      },
      {
        title: null,
        titleSource: null,
      },
      {
        title: "thread-only",
        titleSource: "thread-id",
      },
    ]);
  } finally {
    database.close();
  }
});

test("snapshot rebuild preserves older aliases when newer session rows omit them and materializes thread-title attachments and permissions", () => {
  const database = new DatabaseSync(":memory:");
  ensureGatewayStoreBaseSchema(database);

  try {
    replaceSessionSources(database, [
      createSessionSource("session-alias-latest", {
        actorId: "contact:alias",
        alias: null,
        identityId: "alias@example.com",
        threadId: "thread-alias",
        updatedAt: "2026-04-08T00:02:00.000Z",
      }),
      createSessionSource("session-alias-earlier", {
        actorId: "contact:alias",
        alias: "Recovered Alias",
        identityId: "alias@example.com",
        threadId: "thread-alias",
        updatedAt: "2026-04-08T00:01:00.000Z",
      }),
      createSessionSource("session-thread-title", {
        actorId: "contact:title",
        alias: "   ",
        identityId: "title@example.com",
        threadId: "thread-title",
      }),
    ]);
    upsertCaptureSources(database, [
      {
        ...createCapture("capture-thread-title", {
          accountId: "title@example.com",
          actorDisplayName: "   ",
          actorId: "contact:title",
          occurredAt: "2026-04-08T00:03:00.000Z",
          threadId: "thread-title",
          threadTitle: "Quarterly Planning",
        }),
        attachments: [
          {
            attachmentId: "attachment-thread-title",
            byteSize: 42,
            externalId: "provider-attachment",
            extractedText: "extracted summary",
            fileName: "plan.txt",
            kind: "document" as const,
            mime: "text/plain",
            ordinal: 0,
            parseState: "parsed",
            transcriptText: "transcript summary",
          },
        ],
      },
    ]);
    database
      .prepare(
        `
          INSERT INTO gateway_permissions (
            request_id,
            session_key,
            action,
            description,
            status,
            requested_at,
            resolved_at,
            note
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "permission-thread-title",
        createGatewayConversationSessionKey("email:title@example.com:contact:title:thread-title:true"),
        "send-message",
        "Needs approval",
        "open",
        "2026-04-08T00:04:00.000Z",
        null,
        "Awaiting review",
      );

    rebuildSnapshotStateFrom(database, readSnapshotState(database));

    const snapshot = readSnapshotState(database).snapshot;
    assert.ok(snapshot);

    const aliasConversation = snapshot.conversations.find(
      (conversation) => conversation.title === "Recovered Alias",
    );
    assert.ok(aliasConversation);
    assert.equal(aliasConversation.title, "Recovered Alias");
    assert.equal(aliasConversation.titleSource, "alias");
    assert.equal(aliasConversation.lastActivityAt, "2026-04-08T00:02:00.000Z");

    const threadConversation = snapshot.conversations.find(
      (conversation) => conversation.title === "Quarterly Planning",
    );
    assert.ok(threadConversation);
    assert.equal(threadConversation.titleSource, "thread-title");

    const threadMessage = snapshot.messages.find(
      (message) => message.sessionKey === threadConversation.sessionKey,
    );
    assert.ok(threadMessage);
    assert.equal(threadMessage.attachments.length, 1);
    assert.equal(threadMessage.attachments[0]?.schema, "murph.gateway-attachment.v1");
    assert.equal(threadMessage.attachments[0]?.messageId, threadMessage.messageId);
    assert.equal(threadMessage.attachments[0]?.kind, "document");
    assert.equal(threadMessage.attachments[0]?.mime, "text/plain");
    assert.equal(threadMessage.attachments[0]?.fileName, "plan.txt");
    assert.equal(threadMessage.attachments[0]?.byteSize, 42);
    assert.equal(threadMessage.attachments[0]?.parseState, "parsed");
    assert.equal(threadMessage.attachments[0]?.extractedText, "extracted summary");
    assert.equal(threadMessage.attachments[0]?.transcriptText, "transcript summary");

    assert.equal(snapshot.permissions.length, 1);
    assert.equal(snapshot.permissions[0]?.schema, "murph.gateway-permission-request.v1");
    assert.equal(snapshot.permissions[0]?.requestId, "permission-thread-title");
    assert.equal(snapshot.permissions[0]?.action, "send-message");
    assert.equal(snapshot.permissions[0]?.description, "Needs approval");
    assert.equal(snapshot.permissions[0]?.status, "open");
    assert.equal(snapshot.permissions[0]?.requestedAt, "2026-04-08T00:04:00.000Z");
    assert.equal(snapshot.permissions[0]?.resolvedAt, null);
    assert.equal(snapshot.permissions[0]?.note, "Awaiting review");
  } finally {
    database.close();
  }
});

test("snapshot rebuild backfills merged sent outbox messages with capture text and attachments", () => {
  const database = new DatabaseSync(":memory:");
  ensureGatewayStoreBaseSchema(database);

  try {
    replaceSessionSources(database, [
      createSessionSource("session-merged-backfill", {
        actorId: "contact:backfill",
        alias: "Backfill path",
        identityId: "backfill@example.com",
        threadId: "thread-backfill",
      }),
    ]);
    replaceOutboxSources(database, [
      {
        actorId: "contact:backfill",
        bindingDelivery: {
          kind: "thread" as const,
          target: "thread-backfill",
        },
        channel: "email",
        createdAt: "2026-04-08T00:00:00.000Z",
        delivery: {
          channel: "email",
          idempotencyKey: "gateway-send:intent-backfill",
          messageLength: 0,
          providerMessageId: "provider-backfill",
          providerThreadId: null,
          sentAt: "2026-04-08T00:00:05.000Z",
          target: "thread-backfill",
          targetKind: "thread" as const,
        },
        identityId: "backfill@example.com",
        intentId: "intent-backfill",
        message: "",
        replyToMessageId: null,
        sentAt: "2026-04-08T00:00:05.000Z",
        status: "sent" as const,
        threadId: "thread-backfill",
        threadIsDirect: true,
        updatedAt: "2026-04-08T00:00:05.000Z",
      },
    ]);
    upsertCaptureSources(database, [
      {
        ...createCapture("capture-backfill", {
          accountId: "backfill@example.com",
          actorDisplayName: "Backfill Sender",
          actorId: "contact:backfill",
          actorIsSelf: true,
          externalId: "email:provider-backfill",
          occurredAt: "2026-04-08T00:00:06.000Z",
          text: "delivered copy",
          threadId: "thread-backfill",
        }),
        attachments: [
          {
            attachmentId: "attachment-backfill",
            byteSize: 99,
            externalId: "provider-backfill-attachment",
            extractedText: "backfilled attachment",
            fileName: "backfill.txt",
            kind: "document" as const,
            mime: "text/plain",
            ordinal: 0,
            parseState: "parsed",
            transcriptText: null,
          },
        ],
      },
    ]);

    rebuildSnapshotStateFrom(database, readSnapshotState(database));

    const snapshot = readSnapshotState(database).snapshot;
    assert.ok(snapshot);

    const conversation = snapshot.conversations.find(
      (entry) => entry.title === "Backfill path",
    );
    assert.ok(conversation);

    const messages = snapshot.messages.filter(
      (message) => message.sessionKey === conversation.sessionKey,
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.text, "delivered copy");
    assert.equal(messages[0]?.actorDisplayName, "Backfill Sender");
    assert.equal(messages[0]?.attachments.length, 1);
    assert.equal(messages[0]?.attachments[0]?.fileName, "backfill.txt");
    assert.equal(messages[0]?.attachments[0]?.parseState, "parsed");
  } finally {
    database.close();
  }
});
