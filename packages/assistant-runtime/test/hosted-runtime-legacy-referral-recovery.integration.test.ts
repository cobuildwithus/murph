import { rm } from "node:fs/promises";

import {
  listAssistantOutboxIntents,
  type AssistantNotificationInput,
} from "@murphai/assistant-engine";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "@murphai/hosted-execution";
import type {
  HostedMailboxItem,
} from "@murphai/hosted-execution/runtime-control";
import { createAssistantModelTarget } from "@murphai/operator-config/assistant-backend";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  collectHostedAssistantDeliverySideEffects,
  drainHostedPreparedAssistantDeliveries,
  prepareHostedAssistantDeliveryEffectsForDispatch,
} from "../src/hosted-runtime/callbacks.ts";
import type {
  HostedMailboxResolvedImportItem,
} from "../src/hosted-runtime/mailbox-import.ts";
import {
  createEmptyHostedMailboxImportState,
  readHostedMailboxImportState,
  writeHostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";
import type {
  HostedRuntimeEffectsPort,
} from "../src/hosted-runtime/platform.ts";
import {
  enqueueHostedSystemMailboxItem,
  prepareHostedSystemMailboxItemForCheckpoint,
  restoreHostedSystemMailboxCheckpointRollbackState,
  type HostedSystemMailboxRuntime,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  readHostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  createHostedRuntimeArtifactStoreStub,
  createHostedRuntimeEffectsPortStub,
  createHostedRuntimeResolvedConfig,
  createHostedRuntimeWorkspace,
} from "./hosted-runtime-test-helpers.ts";

const boundaries = vi.hoisted(() => ({
  exactText: "Your referral reward is already applied.",
  lifecycle: [] as string[],
  notificationInputs: [] as AssistantNotificationInput[],
  prepareHostedWakeContext: vi.fn(),
  resolveDefaults: vi.fn(),
}));

vi.mock("../src/hosted-runtime/context.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/hosted-runtime/context.ts")
  >();
  return {
    ...actual,
    prepareHostedWakeContext: boundaries.prepareHostedWakeContext,
  };
});

vi.mock("@murphai/operator-config/operator-config", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@murphai/operator-config/operator-config")
  >();
  return {
    ...actual,
    resolveAssistantOperatorDefaults: boundaries.resolveDefaults,
  };
});

vi.mock("@murphai/assistant-engine", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-engine")>(
    "@murphai/assistant-engine",
  );
  return {
    ...actual,
    async sendAssistantNotification(input: AssistantNotificationInput) {
      boundaries.lifecycle.push("assistant-engine");
      boundaries.notificationInputs.push(input);
      return await actual.sendAssistantNotificationLocal({
        ...input,
        // Keep the legacy wake shape at the runtime boundary while making the
        // engine turn deterministic. This still crosses the production
        // translator, conversation policy, audience guard, outbox, and hosted
        // provider-entry paths without invoking a model in the test.
        responsePolicy: {
          kind: "require_send_exact_text",
          text: boundaries.exactText,
        },
      });
    },
  };
});

const FIXED_NOW = "2026-08-10T20:00:00.000Z";
const MEMBER_ID = "member_legacy_referral";
const cleanupRoots: string[] = [];
const modelTarget = createAssistantModelTarget({
  approvalPolicy: "never",
  model: "gpt-5.6-terra",
  modelProvider: "vercel-ai-gateway",
  provider: "codex-cli",
  reasoningEffort: "medium",
  sandbox: "danger-full-access",
});

if (!modelTarget) {
  throw new Error("Expected a test assistant model target.");
}

beforeEach(() => {
  vi.clearAllMocks();
  boundaries.lifecycle.length = 0;
  boundaries.notificationInputs.length = 0;
  boundaries.prepareHostedWakeContext.mockResolvedValue(null);
  boundaries.resolveDefaults.mockResolvedValue({
    backend: null,
    identityId: null,
    selfDeliveryTargets: null,
  });
});

