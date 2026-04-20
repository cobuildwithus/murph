import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  buildHostedExecutionAssistantCronTickWake,
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
  buildHostedExecutionTelegramConversationMessageWake,
  buildHostedExecutionVaultShareAcceptedWake,
} from "@murphai/hosted-execution";

import { summarizeWake } from "../src/hosted-runtime/summary.ts";

describe("summarizeWake", () => {
  it("describes activation runs even when bootstrap state is unavailable", () => {
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId: "evt_activation",
      memberId: "member_123",
      memberChannels: {
        email: false,
        linq: false,
        telegram: false,
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    assert.equal(
      summarizeWake(wake, {
        bootstrapResult: null,
        conversationMetrics: null,
        deviceSyncProcessed: 1,
        deviceSyncSkipped: true,
        followupExecution: "member-activated",
        nextWakeAt: null,
        parserProcessed: 2,
        shareImportResult: null,
        shareImportTitle: null,
      }),
      "Processed member activation (bootstrap state unavailable).",
    );
  });

  it("formats hosted assistant bootstrap details when activation seeded an explicit config", () => {
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId: "evt_activation",
      memberId: "member_123",
      memberChannels: {
        email: true,
        linq: true,
        telegram: false,
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    assert.equal(
      summarizeWake(wake, {
        bootstrapResult: {
          assistantConfigStatus: "hosted-env",
          assistantConfigured: true,
          assistantProvider: "openai-compatible",
          assistantSeeded: true,
          emailAutoReplyEnabled: true,
          linqAutoReplyEnabled: true,
          telegramAutoReplyEnabled: false,
          vaultCreated: true,
        },
        conversationMetrics: null,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: false,
        followupExecution: "member-activated",
        nextWakeAt: null,
        parserProcessed: 0,
        shareImportResult: null,
        shareImportTitle: null,
      }),
      "Processed member activation (created the canonical vault; seeded explicit hosted assistant config (openai-compatible); hosted email auto-reply ready; hosted Linq auto-reply ready; hosted Telegram auto-reply unavailable).",
    );
  });

  it("covers the unavailable assistant bootstrap states when activation reuses an existing vault", () => {
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId: "evt_activation",
      memberId: "member_123",
      memberChannels: {
        email: false,
        linq: false,
        telegram: true,
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    assert.equal(
      summarizeWake(wake, {
        bootstrapResult: {
          assistantConfigStatus: "missing",
          assistantConfigured: false,
          assistantProvider: null,
          assistantSeeded: false,
          emailAutoReplyEnabled: false,
          linqAutoReplyEnabled: false,
          telegramAutoReplyEnabled: true,
          vaultCreated: false,
        },
        conversationMetrics: null,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: false,
        followupExecution: "member-activated",
        nextWakeAt: null,
        parserProcessed: 0,
        shareImportResult: null,
        shareImportTitle: null,
      }),
      "Processed member activation (reused the canonical vault; hosted assistant config missing; hosted email auto-reply unavailable; hosted Linq auto-reply unavailable; hosted Telegram auto-reply ready).",
    );
  });

  it("covers the invalid, unready, and generic unavailable assistant bootstrap statuses", () => {
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId: "evt_activation",
      memberId: "member_123",
      memberChannels: {
        email: false,
        linq: false,
        telegram: false,
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const statuses = [
      {
        expected: "Processed member activation (created the canonical vault; hosted assistant config invalid; hosted email auto-reply unavailable; hosted Linq auto-reply unavailable; hosted Telegram auto-reply unavailable).",
        status: "invalid" as const,
      },
      {
        expected: "Processed member activation (created the canonical vault; hosted assistant config not ready; hosted email auto-reply unavailable; hosted Linq auto-reply unavailable; hosted Telegram auto-reply unavailable).",
        status: "unready" as const,
      },
      {
        expected: "Processed member activation (created the canonical vault; hosted assistant config unavailable; hosted email auto-reply unavailable; hosted Linq auto-reply unavailable; hosted Telegram auto-reply unavailable).",
        status: "hosted-env" as const,
      },
    ];

    for (const entry of statuses) {
      assert.equal(
        summarizeWake(wake, {
          bootstrapResult: {
            assistantConfigStatus: entry.status,
            assistantConfigured: false,
            assistantProvider: null,
            assistantSeeded: false,
            emailAutoReplyEnabled: false,
            linqAutoReplyEnabled: false,
            telegramAutoReplyEnabled: false,
            vaultCreated: true,
          },
          conversationMetrics: null,
          deviceSyncProcessed: 0,
          deviceSyncSkipped: false,
          followupExecution: "member-activated",
          nextWakeAt: null,
          parserProcessed: 0,
          shareImportResult: null,
          shareImportTitle: null,
        }),
        entry.expected,
      );
    }
  });

  it("summarizes explicit member channel sync events", () => {
    const wake = buildHostedExecutionMemberChannelsUpdatedWake({
      eventId: "evt_member_channels",
      memberChannels: {
        email: true,
        linq: false,
        telegram: true,
      },
      memberId: "member_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    assert.equal(
      summarizeWake(wake, {
        bootstrapResult: null,
        conversationMetrics: null,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: false,
        followupExecution: "member-channels-updated",
        nextWakeAt: null,
        parserProcessed: 0,
        shareImportResult: null,
        shareImportTitle: null,
      }),
      "Processed member channel sync.",
    );
  });

  it("uses the share id fallback and notes logged meal imports", () => {
    const wake = buildHostedExecutionVaultShareAcceptedWake({
      eventId: "evt_share",
      memberId: "member_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
      share: {
        ownerUserId: "member_sender",
        shareId: "share_123",
      },
    });

    assert.equal(
      summarizeWake(wake, {
        bootstrapResult: null,
        conversationMetrics: null,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: false,
        followupExecution: "vault-share-accepted",
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
      "Imported share pack \"share_123\" (0 foods, 0 protocols, 0 recipes).",
    );
  });

  it("summarizes hosted inbox and maintenance wake variants", () => {
    const wakes = [
      {
        wake: buildHostedExecutionLinqConversationMessageWake({
          eventId: "evt_linq",
          linqMessage: {
            chatId: "chat_123",
            from: "+15551234567",
            isFromMe: false,
            messageId: "linq_123",
            parts: [
              {
                value: "hello",
                type: "text",
              },
            ],
          },
          occurredAt: "2026-04-08T00:00:00.000Z",
          phoneLookupKey: "phone_lookup_123",
          userId: "member_123",
        }),
        expected: "Persisted Linq capture on the hosted conversation lane.",
      },
      {
        wake: buildHostedExecutionTelegramConversationMessageWake({
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
        expected: "Persisted Telegram capture on the hosted conversation lane.",
      },
      {
        wake: buildHostedExecutionEmailConversationMessageWake({
          eventId: "evt_email",
          identityId: "identity_123",
          occurredAt: "2026-04-08T00:00:00.000Z",
          rawMessageKey: "raw/message.eml",
          userId: "member_123",
        }),
        expected: "Persisted hosted email capture on the hosted conversation lane.",
      },
      {
        wake: buildHostedExecutionAssistantCronTickWake({
          eventId: "evt_cron",
          occurredAt: "2026-04-08T00:00:00.000Z",
          reason: "alarm",
          userId: "member_123",
        }),
        expected: "Processed assistant cron tick (alarm) on the hosted assistant lane.",
      },
      {
        wake: buildHostedExecutionDeviceSyncWake({
          eventId: "evt_wake",
          occurredAt: "2026-04-08T00:00:00.000Z",
          reason: "connected",
          userId: "member_123",
        }),
        expected: "Processed device-sync wake (connected) on the hosted device-sync lane. Device sync jobs: 2.",
      },
    ];

    for (const entry of wakes) {
      assert.equal(
        summarizeWake(entry.wake, {
          bootstrapResult: null,
          conversationMetrics: null,
          deviceSyncProcessed: 2,
          deviceSyncSkipped: false,
          followupExecution: entry.wake.kind === "conversation.message"
            ? "conversation-message"
            : entry.wake.kind === "assistant.cron.tick"
              ? "assistant-cron"
              : "device-sync",
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
