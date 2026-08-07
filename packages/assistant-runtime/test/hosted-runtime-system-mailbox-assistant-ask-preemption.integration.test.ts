import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildHostedExecutionAssistantAskCompletedWake,
} from "@murphai/hosted-execution";
import { VAULT_LAYOUT } from "@murphai/contracts";
import type {
  HostedMailboxItem,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedMailboxResolvedImportItem,
} from "../src/hosted-runtime/mailbox-import.ts";
import type {
  HostedRuntimePlatform,
} from "../src/hosted-runtime/platform.ts";
import {
  enqueueHostedSystemMailboxItem,
  prepareHostedSystemMailboxItemForCheckpoint,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  readHostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  createHostedRuntimeResolvedConfig,
  createHostedRuntimeWorkspace,
} from "./hosted-runtime-test-helpers.ts";
import { describe, it } from "vitest";

const FIXED_NOW = "2026-08-06T12:00:00.000Z";

describe("hosted system mailbox assistant ask preemption", () => {
  it("retains a completion without retry metadata when the lazy handler yields to foreground input", async () => {
    const workspace = await createHostedRuntimeWorkspace(
      "murph-hosted-system-mailbox-assistant-ask-preemption-",
    );
    const wake = buildHostedExecutionAssistantAskCompletedWake({
      ask: {
        expiresAt: "2099-08-06T12:10:00.000Z",
        origin: {
          automationId: "automation_preemption_integration",
          kind: "automation_occurrence",
          occurrenceAt: FIXED_NOW,
        },
        question: "Which time works?",
        requestId: "aask_req_preemption_integration",
        result: {
          answer: "Tomorrow afternoon.",
          outcome: "answered",
        },
        targetLabel: null,
      },
      eventId: "aask_done_preemption_integration",
      memberId: "member_preemption_integration",
      occurredAt: FIXED_NOW,
    });
    const item = createResolvedAssistantAskCompletionItem(wake.eventId);

    try {
      await mkdir(workspace.vaultRoot, { recursive: true });
      await writeFile(
        path.join(workspace.vaultRoot, VAULT_LAYOUT.metadata),
        "{}\n",
        "utf8",
      );
      await enqueueHostedSystemMailboxItem({
        item,
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const result = await prepareHostedSystemMailboxItemForCheckpoint({
        now: () => FIXED_NOW,
        runtime: createRuntime(),
        runtimeEnv: {},
        shouldYieldBackgroundMaintenance: () => true,
        vaultRoot: workspace.vaultRoot,
      });

      assert.ok(result);
      assert.equal(result.status, "preempted");
      assert.equal(result.item.status, "pending");
      assert.equal(result.item.nextAttemptAt, null);
      assert.equal(result.item.lastErrorCode, null);
      assert.equal(result.item.lastErrorMessage, null);

      const state = await readHostedSystemMailboxState(workspace.vaultRoot);
      assert.equal(state.pending.length, 1);
      assert.equal(state.pending[0]?.itemId, item.item.id);
      assert.equal(state.pending[0]?.status, "pending");
      assert.equal(state.pending[0]?.nextAttemptAt, null);
      assert.equal(state.pending[0]?.lastErrorCode, null);
      assert.equal(state.pending[0]?.lastErrorMessage, null);
    } finally {
      await workspace.cleanup();
    }
  });
});

function createRuntime(): Parameters<
  typeof prepareHostedSystemMailboxItemForCheckpoint
>[0]["runtime"] {
  const platform: HostedRuntimePlatform = {
    artifactStore: {
      async get() {
        return null;
      },
      async put() {},
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {},
    },
  };

  return {
    commitTimeoutMs: null,
    forwardedEnv: {},
    platform,
    platformEnv: {},
    resolvedConfig: createHostedRuntimeResolvedConfig(),
    userEnv: {},
  };
}

function createResolvedAssistantAskCompletionItem(
  eventId: string,
): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: eventId,
    expiresAt: null,
    id: "mailbox_item_preemption_integration",
    kind: "assistant.ask.completed",
    lane: "system",
    laneSeq: "1",
    occurredAt: FIXED_NOW,
    payloadBytes: 64,
    payloadInlineCiphertext: "ciphertext",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: FIXED_NOW,
    userId: "member_preemption_integration",
  };

  return {
    item,
    payload: {
      payloadCiphertext: "ciphertext",
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      requestId: "aask_req_preemption_integration",
      source: "inline",
      status: "resolved",
    },
    route: {
      action: "continue-assistant-ask",
      advanceProgress: true,
      itemRef: {
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
      },
      state: "route",
    },
  };
}
