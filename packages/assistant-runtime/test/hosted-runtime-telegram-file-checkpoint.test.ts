import {
  createDueAssistantWorkspace,
  createPhaseInput,
  createSystemMailboxItem,
  mocks,
  runHostedWorkspaceAssistantPhase,
  runHostedWorkspaceDurableCheckpointEffects,
} from "./hosted-runtime-workspace-assistant-phase.harness.ts";

import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { initializeVault } from "@murphai/core";
import {
  createAssistantOutboxIntent,
  readAssistantOutboxIntent,
} from "@murphai/assistant-engine/assistant-outbox";
import { buildHostedExecutionRuntimeTimerWake } from "@murphai/hosted-execution";
import { buildHostedActionApprovalCycleOwnerKey, buildHostedActionApprovalOutcomeEffectId } from "@murphai/hosted-execution/action-approval";
import { HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON } from "@murphai/hosted-execution/orchestration-control";
import { createHostedRuntimeEffectsPortStub } from "./hosted-runtime-test-helpers.ts";

it.each(["approval", "retry"] as const)(
  "checkpoints the real Telegram file %s claim and prevents upload replay after cold restore",
  { timeout: 90_000 },
  async (entry) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-04T12:00:00.000Z"));
    const root = await mkdtemp(path.join(tmpdir(), "telegram-file-checkpoint-"));
    const vaultRoot = path.join(root, "vault");
    const snapshot = path.join(root, "snapshot");
    const callbacks = await vi.importActual<typeof import("../src/hosted-runtime/callbacks.ts")>(
      "../src/hosted-runtime/callbacks.ts",
    );
    try {
      await initializeVault({ vaultRoot, createdAt: new Date().toISOString() });
      const bytes = Buffer.from("%PDF-1.4\nSynthetic saved file\n%%EOF\n");
      await mkdir(path.join(vaultRoot, "documents"), { recursive: true });
      await writeFile(path.join(vaultRoot, "documents/report.pdf"), bytes);
      const approvalGeneration = "b".repeat(64);
      const approvalId = `haa_${"a".repeat(32)}`;
      const expiresAt = "2026-09-04T12:15:00.000Z";
      const cycleOwnerKey = buildHostedActionApprovalCycleOwnerKey({ approvalId, expiresAt });
      const approvalEffectId = buildHostedActionApprovalOutcomeEffectId({ approvalGeneration, approvalId, expiresAt });
      const actionApprovalPort = {
        consume: vi.fn(async () => ({ approvalGeneration, approvalId, status: "approved" as const })),
        read: vi.fn(async () => ({ approvalGeneration, approvalId, cycleOwnerKey, status: "approved" as const })),
        request: vi.fn(async () => { throw new Error("Unexpected approval request"); }),
      };
      const intent = await createAssistantOutboxIntent({
        bindingDelivery: { kind: "thread", target: "123" },
        channel: "telegram", dedupeToken: "synthetic-file", deliveryIdempotencyKey: cycleOwnerKey, deliveryTransportIdempotent: false,
        ...(entry === "approval" ? { initialState: { status: "awaiting_approval" as const, nextAttemptAt: expiresAt } } : {}),
        media: [{
          approvalGeneration: entry === "retry" ? approvalGeneration : null, approvalId: entry === "retry" ? approvalId : null, contentType: "application/pdf", filename: "report.pdf",
          kind: "vault_file", ref: "documents/report.pdf",
          sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.byteLength,
        }],
        message: "", sessionId: "session_file", threadId: "123", threadIsDirect: true,
        turnId: "turn_file", vault: vaultRoot,
      });
      let rejectUpload = entry === "retry";
      let acceptedUploads = 0;
      const providerFetch = vi.fn<typeof fetch>(async (url, init) => {
        expect(String(url)).toContain("/sendDocument");
        expect(init?.body).toBeInstanceOf(FormData);
        if (rejectUpload) {
          return new Response(JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 0.001 } }), { status: 429 });
        }
        acceptedUploads += 1;
        return new Response(JSON.stringify({ ok: true, result: { message_id: 7, chat: { id: 123 } } }));
      });
      const collect = () => callbacks.collectHostedAssistantDeliverySideEffects({
        actionApprovalPort, includeBackgroundDueIntents: true, vaultRoot,
      });
      const drain = (effects: Awaited<ReturnType<typeof collect>>) => callbacks.drainHostedPreparedAssistantDeliveries({
        actionApprovalPort, assistantDeliveryEffects: effects,
        effectsPort: createHostedRuntimeEffectsPortStub(), forwardedEnv: { TELEGRAM_BOT_TOKEN: "synthetic-token" },
        platformEnv: {}, providerFetch, vaultRoot,
        wake: buildHostedExecutionRuntimeTimerWake({
          eventId: "evt_file", occurredAt: new Date().toISOString(), triggerKind: "runtime_timer", userId: "member_synthetic_phase",
        }),
      });
      mocks.readAssistantOutboxIntent.mockImplementation(readAssistantOutboxIntent);
      // Three real definitive failures reach the 600-second outbox backoff,
      // beyond the 180-second idle checkpoint and within the approval window.
      if (entry === "retry") {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const outcomes = await drain(await collect());
          expect(outcomes).toEqual([expect.objectContaining({ deliveryStatus: "retryable", retryable: true })]);
          const retry = await readAssistantOutboxIntent(vaultRoot, intent.intentId);
          expect(retry?.status).toBe("retryable");
          if (!retry?.nextAttemptAt) throw new Error("Expected bounded retry wake");
          vi.setSystemTime(new Date(retry.nextAttemptAt));
        }
        await cp(vaultRoot, snapshot, { recursive: true });
        rejectUpload = false;
      }
      const callsBeforePhase = providerFetch.mock.calls.length;
      mocks.collectHostedAssistantDeliverySideEffects.mockImplementation(callbacks.collectHostedAssistantDeliverySideEffects);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockImplementation(callbacks.prepareHostedAssistantDeliveryEffectsForDispatch);
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementation(callbacks.drainHostedPreparedAssistantDeliveries);
      mocks.resolveHostedAssistantOutboxNextWakeAt.mockImplementation(callbacks.resolveHostedAssistantOutboxNextWakeAt);
      if (entry === "approval") {
        const item = createSystemMailboxItem();
        mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
          item: {
            ...item, routeAction: "apply-runtime-control-request",
            wake: { effectId: approvalEffectId, eventId: "evt_file_approval", kind: "runtime.pending-effects-reconcile-requested", occurredAt: new Date().toISOString(), userId: "member_synthetic_phase" },
          },
          itemId: item.itemId, status: "processed",
          metrics: { systemProgressed: true, redactedLogEntries: [] },
        });
      }
      const input = createPhaseInput({
        now: () => new Date().toISOString(), operatorHomeRoot: path.join(root, "home"), vaultRoot,
        runtimeActionApprovalPort: actionApprovalPort, runtimeForwardedEnv: { TELEGRAM_BOT_TOKEN: "synthetic-token" },
        workspace: createDueAssistantWorkspace({ nextWakeAt: new Date().toISOString(), nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON }),
      });
      input.runtime.platform.providerFetch = providerFetch;
      const phase = await runHostedWorkspaceAssistantPhase(input);
      if (entry === "approval") {
        expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith(expect.objectContaining({ preferredEffectIds: [approvalEffectId] }));
        expect(actionApprovalPort.read).toHaveBeenCalledOnce();
      }
      const postCheckpoint = await phase.afterCheckpoint?.();
      expect(providerFetch).toHaveBeenCalledTimes(callsBeforePhase);
      expect(postCheckpoint?.afterDurableCheckpoint).toBeDefined();
      const prepared = await readAssistantOutboxIntent(vaultRoot, intent.intentId);
      expect(prepared).toMatchObject({ status: "sending", deliveryTransportIdempotent: false, preparedDispatchToken: expect.any(String) });
      const recoveryWakeAt = await callbacks.resolveHostedAssistantOutboxNextWakeAt({ vaultRoot });
      expect(recoveryWakeAt).toBe(new Date(Date.now() + 2 * 60_000).toISOString());
      expect(postCheckpoint).toMatchObject({ nextWakeAt: recoveryWakeAt, nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON });
      // Publish the complete local snapshot before running the durable callback.
      await rm(snapshot, { force: true, recursive: true });
      await cp(vaultRoot, snapshot, { recursive: true });
      await runHostedWorkspaceDurableCheckpointEffects(postCheckpoint?.afterDurableCheckpoint);
      expect(acceptedUploads).toBe(1);
      expect(await readAssistantOutboxIntent(vaultRoot, intent.intentId)).toMatchObject({ status: "sent" });
      // Lose the accepted receipt and recover only the last published snapshot.
      await rm(vaultRoot, { recursive: true });
      await cp(snapshot, vaultRoot, { recursive: true });
      expect(await readAssistantOutboxIntent(vaultRoot, intent.intentId)).toMatchObject({ status: "sending" });
      expect(await drain(await collect())).toEqual([]);
      expect(providerFetch).toHaveBeenCalledTimes(callsBeforePhase + 1);
      vi.setSystemTime(new Date(recoveryWakeAt!));
      expect(await drain(await collect())).toEqual([]);
      const staleWakeAt = await callbacks.resolveHostedAssistantOutboxNextWakeAt({ vaultRoot });
      expect(staleWakeAt).toBe(new Date(Date.parse(recoveryWakeAt!) + 8 * 60_000).toISOString());
      vi.setSystemTime(new Date(staleWakeAt!));
      const recovered = await drain(await collect());
      expect(recovered).toEqual([expect.objectContaining({ deliveryStatus: "failed", deliveryErrorCode: "ASSISTANT_DELIVERY_AMBIGUOUS", retryable: false })]);
      expect(acceptedUploads).toBe(1);
      expect(providerFetch).toHaveBeenCalledTimes(callsBeforePhase + 1);
      expect(await readAssistantOutboxIntent(vaultRoot, intent.intentId)).toMatchObject({ status: "failed", lastError: { code: "ASSISTANT_DELIVERY_AMBIGUOUS" } });
    } finally {
      vi.useRealTimers();
      await rm(root, { force: true, recursive: true });
    }
  },
);
