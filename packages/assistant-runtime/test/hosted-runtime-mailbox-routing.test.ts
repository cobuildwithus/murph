import assert from "node:assert/strict";

import { describe, test } from "vitest";

import type {
  HostedMailboxItem,
  HostedMailboxKind,
  HostedMailboxLane,
} from "@murphai/hosted-execution/runtime-control";
import {
  createHostedMailboxRoutingPlan,
  resolveExpectedLaneForHostedMailboxKind,
  type HostedMailboxImportAction,
} from "../src/hosted-runtime/mailbox-routing.ts";

const TEST_NOW = "2026-04-26T00:00:00.000Z";

describe("hosted mailbox routing", () => {
  test("classifies every current hosted mailbox kind into a semantic import action", () => {
    const cases: Array<{
      action: HostedMailboxImportAction;
      kind: HostedMailboxKind;
      lane: HostedMailboxLane;
    }> = [
      {
        action: "import-conversation-message",
        kind: "conversation.message",
        lane: "conversation",
      },
      {
        action: "apply-member-activation",
        kind: "member.activated",
        lane: "system",
      },
      {
        action: "apply-member-channels-update",
        kind: "member.channels.updated",
        lane: "system",
      },
      {
        action: "dispatch-assistant-notification",
        kind: "assistant.notification.requested",
        lane: "system",
      },
      {
        action: "run-device-sync-wake",
        kind: "device-sync.wake",
        lane: "system",
      },
      {
        action: "apply-runtime-control-request",
        kind: "runtime.manual-requested",
        lane: "system",
      },
      {
        action: "apply-runtime-control-request",
        kind: "runtime.maintenance-requested",
        lane: "system",
      },
      {
        action: "apply-runtime-control-request",
        kind: "runtime.browser-vault-refresh-requested",
        lane: "system",
      },
      {
        action: "apply-runtime-control-request",
        kind: "runtime.device-sync-recovery-requested",
        lane: "system",
      },
      {
        action: "apply-runtime-control-request",
        kind: "runtime.mailbox-lag-observed",
        lane: "system",
      },
    ];

    for (const entry of cases) {
      const item = createMailboxItem({
        kind: entry.kind,
        lane: entry.lane,
      });

      const plan = createHostedMailboxRoutingPlan(item);

      assert.equal(plan.state, "route");
      assert.equal(plan.advanceProgress, true);
      assert.equal(plan.action, entry.action);
      assert.deepEqual(plan.itemRef, {
        id: item.id,
        kind: entry.kind,
        lane: entry.lane,
        laneSeq: item.laneSeq,
      });
    }
  });

  test("keeps the mailbox lane contract explicit for producer and runtime agreement", () => {
    assert.equal(resolveExpectedLaneForHostedMailboxKind("conversation.message"), "conversation");
    assert.equal(resolveExpectedLaneForHostedMailboxKind("member.activated"), "system");
    assert.equal(resolveExpectedLaneForHostedMailboxKind("member.channels.updated"), "system");
    assert.equal(resolveExpectedLaneForHostedMailboxKind("assistant.notification.requested"), "system");
    assert.equal(resolveExpectedLaneForHostedMailboxKind("device-sync.wake"), "system");
    assert.equal(resolveExpectedLaneForHostedMailboxKind("runtime.manual-requested"), "system");
    assert.equal(resolveExpectedLaneForHostedMailboxKind("runtime.maintenance-requested"), "system");
  });

  test("quarantines lane and sequence inconsistencies before progress can advance", () => {
    assertQuarantine(
      createHostedMailboxRoutingPlan(createMailboxItem({
        kind: "conversation.message",
        lane: "system",
      })),
      "lane_kind_mismatch",
    );

    assertQuarantine(
      createHostedMailboxRoutingPlan(createMailboxItem({
        laneSeq: "0",
      })),
      "invalid_lane_seq",
    );
  });

  test("quarantines unsupported and malformed metadata with compact codes only", () => {
    assertQuarantine(
      createHostedMailboxRoutingPlan(createMailboxItem({
        kind: "runtime.timer" as HostedMailboxKind,
      })),
      "unsupported_kind",
    );
    assertQuarantine(
      createHostedMailboxRoutingPlan(createMailboxItem({
        payloadSchema: "murph.unsupported-mailbox-payload.v1",
      })),
      "invalid_payload_schema",
    );
  });

  test("does not put ciphertext or forbidden progress concepts into plans", () => {
    const route = createHostedMailboxRoutingPlan(createMailboxItem());
    const quarantine = createHostedMailboxRoutingPlan(createMailboxItem({
      kind: "runtime.timer" as HostedMailboxKind,
    }));

    const serializedPlans = JSON.stringify([route, quarantine]);

    assert.equal(serializedPlans.includes("ciphertext_synthetic_inline"), false);
    assert.equal(serializedPlans.includes("hosted-mailbox-payload:"), false);
    assert.equal(serializedPlans.includes("runId"), false);
    assert.equal(serializedPlans.includes("committedSeq"), false);
    assert.equal(serializedPlans.includes("targetSeq"), false);
    assert.equal(serializedPlans.includes("adopt"), false);
    assert.equal(serializedPlans.includes("finalize"), false);
    assert.equal(serializedPlans.includes("source_cursor"), false);
  });
});

function assertQuarantine(
  plan: ReturnType<typeof createHostedMailboxRoutingPlan>,
  quarantineCode: string,
): void {
  assert.deepEqual(Object.keys(plan).sort(), [
    "advanceProgress",
    "quarantineCode",
    "state",
  ]);
  assert.deepEqual(plan, {
    advanceProgress: false,
    quarantineCode,
    state: "quarantine",
  });
}

function createMailboxItem(overrides: Partial<HostedMailboxItem> = {}): HostedMailboxItem {
  return {
    createdAt: TEST_NOW,
    dedupeKey: "dedupe_synthetic_001",
    expiresAt: null,
    id: "item_synthetic_001",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: "1",
    occurredAt: TEST_NOW,
    payloadBytes: 64,
    payloadInlineCiphertext: "ciphertext_synthetic_inline",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: TEST_NOW,
    userId: "member_synthetic_001",
    ...overrides,
  };
}
