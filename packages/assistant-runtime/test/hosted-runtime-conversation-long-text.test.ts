import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { INBOX_CAPTURE_TEXT_MAX_LENGTH } from "@murphai/contracts";
import { initializeVault, readJsonlRecords } from "@murphai/core";
import { buildHostedExecutionLinqConversationMessageWake } from "@murphai/hosted-execution";
import { openInboxRuntime } from "@murphai/inboxd";
import { test } from "vitest";

import {
  importHostedConversationMessageWakeIntoLocalInbox,
} from "../src/hosted-runtime/events/conversation.ts";
import type {
  NormalizedHostedAssistantRuntimeConfig,
} from "../src/hosted-runtime/models.ts";
import {
  createHostedRuntimeEffectsPortStub,
} from "./hosted-runtime-test-helpers.ts";

test("hosted conversation import preserves long message text for the agent while capping inbox-capture projection text", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-long-text-vault-"));
  const fullText = "a".repeat(INBOX_CAPTURE_TEXT_MAX_LENGTH + 512);

  try {
    await initializeVault({ vaultRoot, createdAt: "2026-04-29T00:00:00.000Z" });

    const result = await importHostedConversationMessageWakeIntoLocalInbox({
      runtime: createRuntime(),
      vaultRoot,
      wake: buildHostedExecutionLinqConversationMessageWake({
        eventId: "evt_hosted_linq_long_text",
        linqMessage: {
          chatId: "chat_hosted_linq_long_text",
          from: "+15550100000",
          isFromMe: false,
          messageId: "msg_hosted_linq_long_text",
          parts: [
            {
              type: "text",
              value: fullText,
            },
          ],
        },
        occurredAt: "2026-04-29T18:40:53.000Z",
        phoneLookupKey: "+15550100000",
        userId: "member_synthetic_hosted_long_text",
      }),
    });

    const runtime = await openInboxRuntime({ vaultRoot });
    try {
      assert.ok(result.capture);
      const capture = runtime.getCapture(result.capture.captureId);
      assert.ok(capture);
      assert.equal(capture.text, fullText);
    } finally {
      runtime.close();
    }

    const captureRecords = await readJsonlRecords({
      vaultRoot,
      relativePath: "ledger/inbox-captures/2026/2026-04.jsonl",
    });
    assert.equal(captureRecords.length, 1);
    const captureRecord = captureRecords[0] as { text?: unknown };
    const captureRecordText = captureRecord.text;
    assert.equal(typeof captureRecordText, "string");
    if (typeof captureRecordText !== "string") {
      throw new TypeError("Expected long inbox-capture text projection in test record.");
    }
    assert.equal(captureRecordText.length, INBOX_CAPTURE_TEXT_MAX_LENGTH);
    assert.equal(captureRecordText, fullText.slice(0, INBOX_CAPTURE_TEXT_MAX_LENGTH));
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

function createRuntime(): Pick<
  NormalizedHostedAssistantRuntimeConfig,
  "forwardedEnv" | "platform" | "platformEnv" | "userEnv"
> {
  return {
    forwardedEnv: {},
    platform: {
      artifactStore: {
        async get() {
          return null;
        },
        async put() {},
      },
      effectsPort: createHostedRuntimeEffectsPortStub(),
    },
    platformEnv: {},
    userEnv: {},
  };
}
