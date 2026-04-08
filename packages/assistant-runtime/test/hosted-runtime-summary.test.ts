import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  buildHostedExecutionGatewayMessageSendDispatch,
  buildHostedExecutionMemberActivatedDispatch,
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
          foods: [
            {
              foodId: "food_123",
              sourceRef: "food.breakfast",
            },
          ],
          meal: {
            mealEntryId: "meal_123",
          },
          pack: {
            createdAt: "2026-04-08T00:00:00.000Z",
            entities: [],
            schemaVersion: "murph.share-pack.v1",
          },
          protocols: [],
          recipes: [],
        },
        shareImportTitle: null,
      }),
      "Imported share pack \"share_123\" (1 foods, 0 protocols, 0 recipes). Logged one meal entry from the shared food. Parser jobs: 1. Device sync jobs: 0.",
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
});
