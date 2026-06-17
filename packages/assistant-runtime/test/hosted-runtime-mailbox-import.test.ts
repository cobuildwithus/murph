import assert from "node:assert/strict";

import { describe, test } from "vitest";

import type {
  HostedMailboxFetchRequest,
  HostedMailboxFetchResponse,
  HostedMailboxItem,
  HostedMailboxPayload,
  HostedMailboxPayloadFetchRequest,
  HostedMailboxPayloadFetchResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/runtime-control";

import {
  createEmptyHostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";
import {
  HostedMailboxUserMismatchError,
  fetchAndProcessHostedMailboxPrefix,
} from "../src/hosted-runtime/mailbox-import.ts";
import type {
  HostedRuntimeMailboxPort,
} from "../src/hosted-runtime-contracts.ts";

const TEST_NOW = "2026-04-26T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_import";

describe("hosted mailbox import loop", () => {
  test("fetches after runtime watermarks and advances only after durable import", async () => {
    const first = createMailboxItem({
      id: "mailbox_item_conversation_001",
      laneSeq: "1",
    });
    const second = createMailboxItem({
      id: "mailbox_item_conversation_002",
      laneSeq: "2",
    });
    const { fetchRequests, mailboxPort } = createMailboxPort({
      items: [first, second],
    });
    const imported: string[] = [];

    const result = await fetchAndProcessHostedMailboxPrefix({
      expectedUserId: TEST_USER_ID,
      async importItem(input) {
        imported.push(input.item.id);
        return { status: "imported" };
      },
      limitPerLane: 10,
      mailboxPort,
      now: () => TEST_NOW,
      requestId: "request_synthetic_import_001",
      state: createEmptyHostedMailboxImportState(),
    });

    assert.deepEqual(fetchRequests, [
      {
        lanes: [
          { importedSeq: "0", lane: "system" },
          { importedSeq: "0", lane: "conversation" },
        ],
        limitPerLane: 10,
        requestId: "request_synthetic_import_001",
      },
    ]);
    assert.deepEqual(imported, [
      "mailbox_item_conversation_001",
      "mailbox_item_conversation_002",
    ]);
    assert.equal(result.importedCount, 2);
    assert.equal(result.conversationImportedCount, 2);
    assert.deepEqual(result.blocked, []);
    assert.equal(result.state.watermarks.conversation, "2");
    assert.equal(result.state.watermarks.system, "0");
  });

  test("does not advance the conversation watermark when import throws before success", async () => {
    const state = createEmptyHostedMailboxImportState();
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_conversation_enqueue_failure",
          laneSeq: "1",
        }),
      ],
    });

    await assert.rejects(
      fetchAndProcessHostedMailboxPrefix({
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("pending input enqueue failed");
        },
        limitPerLane: 10,
        mailboxPort,
        now: () => TEST_NOW,
        requestId: "request_synthetic_import_enqueue_failure",
        state,
      }),
      /pending input enqueue failed/u,
    );

    assert.equal(state.watermarks.conversation, "0");
    assert.equal(state.watermarks.system, "0");
  });

  test("flags items at or below the durable consumed floor as durably consumed", async () => {
    const { mailboxPort } = createMailboxPort({
      consumedSeqByLane: [
        { consumedSeq: "1", lane: "conversation" },
      ],
      items: [
        createMailboxItem({
          id: "mailbox_item_conversation_001",
          laneSeq: "1",
        }),
        createMailboxItem({
          id: "mailbox_item_conversation_002",
          laneSeq: "2",
        }),
      ],
    });
    const durablyConsumedBySeq = new Map<string, boolean | undefined>();

    const result = await fetchAndProcessHostedMailboxPrefix({
      expectedUserId: TEST_USER_ID,
      async importItem(input) {
        durablyConsumedBySeq.set(input.item.laneSeq, input.durablyConsumed);
        return { status: "imported" };
      },
      limitPerLane: 10,
      mailboxPort,
      now: () => TEST_NOW,
      requestId: "request_synthetic_import_consumed_floor",
      state: createEmptyHostedMailboxImportState(),
    });

    assert.equal(result.importedCount, 2);
    assert.deepEqual([...durablyConsumedBySeq.entries()], [
      ["1", true],
      ["2", false],
    ]);
  });

  test("flags nothing as durably consumed when the fetch response omits consumedSeqByLane", async () => {
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_conversation_001",
          laneSeq: "1",
        }),
        createMailboxItem({
          id: "mailbox_item_conversation_002",
          laneSeq: "2",
        }),
      ],
    });
    const durablyConsumedBySeq = new Map<string, boolean | undefined>();

    const result = await fetchAndProcessHostedMailboxPrefix({
      expectedUserId: TEST_USER_ID,
      async importItem(input) {
        durablyConsumedBySeq.set(input.item.laneSeq, input.durablyConsumed);
        return { status: "imported" };
      },
      limitPerLane: 10,
      mailboxPort,
      now: () => TEST_NOW,
      requestId: "request_synthetic_import_consumed_floor_missing",
      state: createEmptyHostedMailboxImportState(),
    });

    assert.equal(result.importedCount, 2);
    assert.deepEqual([...durablyConsumedBySeq.entries()], [
      ["1", false],
      ["2", false],
    ]);
  });

  test("returns the latest Linq delivery context imported from the mailbox prefix", async () => {
    const item = createMailboxItem({
      id: "mailbox_item_conversation_linq_context",
      laneSeq: "1",
    });
    const { mailboxPort } = createMailboxPort({
      items: [item],
    });

    const result = await fetchAndProcessHostedMailboxPrefix({
      expectedUserId: TEST_USER_ID,
      async importItem(input) {
        assert.equal(input.item.id, "mailbox_item_conversation_linq_context");
        return {
          linqDeliveryContext: {
            directRecipientPhoneNumber: "+15550000001",
            fromPhoneNumber: null,
            replyToMessageId: "linq-message-1",
            target: "linq-thread-1",
          },
          status: "imported",
        };
      },
      limitPerLane: 10,
      mailboxPort,
      now: () => TEST_NOW,
      requestId: "request_synthetic_import_linq_context",
      state: createEmptyHostedMailboxImportState(),
    });

    assert.equal(result.importedCount, 1);
    assert.equal(result.conversationImportedCount, 1);
    assert.deepEqual(result.latestLinqDeliveryContext, {
      directRecipientPhoneNumber: "+15550000001",
      fromPhoneNumber: null,
      replyToMessageId: "linq-message-1",
      target: "linq-thread-1",
    });
    assert.equal(result.state.watermarks.conversation, "1");
  });

  test("interleaves mailbox lanes so conversation replies are not starved by system backlogs", async () => {
    const firstSystem = createMailboxItem({
      id: "mailbox_item_system_001",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const secondSystem = createMailboxItem({
      id: "mailbox_item_system_002",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "2",
    });
    const thirdSystem = createMailboxItem({
      id: "mailbox_item_system_003",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "3",
    });
    const conversation = createMailboxItem({
      id: "mailbox_item_conversation_001",
      laneSeq: "1",
    });
    const { mailboxPort } = createMailboxPort({
      items: [firstSystem, secondSystem, thirdSystem, conversation],
    });
    const imported: string[] = [];
    let importAttempts = 0;

    const result = await fetchAndProcessHostedMailboxPrefix({
      expectedUserId: TEST_USER_ID,
      async importItem(input) {
        importAttempts += 1;
        if (importAttempts > 2) {
          return {
            reasonCode: "budget.mailbox_items",
            status: "deferred",
          };
        }
        imported.push(input.item.id);
        return { status: "imported" };
      },
      limitPerLane: 10,
      mailboxPort,
      now: () => TEST_NOW,
      requestId: "request_synthetic_import_fair_lanes",
      state: createEmptyHostedMailboxImportState(),
    });

    assert.deepEqual(imported, [
      "mailbox_item_system_001",
      "mailbox_item_conversation_001",
    ]);
    assert.deepEqual(result.blocked, [
      {
        itemId: "mailbox_item_system_002",
        lane: "system",
        reasonCode: "budget.mailbox_items",
        retryable: true,
        seq: "2",
      },
    ]);
    assert.equal(result.state.watermarks.conversation, "1");
    assert.equal(result.state.watermarks.system, "1");
  });

  test("stops a lane on a strict-prefix gap without importing later items", async () => {
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_conversation_002",
          laneSeq: "2",
        }),
      ],
    });
    const imported: string[] = [];

    const result = await fetchAndProcessHostedMailboxPrefix({
      expectedUserId: TEST_USER_ID,
      async importItem(input) {
        imported.push(input.item.id);
        return { status: "imported" };
      },
      limitPerLane: 10,
      mailboxPort,
      now: () => TEST_NOW,
      requestId: "request_synthetic_import_gap",
      state: createEmptyHostedMailboxImportState(),
    });

    assert.deepEqual(imported, []);
    assert.deepEqual(result.blocked, [
      {
        itemId: "mailbox_item_conversation_002",
        lane: "conversation",
        reasonCode: "lane.gap",
        retryable: true,
        seq: "2",
      },
    ]);
    assert.equal(result.nextRetryAt, "2026-04-26T00:00:15.000Z");
    assert.equal(result.state.watermarks.conversation, "0");
  });

  test("does not advance when a sidecar payload is temporarily missing", async () => {
    const item = createMailboxItem({
      id: "mailbox_item_conversation_sidecar",
      laneSeq: "1",
      payloadInlineCiphertext: null,
      payloadRef: "hosted-mailbox-payload:mailbox_item_conversation_sidecar",
    });
    const { mailboxPort, payloadFetchRequests } = createMailboxPort({
      items: [item],
      payloadResponse: {
        fetchedAt: TEST_NOW,
        payload: null,
      },
    });

    const result = await fetchAndProcessHostedMailboxPrefix({
      expectedUserId: TEST_USER_ID,
      async importItem() {
        throw new Error("Import should not run without a payload.");
      },
      limitPerLane: 10,
      mailboxPort,
      now: () => TEST_NOW,
      requestId: "request_synthetic_import_payload_missing",
      state: createEmptyHostedMailboxImportState(),
    });

    assert.deepEqual(payloadFetchRequests, [
      {
        dedupeKey: "dedupe_synthetic_import",
        mailboxItemId: "mailbox_item_conversation_sidecar",
        payloadRef: "hosted-mailbox-payload:mailbox_item_conversation_sidecar",
        requestId: "request_synthetic_import_payload_missing:mailbox_item_conversation_sidecar:payload",
      },
    ]);
    assert.deepEqual(result.blocked, [
      {
        itemId: "mailbox_item_conversation_sidecar",
        lane: "conversation",
        reasonCode: "payload.sidecar_missing",
        retryable: true,
        seq: "1",
      },
    ]);
    assert.equal(result.nextRetryAt, "2026-04-26T00:00:15.000Z");
    assert.equal(result.state.watermarks.conversation, "0");
  });

  test("keeps stale retryable blockers pending and schedules a retry", async () => {
    const staleCreatedAt = "2026-04-25T23:29:59.000Z";
    const missingSidecar = createMailboxItem({
      createdAt: staleCreatedAt,
      id: "mailbox_item_conversation_stale_sidecar",
      laneSeq: "1",
      payloadInlineCiphertext: null,
      payloadRef: "hosted-mailbox-payload:mailbox_item_conversation_stale_sidecar",
    });
    const deferredItem = createMailboxItem({
      createdAt: staleCreatedAt,
      id: "mailbox_item_conversation_stale_deferred",
      laneSeq: "2",
    });
    const blockedItem = createMailboxItem({
      createdAt: staleCreatedAt,
      id: "mailbox_item_conversation_stale_blocked",
      laneSeq: "3",
    });
    const validItem = createMailboxItem({
      id: "mailbox_item_conversation_after_stale_blockers",
      laneSeq: "4",
    });
    const { mailboxPort } = createMailboxPort({
      items: [missingSidecar, deferredItem, blockedItem, validItem],
      payloadResponse: {
        fetchedAt: TEST_NOW,
        payload: null,
      },
    });
    const imported: string[] = [];

    const result = await fetchAndProcessHostedMailboxPrefix({
      expectedUserId: TEST_USER_ID,
      async importItem(input) {
        if (input.item.id === "mailbox_item_conversation_stale_deferred") {
          return {
            reasonCode: "import.deferred",
            status: "deferred",
          };
        }
        if (input.item.id === "mailbox_item_conversation_stale_blocked") {
          return {
            reasonCode: "temporary.retryable_block",
            retryable: true,
            status: "blocked",
          };
        }
        imported.push(input.item.id);
        return { status: "imported" };
      },
      limitPerLane: 10,
      mailboxPort,
      now: () => TEST_NOW,
      requestId: "request_synthetic_import_stale_retryable",
      state: createEmptyHostedMailboxImportState(),
    });

    assert.deepEqual(result.blocked, [
      {
        itemId: "mailbox_item_conversation_stale_sidecar",
        lane: "conversation",
        reasonCode: "payload.sidecar_missing",
        retryable: true,
        seq: "1",
      },
    ]);
    assert.deepEqual(imported, []);
    assert.equal(result.nextRetryAt, "2026-04-26T00:00:15.000Z");
    assert.equal(result.state.watermarks.conversation, "0");
    assert.deepEqual(result.state.recentStatuses, []);
  });

  test("quarantines malformed route metadata without exposing payload details", async () => {
    const item = createMailboxItem({
      id: "mailbox_item_system_bad_lane",
      kind: "conversation.message",
      lane: "system",
      laneSeq: "1",
    });
    const { mailboxPort } = createMailboxPort({
      items: [item],
    });

    const result = await fetchAndProcessHostedMailboxPrefix({
      expectedUserId: TEST_USER_ID,
      async importItem() {
        throw new Error("Import should not run for a route quarantine.");
      },
      limitPerLane: 10,
      mailboxPort,
      now: () => TEST_NOW,
      requestId: "request_synthetic_import_route_bad",
      state: createEmptyHostedMailboxImportState(),
    });

    assert.deepEqual(result.blocked, [
      {
        itemId: "mailbox_item_system_bad_lane",
        lane: "system",
        reasonCode: "route.lane_kind_mismatch",
        retryable: false,
        seq: "1",
      },
    ]);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("ciphertext_inline_synthetic"), false);
    assert.equal(serialized.includes("payloadRef"), false);
    assert.equal(serialized.includes("runId"), false);
    assert.equal(serialized.includes("committedSeq"), false);
    assert.equal(serialized.includes("source_cursor"), false);
  });

  test("quarantines invalid sequence metadata instead of throwing from prefix checks", async () => {
    const item = createMailboxItem({
      id: "mailbox_item_conversation_bad_seq",
      laneSeq: "01",
    });
    const { mailboxPort } = createMailboxPort({
      items: [item],
    });

    const result = await fetchAndProcessHostedMailboxPrefix({
      expectedUserId: TEST_USER_ID,
      async importItem() {
        throw new Error("Import should not run for invalid sequence metadata.");
      },
      limitPerLane: 10,
      mailboxPort,
      now: () => TEST_NOW,
      requestId: "request_synthetic_import_invalid_seq",
      state: createEmptyHostedMailboxImportState(),
    });

    assert.deepEqual(result.blocked, [
      {
        itemId: "mailbox_item_conversation_bad_seq",
        lane: "conversation",
        reasonCode: "route.invalid_lane_seq",
        retryable: false,
        seq: "01",
      },
    ]);
    assert.equal(result.state.watermarks.conversation, "0");
  });

  test("normalizes deferred and successful import reason codes without leaking malformed text", async () => {
    const deferredItem = createMailboxItem({
      id: "mailbox_item_conversation_deferred",
      laneSeq: "1",
    });
    const { mailboxPort: deferredMailboxPort } = createMailboxPort({
      items: [deferredItem],
    });

    const deferredResult = await fetchAndProcessHostedMailboxPrefix({
      expectedUserId: TEST_USER_ID,
      async importItem() {
        return {
          reasonCode: "  import deferred!  ",
          status: "deferred",
        };
      },
      limitPerLane: 10,
      mailboxPort: deferredMailboxPort,
      now: () => TEST_NOW,
      requestId: "request_synthetic_import_deferred",
      state: createEmptyHostedMailboxImportState(),
    });

    assert.deepEqual(deferredResult.blocked, [
      {
        itemId: "mailbox_item_conversation_deferred",
        lane: "conversation",
        reasonCode: "import.deferred",
        retryable: true,
        seq: "1",
      },
    ]);
    assert.equal(deferredResult.nextRetryAt, "2026-04-26T00:00:15.000Z");
    assert.deepEqual(deferredResult.state.recentStatuses, []);
    assert.equal(deferredResult.state.watermarks.conversation, "0");

    const importedItem = createMailboxItem({
      id: "mailbox_item_system_imported",
      kind: "member.activated",
      lane: "system",
      laneSeq: "1",
    });
    const { mailboxPort: importedMailboxPort } = createMailboxPort({
      items: [importedItem],
    });

    const importedResult = await fetchAndProcessHostedMailboxPrefix({
      expectedUserId: TEST_USER_ID,
      async importItem() {
        return {
          status: "imported",
        };
      },
      limitPerLane: 10,
      mailboxPort: importedMailboxPort,
      now: () => TEST_NOW,
      requestId: "request_synthetic_import_no_reason",
      state: createEmptyHostedMailboxImportState(),
    });

    assert.deepEqual(importedResult.blocked, []);
    assert.deepEqual(importedResult.state.recentStatuses, [
      {
        itemKind: "member.activated",
        lane: "system",
        occurredAt: TEST_NOW,
        reasonCode: null,
        seq: "1",
        status: "imported",
      },
    ]);
    assert.equal(importedResult.state.watermarks.system, "1");
  });

  test("advances past non-retryable blocked import outcomes after recording quarantine", async () => {
    const poisonItem = createMailboxItem({
      id: "mailbox_item_conversation_decode_mismatch",
      laneSeq: "1",
    });
    const validItem = createMailboxItem({
      id: "mailbox_item_conversation_valid_after_poison",
      laneSeq: "2",
    });
    const { mailboxPort } = createMailboxPort({
      items: [poisonItem, validItem],
    });
    const imported: string[] = [];

    const result = await fetchAndProcessHostedMailboxPrefix({
      expectedUserId: TEST_USER_ID,
      async importItem(input) {
        if (input.item.id === "mailbox_item_conversation_decode_mismatch") {
          return {
            reasonCode: "payload.decode_mismatch",
            retryable: false,
            status: "blocked",
          };
        }
        imported.push(input.item.id);
        return {
          status: "imported",
        };
      },
      limitPerLane: 10,
      mailboxPort,
      now: () => TEST_NOW,
      requestId: "request_synthetic_import_blocked",
      state: createEmptyHostedMailboxImportState(),
    });

    assert.deepEqual(result.blocked, [
      {
        itemId: "mailbox_item_conversation_decode_mismatch",
        lane: "conversation",
        reasonCode: "payload.decode_mismatch",
        retryable: false,
        seq: "1",
      },
    ]);
    assert.deepEqual(imported, ["mailbox_item_conversation_valid_after_poison"]);
    assert.deepEqual(result.state.recentStatuses, [
      {
        itemKind: "conversation.message",
        lane: "conversation",
        occurredAt: TEST_NOW,
        reasonCode: "payload.decode_mismatch",
        seq: "1",
        status: "quarantined",
      },
      {
        itemKind: "conversation.message",
        lane: "conversation",
        occurredAt: TEST_NOW,
        reasonCode: null,
        seq: "2",
        status: "imported",
      },
    ]);
    assert.equal(result.importedCount, 1);
    assert.equal(result.conversationImportedCount, 1);
    assert.equal(result.state.watermarks.conversation, "2");
  });

  test("keeps retryable blocked import outcomes pending and schedules a retry", async () => {
    const retryableItem = createMailboxItem({
      id: "mailbox_item_conversation_retryable_block",
      laneSeq: "1",
    });
    const validItem = createMailboxItem({
      id: "mailbox_item_conversation_after_retryable_block",
      laneSeq: "2",
    });
    const { mailboxPort } = createMailboxPort({
      items: [retryableItem, validItem],
    });
    const imported: string[] = [];

    const result = await fetchAndProcessHostedMailboxPrefix({
      expectedUserId: TEST_USER_ID,
      async importItem(input) {
        if (input.item.id === "mailbox_item_conversation_retryable_block") {
          return {
            reasonCode: "temporary.retryable_block",
            retryable: true,
            status: "blocked",
          };
        }
        imported.push(input.item.id);
        return {
          status: "imported",
        };
      },
      limitPerLane: 10,
      mailboxPort,
      now: () => TEST_NOW,
      requestId: "request_synthetic_import_retryable_block",
      state: createEmptyHostedMailboxImportState(),
    });

    assert.deepEqual(result.blocked, [
      {
        itemId: "mailbox_item_conversation_retryable_block",
        lane: "conversation",
        reasonCode: "temporary.retryable_block",
        retryable: true,
        seq: "1",
      },
    ]);
    assert.deepEqual(imported, []);
    assert.equal(result.nextRetryAt, "2026-04-26T00:00:15.000Z");
    assert.deepEqual(result.state.recentStatuses, []);
    assert.equal(result.state.watermarks.conversation, "0");
  });

  test("rejects mailbox fetch responses for another user before import", async () => {
    const item = createMailboxItem();
    const { mailboxPort, payloadFetchRequests } = createMailboxPort({
      items: [item],
      userId: "member_synthetic_other",
    });
    let importCalls = 0;

    await assert.rejects(
      () =>
        fetchAndProcessHostedMailboxPrefix({
          expectedUserId: TEST_USER_ID,
          async importItem() {
            importCalls += 1;
            return { status: "imported" };
          },
          limitPerLane: 10,
          mailboxPort,
          now: () => TEST_NOW,
          requestId: "request_synthetic_import_fetch_user_mismatch",
          state: createEmptyHostedMailboxImportState(),
        }),
      (error) =>
        error instanceof HostedMailboxUserMismatchError
        && error.scope === "fetch_response"
        && error.itemId === null,
    );
    assert.equal(importCalls, 0);
    assert.deepEqual(payloadFetchRequests, []);
  });

  test("rejects mailbox items for another user before payload fetch or import", async () => {
    const item = createMailboxItem({
      userId: "member_synthetic_other",
    });
    const { mailboxPort, payloadFetchRequests } = createMailboxPort({
      items: [item],
    });
    let importCalls = 0;

    await assert.rejects(
      () =>
        fetchAndProcessHostedMailboxPrefix({
          expectedUserId: TEST_USER_ID,
          async importItem() {
            importCalls += 1;
            return { status: "imported" };
          },
          limitPerLane: 10,
          mailboxPort,
          now: () => TEST_NOW,
          requestId: "request_synthetic_import_item_user_mismatch",
          state: createEmptyHostedMailboxImportState(),
        }),
      (error) =>
        error instanceof HostedMailboxUserMismatchError
        && error.scope === "item"
        && error.itemId === "mailbox_item_conversation_001",
    );
    assert.equal(importCalls, 0);
    assert.deepEqual(payloadFetchRequests, []);
  });
});

