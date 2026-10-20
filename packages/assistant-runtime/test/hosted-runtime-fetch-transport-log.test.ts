import {
  TEST_NOW,
  TEST_USER_ID,
  createMailboxPort,
  createPlatform,
  createSnapshotFixtureRef,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  removeTempRoot,
  writeMailboxImportStateFile,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault } from "@murphai/core";
import type { HostedRuntimeLogRequest } from "@murphai/hosted-execution/runtime-control";
import { describe, test } from "vitest";

import { runHostedWorkspaceRuntimeJobInProcess } from "../src/hosted-runtime.ts";
import { drainHostedRuntimeLogWritesBestEffort } from "../src/hosted-runtime/runtime-logs.ts";
import { createEmptyHostedMailboxImportState } from "../src/hosted-runtime/mailbox-state.ts";

async function runEmptyInvocation(input: {
  attemptId: string;
  readFetchTransportDiagnostics: () => Record<string, number | string | boolean | null>;
  passReadTiming?: Record<string, number | string | boolean | null>;
}) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-fetch-transport-log-"));
  const logRequests: HostedRuntimeLogRequest[] = [];
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    await writeMailboxImportStateFile(vaultRoot, createEmptyHostedMailboxImportState());
    const result = await runHostedWorkspaceRuntimeJobInProcess(
      createWorkspaceRuntimeJobInput({
        request: {
          attemptId: input.attemptId,
          leaseGeneration: "7",
          processingMode: "system_mailbox",
          userId: TEST_USER_ID,
          workspaceVersion: "0",
        },
      }),
      {
        async createCheckpointSnapshot() {
          return { snapshotRef: createSnapshotFixtureRef({ hash: "e".repeat(64), size: 128 }) };
        },
        async importItem() {
          throw new Error("An empty invocation must not import an item.");
        },
        platform: createPlatform({
          logRequests,
          mailboxPort: withPassReadTiming(createMailboxPort({ events: [], items: [] }), input.passReadTiming),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events: [],
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        fetchTransportDiagnostics: { read: input.readFetchTransportDiagnostics },
        async runAssistantPhase() {
          throw new Error("An empty invocation must not run the assistant.");
        },
        vaultRoot,
      },
    );
    await drainHostedRuntimeLogWritesBestEffort();
    return {
      finished: logRequests.flatMap((request) => request.entries).filter((entry) =>
        entry.attemptId === input.attemptId && entry.eventCode === "runtime.invocation_finished"),
      imported: logRequests.flatMap((request) => request.entries).filter((entry) =>
        entry.attemptId === input.attemptId && entry.eventCode === "mailbox.imported"),
      result,
    };
  } finally {
    await drainHostedRuntimeLogWritesBestEffort();
    await removeTempRoot(vaultRoot);
  }
}

function withPassReadTiming(
  mailboxPort: ReturnType<typeof createMailboxPort>,
  transportTiming?: Record<string, number | string | boolean | null>,
): ReturnType<typeof createMailboxPort> {
  if (!transportTiming) return mailboxPort;
  return {
    ...mailboxPort,
    async fetch(request, context) {
      return { ...await mailboxPort.fetch(request, context), transportTiming };
    },
  };
}

describe("hosted invocation fetch transport diagnostics", () => {
  test("writes the import pass's own read timing onto its existing mailbox.imported row", async () => {
    const { imported, finished } = await runEmptyInvocation({
      attemptId: "attempt_synthetic_pass_read_timing",
      passReadTiming: { passMailboxFetchResponseWaitMs: 333, passMailboxFetchAttemptCount: 1 },
      readFetchTransportDiagnostics: () => ({ firstMailboxFetchResponseWaitMs: 11 }),
    });
    assert.equal(imported.length, 1);
    assert.equal(imported[0]?.redactedJson?.passMailboxFetchResponseWaitMs, 333);
    assert.equal(imported[0]?.redactedJson?.passMailboxFetchAttemptCount, 1);
    // Invocation-first fields stay on the terminal row, never on the pass row.
    assert.equal(Object.hasOwn(imported[0]?.redactedJson ?? {}, "firstMailboxFetchResponseWaitMs"), false);
    assert.equal(finished[0]?.redactedJson?.firstMailboxFetchResponseWaitMs, 11);
    assert.equal(Object.hasOwn(finished[0]?.redactedJson ?? {}, "passMailboxFetchResponseWaitMs"), false);
  });

  test("adds the invocation's first-request scalars to the existing terminal entry", async () => {
    const { finished, result } = await runEmptyInvocation({
      attemptId: "attempt_synthetic_fetch_transport_present",
      readFetchTransportDiagnostics: () => ({
        firstTypingFetchDurationMs: 412,
        firstTypingFetchTlsHandshakeMs: 37,
        firstTypingFetchLastStage: "response_headers",
      }),
    });
    assert.equal(result.status, "idle");
    assert.equal(finished.length, 1);
    assert.equal(finished[0]?.redactedJson?.invocationStatus, "idle");
    assert.equal(finished[0]?.redactedJson?.firstTypingFetchDurationMs, 412);
    assert.equal(finished[0]?.redactedJson?.firstTypingFetchTlsHandshakeMs, 37);
    assert.equal(finished[0]?.redactedJson?.firstTypingFetchLastStage, "response_headers");
  });

  test("keeps the invocation result and terminal entry when the diagnostic read fails", async () => {
    const { finished, result } = await runEmptyInvocation({
      attemptId: "attempt_synthetic_fetch_transport_failed_read",
      readFetchTransportDiagnostics: () => {
        throw new Error("Synthetic diagnostic read failure");
      },
    });
    assert.equal(result.status, "idle");
    assert.equal(finished.length, 1);
    assert.equal(finished[0]?.redactedJson?.invocationStatus, "idle");
    assert.equal(
      Object.keys(finished[0]?.redactedJson ?? {}).some((key) => key.startsWith("firstTypingFetch")),
      false,
    );
  });
});
