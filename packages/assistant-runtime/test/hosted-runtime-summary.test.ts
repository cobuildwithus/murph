import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  buildHostedExecutionAssistantCronTickDispatch,
  buildHostedExecutionDeviceSyncWakeDispatch,
  buildHostedExecutionEmailMessageReceivedDispatch,
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedExecutionGatewayMessageSendDispatch,
  buildHostedExecutionMemberActivatedDispatch,
  buildHostedExecutionTelegramMessageReceivedDispatch,
  buildHostedExecutionVaultShareAcceptedDispatch,
} from "@murphai/hosted-execution";

import { summarizeDispatch } from "../src/hosted-runtime/summary.ts";

describe("summarizeDispatch", () => {
  it("describes activation runs even when bootstrap state is unavailable", () => {
    const dispatch = buildHostedExecutionMemberActivatedDispatch({
      eventId: "evt_activation",
      memberId: "member_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    assert.equal(
      summarizeDispatch(dispatch, {
        bootstrapResult: null,
        deviceSyncProcessed: 1,
        deviceSyncSkipped: true,
        nextWakeAt: null,
        parserProcessed: 2,
        shareImportResult: null,
        shareImportTitle: null,
      }),
      "Processed member activation (bootstrap state unavailable) and ran the hosted maintenance loop. Parser jobs: 2. Device sync jobs: 1 (skipped: providers not configured).",
    );
  });

  it("formats hosted assistant bootstrap details when activation seeded an explicit config", () => {
    const dispatch = buildHostedExecutionMemberActivatedDispatch({
      eventId: "evt_activation",
      memberId: "member_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    assert.equal(
      summarizeDispatch(dispatch, {
        bootstrapResult: {
          assistantConfigStatus: "hosted-env",
          assistantConfigured: true,
          assistantProvider: "openai-compatible",
          assistantSeeded: true,
          emailAutoReplyEnabled: true,
          telegramAutoReplyEnabled: false,
          vaultCreated: true,
        },
        deviceSyncProcessed: 0,
        deviceSyncSkipped: false,
        nextWakeAt: null,
        parserProcessed: 0,
        shareImportResult: null,
        shareImportTitle: null,
      }),
      "Processed member activation (created the canonical vault; seeded explicit hosted assistant config (openai-compatible); hosted email auto-reply ready; hosted Telegram auto-reply unavailable) and ran the hosted maintenance loop. Parser jobs: 0. Device sync jobs: 0.",
    );
  });

  it("covers the unavailable assistant bootstrap states when activation reuses an existing vault", () => {
    const dispatch = buildHostedExecutionMemberActivatedDispatch({
      eventId: "evt_activation",
      memberId: "member_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    assert.equal(
      summarizeDispatch(dispatch, {
        bootstrapResult: {
          assistantConfigStatus: "missing",
          assistantConfigured: false,
          assistantProvider: null,
          assistantSeeded: false,
          emailAutoReplyEnabled: false,
          telegramAutoReplyEnabled: true,
          vaultCreated: false,
        },
        deviceSyncProcessed: 0,
        deviceSyncSkipped: false,
        nextWakeAt: null,
        parserProcessed: 0,
        shareImportResult: null,
        shareImportTitle: null,
      }),
      "Processed member activation (reused the canonical vault; hosted assistant config missing; hosted email auto-reply unavailable; hosted Telegram auto-reply ready) and ran the hosted maintenance loop. Parser jobs: 0. Device sync jobs: 0.",
    );
  });

  it("covers the invalid, unready, and generic unavailable assistant bootstrap statuses", () => {
    const dispatch = buildHostedExecutionMemberActivatedDispatch({
      eventId: "evt_activation",
      memberId: "member_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const statuses = [
      {
        expected: "Processed member activation (created the canonical vault; hosted assistant config invalid; hosted email auto-reply unavailable; hosted Telegram auto-reply unavailable) and ran the hosted maintenance loop. Parser jobs: 0. Device sync jobs: 0.",
        status: "invalid" as const,
      },
      {
        expected: "Processed member activation (created the canonical vault; hosted assistant config not ready; hosted email auto-reply unavailable; hosted Telegram auto-reply unavailable) and ran the hosted maintenance loop. Parser jobs: 0. Device sync jobs: 0.",
        status: "unready" as const,
      },
      {
        expected: "Processed member activation (created the canonical vault; hosted assistant config unavailable; hosted email auto-reply unavailable; hosted Telegram auto-reply unavailable) and ran the hosted maintenance loop. Parser jobs: 0. Device sync jobs: 0.",
        status: "hosted-env" as const,
      },
    ];

    for (const entry of statuses) {
      assert.equal(
        summarizeDispatch(dispatch, {
          bootstrapResult: {
            assistantConfigStatus: entry.status,
            assistantConfigured: false,
            assistantProvider: null,
            assistantSeeded: false,
            emailAutoReplyEnabled: false,
            telegramAutoReplyEnabled: false,
            vaultCreated: true,
          },
          deviceSyncProcessed: 0,
          deviceSyncSkipped: false,
          nextWakeAt: null,
          parserProcessed: 0,
          shareImportResult: null,
          shareImportTitle: null,
        }),
        entry.expected,
      );
    }
  });

  it("uses the share id fallback and notes logged meal imports", () => {
    const dispatch = buildHostedExecutionVaultShareAcceptedDispatch({
      eventId: "evt_share",
      memberId: "member_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
      share: {
        ownerUserId: "member_sender",
        shareId: "share_123",
      },
    });

    assert.equal(
      summarizeDispatch(dispatch, {
        bootstrapResult: null,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: false,
        nextWakeAt: null,
        parserProcessed: 1,
        shareImportResult: {
          foods: [],
          meal: null,
          pack: {
            createdAt: "2026-04-08T00:00:00.000Z",
            entities: [],
            schemaVersion: "murph.share-pack.v1",
            title: "Shared breakfast",
          },
          protocols: [],
          recipes: [],
        },
        shareImportTitle: null,
      }),
      "Imported share pack \"share_123\" (0 foods, 0 protocols, 0 recipes). Parser jobs: 1. Device sync jobs: 0.",
    );
  });

  it("includes the targeted gateway session in hosted reply summaries", () => {
    const dispatch = buildHostedExecutionGatewayMessageSendDispatch({
      eventId: "evt_gateway_send",
      occurredAt: "2026-04-08T00:00:00.000Z",
      sessionKey: "session_123",
      text: "hello",
      userId: "member_123",
    });

    assert.equal(
      summarizeDispatch(dispatch, {
        bootstrapResult: null,
        deviceSyncProcessed: 3,
        deviceSyncSkipped: false,
        nextWakeAt: null,
        parserProcessed: 4,
        shareImportResult: null,
        shareImportTitle: null,
      }),
      "Queued a hosted gateway reply for session_123 and ran the hosted maintenance loop. Parser jobs: 4. Device sync jobs: 3.",
    );
  });

  it("summarizes hosted inbox and maintenance dispatch variants", () => {
    const dispatches = [
      {
        dispatch: buildHostedExecutionLinqMessageReceivedDispatch({
          eventId: "evt_linq",
          linqEvent: {
            body: "hello",
          },
          linqMessageId: "linq_123",
          occurredAt: "2026-04-08T00:00:00.000Z",
          phoneLookupKey: "phone_lookup_123",
          userId: "member_123",
        }),
        expected: "Persisted Linq capture and ran the hosted maintenance loop. Parser jobs: 1. Device sync jobs: 2.",
      },
      {
        dispatch: buildHostedExecutionTelegramMessageReceivedDispatch({
          eventId: "evt_telegram",
          occurredAt: "2026-04-08T00:00:00.000Z",
          telegramMessage: {
            messageId: "42",
            schema: "murph.hosted-telegram-message.v1",
            text: "hello",
            threadId: "chat_123",
          },
          userId: "member_123",
        }),
        expected: "Persisted Telegram capture and ran the hosted maintenance loop. Parser jobs: 1. Device sync jobs: 2.",
      },
      {
        dispatch: buildHostedExecutionEmailMessageReceivedDispatch({
          eventId: "evt_email",
          identityId: "identity_123",
          occurredAt: "2026-04-08T00:00:00.000Z",
          rawMessageKey: "raw/message.eml",
          userId: "member_123",
        }),
        expected: "Persisted hosted email capture and ran the hosted maintenance loop. Parser jobs: 1. Device sync jobs: 2.",
      },
      {
        dispatch: buildHostedExecutionAssistantCronTickDispatch({
          eventId: "evt_cron",
          occurredAt: "2026-04-08T00:00:00.000Z",
          reason: "alarm",
          userId: "member_123",
        }),
        expected: "Processed assistant cron tick (alarm) and ran the hosted maintenance loop. Parser jobs: 1. Device sync jobs: 2.",
      },
      {
        dispatch: buildHostedExecutionDeviceSyncWakeDispatch({
          eventId: "evt_wake",
          occurredAt: "2026-04-08T00:00:00.000Z",
          reason: "connected",
          userId: "member_123",
        }),
        expected: "Processed device-sync wake (connected) and ran the hosted maintenance loop. Parser jobs: 1. Device sync jobs: 2.",
      },
    ];

    for (const entry of dispatches) {
      assert.equal(
        summarizeDispatch(entry.dispatch, {
          bootstrapResult: null,
          deviceSyncProcessed: 2,
          deviceSyncSkipped: false,
          nextWakeAt: null,
          parserProcessed: 1,
          shareImportResult: null,
          shareImportTitle: null,
        }),
        entry.expected,
      );
    }
  });
});
