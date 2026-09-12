import { cp } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showAutomation } from "@murphai/core";
import {
  getAssistantCronStatus,
  MURPH_ONBOARDING_FOLLOWUP_AUTOMATION,
  readAssistantOnboardingState,
} from "@murphai/assistant-engine";
import { buildHostedExecutionMemberActivatedWake } from "@murphai/hosted-execution";
import type { HostedMailboxItem } from "@murphai/hosted-execution/runtime-control";
import type { HostedMailboxResolvedImportItem } from "../src/hosted-runtime/mailbox-import.ts";
import {
  enqueueHostedSystemMailboxItem,
  prepareHostedSystemMailboxItemForCheckpoint,
} from "../src/hosted-runtime/system-mailbox.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  createHostedRuntimeEffectsPortStub,
  createHostedRuntimeResolvedConfig,
  createHostedRuntimeWorkspace,
} from "./hosted-runtime-test-helpers.ts";

const writeBoundary = vi.hoisted(() => ({
  afterWrite: null as (() => Promise<void>) | null,
  count: 0,
}));
vi.mock("@murphai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@murphai/core")>();
  return {
    ...actual,
    upsertAutomation: async (input: Parameters<typeof actual.upsertAutomation>[0]) => {
      const result = await actual.upsertAutomation(input);
      if (input.slug === "finish-onboarding-followup") {
        writeBoundary.count += 1;
        const boundary = writeBoundary.afterWrite;
        writeBoundary.afterWrite = null;
        await boundary?.();
      }
      return result;
    },
  };
});
const FIXED_NOW = "2026-04-27T00:00:00.000Z";
afterEach(() => {
  writeBoundary.afterWrite = null;
  writeBoundary.count = 0;
  vi.useRealTimers();
});

