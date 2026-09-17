import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildHostedExecutionDeviceSyncWake } from "@murphai/hosted-execution";
import { resolveAssistantStatePaths } from "@murphai/runtime-state/node";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  prepareHostedSystemMailboxItemForCheckpoint,
  type HostedSystemMailboxRuntime,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  readHostedSystemMailboxState,
  updateHostedSystemMailboxState,
  resolveHostedSystemMailboxNextWakeCandidate,
  type HostedSystemMailboxPendingItem,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  createHostedRuntimeResolvedConfig,
  createHostedRuntimeWorkspace,
} from "./hosted-runtime-test-helpers.ts";

import { createEmptyHostedMailboxImportState, writeHostedMailboxImportState } from "../src/hosted-runtime/mailbox-state.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    writeFile: vi.fn(actual.writeFile),
  };
});

const tempRoots: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe("empty system-mailbox preparation", () => {
  it("leaves deferred device work untouched when a premature wake arrives", async () => {
    const workspace = await createHostedRuntimeWorkspace("deferred-device-mailbox-");
    tempRoots.push(workspace.workspaceRoot);
    const now = "2026-04-27T12:00:00.000Z";
    const retryAt = "2026-04-28T12:00:00.000Z";
    const wake = buildHostedExecutionDeviceSyncWake({
      connectionId: "synthetic_connection", eventId: "device-sync.wake:retained",
      expectedConnectedAt: now, occurredAt: now, provider: "junction",
      reason: "reconcile_due", userId: "synthetic_member",
      hint: { jobs: [{ kind: "resource", dedupeKey: "synthetic_job", availableAt: retryAt }] },
    });
    const retained: HostedSystemMailboxPendingItem = {
      itemId: "retained", mailboxDedupeKey: wake.eventId, mailboxLaneSeq: "1",
      attemptCount: 1, deviceSyncContinuationOwner: true, lastAttemptAt: now,
      lastErrorCode: null, lastErrorMessage: null, nextAttemptAt: retryAt,
      occurredAt: now, postCheckpointRecord: null, preferenceCausalSeq: null, requestId: null,
      routeAction: "run-device-sync-wake", status: "pending", wake,
    };
    const { deviceSyncContinuationOwner: _owner, ...base } = retained;
    const dirty: HostedSystemMailboxPendingItem = {
      ...base, itemId: "dirty", mailboxDedupeKey: "device-sync.wake:dirty", mailboxLaneSeq: "2",
      attemptCount: 0, lastAttemptAt: null,
      wake: { ...wake, eventId: "device-sync.wake:dirty", reason: "webhook_hint",
        hint: { reason: "webhook_dirty_transition" } },
    };
    const state = { pending: [retained, dirty] };
    await writeHostedMailboxImportState({ vaultRoot: workspace.vaultRoot, state: {
      ...createEmptyHostedMailboxImportState(), watermarks: { conversation: "0", system: "2" },
    } });
    await updateHostedSystemMailboxState(workspace.vaultRoot, () => state);
    for (let pass = 0; pass < 3; pass += 1) {
      await expect(prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["run-device-sync-wake"], allowedWakeKinds: ["device-sync.wake"],
        now: () => now, runtime: createRuntime(), runtimeEnv: {}, vaultRoot: workspace.vaultRoot,
      })).resolves.toBeNull();
      await expect(resolveHostedSystemMailboxNextWakeCandidate({
        now: () => now, vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({ at: retryAt, executionClass: null, reason: "device-sync.reconcile" });
      expect(await readHostedSystemMailboxState(workspace.vaultRoot)).toEqual(state);
    }
  });

  it.each([false, true])(
    "does not write unchanged empty mailbox state (persisted=%s)",
    async (persisted) => {
      const workspace = await createHostedRuntimeWorkspace("system-mailbox-empty-");
      tempRoots.push(workspace.workspaceRoot);
      const statePath = path.join(
        resolveAssistantStatePaths(workspace.vaultRoot).assistantStateRoot,
        "hosted-system-mailbox.json",
      );
      if (persisted) {
        await updateHostedSystemMailboxState(workspace.vaultRoot, () => ({ pending: [] }));
      }
      const before = persisted ? await readFile(statePath, "utf8") : null;
      vi.mocked(writeFile).mockClear();
      vi.mocked(rename).mockClear();

      for (let pass = 0; pass < 3; pass += 1) {
        await expect(prepareHostedSystemMailboxItemForCheckpoint({
          allowedRouteActions: ["apply-runtime-control-request", "continue-assistant-ask"],
          allowedWakeKinds: ["runtime.pending-effects-reconcile-requested", "assistant.ask.completed"],
          runtime: createRuntime(),
          runtimeEnv: {},
          vaultRoot: workspace.vaultRoot,
        })).resolves.toBeNull();
      }

      expect(vi.mocked(writeFile).mock.calls.filter(([file]) =>
        String(file) === statePath || String(file).startsWith(`${statePath}.`),
      )).toHaveLength(0);
      expect(vi.mocked(rename).mock.calls.filter(([, target]) => target === statePath))
        .toHaveLength(0);
      expect(await readHostedSystemMailboxState(workspace.vaultRoot)).toEqual({ pending: [] });
      if (persisted) {
        expect(await readFile(statePath, "utf8")).toBe(before);
      } else {
        await expect(access(statePath)).rejects.toMatchObject({ code: "ENOENT" });
      }
    },
  );
});

function createRuntime(): HostedSystemMailboxRuntime {
  return {
    commitTimeoutMs: null,
    forwardedEnv: {},
    platform: {
      artifactStore: {
        async get() { throw new Error("Empty mailbox must not read artifacts."); },
        async put() { throw new Error("Empty mailbox must not write artifacts."); },
      },
      effectsPort: {
        async readRawEmailMessage() { throw new Error("Empty mailbox must not read provider data."); },
        async sendEmail() { throw new Error("Empty mailbox must not send a message."); },
      },
    },
    platformEnv: {},
    resolvedConfig: createHostedRuntimeResolvedConfig(),
    userEnv: {},
  };
}