function createMailboxPort(input: {
  consumedSeqByLane?: HostedMailboxFetchResponse["consumedSeqByLane"];
  items: readonly HostedMailboxItem[];
  payloadResponse?: HostedMailboxPayloadFetchResponse;
  userId?: string;
}): {
  fetchRequests: HostedMailboxFetchRequest[];
  mailboxPort: HostedRuntimeMailboxPort;
  payloadFetchRequests: HostedMailboxPayloadFetchRequest[];
} {
  const fetchRequests: HostedMailboxFetchRequest[] = [];
  const payloadFetchRequests: HostedMailboxPayloadFetchRequest[] = [];

  return {
    fetchRequests,
    mailboxPort: {
      async fetch(request): Promise<HostedMailboxFetchResponse> {
        fetchRequests.push(request);
        return {
          ...(input.consumedSeqByLane === undefined
            ? {}
            : { consumedSeqByLane: input.consumedSeqByLane }),
          fetchedAt: TEST_NOW,
          items: input.items.filter((item) =>
            request.lanes.some((lane) =>
              lane.lane === item.lane && BigInt(item.laneSeq) > BigInt(lane.importedSeq)
            )
          ),
          maxSeqByLane: request.lanes.map((lane) => ({
            lane: lane.lane,
            maxSeq: input.items
              .filter((item) => item.lane === lane.lane)
              .reduce((maxSeq, item) =>
                BigInt(item.laneSeq) > BigInt(maxSeq) ? item.laneSeq : maxSeq,
              lane.importedSeq),
          })),
          userId: input.userId ?? TEST_USER_ID,
        };
      },
      async fetchPayload(request): Promise<HostedMailboxPayloadFetchResponse> {
        payloadFetchRequests.push(request);
        return input.payloadResponse ?? {
          fetchedAt: TEST_NOW,
          payload: createMailboxPayload({
            mailboxItemId: request.mailboxItemId,
          }),
        };
      },
    },
    payloadFetchRequests,
  };
}

function createMailboxItem(overrides: Partial<HostedMailboxItem> = {}): HostedMailboxItem {
  return {
    createdAt: TEST_NOW,
    dedupeKey: "dedupe_synthetic_import",
    expiresAt: null,
    id: "mailbox_item_conversation_001",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: "1",
    occurredAt: TEST_NOW,
    payloadBytes: 128,
    payloadInlineCiphertext: "ciphertext_inline_synthetic",
    payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
    ...overrides,
  };
}

function createMailboxPayload(overrides: Partial<HostedMailboxPayload> = {}): HostedMailboxPayload {
  return {
    createdAt: TEST_NOW,
    mailboxItemId: "mailbox_item_conversation_001",
    payloadCiphertext: "ciphertext_sidecar_synthetic",
    payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
    userId: TEST_USER_ID,
    ...overrides,
  };
}