describe("activation follow-up ownership", () => {
  it.each((["linq", "email"] as const).flatMap((channel) =>
    [true, false].map((preempt) => ({ channel, preempt }))
  ))(
    "preserves $channel activation enrollment (foreground preemption: $preempt)",
    async ({ channel, preempt }) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(FIXED_NOW);
      const workspace = await createHostedRuntimeWorkspace("activation-yield-");
      const restored = await createHostedRuntimeWorkspace("activation-restored-");
      let announceWrite!: () => void;
      let releaseWrite!: () => void;
      const paused = new Promise<void>((resolve) => { announceWrite = resolve; });
      const released = new Promise<void>((resolve) => { releaseWrite = resolve; });
      let foregroundArrived = false;
      let preparation: ReturnType<typeof prepareHostedSystemMailboxItemForCheckpoint> | undefined;
      const wake = buildHostedExecutionMemberActivatedWake({
        eventId: "member.activated:synthetic-setup",
        memberChannels: { email: channel === "email", linq: channel === "linq", telegram: false },
        memberId: "member_activation_synthetic",
        occurredAt: FIXED_NOW,
        onboardingFollowupRoute: {
          actorId: null,
          channel,
          delivery: { kind: "thread", target: channel === "email" ? "member@example.test" : "synthetic-chat" },
          identityId: "identity_synthetic",
          threadId: null,
          threadIsDirect: true,
        },
        signupWelcome: null,
      });
      const runtime: Parameters<typeof prepareHostedSystemMailboxItemForCheckpoint>[0]["runtime"] = {
        commitTimeoutMs: null,
        forwardedEnv: {},
        platform: {
          artifactStore: { get: async () => null, put: async () => {} },
          effectsPort: createHostedRuntimeEffectsPortStub(),
        },
        platformEnv: {},
        resolvedConfig: createHostedRuntimeResolvedConfig(),
        userEnv: {},
      };
      try {
        await enqueueHostedSystemMailboxItem({ item: createResolvedActivationItem(), wake, vaultRoot: workspace.vaultRoot });
        if (preempt) writeBoundary.afterWrite = async () => { announceWrite(); await released; };
        preparation = prepareHostedSystemMailboxItemForCheckpoint({
          now: () => FIXED_NOW,
          operatorHomeRoot: workspace.operatorHomeRoot,
          runtime,
          runtimeEnv: {},
          shouldYieldBackgroundMaintenance: () => foregroundArrived,
          vaultRoot: workspace.vaultRoot,
        });
        if (!preempt) {
          expect((await preparation)?.status).toBe("processed");
          expect((await readHostedSystemMailboxState(workspace.vaultRoot)).pending).toEqual([]);
          const automation = await showAutomation({
            slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
            vaultRoot: workspace.vaultRoot,
          });
          expect(automation).toMatchObject({
            route: { channel, threadIsDirect: true },
            schedule: { kind: "dailyLocal" },
            status: "active",
          });
          const status = await getAssistantCronStatus(workspace.vaultRoot);
          expect(Date.parse(status.nextRunAt!)).toBeGreaterThan(Date.parse(FIXED_NOW));
          expect(writeBoundary.count).toBe(2);
          return;
        }
        await Promise.race([
          paused,
          preparation.then(() => { throw new Error("Activation finished before the setup boundary."); }),
        ]);
        foregroundArrived = true;
        releaseWrite();
        expect((await preparation)?.status).toBe("preempted");
        expect(writeBoundary.count).toBe(1);
        const partial = await showAutomation({ slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug, vaultRoot: workspace.vaultRoot });
        expect(partial?.schedule.kind).toBe("at");
        expect(await readHostedSystemMailboxState(workspace.vaultRoot)).toMatchObject({
          pending: [{ status: "pending", lastErrorCode: null, wake }],
        });
        expect((await readAssistantOnboardingState(workspace.vaultRoot)).createdAt).toBe(FIXED_NOW);

        // Restore only persisted vault bytes; no process-local continuation survives.
        await cp(workspace.vaultRoot, restored.vaultRoot, { recursive: true });
        vi.setSystemTime("2026-04-27T01:00:00.000Z");
        const resumed = await prepareHostedSystemMailboxItemForCheckpoint({
          now: () => new Date().toISOString(),
          operatorHomeRoot: restored.operatorHomeRoot,
          runtime,
          runtimeEnv: {},
          shouldYieldBackgroundMaintenance: () => false,
          vaultRoot: restored.vaultRoot,
        });
        expect(resumed?.status).toBe("processed");
        expect((await readHostedSystemMailboxState(restored.vaultRoot)).pending).toEqual([]);
        const complete = await showAutomation({ slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug, vaultRoot: restored.vaultRoot });
        expect(complete).toMatchObject({
          automationId: partial?.automationId,
          activeUntil: partial?.activeUntil,
          route: partial?.route,
          schedule: { kind: "dailyLocal" },
          status: "active",
        });
        expect((await readAssistantOnboardingState(restored.vaultRoot)).createdAt).toBe(FIXED_NOW);
        const status = await getAssistantCronStatus(restored.vaultRoot);
        expect(status.nextRunAt).toBe(partial?.schedule.kind === "at" ? partial.schedule.at : null);
      } finally {
        releaseWrite();
        await preparation?.catch(() => {});
        await Promise.all([workspace.cleanup(), restored.cleanup()]);
      }
    },
  );
});

function createResolvedActivationItem(): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: "member.activated:bootstrap-before-maintenance",
    expiresAt: null,
    id: "mailbox_item_system_activation",
    kind: "member.activated",
    lane: "system",
    laneSeq: "1",
    occurredAt: FIXED_NOW,
    payloadBytes: 64,
    payloadInlineCiphertext: "ciphertext",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: FIXED_NOW,
    userId: "member_activation_synthetic",
  };

  return {
    item,
    payload: {
      payloadCiphertext: "ciphertext",
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      requestId: null,
      source: "inline",
      status: "resolved",
    },
    route: {
      action: "apply-member-activation",
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

