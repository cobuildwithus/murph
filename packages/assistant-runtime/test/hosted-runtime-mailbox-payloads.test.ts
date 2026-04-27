import assert from "node:assert/strict";

import { test } from "vitest";

import type {
  HostedMailboxFetchRequest,
  HostedMailboxFetchResponse,
  HostedMailboxItem,
  HostedMailboxPayload,
  HostedMailboxPayloadFetchRequest,
  HostedMailboxPayloadFetchResponse,
} from "@murphai/hosted-execution";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution";

import type {
  HostedRuntimeMailboxPort,
} from "../src/hosted-runtime-contracts.ts";
import {
  resolveHostedMailboxItemPayload,
} from "../src/hosted-runtime/mailbox-payloads.ts";

const TEST_NOW = "2026-04-26T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_mailbox_payloads";

test("returns inline mailbox ciphertext without fetching a sidecar payload", async () => {
  const { mailboxPort, payloadFetchRequests } = createMailboxPort({
    fetchedAt: TEST_NOW,
    payload: null,
  });
  const item = createMailboxItem({
    payloadInlineCiphertext: "ciphertext_inline_synthetic",
    payloadRef: null,
  });

  const result = await resolveHostedMailboxItemPayload({
    item,
    mailboxPort,
  });

  assert.deepEqual(payloadFetchRequests, []);
  assert.deepEqual(result, {
    payloadCiphertext: "ciphertext_inline_synthetic",
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    requestId: null,
    source: "inline",
    status: "resolved",
  });
});

test("fetches sidecar mailbox ciphertext with a generated request id and item id", async () => {
  const item = createMailboxItem({
    id: "mailbox_item_synthetic_sidecar",
    payloadInlineCiphertext: null,
    payloadRef: "hosted-mailbox-payload:mailbox_item_synthetic_sidecar",
  });
  const payload = createMailboxPayload({
    mailboxItemId: item.id,
    payloadCiphertext: "ciphertext_sidecar_synthetic",
  });
  const { mailboxPort, payloadFetchRequests } = createMailboxPort({
    fetchedAt: TEST_NOW,
    payload,
  });

  const result = await resolveHostedMailboxItemPayload({
    item,
    mailboxPort,
  });

  assert.equal(payloadFetchRequests.length, 1);
  assert.deepEqual(payloadFetchRequests[0]?.dedupeKey, item.dedupeKey);
  assert.deepEqual(payloadFetchRequests[0]?.mailboxItemId, "mailbox_item_synthetic_sidecar");
  assert.deepEqual(
    payloadFetchRequests[0]?.payloadRef,
    "hosted-mailbox-payload:mailbox_item_synthetic_sidecar",
  );
  assert.match(
    payloadFetchRequests[0]?.requestId ?? "",
    /^hosted-mailbox-payload-fetch:[0-9a-f-]{36}$/u,
  );
  assert.deepEqual(result, {
    payloadCiphertext: "ciphertext_sidecar_synthetic",
    payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
    requestId: payloadFetchRequests[0]?.requestId,
    source: "sidecar",
    status: "resolved",
  });
});

test("uses a caller request id when fetching sidecar mailbox ciphertext", async () => {
  const item = createMailboxItem({
    id: "mailbox_item_synthetic_custom_request",
    payloadInlineCiphertext: null,
    payloadRef: "hosted-mailbox-payload:mailbox_item_synthetic_custom_request",
  });
  const { mailboxPort, payloadFetchRequests } = createMailboxPort({
    fetchedAt: TEST_NOW,
    payload: createMailboxPayload({
      mailboxItemId: item.id,
      payloadCiphertext: "ciphertext_custom_request_synthetic",
    }),
  });

  const result = await resolveHostedMailboxItemPayload({
    item,
    mailboxPort,
    requestId: "request_synthetic_custom_payload",
  });

  assert.equal(result.status, "resolved");
  assert.deepEqual(payloadFetchRequests, [
    {
      dedupeKey: "dedupe_synthetic_mailbox_payload",
      mailboxItemId: "mailbox_item_synthetic_custom_request",
      payloadRef: "hosted-mailbox-payload:mailbox_item_synthetic_custom_request",
      requestId: "request_synthetic_custom_payload",
    },
  ]);
});