afterEach(async () => {
  await Promise.all(
    cleanupRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("runtime-owned legacy referral recovery integration", () => {
  it.each(["warm", "restored"] as const)(
    "recovers an already-imported %s wake through the real guard and fixed-target provider entry exactly once",
    async (runtimeState) => {
      const workspace = await createHostedRuntimeWorkspace(
        "murph-legacy-referral-integration-",
      );
      cleanupRoots.push(workspace.workspaceRoot);
      const notificationKey = `usage-referral-reward:${runtimeState}`;
      const eventId = `assistant.notification.requested:${notificationKey}`;
      const mailboxItemId = `mailbox_legacy_referral_${runtimeState}`;
      const frozenTarget = `linq-frozen-${runtimeState}`;
      const forbiddenFallbackTarget = `linq-current-home-${runtimeState}`;
      const authority = {
        channel: "linq" as const,
        containerMemberId: MEMBER_ID,
        threadId: frozenTarget,
      };
      const wake = createLegacyReferralWake({
        eventId,
        notificationKey,
        target: frozenTarget,
      });
      await persistAlreadyImportedWake({
        eventId,
        mailboxItemId,
        runtimeState,
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const assertExternalThreadRouteAuthority = vi.fn<
        NonNullable<
          HostedRuntimeEffectsPort["assertExternalThreadRouteAuthority"]
        >
      >(async (candidate) => {
        boundaries.lifecycle.push("live-route-authority");
        expect(candidate).toEqual(authority);
      });
      const assertLinqRecentInboundEngagement = vi.fn<
        NonNullable<
          HostedRuntimeEffectsPort["assertLinqRecentInboundEngagement"]
        >
      >(async (request) => {
        boundaries.lifecycle.push("linq-provider-entry-authority");
        expect(request).toMatchObject({
          authorityCheckOnly: false,
          homeRouteFallbackAllowed: false,
          idempotencyKey: notificationKey,
          target: frozenTarget,
          targetKind: "explicit",
        });
        return { providerDispatchClaimed: true };
      });
      const recordLinqDeliveryOutcome = vi.fn(async () => undefined);
      const effectsPort = createHostedRuntimeEffectsPortStub({
        assertExternalThreadRouteAuthority,
        assertLinqRecentInboundEngagement,
        recordLinqDeliveryOutcome,
      });
      const runtime = createRuntime(effectsPort);

      expect(
        (await readHostedMailboxImportState({
          vaultRoot: workspace.vaultRoot,
        })).watermarks.system,
      ).toBe("7");

      await expect(prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: {
          hosted: {
            defaultTarget: modelTarget,
            memberId: MEMBER_ID,
            userEnvKeys: [],
          },
        },
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      })).resolves.toMatchObject({
        itemId: mailboxItemId,
        metrics: {
          deliveryIntentIds: [expect.any(String)],
          mailboxLane: "assistant-notification",
        },
        status: "processed",
      });

      expect(boundaries.lifecycle).toEqual([
        "live-route-authority",
        "assistant-engine",
      ]);
      expect(assertExternalThreadRouteAuthority)
        .toHaveBeenCalledExactlyOnceWith(authority, { signal: null });
      expect(boundaries.notificationInputs).toHaveLength(1);
      expect(boundaries.notificationInputs[0]).toMatchObject({
        bindingDeliveryTarget: frozenTarget,
        channel: "linq",
        deliveryDedupeToken: notificationKey,
        deliveryDispatchMode: "queue-only",
        deliveryIdempotencyKey: notificationKey,
        deliveryKind: null,
        deliveryTarget: frozenTarget,
        outboxExternalThreadRouteAuthority: authority,
        responsePolicy: { kind: "require_send" },
        threadIsDirect: true,
      });
      expect((await readHostedSystemMailboxState(workspace.vaultRoot)).pending)
        .toEqual([]);
      expect(
        (await readHostedMailboxImportState({
          vaultRoot: workspace.vaultRoot,
        })).watermarks.system,
      ).toBe("7");

      const intents = await listAssistantOutboxIntents(workspace.vaultRoot);
      expect(intents).toHaveLength(1);
      const intent = intents[0]!;
      expect(intent).toMatchObject({
        channel: "linq",
        deliveryIdempotencyKey: notificationKey,
        deliveryTransportIdempotent: true,
        explicitTarget: frozenTarget,
        externalThreadRouteAuthority: authority,
        message: boundaries.exactText,
        status: "pending",
        threadIsDirect: true,
      });

      const effects = await collectHostedAssistantDeliverySideEffects({
        includeBackgroundDueIntents: true,
        preferredIntentIds: [intent.intentId],
        vaultRoot: workspace.vaultRoot,
      });
      expect(effects).toHaveLength(1);
      const preparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
        assistantDeliveryEffects: effects,
        now: () => FIXED_NOW,
        vaultRoot: workspace.vaultRoot,
      });
      expect(preparation.preparedDispatches).toHaveLength(1);

      const providerRequests: Array<{
        body: string | null;
        method: string | null;
        url: string;
      }> = [];
      const providerFetch = vi.fn<typeof fetch>(async (request, init) => {
        providerRequests.push({
          body: typeof init?.body === "string" ? init.body : null,
          method: init?.method ?? null,
          url: String(request),
        });
        return Response.json({
          message: {
            id: `linq-message-${runtimeState}`,
          },
        });
      });

      await expect(drainHostedPreparedAssistantDeliveries({
        allowPreparedSending: true,
        assistantDeliveryEffects: effects,
        effectsPort,
        forwardedEnv: {
          LINQ_API_BASE_URL: "https://linq.example.test/api/partner/v3",
          LINQ_API_TOKEN: "linq-token",
        },
        platformEnv: {},
        preparedDispatches: preparation.preparedDispatches,
        providerFetch,
        vaultRoot: workspace.vaultRoot,
        wake,
      })).resolves.toEqual([
        expect.objectContaining({
          deliveryStatus: "sent",
          providerMessageId: `linq-message-${runtimeState}`,
        }),
      ]);

      expect(assertLinqRecentInboundEngagement).toHaveBeenCalledTimes(1);
      expect(providerRequests).toEqual([
        expect.objectContaining({
          method: "POST",
          url:
            `https://linq.example.test/api/partner/v3/chats/${frozenTarget}/messages`,
        }),
      ]);
      expect(providerRequests[0]?.body).toContain(boundaries.exactText);
      expect(JSON.stringify({
        lifecycle: boundaries.lifecycle,
        notificationInputs: boundaries.notificationInputs,
        providerRequests,
      })).not.toContain(forbiddenFallbackTarget);
      expect(boundaries.lifecycle).toEqual([
        "live-route-authority",
        "assistant-engine",
        "linq-provider-entry-authority",
      ]);
      expect(recordLinqDeliveryOutcome).toHaveBeenCalledTimes(1);
      await expect(listAssistantOutboxIntents(workspace.vaultRoot)).resolves
        .toEqual([
          expect.objectContaining({
            delivery: expect.objectContaining({
              providerMessageId: `linq-message-${runtimeState}`,
              target: frozenTarget,
            }),
            intentId: intent.intentId,
            status: "sent",
          }),
        ]);

      await expect(prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: {
          hosted: {
            defaultTarget: modelTarget,
            memberId: MEMBER_ID,
            userEnvKeys: [],
          },
        },
        now: () => "2026-08-10T20:01:00.000Z",
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      })).resolves.toBeNull();
      await expect(collectHostedAssistantDeliverySideEffects({
        includeBackgroundDueIntents: true,
        preferredIntentIds: [intent.intentId],
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual([]);
      expect(assertExternalThreadRouteAuthority).toHaveBeenCalledTimes(1);
      expect(assertLinqRecentInboundEngagement).toHaveBeenCalledTimes(1);
      expect(providerFetch).toHaveBeenCalledTimes(1);
    },
  );
});

function createLegacyReferralWake(input: {
  eventId: string;
  notificationKey: string;
  target: string;
}) {
  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: input.eventId,
    memberId: MEMBER_ID,
    notification: {
      deliveryDedupeToken: input.notificationKey,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: input.notificationKey,
      instructions: "Celebrate the completed referral reward.",
      responsePolicy: { kind: "require_send" },
      route: {
        actorId: "linq-participant",
        channel: "linq",
        delivery: {
          kind: "explicit",
          target: input.target,
        },
        identityId: "direct-identity",
        threadId: "direct-thread",
        threadIsDirect: true,
      },
    },
    occurredAt: FIXED_NOW,
  });
}

