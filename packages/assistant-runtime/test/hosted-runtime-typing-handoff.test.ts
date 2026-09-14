import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault } from "@murphai/core";
import { test, vi } from "vitest";
import {
  TEST_NOW, TEST_USER_ID, createMailboxItem, createMailboxPort, createPlatform,
  createSnapshotFixtureRef, createWorkspacePort, createWorkspaceRuntimeJobInput,
  createWorkspaceState, removeTempRoot, runHostedWorkspaceRuntimeJobInProcess,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import { normalizeHostedAssistantRuntimeConfig } from "../src/hosted-runtime/environment.ts";
import { createHostedWorkspaceBridgeMailboxImporter } from "../src/hosted-runtime/snapshot-bridge-mailbox.ts";
import { createHostedAssistantChannelTypingDependencies } from "../src/hosted-runtime/channel-activity.ts";
import type { HostedAssistantLinqDeliveryContext } from "../src/hosted-runtime/linq-delivery-context.ts";

const mocks = vi.hoisted(() => ({
  cancel: null as (() => void) | null,
  importedFetch: undefined as typeof fetch | null | undefined,
  start: vi.fn(),
  stop: vi.fn(async () => undefined),
}));
const route: HostedAssistantLinqDeliveryContext = {
  directRecipientPhoneNumber: null, fromPhoneNumber: null,
  replyToMessageId: "synthetic_message", routeAuthority: null,
  service: "iMessage", target: "synthetic_chat", threadIsDirect: true,
};
vi.mock("@murphai/assistant-engine/assistant-channel-adapters", async (importOriginal) => ({
  ...await importOriginal<typeof import("@murphai/assistant-engine/assistant-channel-adapters")>(),
  startLinqTypingIndicator: mocks.start,
}));
vi.mock("../src/hosted-runtime/mailbox-conversation-import.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hosted-runtime/mailbox-conversation-import.ts")>();
  const { startHostedLinqAttachmentTyping } = await import("../src/hosted-runtime/channel-activity.ts");
  return {
    ...actual,
    createHostedConversationMailboxImportItem: (
      input: Parameters<typeof actual.createHostedConversationMailboxImportItem>[0],
    ) => async () => {
      mocks.importedFetch = input.runtime.platform.providerFetch;
      mocks.cancel = startHostedLinqAttachmentTyping({
        forwardedEnv: input.runtime.forwardedEnv, userEnv: input.runtime.userEnv,
        providerFetch: input.runtime.platform.providerFetch, linqDeliveryContext: route,
      });
      return { status: "imported" as const };
    },
  };
});

test.each([
  { abortAfterHandoff: false, providerAvailable: true },
  { abortAfterHandoff: true, providerAvailable: true },
  { abortAfterHandoff: false, providerAvailable: false },
])("runtime bridge preserves typing handoff and provider authority ($providerAvailable, abort: $abortAfterHandoff)", async ({ abortAfterHandoff, providerAvailable }) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-typing-handoff-"));
  const events: string[] = [];
  const originalFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  const platform = {
    ...createPlatform({
      mailboxPort: createMailboxPort({ events, items: [createMailboxItem({ laneSeq: "1" })] }),
      workspacePort: createWorkspacePort({ checkpointRequests: [], events, workspace: createWorkspaceState({ version: "0" }) }),
    }),
    providerFetch: providerAvailable ? originalFetch : null,
  };
  const job = createWorkspaceRuntimeJobInput({
    request: { attemptId: "synthetic_typing_handoff", userId: TEST_USER_ID, workspaceVersion: "0", idleCheckpointDelayMs: 1 },
  });
  const importer = createHostedWorkspaceBridgeMailboxImporter({
    decodeMailboxPayload: { async decode() { throw new Error("Synthetic import handles no payload."); } },
    runtime: normalizeHostedAssistantRuntimeConfig(job.runtime, { ...platform, providerFetch: originalFetch }), vaultRoot,
  });
  const abort = new AbortController();
  let guardedFetch: typeof fetch | undefined;
  let checked = false;
  mocks.start.mockResolvedValue({ acceptedAt: TEST_NOW, isActive: () => true, stop: mocks.stop });
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    const running = runHostedWorkspaceRuntimeJobInProcess(job, {
      platform, signal: abort.signal, vaultRoot, importItem: importer,
      async createCheckpointSnapshot() {
        return { snapshotRef: createSnapshotFixtureRef({ hash: "a".repeat(64), size: 512 }) };
      },
      async runAssistantPhase(input) {
        if (checked) return { progressed: false };
        checked = true;
        guardedFetch = input.runtime.platform.providerFetch ?? undefined;
        if (!providerAvailable) {
          assert.equal(guardedFetch, undefined);
          assert.equal(mocks.importedFetch, null, "missing invocation authority must override the bridge's provider");
          assert.equal(mocks.start.mock.calls.length, 0);
          return { progressed: false };
        }
        assert.ok(guardedFetch);
        assert.notEqual(guardedFetch, originalFetch);
        const typing = createHostedAssistantChannelTypingDependencies({
          forwardedEnv: input.runtime.forwardedEnv, userEnv: input.runtime.userEnv,
          providerFetch: guardedFetch, linqDeliveryContexts: [route],
        });
        const handle = await typing.startLinqTyping?.({ target: route.target! });
        assert.ok(handle, "attachment typing must hand off to the foreground turn");
        assert.equal(mocks.importedFetch, guardedFetch);
        assert.equal(mocks.start.mock.calls.length, 1, "handoff must reuse the provider session");
        await handle.stop({ providerStop: false });
        const next = await typing.startLinqTyping?.({ target: route.target! });
        assert.ok(next, "the next reply must not inherit a stale typing cooldown");
        assert.equal(mocks.start.mock.calls.length, 2);
        await next.stop();
        if (abortAfterHandoff) {
          abort.abort(new Error("Synthetic invocation ended."));
          await assert.rejects(guardedFetch("https://provider.invalid/typing"));
        }
        return { progressed: false };
      },
    });
    if (abortAfterHandoff) await assert.rejects(running, /Synthetic invocation ended/);
    else await running;
    assert.equal(checked, true);
    assert.equal(originalFetch.mock.calls.length, 0, "aborted provider authority stays closed");
  } finally {
    mocks.cancel?.();
    mocks.start.mockReset();
    mocks.stop.mockClear();
    await removeTempRoot(vaultRoot);
  }
});