test("blocks sidecar unavailable responses without returning ciphertext", async () => {
  const item = createMailboxItem({
    id: "mailbox_item_synthetic_unavailable",
    payloadInlineCiphertext: null,
    payloadRef: "hosted-mailbox-payload:mailbox_item_synthetic_unavailable",
  });
  const { mailboxPort } = createMailboxPort({
    fetchedAt: TEST_NOW,
    payload: null,
    unavailable: {
      code: "not_found",
      retryable: false,
    },
  });

  const result = await resolveHostedMailboxItemPayload({
    item,
    mailboxPort,
    requestId: "request_synthetic_unavailable",
  });

  assert.deepEqual(result, {
    code: "sidecar_unavailable",
    requestId: "request_synthetic_unavailable",
    retryable: false,
    sideInputUnavailableCode: "not_found",
    status: "blocked",
  });
});

test("keeps an ambiguous missing sidecar payload retryable", async () => {
  const item = createMailboxItem({
    id: "mailbox_item_synthetic_missing_sidecar",
    payloadInlineCiphertext: null,
    payloadRef: "hosted-mailbox-payload:mailbox_item_synthetic_missing_sidecar",
  });
  const { mailboxPort } = createMailboxPort({
    fetchedAt: TEST_NOW,
    payload: null,
  });

  const result = await resolveHostedMailboxItemPayload({
    item,
    mailboxPort,
    requestId: "request_synthetic_missing_sidecar",
  });

  assert.deepEqual(result, {
    code: "sidecar_missing",
    requestId: "request_synthetic_missing_sidecar",
    retryable: true,
    status: "blocked",
  });
});

test("blocks invalid double-payload and missing-payload mailbox states without fetching", async () => {
  const { mailboxPort, payloadFetchRequests } = createMailboxPort({
    fetchedAt: TEST_NOW,
    payload: null,
  });

  const doublePayload = await resolveHostedMailboxItemPayload({
    item: createMailboxItem({
      payloadInlineCiphertext: "ciphertext_inline_synthetic",
      payloadRef: "hosted-mailbox-payload:mailbox_item_synthetic_001",
    }),
    mailboxPort,
  });
  const missingPayload = await resolveHostedMailboxItemPayload({
    item: createMailboxItem({
      payloadInlineCiphertext: null,
      payloadRef: null,
    }),
    mailboxPort,
  });

  assert.deepEqual(payloadFetchRequests, []);
  assert.deepEqual(doublePayload, {
    code: "double_payload",
    requestId: null,
    retryable: false,
    status: "blocked",
  });
  assert.deepEqual(missingPayload, {
    code: "missing_payload",
    requestId: null,
    retryable: false,
    status: "blocked",
  });
});

test("blocks blank payload fields without fetching a sidecar payload", async () => {
  const { mailboxPort, payloadFetchRequests } = createMailboxPort({
    fetchedAt: TEST_NOW,
    payload: null,
  });

  const result = await resolveHostedMailboxItemPayload({
    item: createMailboxItem({
      payloadInlineCiphertext: "   ",
      payloadRef: "\n\t",
    }),
    mailboxPort,
  });

  assert.deepEqual(payloadFetchRequests, []);
  assert.deepEqual(result, {
    code: "missing_payload",
    requestId: null,
    retryable: false,
    status: "blocked",
  });
});