async function persistAlreadyImportedWake(input: {
  eventId: string;
  mailboxItemId: string;
  runtimeState: "restored" | "warm";
  vaultRoot: string;
  wake: ReturnType<typeof createLegacyReferralWake>;
}): Promise<void> {
  if (input.runtimeState === "warm") {
    await enqueueHostedSystemMailboxItem({
      item: createResolvedNotificationItem({
        dedupeKey: input.eventId,
        id: input.mailboxItemId,
      }),
      vaultRoot: input.vaultRoot,
      wake: input.wake,
    });
  } else {
    await restoreHostedSystemMailboxCheckpointRollbackState({
      state: {
        pending: [
          {
            attemptCount: 0,
            itemId: input.mailboxItemId,
            lastAttemptAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            mailboxDedupeKey: input.eventId,
            mailboxLaneSeq: "7",
            nextAttemptAt: null,
            occurredAt: input.wake.occurredAt,
            postCheckpointRecord: null,
            preferenceCausalSeq: null,
            requestId: null,
            routeAction: "dispatch-assistant-notification",
            status: "pending",
            wake: input.wake,
          },
        ],
      },
      vaultRoot: input.vaultRoot,
    });
  }

  await writeHostedMailboxImportState({
    state: {
      ...createEmptyHostedMailboxImportState(),
      watermarks: {
        conversation: "0",
        system: "7",
      },
    },
    vaultRoot: input.vaultRoot,
  });
}

function createResolvedNotificationItem(input: {
  dedupeKey: string;
  id: string;
}): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: input.dedupeKey,
    expiresAt: null,
    id: input.id,
    kind: "assistant.notification.requested",
    lane: "system",
    laneSeq: "7",
    occurredAt: FIXED_NOW,
    payloadBytes: 64,
    payloadInlineCiphertext: "ciphertext",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: FIXED_NOW,
    userId: MEMBER_ID,
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
      action: "dispatch-assistant-notification",
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

function createRuntime(
  effectsPort: HostedRuntimeEffectsPort,
): HostedSystemMailboxRuntime {
  return {
    commitTimeoutMs: null,
    forwardedEnv: {},
    platform: {
      artifactStore: createHostedRuntimeArtifactStoreStub().artifactStore,
      effectsPort,
    },
    platformEnv: {},
    resolvedConfig: createHostedRuntimeResolvedConfig(),
    userEnv: {},
  };
}