test("blocks sidecar payloads that do not match the mailbox item", async () => {
  const item = createMailboxItem({
    id: "mailbox_item_synthetic_mismatch",
    payloadInlineCiphertext: null,
    payloadRef: "hosted-mailbox-payload:mailbox_item_synthetic_mismatch",
  });
  const { mailboxPort } = createMailboxPort({
    fetchedAt: TEST_NOW,
    payload: createMailboxPayload({
      mailboxItemId: "mailbox_item_synthetic_other",
      payloadCiphertext: "ciphertext_wrong_item_synthetic",
    }),
  });

  const result = await resolveHostedMailboxItemPayload({
    item,
    mailboxPort,
    requestId: "request_synthetic_mismatch",
  });

  assert.deepEqual(result, {
    code: "sidecar_mismatch",
    requestId: "request_synthetic_mismatch",
    retryable: false,
    status: "blocked",
  });
});

test("blocks sidecar payloads that do not match the mailbox user", async () => {
  const item = createMailboxItem({
    id: "mailbox_item_synthetic_user_mismatch",
    payloadInlineCiphertext: null,
    payloadRef: "hosted-mailbox-payload:mailbox_item_synthetic_user_mismatch",
  });
  const { mailboxPort } = createMailboxPort({
    fetchedAt: TEST_NOW,
    payload: createMailboxPayload({
      mailboxItemId: item.id,
      payloadCiphertext: "ciphertext_wrong_user_synthetic",
      userId: "member_synthetic_other",
    }),
  });

  const result = await resolveHostedMailboxItemPayload({
    item,
    mailboxPort,
    requestId: "request_synthetic_user_mismatch",
  });

  assert.deepEqual(result, {
    code: "sidecar_mismatch",
    requestId: "request_synthetic_user_mismatch",
    retryable: false,
    status: "blocked",
  });
});

test("blocks sidecar payloads that do not match the mailbox schema", async () => {
  const item = createMailboxItem({
    id: "mailbox_item_synthetic_schema_mismatch",
    payloadInlineCiphertext: null,
    payloadRef: "hosted-mailbox-payload:mailbox_item_synthetic_schema_mismatch",
  });
  const { mailboxPort } = createMailboxPort({
    fetchedAt: TEST_NOW,
    payload: createMailboxPayload({
      mailboxItemId: item.id,
      payloadCiphertext: "ciphertext_wrong_schema_synthetic",
      payloadSchema: "murph.hosted-mailbox-payload.v9",
    }),
  });

  const result = await resolveHostedMailboxItemPayload({
    item,
    mailboxPort,
    requestId: "request_synthetic_schema_mismatch",
  });

  assert.deepEqual(result, {
    code: "sidecar_mismatch",
    requestId: "request_synthetic_schema_mismatch",
    retryable: false,
    status: "blocked",
  });
});

function createMailboxPort(response: HostedMailboxPayloadFetchResponse): {
  mailboxPort: HostedRuntimeMailboxPort;
  payloadFetchRequests: HostedMailboxPayloadFetchRequest[];
} {
  const payloadFetchRequests: HostedMailboxPayloadFetchRequest[] = [];
  return {
    mailboxPort: {
      async fetch(request: HostedMailboxFetchRequest): Promise<HostedMailboxFetchResponse> {
        throw new Error(`Unexpected mailbox item fetch ${request.requestId}`);
      },
      async fetchPayload(
        request: HostedMailboxPayloadFetchRequest,
      ): Promise<HostedMailboxPayloadFetchResponse> {
        payloadFetchRequests.push(request);
        return response;
      },
    },
    payloadFetchRequests,
  };
}

function createMailboxItem(overrides: Partial<HostedMailboxItem> = {}): HostedMailboxItem {
  return {
    createdAt: TEST_NOW,
    dedupeKey: "dedupe_synthetic_mailbox_payload",
    expiresAt: null,
    id: "mailbox_item_synthetic_001",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: "1",
    occurredAt: TEST_NOW,
    payloadBytes: 128,
    payloadInlineCiphertext: null,
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
    mailboxItemId: "mailbox_item_synthetic_001",
    payloadCiphertext: "ciphertext_sidecar_synthetic",
    payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
    userId: TEST_USER_ID,
    ...overrides,
  };
}
