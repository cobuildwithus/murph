import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildHostedExecutionAssistantAskCompletedWake,
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionCodexAuthRequestedWake,
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
  buildHostedExecutionMemberPreferencesUpdatedWake,
  buildHostedExecutionPendingEffectsReconcileRequestedWake,
  buildHostedExecutionProviderSetupContinuationRequestedWake,
  buildHostedExecutionRuntimeControlWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
  hostedVaultShareProjectionKindToScope,
  type HostedVaultShareActiveProjectionKindsResponse,
} from "@murphai/hosted-execution/vault-share";
import {
  VAULT_LAYOUT,
} from "@murphai/contracts";
import {
  type HostedMailboxItem,
} from "@murphai/hosted-execution/runtime-control";
import type {
  AssistantExecutionContext,
} from "@murphai/assistant-engine";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import { resolveAssistantStatePaths } from "@murphai/runtime-state/node/assistant-state-fs";
import {
  readPreferencesDocument,
  updateAssistantPreferences,
} from "@murphai/core";
import type {
  HostedRuntimeClinicalRecordsPort,
  HostedRuntimePlatform,
} from "../src/hosted-runtime/platform.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeHostedMailboxEvent: vi.fn(),
}));

vi.mock("../src/hosted-runtime/events.ts", () => ({
  executeHostedMailboxEvent: mocks.executeHostedMailboxEvent,
}));

import {
  classifyLegacyHostedUsageReferralDirectLinqAuthority,
  prepareHostedAssistantNotificationSystemMailboxWake,
  type HostedLegacyUsageReferralAuthorityClassification,
} from "../src/hosted-runtime/events/assistant-notification.ts";
import type {
  HostedMailboxResolvedImportItem,
} from "../src/hosted-runtime/mailbox-import.ts";
import {
  createEmptyHostedMailboxImportState,
  readHostedMailboxImportState,
  writeHostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";
import {
  deferHostedSystemMailboxItemAfterVaultShareProjectionFailure,
  enqueueHostedSystemMailboxItem,
  prepareHostedSystemMailboxItemForCheckpoint,
  readHostedSystemMailboxCheckpointRollbackState,
  recordHostedDeviceSyncDirtyPostCheckpointRecord,
  recordHostedSystemMailboxItemAfterCheckpoint,
  retryHostedProviderSetupContinuationItem,
  retainHostedSystemMailboxItemAfterForegroundPreemption,
  resolveHostedSystemMailboxNextWakeAt,
  restoreHostedSystemMailboxCheckpointRollbackState,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  readHostedSystemMailboxState,
  resolveHostedSystemMailboxHandledThroughSeq,
  type HostedSystemMailboxPendingItem,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  createHostedRuntimeResolvedConfig,
  createHostedRuntimeWorkspace,
} from "./hosted-runtime-test-helpers.ts";

const FIXED_NOW = "2026-04-27T00:00:00.000Z";

type HostedSystemMailboxRuntimeForTest =
  Parameters<typeof prepareHostedSystemMailboxItemForCheckpoint>[0]["runtime"];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeHostedMailboxEvent.mockResolvedValue({
    bootstrapResult: null,
    conversationMetrics: null,
    mailboxLane: "assistant-notification",
    nextWakeAt: null,
    postCheckpointRecord: null,
    redactedLogEntries: [],
  });
});

describe("hosted system mailbox notification execution context", () => {
  it("deletes staged environment audio only after the checkpoint boundary", async () => {
    const workspace = await createHostedRuntimeWorkspace(
      "murph-hosted-system-mailbox-",
    );
    const deleteEnvironmentVoice = vi.fn(async () => undefined);
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:environment-audio-cleanup",
      memberId: "member_123",
      notification: {
        instructions: "Synthetic checkpoint record.",
        route: {
          actorId: "+15550001111",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: FIXED_NOW,
    });
    const item = {
      attemptCount: 1,
      itemId: "mailbox_environment_voice_1",
      lastAttemptAt: FIXED_NOW,
      lastErrorCode: null,
      lastErrorMessage: null,
      mailboxDedupeKey: wake.eventId,
      mailboxLaneSeq: "1",
      nextAttemptAt: null,
      occurredAt: FIXED_NOW,
      postCheckpointRecord: {
        audioKey: "a".repeat(40),
        kind: "environment-voice.audio-delete" as const,
      },
      requestId: null,
      routeAction: "dispatch-assistant-notification" as const,
      status: "recording" as const,
      wake,
    } satisfies HostedSystemMailboxPendingItem;

    try {
      expect(deleteEnvironmentVoice).not.toHaveBeenCalled();
      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item,
        runtime: createRuntime({
          effectsPort: {
            deleteEnvironmentVoice,
            async readRawEmailMessage() {
              return null;
            },
            async sendEmail() {},
          },
        }),
        vaultRoot: workspace.vaultRoot,
      })).resolves.toMatchObject({
        failed: 0,
        recorded: 1,
      });
      expect(deleteEnvironmentVoice).toHaveBeenCalledWith("a".repeat(40));
    } finally {
      await workspace.cleanup();
    }
  });

  it("retains the cleanup record for retry when environment audio deletion fails", async () => {
    const workspace = await createHostedRuntimeWorkspace(
      "murph-hosted-system-mailbox-",
    );
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:environment-audio-retry",
      memberId: "member_123",
      notification: {
        instructions: "Synthetic checkpoint retry record.",
        route: {
          actorId: "+15550001111",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: FIXED_NOW,
    });
    try {
      mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "environment-voice",
        nextWakeAt: null,
        postCheckpointRecord: {
          audioKey: "b".repeat(40),
          kind: "environment-voice.audio-delete",
        },
        redactedLogEntries: [],
      });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedNotificationItem({
          dedupeKey: wake.eventId,
          id: "mailbox_environment_voice_retry",
        }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });
      const runtime = createRuntime({
        effectsPort: {
          async deleteEnvironmentVoice() {
            throw new Error("temporary delete failure");
          },
          async readRawEmailMessage() {
            return null;
          },
          async sendEmail() {},
        },
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.ok(prepared);
      assert.equal(prepared.status, "processed");
      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toMatchObject({
        failed: 1,
        recorded: 0,
      });
      const state = await readHostedSystemMailboxState(workspace.vaultRoot);
      expect(state.pending).toEqual([
        expect.objectContaining({
          itemId: "mailbox_environment_voice_retry",
          postCheckpointRecord: {
            audioKey: "b".repeat(40),
            kind: "environment-voice.audio-delete",
          },
          status: "recording",
        }),
      ]);
    } finally {
      await workspace.cleanup();
    }
  });

  it("finishes a bootstrap-only member activation during import", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId: "member.activated:bootstrap-before-maintenance",
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      memberId: "member_123",
      occurredAt: FIXED_NOW,
      timeZone: "America/New_York",
    });

    try {
      assert.deepEqual(
        await enqueueHostedSystemMailboxItem({
          item: createResolvedActivationItem(),
          vaultRoot: workspace.vaultRoot,
          wake,
        }),
        {
          reasonCode: "system_mailbox.activation_bootstrapped",
          status: "imported",
        },
      );
      await access(path.join(workspace.vaultRoot, VAULT_LAYOUT.metadata));
      expect(mocks.executeHostedMailboxEvent).not.toHaveBeenCalled();
      expect(await readHostedSystemMailboxState(workspace.vaultRoot)).toEqual({
        pending: [],
      });
    } finally {
      await workspace.cleanup();
    }
  });

  it("queues member activation when a welcome still needs delivery", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId: "member.activated:signup-welcome",
      memberChannels: {
        email: false,
        linq: false,
        telegram: true,
      },
      memberId: "member_123",
      occurredAt: FIXED_NOW,
      signupWelcome: {
        route: {
          actorId: null,
          channel: "telegram",
          delivery: {
            kind: "explicit",
            target: "12345",
          },
          identityId: "hbidx:telegram:v1:test",
          threadId: null,
          threadIsDirect: true,
        },
        text: "Welcome to Murph.",
      },
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedActivationItem(),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      expect(await readHostedSystemMailboxState(workspace.vaultRoot))
        .toMatchObject({
          pending: [
            {
              routeAction: "apply-member-activation",
              wake: {
                kind: "member.activated",
                signupWelcome: expect.any(Object),
              },
            },
          ],
        });
    } finally {
      await workspace.cleanup();
    }
  });

  it("routes prepared group room setup through required initialization", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId: "member.activated:prepared-group-room-model",
      initialGroupRoomModelMarkdown:
        "## Explicit setup\n\nKeep this room low-key.",
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      memberId: "member_group_runtime",
      occurredAt: FIXED_NOW,
      signupWelcome: null,
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedActivationItem(),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      expect(await readHostedSystemMailboxState(workspace.vaultRoot))
        .toMatchObject({
          pending: [
            {
              routeAction: "initialize-group-room-model",
              wake: {
                kind: "member.activated",
              },
            },
          ],
        });
    } finally {
      await workspace.cleanup();
    }
  });

  it("keeps hosted member context on queued notification wakes", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:member-context",
      memberId: "member_123",
      notification: {
        instructions: "Send the prepared account update.",
        route: {
          actorId: "+15550001111",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: FIXED_NOW,
    });
    const executionContext: AssistantExecutionContext = {
      hosted: {
        memberId: "member_123",
        userEnvKeys: [],
      },
    };
    const groupRequest = vi.fn();

    try {
      assert.deepEqual(
        await enqueueHostedSystemMailboxItem({
          item: createResolvedNotificationItem(),
          vaultRoot: workspace.vaultRoot,
          wake,
        }),
        {
          reasonCode: "system_mailbox.queued",
          status: "imported",
        },
      );

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext,
        now: () => FIXED_NOW,
        runtime: createRuntime({
          groupToolPort: { request: groupRequest },
        }),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          executionContext: expect.objectContaining({
            hosted: expect.objectContaining({
              memberId: "member_123",
            }),
          }),
          forceQueueOnlyAssistantNotification: true,
          sourceMailboxItemId: "mailbox_item_system_notification",
          wake: expect.objectContaining({
            kind: "assistant.notification.requested",
          }),
        }),
      );
      expect(
        mocks.executeHostedMailboxEvent.mock.calls[0]?.[0]
          .executionContext.hosted,
      ).not.toHaveProperty("groupTool");
    } finally {
      await workspace.cleanup();
    }
  });

  it("selects an exact external-completion family ahead of an older generic notification", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const genericDedupeKey =
      "assistant.notification.requested:generic:older-notification";
    const referralDedupeKey =
      "assistant.notification.requested:usage-referral-reward:referral_123";
    const buildWake = (eventId: string, occurredAt: string) =>
      buildHostedExecutionAssistantNotificationRequestedWake({
        eventId,
        memberId: "member_123",
        notification: {
          deliveryDedupeToken: eventId,
          deliveryIdempotencyKey: eventId,
          instructions: "Send the prepared completion.",
          responsePolicy: {
            kind: "require_send_exact_text",
            text: "Mission complete.",
          },
          route: {
            actorId: null,
            channel: "linq",
            delivery: {
              kind: "thread",
              target: "linq_source_thread",
            },
            identityId: "hbidx:phone:v1:test",
            threadId: "linq_source_thread",
            threadIsDirect: false,
          },
        },
        occurredAt,
      });

    try {
      const genericOccurredAt = "2026-04-26T23:59:00.000Z";
      for (const entry of [
        {
          dedupeKey: genericDedupeKey,
          id: "mailbox_item_generic_notification",
          laneSeq: "1",
          occurredAt: genericOccurredAt,
        },
        {
          dedupeKey: referralDedupeKey,
          id: "mailbox_item_referral_completion",
          laneSeq: "2",
          occurredAt: FIXED_NOW,
        },
      ]) {
        expect((await enqueueHostedSystemMailboxItem({
          item: createResolvedNotificationItem(entry),
          vaultRoot: workspace.vaultRoot,
          wake: buildWake(entry.dedupeKey, entry.occurredAt),
        })).status).toBe("imported");
      }

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedMailboxDedupeKeyPrefixes: [
          "assistant.notification.requested:phone-call-result:",
          "assistant.notification.requested:usage-referral-reward:",
        ],
        allowedRouteActions: ["dispatch-assistant-notification"],
        allowedWakeKinds: ["assistant.notification.requested"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      expect(prepared).toEqual(expect.objectContaining({
        item: expect.objectContaining({
          itemId: "mailbox_item_referral_completion",
          mailboxDedupeKey: referralDedupeKey,
        }),
        status: "processed",
      }));
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledTimes(1);
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          forceQueueOnlyAssistantNotification: true,
          sourceMailboxItemId: "mailbox_item_referral_completion",
          wake: expect.objectContaining({
            eventId: referralDedupeKey,
            kind: "assistant.notification.requested",
          }),
        }),
      );
      expect((await readHostedSystemMailboxState(workspace.vaultRoot)).pending)
        .toEqual(expect.arrayContaining([
          expect.objectContaining({
            itemId: "mailbox_item_generic_notification",
            status: "pending",
          }),
        ]));
    } finally {
      await workspace.cleanup();
    }
  });

  const legacyUsageReferralLookalikes: Array<{
    contextMemberId?: string;
    expectedClassification: Exclude<
      HostedLegacyUsageReferralAuthorityClassification,
      "eligible"
    >;
    label: string;
    mailboxDedupeKey?: string;
    mutate: (
      wake: ReturnType<typeof createLegacyUsageReferralNotificationWake>,
    ) => void;
  }> = [
    {
      expectedClassification: "identity_mismatch",
      label: "mismatched referral identity",
      mutate(wake) {
        wake.notification.deliveryDedupeToken =
          "usage-referral-reward:different-referral";
      },
    },
    {
      expectedClassification: "identity_mismatch",
      label: "mismatched mailbox identity",
      mailboxDedupeKey:
        "assistant.notification.requested:usage-referral-reward:other",
      mutate() {},
    },
    {
      expectedClassification: "route_mismatch",
      label: "wrong channel",
      mutate(wake) {
        wake.notification.route.channel = "telegram";
      },
    },
    {
      expectedClassification: "route_mismatch",
      label: "non-direct route",
      mutate(wake) {
        wake.notification.route.threadIsDirect = false;
      },
    },
    {
      expectedClassification: "route_mismatch",
      label: "non-explicit delivery",
      mutate(wake) {
        wake.notification.route.delivery.kind = "thread";
      },
    },
    {
      contextMemberId: "different-runtime-member",
      expectedClassification: "member_mismatch",
      label: "wrong runtime member",
      mutate() {},
    },
    {
      expectedClassification: "not_usage_referral",
      label: "non-referral notification key",
      mutate(wake) {
        wake.notification.deliveryDedupeToken =
          "phone-call-result:not-a-referral";
      },
    },
    {
      expectedClassification: "policy_mismatch",
      label: "unsupported delivery policy",
      mutate(wake) {
        wake.notification.deliveryDispatchMode = "immediate";
      },
    },
  ];

  it.each(legacyUsageReferralLookalikes)(
    "does not recover a legacy referral lookalike with $label",
    async ({
      contextMemberId = "member_123",
      expectedClassification,
      mailboxDedupeKey,
      mutate,
    }) => {
      const notificationKey = "usage-referral-reward:lookalike";
      const eventId = `assistant.notification.requested:${notificationKey}`;
      const wake = createLegacyUsageReferralNotificationWake({
        eventId,
        memberId: "member_123",
        notificationKey,
        target: "linq-frozen-lookalike",
      });
      mutate(wake);
      const assertExternalThreadRouteAuthority = vi.fn(async () => undefined);
      const executionContext: AssistantExecutionContext = {
        hosted: {
          memberId: contextMemberId,
          userEnvKeys: [],
        },
      };
      const resolvedMailboxDedupeKey = mailboxDedupeKey ?? eventId;

      expect(classifyLegacyHostedUsageReferralDirectLinqAuthority({
        executionContext,
        mailboxDedupeKey: resolvedMailboxDedupeKey,
        wake,
      })).toBe(expectedClassification);

      await expect(prepareHostedAssistantNotificationSystemMailboxWake({
        assertExternalThreadRouteAuthority,
        executionContext,
        mailboxDedupeKey: resolvedMailboxDedupeKey,
        signal: null,
        wake,
      })).resolves.toEqual({
        kind: "execute",
        wake,
      });
      expect(assertExternalThreadRouteAuthority).not.toHaveBeenCalled();
    },
  );

  it.each(["warm", "restored"] as const)(
    "recovers an already-imported authority-less referral on a %s runtime",
    async (runtimeState) => {
      const workspace = await createHostedRuntimeWorkspace(
        "murph-hosted-system-mailbox-referral-recovery-",
      );
      const memberId = "member_123";
      const notificationKey = `usage-referral-reward:${runtimeState}`;
      const eventId = `assistant.notification.requested:${notificationKey}`;
      const mailboxItemId = `mailbox_referral_${runtimeState}`;
      const target = `linq-frozen-${runtimeState}`;
      const wake = createLegacyUsageReferralNotificationWake({
        eventId,
        memberId,
        notificationKey,
        target,
      });
      const assertExternalThreadRouteAuthority = vi.fn(async () => undefined);
      const deliveredTargets: string[] = [];
      mocks.executeHostedMailboxEvent.mockImplementation(async (input) => {
        if (input.wake.kind !== "assistant.notification.requested") {
          throw new TypeError("Expected an assistant notification wake.");
        }
        deliveredTargets.push(input.wake.notification.route.delivery.target);
        expect(input.wake.notification.externalThreadRouteAuthority).toEqual({
          channel: "linq",
          containerMemberId: memberId,
          threadId: target,
        });
        return createAssistantNotificationMailboxMetrics();
      });

      try {
        await persistAlreadyImportedNotification({
          eventId,
          mailboxItemId,
          mailboxLaneSeq: "7",
          runtimeState,
          vaultRoot: workspace.vaultRoot,
          wake,
        });

        expect(
          (await readHostedMailboxImportState({
            vaultRoot: workspace.vaultRoot,
          })).watermarks.system,
        ).toBe("7");

        const runtime = createRuntimeWithExternalRouteAuthority(
          assertExternalThreadRouteAuthority,
        );
        const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
          executionContext: null,
          now: () => FIXED_NOW,
          runtime,
          runtimeEnv: {},
          vaultRoot: workspace.vaultRoot,
        });

        expect(prepared).toMatchObject({
          itemId: mailboxItemId,
          status: "processed",
        });
        expect(assertExternalThreadRouteAuthority).toHaveBeenCalledExactlyOnceWith(
          {
            channel: "linq",
            containerMemberId: memberId,
            threadId: target,
          },
          { signal: null },
        );
        expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            sourceMailboxItemId: mailboxItemId,
            wake: expect.objectContaining({
              eventId,
              notification: expect.objectContaining({
                externalThreadRouteAuthority: {
                  channel: "linq",
                  containerMemberId: memberId,
                  threadId: target,
                },
                route: expect.objectContaining({
                  delivery: {
                    kind: "explicit",
                    target,
                  },
                  threadIsDirect: true,
                }),
              }),
            }),
          }),
        );
        expect(deliveredTargets).toEqual([target]);
        expect((await readHostedSystemMailboxState(workspace.vaultRoot)).pending)
          .toEqual([]);
        expect(
          (await readHostedMailboxImportState({
            vaultRoot: workspace.vaultRoot,
          })).watermarks.system,
        ).toBe("7");

        await expect(prepareHostedSystemMailboxItemForCheckpoint({
          executionContext: null,
          now: () => "2026-04-27T00:01:00.000Z",
          runtime,
          runtimeEnv: {},
          vaultRoot: workspace.vaultRoot,
        })).resolves.toBeNull();
        expect(assertExternalThreadRouteAuthority).toHaveBeenCalledTimes(1);
        expect(deliveredTargets).toEqual([target]);
      } finally {
        await workspace.cleanup();
      }
    },
  );

  it("terminally advances a stale frozen referral target and then runs the next item", async () => {
    const workspace = await createHostedRuntimeWorkspace(
      "murph-hosted-system-mailbox-referral-stale-",
    );
    const memberId = "member_123";
    const staleNotificationKey = "usage-referral-reward:stale-frozen";
    const staleEventId =
      `assistant.notification.requested:${staleNotificationKey}`;
    const staleTarget = "linq-frozen-stale-target";
    const nextNotificationKey = "usage-referral-reward:next-authorized";
    const nextEventId = `assistant.notification.requested:${nextNotificationKey}`;
    const nextTarget = "linq-next-authorized-target";
    const staleWake = createLegacyUsageReferralNotificationWake({
      eventId: staleEventId,
      memberId,
      notificationKey: staleNotificationKey,
      target: staleTarget,
    });
    const nextWake = createLegacyUsageReferralNotificationWake({
      eventId: nextEventId,
      externalThreadRouteAuthority: {
        channel: "linq",
        containerMemberId: memberId,
        threadId: nextTarget,
      },
      memberId,
      notificationKey: nextNotificationKey,
      target: nextTarget,
    });
    const staleError = Object.assign(
      new Error("Hosted notification route is no longer authorized."),
      {
        code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
        retryable: false,
      },
    );
    const assertExternalThreadRouteAuthority = vi.fn(async () => {
      throw staleError;
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedNotificationItem({
          dedupeKey: staleEventId,
          id: "mailbox_referral_stale",
          laneSeq: "8",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: staleWake,
      });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedNotificationItem({
          dedupeKey: nextEventId,
          id: "mailbox_referral_next",
          laneSeq: "9",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: nextWake,
      });
      await writeHostedMailboxImportState({
        state: {
          ...createEmptyHostedMailboxImportState(),
          watermarks: {
            conversation: "0",
            system: "9",
          },
        },
        vaultRoot: workspace.vaultRoot,
      });
      const before = await readHostedSystemMailboxState(workspace.vaultRoot);
      expect(resolveHostedSystemMailboxHandledThroughSeq({
        importedSeq: "9",
        state: before,
      })).toBe("7");

      const runtime = createRuntimeWithExternalRouteAuthority(
        assertExternalThreadRouteAuthority,
      );
      const stale = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      expect(stale).toMatchObject({
        itemId: "mailbox_referral_stale",
        metrics: {
          deliveryIntentIds: [],
          mailboxLane: "assistant-notification",
          redactedLogEntries: [
            expect.objectContaining({
              redacted: expect.objectContaining({
                eventCode:
                  "assistant.notification.legacy_usage_referral_terminal_no_send",
                terminalDisposition: "external_route_authority_stale",
              }),
            }),
          ],
        },
        status: "processed",
      });
      expect(assertExternalThreadRouteAuthority).toHaveBeenCalledExactlyOnceWith(
        {
          channel: "linq",
          containerMemberId: memberId,
          threadId: staleTarget,
        },
        { signal: null },
      );
      expect(mocks.executeHostedMailboxEvent).not.toHaveBeenCalled();
      const afterStale = await readHostedSystemMailboxState(workspace.vaultRoot);
      expect(afterStale.pending).toEqual([
        expect.objectContaining({ itemId: "mailbox_referral_next" }),
      ]);
      expect(resolveHostedSystemMailboxHandledThroughSeq({
        importedSeq: "9",
        state: afterStale,
      })).toBe("8");

      const next = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => "2026-04-27T00:00:01.000Z",
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      expect(next).toMatchObject({
        itemId: "mailbox_referral_next",
        status: "processed",
      });
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          sourceMailboxItemId: "mailbox_referral_next",
          wake: expect.objectContaining({
            notification: expect.objectContaining({
              route: expect.objectContaining({
                delivery: {
                  kind: "explicit",
                  target: nextTarget,
                },
              }),
            }),
          }),
        }),
      );
      expect(
        JSON.stringify(mocks.executeHostedMailboxEvent.mock.calls),
      ).not.toContain(staleTarget);
      expect(assertExternalThreadRouteAuthority).toHaveBeenCalledTimes(1);
      const afterNext = await readHostedSystemMailboxState(workspace.vaultRoot);
      expect(afterNext.pending).toEqual([]);
      expect(resolveHostedSystemMailboxHandledThroughSeq({
        importedSeq: "9",
        state: afterNext,
      })).toBe("9");
    } finally {
      await workspace.cleanup();
    }
  });

  it("keeps an authority-owner outage on the normal ordered retry path", async () => {
    const workspace = await createHostedRuntimeWorkspace(
      "murph-hosted-system-mailbox-referral-retry-",
    );
    const notificationKey = "usage-referral-reward:authority-retry";
    const eventId = `assistant.notification.requested:${notificationKey}`;
    const target = "linq-frozen-retry-target";
    const wake = createLegacyUsageReferralNotificationWake({
      eventId,
      memberId: "member_123",
      notificationKey,
      target,
    });
    const assertExternalThreadRouteAuthority = vi.fn()
      .mockRejectedValueOnce(new VaultCliError(
        "ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_UNAVAILABLE",
        "Temporary authority owner failure.",
        { retryable: true },
      ))
      .mockResolvedValueOnce(undefined);

    try {
      await persistAlreadyImportedNotification({
        eventId,
        mailboxItemId: "mailbox_referral_retry",
        mailboxLaneSeq: "12",
        runtimeState: "warm",
        vaultRoot: workspace.vaultRoot,
        wake,
      });
      const runtime = createRuntimeWithExternalRouteAuthority(
        assertExternalThreadRouteAuthority,
      );

      await expect(prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      })).resolves.toMatchObject({
        attemptCount: 1,
        errorCode: "ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_UNAVAILABLE",
        itemId: "mailbox_referral_retry",
        legacyUsageReferralAuthorityClassification: "eligible",
        nextWakeAt: "2026-04-27T00:01:00.000Z",
        routeAction: "dispatch-assistant-notification",
        status: "retryable_failed",
        wakeKind: "assistant.notification.requested",
      });
      expect(mocks.executeHostedMailboxEvent).not.toHaveBeenCalled();
      expect((await readHostedSystemMailboxState(workspace.vaultRoot)).pending)
        .toEqual([
          expect.objectContaining({
            itemId: "mailbox_referral_retry",
            lastErrorCode:
              "ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_UNAVAILABLE",
            nextAttemptAt: "2026-04-27T00:01:00.000Z",
            status: "pending",
          }),
        ]);

      await expect(prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => "2026-04-27T00:00:59.999Z",
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      })).resolves.toBeNull();
      expect(assertExternalThreadRouteAuthority).toHaveBeenCalledTimes(1);

      await expect(prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => "2026-04-27T00:01:00.000Z",
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      })).resolves.toMatchObject({
        itemId: "mailbox_referral_retry",
        status: "processed",
      });
      expect(assertExternalThreadRouteAuthority).toHaveBeenCalledTimes(2);
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          wake: expect.objectContaining({
            notification: expect.objectContaining({
              externalThreadRouteAuthority: {
                channel: "linq",
                containerMemberId: "member_123",
                threadId: target,
              },
            }),
          }),
        }),
      );
      expect((await readHostedSystemMailboxState(workspace.vaultRoot)).pending)
        .toEqual([]);
    } finally {
      await workspace.cleanup();
    }
  });

  it("leaves a referral lookalike authority-less for the unchanged audience guard", async () => {
    const workspace = await createHostedRuntimeWorkspace(
      "murph-hosted-system-mailbox-referral-lookalike-",
    );
    const notificationKey = "usage-referral-reward:dedupe-mismatch";
    const eventId = `assistant.notification.requested:${notificationKey}`;
    const wake = createLegacyUsageReferralNotificationWake({
      eventId,
      memberId: "member_123",
      notificationKey,
      target: "linq-lookalike-target",
    });
    wake.notification.deliveryDedupeToken =
      "usage-referral-reward:different-referral";
    const assertExternalThreadRouteAuthority = vi.fn(async () => undefined);
    mocks.executeHostedMailboxEvent.mockImplementationOnce(async (input) => {
      if (input.wake.kind !== "assistant.notification.requested") {
        throw new TypeError("Expected an assistant notification wake.");
      }
      expect(
        input.wake.notification.externalThreadRouteAuthority,
      ).toBeUndefined();
      throw new VaultCliError(
        "ASSISTANT_AUDIENCE_UNVERIFIED",
        "Assistant target audience could not be verified.",
        { retryable: false },
      );
    });

    try {
      await persistAlreadyImportedNotification({
        eventId,
        mailboxItemId: "mailbox_referral_lookalike",
        mailboxLaneSeq: "13",
        runtimeState: "warm",
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      await expect(prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntimeWithExternalRouteAuthority(
          assertExternalThreadRouteAuthority,
        ),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      })).resolves.toMatchObject({
        errorCode: "ASSISTANT_AUDIENCE_UNVERIFIED",
        legacyUsageReferralAuthorityClassification: "identity_mismatch",
        status: "retryable_failed",
      });

      expect(assertExternalThreadRouteAuthority).not.toHaveBeenCalled();
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledTimes(1);
    } finally {
      await workspace.cleanup();
    }
  });

  it("does not rescope the group tool for a late scheduled completion", async () => {
    const workspace = await createHostedRuntimeWorkspace(
      "murph-hosted-system-mailbox-",
    );
    const wake = buildHostedExecutionAssistantAskCompletedWake({
      ask: {
        expiresAt: "2026-04-27T00:10:00.000Z",
        origin: {
          automationId: "automation_call_circle",
          kind: "automation_occurrence",
          occurrenceAt: FIXED_NOW,
        },
        question: "Which coarse call windows work over the next week?",
        requestId: "aask_req_system_internal",
        result: {
          answer: "Tuesday evening.",
          outcome: "answered",
        },
        targetLabel: null,
      },
      eventId: "aask_done_system_internal",
      memberId: "member_group_runtime",
      occurredAt: FIXED_NOW,
    });
    const groupRequest = vi.fn();

    try {
      assert.deepEqual(
        await enqueueHostedSystemMailboxItem({
          item: createResolvedAssistantAskCompletionItem(),
          vaultRoot: workspace.vaultRoot,
          wake,
        }),
        {
          reasonCode: "system_mailbox.queued",
          status: "imported",
        },
      );

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({
          groupToolPort: { request: groupRequest },
        }),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      const executionInput = mocks.executeHostedMailboxEvent.mock.calls[0]?.[0];
      expect(executionInput).toEqual(
        expect.objectContaining({
          executionContext: expect.objectContaining({
            hosted: expect.objectContaining({
              memberId: "member_group_runtime",
            }),
          }),
          sourceMailboxItemId: "mailbox_item_system_assistant_ask_completed",
          wake: expect.objectContaining({
            kind: "assistant.ask.completed",
          }),
        }),
      );
      expect(executionInput?.executionContext.hosted).not.toHaveProperty(
        "groupTool",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("prioritizes only Ask completions strictly older than pending personal input", async () => {
    const workspace = await createHostedRuntimeWorkspace(
      "murph-hosted-system-mailbox-",
    );
    const wake = buildHostedExecutionAssistantAskCompletedWake({
      ask: {
        expiresAt: "2026-04-27T00:10:00.000Z",
        origin: {
          automationId: "automation_call_circle",
          kind: "automation_occurrence",
          occurrenceAt: FIXED_NOW,
        },
        question: "Which coarse call windows work over the next week?",
        requestId: "aask_req_causal_order",
        result: {
          answer: "Tuesday evening.",
          outcome: "answered",
        },
        targetLabel: null,
      },
      eventId: "aask_done_causal_order",
      memberId: "member_group_runtime",
      occurredAt: FIXED_NOW,
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedAssistantAskCompletionItem({
          dedupeKey: wake.eventId,
          id: wake.eventId,
          occurredAt: wake.occurredAt,
        }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      for (const cutoff of [
        "2026-04-26T23:59:59.000Z",
        FIXED_NOW,
        "not-a-timestamp",
        null,
      ]) {
        const blocked = await prepareHostedSystemMailboxItemForCheckpoint({
          allowedRouteActions: ["continue-assistant-ask"],
          allowedWakeKinds: ["assistant.ask.completed"],
          assistantAskCompletionOccurredBefore: cutoff,
          now: () => "2026-04-27T00:01:00.000Z",
          runtime: createRuntime({}),
          runtimeEnv: {},
          vaultRoot: workspace.vaultRoot,
        });

        assert.equal(blocked, null);
      }
      assert.equal(mocks.executeHostedMailboxEvent.mock.calls.length, 0);
      assert.equal((await readHostedSystemMailboxState(workspace.vaultRoot)).pending[0]?.attemptCount, 0);

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["continue-assistant-ask"],
        allowedWakeKinds: ["assistant.ask.completed"],
        assistantAskCompletionOccurredBefore: "2026-04-27T00:00:01.000Z",
        now: () => "2026-04-27T00:01:00.000Z",
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledTimes(1);
    } finally {
      await workspace.cleanup();
    }
  });

  it("rollback discards only failed imported system items and preserves concurrent enqueues", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:rollback",
      memberId: "member_123",
      notification: {
        instructions: "Send the prepared account update.",
        route: {
          actorId: "+15550001111",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: FIXED_NOW,
    });

    try {
      const rollbackState = await readHostedSystemMailboxCheckpointRollbackState({
        vaultRoot: workspace.vaultRoot,
      });
      const failedImportItem = createResolvedNotificationItem({
        id: "mailbox_item_failed_import",
      });
      const concurrentItem = createResolvedNotificationItem({
        id: "mailbox_item_concurrent_import",
      });
      await enqueueHostedSystemMailboxItem({
        item: failedImportItem,
        vaultRoot: workspace.vaultRoot,
        wake,
      });
      await enqueueHostedSystemMailboxItem({
        item: concurrentItem,
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      await restoreHostedSystemMailboxCheckpointRollbackState({
        discardItemIds: [failedImportItem.item.id],
        state: rollbackState,
        vaultRoot: workspace.vaultRoot,
      });

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(prepared?.status, "processed");
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceMailboxItemId: concurrentItem.item.id,
        }),
      );
      const next = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(next, null);
    } finally {
      await workspace.cleanup();
    }
  });

  it("records device-sync dirty processed revisions only after the checkpoint boundary", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const ackDirtyStateProcessed = vi.fn(async () => ({
      connectionId: "dsc_dirty_123",
      dirtyRevision: "12",
      nextWakeAt: null,
      processedRevision: "12",
      recorded: true,
      stillDirty: false,
      userId: "member_123",
    }));
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:dirty-ack",
      memberId: "member_123",
      notification: {
        instructions: "Process the dirty ack.",
        route: {
          actorId: "+15550001111",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: FIXED_NOW,
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "device-sync",
      nextWakeAt: null,
      postCheckpointRecord: {
        connectionId: "dsc_dirty_123",
        kind: "device-sync.dirty-processed",
        nextWakeAt: null,
        processedDirtyPayloadIds: ["dsp_payload_1"],
        processedRevision: "12",
      },
      redactedLogEntries: [],
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedNotificationItem({
          id: "mailbox_item_system_dirty_ack",
        }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const runtime = createRuntime({
        deviceSyncPort: {
          async applyUpdates() {
            throw new Error("applyUpdates should not be called");
          },
          ackDirtyStateProcessed,
          async createConnectLink() {
            throw new Error("createConnectLink should not be called");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            throw new Error("fetchSnapshot should not be called");
          },
        },
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      expect(ackDirtyStateProcessed).not.toHaveBeenCalled();
      assert.ok(prepared?.item.postCheckpointRecord);

      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 1,
      });
      expect(ackDirtyStateProcessed).toHaveBeenCalledWith({
        connectionId: "dsc_dirty_123",
        processedDirtyPayloadIds: ["dsp_payload_1"],
        processedRevision: "12",
      });
    } finally {
      await workspace.cleanup();
    }
  });

  it("keeps an immediate wake when a newer dirty revision arrives before acknowledgement", async () => {
    const immediateWakeAt = "2026-04-05T00:00:01.000Z";
    const localRetryAt = "2026-04-05T00:05:00.000Z";
    const runtime = createRuntime({
      deviceSyncPort: {
        async ackDirtyStateProcessed() {
          return {
            connectionId: "dsc_dirty_newer_revision",
            dirtyRevision: "13",
            nextWakeAt: immediateWakeAt,
            processedRevision: "12",
            recorded: true,
            stillDirty: true,
            userId: "member_123",
          };
        },
        async applyUpdates() {
          throw new Error("applyUpdates should not be called");
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called");
        },
        async fetchDirtyStates() {
          return {
            hasMore: false,
            items: [],
            nextWakeAt: null,
            userId: "member_123",
          };
        },
        async fetchSnapshot() {
          throw new Error("fetchSnapshot should not be called");
        },
      },
    });

    await expect(recordHostedDeviceSyncDirtyPostCheckpointRecord({
      record: {
        connectionId: "dsc_dirty_newer_revision",
        kind: "device-sync.dirty-processed",
        nextWakeAt: localRetryAt,
        processedRevision: "12",
      },
      runtime,
    })).resolves.toEqual({
      nextWakeAt: immediateWakeAt,
      recorded: 1,
      stillDirty: true,
    });
  });

  it("records a clinical outcome only after its vault checkpoint is durable", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const recordOutcome = vi.fn(async () => undefined);
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:clinical-outcome",
      memberId: "member_123",
      notification: {
        instructions: "Reconcile the prepared clinical outcome.",
        route: {
          actorId: "+15550001111",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: FIXED_NOW,
    });
    const request = {
      counts: {
        createdCount: 1,
        executableDecisionCount: 1,
        fetchedPageCount: 1,
        fetchedResourceFamilyCount: 1,
        rawFileCount: 2,
        retractedCount: 0,
        reviewDecisionCount: 0,
        skippedExistingCount: 0,
        supersededCount: 0,
      },
      generation: 1,
      runId: "clinical_run_1",
      status: "completed" as const,
    };
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "clinical-records",
      nextWakeAt: null,
      postCheckpointRecord: {
        kind: "clinical-records.outcome-recorded",
        request,
      },
      redactedLogEntries: [],
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedNotificationItem({
          id: "mailbox_item_system_clinical_outcome",
        }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });
      const runtime = createRuntime({
        clinicalRecordsPort: {
          async fetchPage() {
            throw new Error("fetchPage should not be called");
          },
          async readRun() {
            throw new Error("readRun should not be called");
          },
          recordOutcome,
        },
      });

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      expect(recordOutcome).not.toHaveBeenCalled();
      assert.equal(
        prepared.item.postCheckpointRecord?.kind,
        "clinical-records.outcome-recorded",
      );

      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 1,
      });
      expect(recordOutcome).toHaveBeenCalledOnce();
      expect(recordOutcome).toHaveBeenCalledWith(request);
    } finally {
      await workspace.cleanup();
    }
  });

  it("aborts a stalled clinical outcome record and preserves it for retry", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const controller = new AbortController();
    const request = {
      counts: {
        createdCount: 0,
        executableDecisionCount: 0,
        fetchedPageCount: 1,
        fetchedResourceFamilyCount: 1,
        rawFileCount: 2,
        retractedCount: 0,
        reviewDecisionCount: 0,
        skippedExistingCount: 0,
        supersededCount: 0,
      },
      generation: 1,
      runId: "clinical_run_1",
      status: "completed" as const,
    };
    const recordOutcome = vi.fn<HostedRuntimeClinicalRecordsPort["recordOutcome"]>(
      async (_request, options) => await new Promise<never>((_resolve, reject) => {
        const signal = options?.signal;
        if (!signal) {
          reject(new Error("Expected a Clinical Records cancellation signal."));
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    );
    const item: HostedSystemMailboxPendingItem = {
      attemptCount: 1,
      itemId: "mailbox_item_clinical_record_cancel",
      lastAttemptAt: FIXED_NOW,
      lastErrorCode: null,
      lastErrorMessage: null,
      mailboxDedupeKey: "clinical-record-cancel",
      mailboxLaneSeq: "1",
      nextAttemptAt: null,
      occurredAt: FIXED_NOW,
      postCheckpointRecord: {
        kind: "clinical-records.outcome-recorded" as const,
        request,
      },
      requestId: "clinical_record_cancel",
      routeAction: "run-clinical-records-sync" as const,
      status: "recording" as const,
      wake: {
        eventId: "clinical-records.sync-requested:cancel",
        generation: 1,
        kind: "clinical-records.sync-requested" as const,
        occurredAt: FIXED_NOW,
        runId: "clinical_run_1",
        userId: "member_123",
      },
    };
    const runtime = createRuntime({
      clinicalRecordsPort: {
        async fetchPage() {
          throw new Error("fetchPage should not be called");
        },
        async readRun() {
          throw new Error("readRun should not be called");
        },
        recordOutcome,
      },
    });

    try {
      await restoreHostedSystemMailboxCheckpointRollbackState({
        state: { pending: [item] },
        vaultRoot: workspace.vaultRoot,
      });
      const recording = recordHostedSystemMailboxItemAfterCheckpoint({
        item,
        runtime,
        signal: controller.signal,
        vaultRoot: workspace.vaultRoot,
      });
      await vi.waitFor(() => expect(recordOutcome).toHaveBeenCalledOnce());
      controller.abort(new DOMException("Foreground work arrived.", "AbortError"));

      await expect(recording).resolves.toEqual(expect.objectContaining({
        failed: 1,
        recorded: 0,
      }));
      expect(recordOutcome).toHaveBeenCalledWith(
        request,
        { signal: controller.signal },
      );
      await expect(readHostedSystemMailboxCheckpointRollbackState({
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        pending: [expect.objectContaining({
          itemId: item.itemId,
          status: "recording",
        })],
      });
    } finally {
      await workspace.cleanup();
    }
  });

  it("records batched device-sync dirty processed revisions after the checkpoint boundary", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const ackDirtyStateProcessed = vi.fn()
      .mockResolvedValueOnce({
        connectionId: "dsc_dirty_batch_1",
        dirtyRevision: "21",
        nextWakeAt: "2026-04-05T00:03:00.000Z",
        processedRevision: "21",
        recorded: true,
        stillDirty: false,
        userId: "member_123",
      })
      .mockResolvedValueOnce({
        connectionId: "dsc_dirty_batch_2",
        dirtyRevision: "22",
        nextWakeAt: null,
        processedRevision: "22",
        recorded: true,
        stillDirty: false,
        userId: "member_123",
      });
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:dirty-ack-batch",
      memberId: "member_123",
      notification: {
        instructions: "Process the dirty ack batch.",
        route: {
          actorId: "+15550001111",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: FIXED_NOW,
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "device-sync",
      nextWakeAt: null,
      postCheckpointRecord: {
        kind: "device-sync.dirty-processed-batch",
        nextWakeAt: "2026-04-05T00:07:00.000Z",
        records: [
          {
            connectionId: "dsc_dirty_batch_1",
            nextWakeAt: "2026-04-05T00:07:00.000Z",
            processedDirtyPayloadIds: ["dsp_payload_21"],
            processedRevision: "21",
          },
          {
            connectionId: "dsc_dirty_batch_2",
            nextWakeAt: null,
            processedDirtyPayloadIds: ["dsp_payload_22", "dsp_payload_23"],
            processedRevision: "22",
          },
        ],
      },
      redactedLogEntries: [],
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedNotificationItem({
          id: "mailbox_item_system_dirty_ack_batch",
        }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const runtime = createRuntime({
        deviceSyncPort: {
          async applyUpdates() {
            throw new Error("applyUpdates should not be called");
          },
          ackDirtyStateProcessed,
          async createConnectLink() {
            throw new Error("createConnectLink should not be called");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            throw new Error("fetchSnapshot should not be called");
          },
        },
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      expect(ackDirtyStateProcessed).not.toHaveBeenCalled();
      assert.equal(prepared?.item.postCheckpointRecord?.kind, "device-sync.dirty-processed-batch");

      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 2,
      });
      expect(ackDirtyStateProcessed).toHaveBeenNthCalledWith(1, {
        connectionId: "dsc_dirty_batch_1",
        processedDirtyPayloadIds: ["dsp_payload_21"],
        processedRevision: "21",
        stagedDirtyAcks: [
          {
            connectionId: "dsc_dirty_batch_2",
            processedDirtyPayloadIds: ["dsp_payload_22", "dsp_payload_23"],
            processedRevision: "22",
          },
        ],
      });
      expect(ackDirtyStateProcessed).toHaveBeenNthCalledWith(2, {
        connectionId: "dsc_dirty_batch_2",
        processedDirtyPayloadIds: ["dsp_payload_22", "dsp_payload_23"],
        processedRevision: "22",
      });
    } finally {
      await workspace.cleanup();
    }
  });

  it("preserves a batched dirty ack wake when an earlier ack remains dirty", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const ackDirtyStateProcessed = vi.fn()
      .mockResolvedValueOnce({
        connectionId: "dsc_dirty_batch_still_dirty_1",
        dirtyRevision: "41",
        nextWakeAt: "2026-04-05T00:03:00.000Z",
        processedRevision: "41",
        recorded: true,
        stillDirty: true,
        userId: "member_123",
      })
      .mockResolvedValueOnce({
        connectionId: "dsc_dirty_batch_still_dirty_2",
        dirtyRevision: "42",
        nextWakeAt: null,
        processedRevision: "42",
        recorded: true,
        stillDirty: false,
        userId: "member_123",
      });
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:dirty-ack-batch-still-dirty",
      memberId: "member_123",
      notification: {
        instructions: "Process the still-dirty ack batch.",
        route: {
          actorId: "+15550001111",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: FIXED_NOW,
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "device-sync",
      nextWakeAt: null,
      postCheckpointRecord: {
        kind: "device-sync.dirty-processed-batch",
        records: [
          {
            connectionId: "dsc_dirty_batch_still_dirty_1",
            processedDirtyPayloadIds: ["dsp_payload_41"],
            processedRevision: "41",
          },
          {
            connectionId: "dsc_dirty_batch_still_dirty_2",
            processedDirtyPayloadIds: ["dsp_payload_42"],
            processedRevision: "42",
          },
        ],
      },
      redactedLogEntries: [],
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedNotificationItem({
          id: "mailbox_item_system_dirty_ack_batch_still_dirty",
        }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const runtime = createRuntime({
        deviceSyncPort: {
          async applyUpdates() {
            throw new Error("applyUpdates should not be called");
          },
          ackDirtyStateProcessed,
          async createConnectLink() {
            throw new Error("createConnectLink should not be called");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            throw new Error("fetchSnapshot should not be called");
          },
        },
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: "2026-04-05T00:03:00.000Z",
        nextWakeReason: "device-sync.reconcile",
        recorded: 2,
      });
    } finally {
      await workspace.cleanup();
    }
  });

  it("retries a partially recorded device-sync dirty ack batch idempotently", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const ackDirtyStateProcessed = vi.fn()
      .mockResolvedValueOnce({
        connectionId: "dsc_dirty_retry_1",
        dirtyRevision: "31",
        nextWakeAt: "2026-04-05T00:03:00.000Z",
        processedRevision: "31",
        recorded: true,
        stillDirty: false,
        userId: "member_123",
      })
      .mockRejectedValueOnce(new Error("temporary ack failure"))
      .mockResolvedValueOnce({
        connectionId: "dsc_dirty_retry_1",
        dirtyRevision: "31",
        nextWakeAt: "2026-04-05T00:03:00.000Z",
        processedRevision: "31",
        recorded: true,
        stillDirty: false,
        userId: "member_123",
      })
      .mockResolvedValueOnce({
        connectionId: "dsc_dirty_retry_2",
        dirtyRevision: "32",
        nextWakeAt: null,
        processedRevision: "32",
        recorded: true,
        stillDirty: false,
        userId: "member_123",
      });
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:dirty-ack-batch-retry",
      memberId: "member_123",
      notification: {
        instructions: "Process the dirty ack batch retry.",
        route: {
          actorId: "+15550001111",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: FIXED_NOW,
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "device-sync",
      nextWakeAt: null,
      postCheckpointRecord: {
        kind: "device-sync.dirty-processed-batch",
        records: [
          {
            connectionId: "dsc_dirty_retry_1",
            processedDirtyPayloadIds: ["dsp_payload_31"],
            processedRevision: "31",
          },
          {
            connectionId: "dsc_dirty_retry_2",
            processedDirtyPayloadIds: ["dsp_payload_32"],
            processedRevision: "32",
          },
        ],
      },
      redactedLogEntries: [],
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedNotificationItem({
          id: "mailbox_item_system_dirty_ack_batch_retry",
        }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const runtime = createRuntime({
        deviceSyncPort: {
          async applyUpdates() {
            throw new Error("applyUpdates should not be called");
          },
          ackDirtyStateProcessed,
          async createConnectLink() {
            throw new Error("createConnectLink should not be called");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            throw new Error("fetchSnapshot should not be called");
          },
        },
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      const failedRecord = await recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime,
        vaultRoot: workspace.vaultRoot,
      });
      expect(failedRecord).toMatchObject({
        failed: 1,
        recorded: 0,
      });
      expect(ackDirtyStateProcessed).toHaveBeenCalledTimes(2);

      const retryPrepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => failedRecord.nextWakeAt ?? FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(retryPrepared?.status, "recording");

      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: retryPrepared.item,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 2,
      });
      expect(ackDirtyStateProcessed).toHaveBeenCalledTimes(4);
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledTimes(1);
    } finally {
      await workspace.cleanup();
    }
  });

  it("imports runtime control requests as durable no-op system work", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionRuntimeControlWake({
      eventId: "runtime-control:manual",
      kind: "runtime.manual-requested",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });

    try {
      assert.deepEqual(
        await enqueueHostedSystemMailboxItem({
          item: createResolvedRuntimeControlItem(),
          vaultRoot: workspace.vaultRoot,
          wake,
        }),
        {
          reasonCode: "system_mailbox.queued",
          status: "imported",
        },
      );

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceMailboxItemId: "mailbox_item_system_runtime_control",
          wake: expect.objectContaining({
            kind: "runtime.manual-requested",
          }),
        }),
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("retains an accepted provider continuation until its assistant turn settles", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionProviderSetupContinuationRequestedWake({
      eventId: "runtime-control:provider-setup-continuation:fixture",
      occurredAt: FIXED_NOW,
      providerSetup: {
        handoffId: null,
        provider: "strava",
        runId: null,
        setupId: "dps_fixture",
        setupVersion: 2,
      },
      userId: "member_123",
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "runtime-control",
      nextWakeAt: null,
      postCheckpointRecord: null,
      providerSetupContinuationAccepted: true,
      redactedLogEntries: [],
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedRuntimeControlItem({
          dedupeKey: wake.eventId,
          id: "mailbox_item_provider_setup_continuation",
          kind: wake.kind,
        }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      expect(await readHostedSystemMailboxState(workspace.vaultRoot)).toMatchObject({
        pending: [{
          itemId: "mailbox_item_provider_setup_continuation",
          status: "recording",
        }],
      });

      const nextAttemptAt = "2026-04-27T00:01:00.000Z";
      await retryHostedProviderSetupContinuationItem({
        item: prepared.item,
        nextAttemptAt,
        vaultRoot: workspace.vaultRoot,
      });
      await recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime: createRuntime({}),
        vaultRoot: workspace.vaultRoot,
      });

      expect(await readHostedSystemMailboxState(workspace.vaultRoot)).toMatchObject({
        pending: [{
          itemId: "mailbox_item_provider_setup_continuation",
          nextAttemptAt,
          status: "pending",
        }],
      });
    } finally {
      await workspace.cleanup();
    }
  });

  it("retries vault-share maintenance after projection fails and advances only after success", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionRuntimeControlWake({
      eventId: "runtime-control:vault-share-projection",
      kind: "runtime.maintenance-requested",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });
    const deliver = vi.fn()
      .mockRejectedValueOnce(new Error("synthetic projection failure"))
      .mockResolvedValueOnce({ status: "delivered" });
    const runtime = createRuntime({
      vaultSharePort: {
        deliver,
        async listActiveProjectionScopes() {
          return {
            generationTokensByProjectionScopeKey: {
              "sleep-times.v0": "a".repeat(43),
            },
            projectionKinds: ["sleep-times.v0" as const],
            projectionScopes: [hostedVaultShareProjectionKindToScope("sleep-times.v0")],
            projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
          };
        },
      },
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "runtime-control",
      nextWakeAt: null,
      postCheckpointRecord: { kind: "vault-share.projection" },
      redactedLogEntries: [],
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedRuntimeControlItem({
          dedupeKey: "runtime-control:vault-share-projection",
          id: "mailbox_item_vault_share_projection",
          kind: "runtime.maintenance-requested",
        }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(prepared?.status, "processed");
      assert.equal(prepared.item.postCheckpointRecord?.kind, "vault-share.projection");
      expect(resolveHostedSystemMailboxHandledThroughSeq({
        importedSeq: "1",
        state: await readHostedSystemMailboxState(workspace.vaultRoot),
      })).toBe("0");

      const failed = await recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime,
        vaultShareProjectionResult: { outcome: "error" },
        vaultRoot: workspace.vaultRoot,
      });
      expect(failed).toEqual(expect.objectContaining({
        failed: 1,
        recorded: 0,
      }));
      const failedState = await readHostedSystemMailboxState(workspace.vaultRoot);
      expect(failedState.pending).toEqual([
        expect.objectContaining({
          itemId: "mailbox_item_vault_share_projection",
          status: "recording",
        }),
      ]);
      expect(resolveHostedSystemMailboxHandledThroughSeq({
        importedSeq: "1",
        state: failedState,
      })).toBe("0");

      const retry = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => failed.nextWakeAt ?? FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(retry?.status, "recording");
      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: retry.item,
        runtime,
        vaultShareProjectionResult: { outcome: "delivered" },
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 1,
      });
      expect(deliver).not.toHaveBeenCalled();
      expect(await readHostedSystemMailboxState(workspace.vaultRoot)).toEqual({ pending: [] });
      expect(resolveHostedSystemMailboxHandledThroughSeq({
        importedSeq: "1",
        state: await readHostedSystemMailboxState(workspace.vaultRoot),
      })).toBe("1");
    } finally {
      await workspace.cleanup();
    }
  });

  it("lets later runtime controls proceed while approved vault-share work is deferred", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const projectionWake = buildHostedExecutionRuntimeControlWake({
      eventId: "runtime-control:group-share-projection:generation_1",
      kind: "runtime.maintenance-requested",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });
    const codexWake = buildHostedExecutionCodexAuthRequestedWake({
      action: "disconnect",
      attemptId: "hca_abcdefghijklmnop",
      eventId: "runtime-control:codex-auth:disconnect",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });
    const deliver = vi.fn();
    const runtime = createRuntime({
      vaultSharePort: {
        deliver,
        async listActiveProjectionScopes() {
          return {
            hasDeferredProjectionWork: true,
            projectionKinds: [],
            projectionScopes: [],
            projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
          };
        },
      },
    });
    mocks.executeHostedMailboxEvent
      .mockResolvedValueOnce({
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        nextWakeAt: null,
        postCheckpointRecord: { kind: "vault-share.projection" },
        redactedLogEntries: [],
      })
      .mockResolvedValueOnce({
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        nextWakeAt: null,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedRuntimeControlItem({
          dedupeKey: projectionWake.eventId,
          id: "mailbox_item_vault_share_projection",
          kind: "runtime.maintenance-requested",
          laneSeq: "1",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: projectionWake,
      });
      const projection = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(projection?.status, "processed");

      await enqueueHostedSystemMailboxItem({
        item: createResolvedCodexAuthRuntimeControlItem({ laneSeq: "2" }),
        vaultRoot: workspace.vaultRoot,
        wake: codexWake,
      });
      const failed = await recordHostedSystemMailboxItemAfterCheckpoint({
        item: projection.item,
        runtime,
        vaultShareProjectionResult: { outcome: "deferred" },
        vaultRoot: workspace.vaultRoot,
      });
      expect(failed).toMatchObject({
        failed: 1,
        nextWakeAt: expect.any(String),
        recorded: 0,
      });
      expect(failed.nextWakeAt).not.toBeNull();
      expect(Date.parse(failed.nextWakeAt ?? "")).toBeLessThanOrEqual(Date.now());

      const codex = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => new Date().toISOString(),
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      expect(codex).toEqual(expect.objectContaining({
        itemId: "mailbox_item_system_codex_auth",
        status: "processed",
      }));
      const deferredState = await readHostedSystemMailboxState(workspace.vaultRoot);
      expect(deferredState.pending).toEqual([
        expect.objectContaining({
          itemId: "mailbox_item_vault_share_projection",
          lastErrorCode: "HOSTED_VAULT_SHARE_PROJECTION_DEFERRED",
          nextAttemptAt: expect.any(String),
          status: "recording",
        }),
      ]);
      const deferredRetryAt = deferredState.pending[0]?.nextAttemptAt;
      expect(Date.parse(deferredRetryAt ?? "") - Date.now())
        .toBeGreaterThan(4 * 60_000);
      expect(deliver).not.toHaveBeenCalled();
      expect(resolveHostedSystemMailboxHandledThroughSeq({
        importedSeq: "2",
        state: await readHostedSystemMailboxState(workspace.vaultRoot),
      })).toBe("0");
    } finally {
      await workspace.cleanup();
    }
  });

  it("retries inactive-grantor projection without input and terminates after restored access sees revocation", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionRuntimeControlWake({
      eventId: "runtime-control:group-share-projection:generation_inactive",
      kind: "runtime.maintenance-requested",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });
    let grantorAccessRestored = false;
    const listActiveProjectionScopes = vi.fn(
      async (): Promise<HostedVaultShareActiveProjectionKindsResponse> => ({
        hasDeferredProjectionWork: !grantorAccessRestored,
        projectionKinds: [],
        projectionScopes: [],
        projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
      }),
    );
    const runtime = createRuntime({
      vaultSharePort: {
        deliver: vi.fn(),
        listActiveProjectionScopes,
      },
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "runtime-control",
      nextWakeAt: null,
      postCheckpointRecord: { kind: "vault-share.projection" },
      redactedLogEntries: [],
    });
    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedRuntimeControlItem({
          dedupeKey: wake.eventId,
          id: "mailbox_item_vault_share_projection_inactive",
          kind: "runtime.maintenance-requested",
        }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(prepared?.status, "processed");
      const deferred = await recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime,
        vaultShareProjectionResult: { outcome: "deferred" },
        vaultRoot: workspace.vaultRoot,
      });
      const deferredState = await readHostedSystemMailboxState(workspace.vaultRoot);
      const retryAt = deferredState.pending[0]?.nextAttemptAt;
      expect(deferred).toMatchObject({ failed: 1, recorded: 0 });
      expect(retryAt).toEqual(expect.any(String));
      expect(resolveHostedSystemMailboxHandledThroughSeq({
        importedSeq: "1",
        state: deferredState,
      })).toBe("0");

      grantorAccessRestored = true;
      const retry = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => retryAt ?? FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(retry?.status, "recording");
      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: retry.item,
        runtime,
        vaultShareProjectionResult: { outcome: "no-active-share" },
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 0,
      });
      expect(listActiveProjectionScopes).not.toHaveBeenCalled();
      expect(await readHostedSystemMailboxState(workspace.vaultRoot)).toEqual({ pending: [] });
      expect(resolveHostedSystemMailboxHandledThroughSeq({
        importedSeq: "1",
        state: await readHostedSystemMailboxState(workspace.vaultRoot),
      })).toBe("1");
    } finally {
      await workspace.cleanup();
    }
  });

  it("continues bounded vault-share pages promptly without completing the maintenance item", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionRuntimeControlWake({
      eventId: "runtime-control:group-share-projection:generation_bounded",
      kind: "runtime.maintenance-requested",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });
    const deliver = vi.fn().mockResolvedValue({ status: "delivered" });
    const runtime = createRuntime({
      vaultSharePort: {
        deliver,
        async listActiveProjectionScopes() {
          const projectionScope = hostedVaultShareProjectionKindToScope("sleep-times.v0");
          return {
            generationTokensByProjectionScopeKey: {
              "sleep-times.v0": "a".repeat(43),
            },
            hasDeferredProjectionWork: true,
            projectionKinds: ["sleep-times.v0" as const],
            projectionScopes: [projectionScope],
            projectionMode: HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
          };
        },
      },
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "runtime-control",
      nextWakeAt: null,
      postCheckpointRecord: { kind: "vault-share.projection" },
      redactedLogEntries: [],
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedRuntimeControlItem({
          dedupeKey: wake.eventId,
          id: "mailbox_item_vault_share_projection_bounded",
          kind: "runtime.maintenance-requested",
        }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(prepared?.status, "processed");

      const recordedAfterMs = Date.now();
      const continued = await recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime,
        vaultShareProjectionResult: { outcome: "continued" },
        vaultRoot: workspace.vaultRoot,
      });
      expect(continued).toMatchObject({
        failed: 1,
        nextWakeAt: expect.any(String),
        recorded: 0,
      });
      expect(Date.parse(continued.nextWakeAt ?? "") - recordedAfterMs)
        .toBeLessThanOrEqual(5_000);
      expect(deliver).not.toHaveBeenCalled();
      expect((await readHostedSystemMailboxState(workspace.vaultRoot)).pending).toEqual([
        expect.objectContaining({
          itemId: "mailbox_item_vault_share_projection_bounded",
          lastErrorCode: "HOSTED_VAULT_SHARE_PROJECTION_CONTINUE",
          status: "recording",
        }),
      ]);

      const foregroundWake = buildHostedExecutionCodexAuthRequestedWake({
        action: "disconnect",
        attemptId: "hca_boundedpageproof",
        eventId: "runtime-control:codex-auth:bounded-page-foreground",
        occurredAt: FIXED_NOW,
        userId: "member_123",
      });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedCodexAuthRuntimeControlItem({ laneSeq: "2" }),
        vaultRoot: workspace.vaultRoot,
        wake: foregroundWake,
      });
      const foreground = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => new Date(recordedAfterMs).toISOString(),
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      expect(foreground).toEqual(expect.objectContaining({
        itemId: "mailbox_item_system_codex_auth",
        status: "processed",
      }));
    } finally {
      await workspace.cleanup();
    }
  });

  it("retains processed no-record work until its post-checkpoint owner finalizes it", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionRuntimeControlWake({
      eventId: "runtime-control:retained-until-recorded",
      kind: "runtime.manual-requested",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });
    const runtime = createRuntime({});

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedRuntimeControlItem({
          dedupeKey: wake.eventId,
          id: "mailbox_item_system_retained_until_recorded",
        }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        retainProcessedItemUntilRecorded: true,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      assert.equal(prepared.item.postCheckpointRecord, null);
      expect((await readHostedSystemMailboxState(workspace.vaultRoot)).pending).toEqual([
        expect.objectContaining({
          itemId: "mailbox_item_system_retained_until_recorded",
          postCheckpointRecord: null,
          status: "recording",
        }),
      ]);

      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 0,
      });
      expect((await readHostedSystemMailboxState(workspace.vaultRoot)).pending).toEqual([]);
    } finally {
      await workspace.cleanup();
    }
  });

  it("selects only a pending-effects reconciliation from the shared runtime-control lane", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const manualWake = buildHostedExecutionRuntimeControlWake({
      eventId: "runtime-control:manual-before-pending-effects",
      kind: "runtime.manual-requested",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });
    const pendingEffectsWake = buildHostedExecutionPendingEffectsReconcileRequestedWake({
      effectId: "effect_approved_vault_export",
      eventId: "runtime-control:pending-effects",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedRuntimeControlItem(),
        vaultRoot: workspace.vaultRoot,
        wake: manualWake,
      });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedRuntimeControlItem({
          dedupeKey: "runtime-control:pending-effects",
          id: "mailbox_item_system_pending_effects",
          kind: "runtime.pending-effects-reconcile-requested",
          laneSeq: "2",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: pendingEffectsWake,
      });

      await expect(resolveHostedSystemMailboxNextWakeAt({
        allowedRouteActions: ["apply-runtime-control-request"],
        allowedWakeKinds: ["runtime.pending-effects-reconcile-requested"],
        now: () => FIXED_NOW,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toBe(FIXED_NOW);

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-runtime-control-request"],
        allowedWakeKinds: ["runtime.pending-effects-reconcile-requested"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      expect(prepared).toEqual(expect.objectContaining({
        itemId: "mailbox_item_system_pending_effects",
        status: "processed",
      }));
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceMailboxItemId: "mailbox_item_system_pending_effects",
          wake: expect.objectContaining({
            effectId: "effect_approved_vault_export",
            kind: "runtime.pending-effects-reconcile-requested",
          }),
        }),
      );
      expect((await readHostedSystemMailboxState(workspace.vaultRoot)).pending).toEqual([
        expect.objectContaining({
          itemId: "mailbox_item_system_runtime_control",
          status: "pending",
          wake: expect.objectContaining({
            kind: "runtime.manual-requested",
          }),
        }),
      ]);
    } finally {
      await workspace.cleanup();
    }
  });

  it("restores prepared no-op control work after foreground preemption", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionRuntimeControlWake({
      eventId: "runtime-control:manual-preempted",
      kind: "runtime.manual-requested",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedRuntimeControlItem(),
        vaultRoot: workspace.vaultRoot,
        wake,
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(prepared?.status, "processed");
      expect((await readHostedSystemMailboxState(workspace.vaultRoot)).pending)
        .toEqual([]);

      await retainHostedSystemMailboxItemAfterForegroundPreemption({
        item: prepared.item,
        vaultRoot: workspace.vaultRoot,
      });

      expect((await readHostedSystemMailboxState(workspace.vaultRoot)).pending)
        .toEqual([
          expect.objectContaining({
            itemId: prepared.item.itemId,
            nextAttemptAt: null,
            status: "pending",
          }),
        ]);
      await expect(prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      })).resolves.toMatchObject({
        itemId: prepared.item.itemId,
        status: "processed",
      });
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledTimes(2);
    } finally {
      await workspace.cleanup();
    }
  });

  it("records connected Codex auth updates after the checkpoint boundary", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const updateCodexAuth = vi.fn(async () => ({
      applied: true,
      status: "applied" as const,
    }));
    const wake = buildHostedExecutionCodexAuthRequestedWake({
      action: "connect",
      attemptId: "hca_abcdefghijklmnop",
      eventId: "runtime-control:codex-auth",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "runtime-control",
      nextWakeAt: null,
      postCheckpointRecord: {
        attemptId: "hca_abcdefghijklmnop",
        kind: "codex-auth.updated",
        phase: "connected",
      },
      redactedLogEntries: [],
    });

    try {
      assert.deepEqual(
        await enqueueHostedSystemMailboxItem({
          item: createResolvedCodexAuthRuntimeControlItem(),
          vaultRoot: workspace.vaultRoot,
          wake,
        }),
        {
          reasonCode: "system_mailbox.queued",
          status: "imported",
        },
      );

      const runtime = createRuntime({
        codexAuthPort: {
          update: updateCodexAuth,
        },
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      assert.equal(prepared.item.postCheckpointRecord?.kind, "codex-auth.updated");
      expect(updateCodexAuth).not.toHaveBeenCalled();

      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 1,
      });
      expect(updateCodexAuth).toHaveBeenCalledWith({
        attemptId: "hca_abcdefghijklmnop",
        phase: "connected",
      });
    } finally {
      await workspace.cleanup();
    }
  });

  it("keeps connected Codex auth updates after the checkpoint boundary", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const updateCodexAuth = vi.fn(async () => ({
      applied: true,
      status: "applied" as const,
    }));
    const authPath = path.join(workspace.operatorHomeRoot, ".codex-hosted", "auth.json");
    const wake = buildHostedExecutionCodexAuthRequestedWake({
      action: "connect",
      attemptId: "hca_abcdefghijklmnop",
      eventId: "runtime-control:codex-auth",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "runtime-control",
      nextWakeAt: null,
      postCheckpointRecord: {
        attemptId: "hca_abcdefghijklmnop",
        kind: "codex-auth.updated",
        phase: "connected",
      },
      redactedLogEntries: [],
    });

    try {
      await mkdir(path.dirname(authPath), { recursive: true });
      await writeFile(authPath, "{\"auth_mode\":\"chatgpt\"}\n");
      await enqueueHostedSystemMailboxItem({
        item: createResolvedCodexAuthRuntimeControlItem(),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const runtime = createRuntime({
        codexAuthPort: {
          update: updateCodexAuth,
        },
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        operatorHomeRoot: workspace.operatorHomeRoot,
        runtime,
        runtimeEnv: {
          NODE_ENV: "test",
        },
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(prepared?.status, "processed");

      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        operatorHomeRoot: workspace.operatorHomeRoot,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 1,
      });
      expect(updateCodexAuth).toHaveBeenCalledWith({
        attemptId: "hca_abcdefghijklmnop",
        phase: "connected",
      });
      await expect(access(authPath)).resolves.toBeUndefined();
    } finally {
      await workspace.cleanup();
    }
  });

  it("removes connected Codex auth when the checkpoint update is superseded", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const updateCodexAuth = vi.fn(async () => ({
      applied: false,
      status: "superseded" as const,
    }));
    const authPath = path.join(workspace.operatorHomeRoot, ".codex-hosted", "auth.json");
    const wake = buildHostedExecutionCodexAuthRequestedWake({
      action: "connect",
      attemptId: "hca_abcdefghijklmnop",
      eventId: "runtime-control:codex-auth",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "runtime-control",
      nextWakeAt: null,
      postCheckpointRecord: {
        attemptId: "hca_abcdefghijklmnop",
        kind: "codex-auth.updated",
        phase: "connected",
      },
      redactedLogEntries: [],
    });

    try {
      await mkdir(path.dirname(authPath), { recursive: true });
      await writeFile(authPath, "{\"auth_mode\":\"chatgpt\"}\n");
      await enqueueHostedSystemMailboxItem({
        item: createResolvedCodexAuthRuntimeControlItem(),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const runtime = createRuntime({
        codexAuthPort: {
          update: updateCodexAuth,
        },
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        operatorHomeRoot: workspace.operatorHomeRoot,
        runtime,
        runtimeEnv: {
          NODE_ENV: "test",
        },
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(prepared?.status, "processed");

      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        operatorHomeRoot: workspace.operatorHomeRoot,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 0,
      });
      expect(updateCodexAuth).toHaveBeenCalledWith({
        attemptId: "hca_abcdefghijklmnop",
        phase: "connected",
      });
      await expect(access(authPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await workspace.cleanup();
    }
  });

  it("keeps connected Codex auth when the checkpoint update was already applied", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const updateCodexAuth = vi.fn(async () => ({
      applied: true,
      status: "already_applied" as const,
    }));
    const authPath = path.join(workspace.operatorHomeRoot, ".codex-hosted", "auth.json");
    const wake = buildHostedExecutionCodexAuthRequestedWake({
      action: "connect",
      attemptId: "hca_abcdefghijklmnop",
      eventId: "runtime-control:codex-auth",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "runtime-control",
      nextWakeAt: null,
      postCheckpointRecord: {
        attemptId: "hca_abcdefghijklmnop",
        kind: "codex-auth.updated",
        phase: "connected",
      },
      redactedLogEntries: [],
    });

    try {
      await mkdir(path.dirname(authPath), { recursive: true });
      await writeFile(authPath, "{\"auth_mode\":\"chatgpt\"}\n");
      await enqueueHostedSystemMailboxItem({
        item: createResolvedCodexAuthRuntimeControlItem(),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const runtime = createRuntime({
        codexAuthPort: {
          update: updateCodexAuth,
        },
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        operatorHomeRoot: workspace.operatorHomeRoot,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(prepared?.status, "processed");

      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        operatorHomeRoot: workspace.operatorHomeRoot,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 1,
      });
      expect(updateCodexAuth).toHaveBeenCalledWith({
        attemptId: "hca_abcdefghijklmnop",
        phase: "connected",
      });
      await expect(access(authPath)).resolves.toBeUndefined();
    } finally {
      await workspace.cleanup();
    }
  });

  it("forwards foreground-yield hooks to queued device-sync wakes", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const shouldYieldBackgroundMaintenance = vi.fn(() => false);
    const wake = buildHostedExecutionDeviceSyncWake({
      eventId: "device-sync.wake:yield",
      occurredAt: FIXED_NOW,
      reason: "webhook_hint",
      userId: "member_123",
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedDeviceSyncItem(),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        shouldYieldBackgroundMaintenance,
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          shouldYieldDeviceSync: shouldYieldBackgroundMaintenance,
          sourceMailboxItemId: "mailbox_item_system_device_sync",
          wake: expect.objectContaining({
            kind: "device-sync.wake",
          }),
        }),
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("retains the exact device-sync wake across its local retry checkpoint", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const retryAt = "2026-04-27T00:00:15.000Z";
    const wake = buildHostedExecutionDeviceSyncWake({
      connectionId: "dsc_exact_retry",
      eventId: "device-sync.wake:exact-retry",
      expectedConnectedAt: FIXED_NOW,
      hint: {
        jobs: [{
          dedupeKey: "initial-history",
          kind: "resource",
          maxAttempts: 5,
          payload: {
            windowEnd: FIXED_NOW,
            windowStart: "2025-10-29T00:00:00.000Z",
          },
        }],
      },
      occurredAt: FIXED_NOW,
      provider: "oura",
      reason: "connected",
      userId: "member_123",
    });
    const runtime = createRuntime({
      deviceSyncPort: createDeviceSyncPortStub(),
    });
    const retainedWake = buildHostedExecutionDeviceSyncWake({
      ...wake,
      hint: {
        jobs: [{
          availableAt: retryAt,
          dedupeKey: "initial-history",
          kind: "resource",
          maxAttempts: 4,
          payload: {
            windowEnd: FIXED_NOW,
            windowStart: "2025-10-29T00:00:00.000Z",
          },
        }],
      },
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "device-sync",
      nextWakeAt: retryAt,
      postCheckpointRecord: {
        kind: "device-sync.dirty-processed-batch",
        records: [],
        retainMailboxItemUntil: retryAt,
        retainedWake,
      },
      redactedLogEntries: [],
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedDeviceSyncItem({
          id: "mailbox_item_system_device_sync_exact_retry",
        }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["run-device-sync-wake"],
        executionContext: null,
        now: () => FIXED_NOW,
        retainProcessedItemUntilRecorded: true,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(prepared?.status, "processed");

      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: retryAt,
        nextWakeReason: "device-sync.reconcile",
        recorded: 0,
      });

      const retainedState = await readHostedSystemMailboxState(workspace.vaultRoot);
      expect(retainedState.pending).toEqual([
        expect.objectContaining({
          attemptCount: 1,
          itemId: "mailbox_item_system_device_sync_exact_retry",
          nextAttemptAt: retryAt,
          postCheckpointRecord: null,
          status: "pending",
          wake: retainedWake,
        }),
      ]);

      const retryPrepared = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["run-device-sync-wake"],
        executionContext: null,
        now: () => retryAt,
        retainProcessedItemUntilRecorded: true,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(retryPrepared?.status, "processed");
      assert.equal(retryPrepared.item.attemptCount, 2);
      assert.deepEqual(retryPrepared.item.wake, retainedWake);

      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: retryPrepared.item,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 0,
      });
      expect((await readHostedSystemMailboxState(workspace.vaultRoot)).pending).toEqual([]);
    } finally {
      await workspace.cleanup();
    }
  });

  it("lets another connection run around a retained device-sync retry", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const olderWake = buildHostedExecutionDeviceSyncWake({
      connectionId: "dsc_retrying_connection",
      eventId: "device-sync.wake:retrying-connection",
      occurredAt: FIXED_NOW,
      provider: "oura",
      reason: "webhook_hint",
      userId: "member_123",
    });
    const otherConnectionWake = buildHostedExecutionDeviceSyncWake({
      connectionId: "dsc_due_connection",
      eventId: "device-sync.wake:due-connection",
      occurredAt: "2026-04-27T00:00:01.000Z",
      provider: "whoop",
      reason: "webhook_hint",
      userId: "member_123",
    });
    const newerSameConnectionWake = buildHostedExecutionDeviceSyncWake({
      connectionId: "dsc_retrying_connection",
      eventId: "device-sync.wake:newer-same-connection",
      occurredAt: "2026-04-27T00:00:02.000Z",
      provider: "oura",
      reason: "webhook_hint",
      userId: "member_123",
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedDeviceSyncItem({
          id: "mailbox_item_system_device_sync_retrying",
          laneSeq: "1",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: olderWake,
      });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedDeviceSyncItem({
          id: "mailbox_item_system_device_sync_due",
          laneSeq: "2",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: otherConnectionWake,
      });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedDeviceSyncItem({
          id: "mailbox_item_system_device_sync_same_connection",
          laneSeq: "3",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: newerSameConnectionWake,
      });
      mocks.executeHostedMailboxEvent.mockRejectedValueOnce(
        Object.assign(new Error("transient device sync failure"), {
          code: "HOSTED_DEVICE_SYNC_TRANSIENT",
        }),
      );

      const failed = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["run-device-sync-wake"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(failed?.status, "retryable_failed");
      assert.equal(failed.itemId, "mailbox_item_system_device_sync_retrying");

      const otherConnection = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["run-device-sync-wake"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(otherConnection?.status, "processed");
      assert.equal(otherConnection.itemId, "mailbox_item_system_device_sync_due");

      const sameConnectionBlocked = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["run-device-sync-wake"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(sameConnectionBlocked, null);

      const retried = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["run-device-sync-wake"],
        executionContext: null,
        now: () => "2026-04-27T00:01:00.000Z",
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(retried?.status, "processed");
      assert.equal(retried.itemId, "mailbox_item_system_device_sync_retrying");

      const sameConnection = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["run-device-sync-wake"],
        executionContext: null,
        now: () => "2026-04-27T00:01:00.000Z",
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(sameConnection?.status, "processed");
      assert.equal(sameConnection.itemId, "mailbox_item_system_device_sync_same_connection");
      expect(mocks.executeHostedMailboxEvent.mock.calls.map((call) =>
        call[0]?.wake?.eventId
      )).toEqual([
        "device-sync.wake:retrying-connection",
        "device-sync.wake:due-connection",
        "device-sync.wake:retrying-connection",
        "device-sync.wake:newer-same-connection",
      ]);
    } finally {
      await workspace.cleanup();
    }
  });

  it("backs off a recording item when vault-share projection fails", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionDeviceSyncWake({
      eventId: "device-sync.wake:projection-failure",
      occurredAt: FIXED_NOW,
      reason: "webhook_hint",
      userId: "member_123",
    });
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(Date.parse(FIXED_NOW));

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedDeviceSyncItem(),
        vaultRoot: workspace.vaultRoot,
        wake,
      });
      const pending = (await readHostedSystemMailboxState(workspace.vaultRoot)).pending[0];
      assert.ok(pending);

      await expect(
        deferHostedSystemMailboxItemAfterVaultShareProjectionFailure({
          item: {
            ...pending,
            postCheckpointRecord: {
              connectionId: "device_sync_connection_projection_failure",
              kind: "device-sync.dirty-processed",
              processedRevision: "7",
            },
            status: "recording",
          },
          vaultRoot: workspace.vaultRoot,
        }),
      ).resolves.toEqual({
        at: "2026-04-27T00:01:00.000Z",
        reason: "device-sync.reconcile",
      });

      await expect(readHostedSystemMailboxState(workspace.vaultRoot)).resolves.toMatchObject({
        pending: [{
          lastErrorCode: "HOSTED_VAULT_SHARE_PROJECTION_FAILED",
          nextAttemptAt: "2026-04-27T00:01:00.000Z",
          status: "recording",
        }],
      });
    } finally {
      dateNow.mockRestore();
      await workspace.cleanup();
    }
  });

  it("keeps general system maintenance from blocking unrelated due work behind a backed-off route", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const deviceSyncWake = buildHostedExecutionDeviceSyncWake({
      eventId: "device-sync.wake:backoff",
      occurredAt: FIXED_NOW,
      reason: "webhook_hint",
      userId: "member_123",
    });
    const notificationWake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:after-device-sync-backoff",
      memberId: "member_123",
      notification: {
        instructions: "Send the prepared account update.",
        route: {
          actorId: "+15550001111",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-27T00:00:01.000Z",
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedDeviceSyncItem({
          id: "mailbox_item_system_device_sync_backoff",
          laneSeq: "1",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: deviceSyncWake,
      });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedNotificationItem({
          id: "mailbox_item_system_notification_after_backoff",
          laneSeq: "2",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: notificationWake,
      });

      mocks.executeHostedMailboxEvent.mockRejectedValueOnce(
        Object.assign(
          new Error(
            "transient device sync failure for "
              + "https://r2.example.test/private?X-Amz-Signature=fixture-secret "
              + "with TOKEN=fixture-token",
            {
              cause: new TypeError(
                "local scratch /tmp/hosted-runtime/snapshot.enc for member_123",
              ),
            },
          ),
          {
            code: "HOSTED_DEVICE_SYNC_TRANSIENT",
          },
        ),
      );
      const first = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(first?.status, "retryable_failed");
      assert.equal(first.itemId, "mailbox_item_system_device_sync_backoff");
      const safeErrorMessage =
        "transient device sync failure for <redacted-url> with TOKEN=<redacted>"
        + " | local scratch <redacted-path> for <redacted-user-id>";
      assert.equal(first.errorCode, "HOSTED_DEVICE_SYNC_TRANSIENT");
      assert.equal(first.errorMessage, safeErrorMessage);
      const persistedFailure = (
        await readHostedSystemMailboxState(workspace.vaultRoot)
      ).pending.find((item) => item.itemId === first.itemId);
      assert.equal(persistedFailure?.lastErrorCode, "HOSTED_DEVICE_SYNC_TRANSIENT");
      assert.equal(persistedFailure?.lastErrorMessage, safeErrorMessage);
      assert.doesNotMatch(
        first.errorMessage ?? "",
        /fixture-secret|fixture-token|member_123|\/tmp\//u,
      );

      const second = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(second?.status, "processed");
      assert.equal(second.itemId, "mailbox_item_system_notification_after_backoff");
      expect(mocks.executeHostedMailboxEvent.mock.calls.map((call) =>
        call[0]?.sourceMailboxItemId
      )).toEqual([
        "mailbox_item_system_device_sync_backoff",
        "mailbox_item_system_notification_after_backoff",
      ]);
      assert.equal(
        await resolveHostedSystemMailboxNextWakeAt({
          now: () => FIXED_NOW,
          vaultRoot: workspace.vaultRoot,
        }),
        "2026-04-27T00:01:00.000Z",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("blocks newer member-channel snapshots behind the oldest matching queued item", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const olderWake = buildHostedExecutionMemberChannelsUpdatedWake({
      eventId: "member.channels.updated:older-enable",
      memberId: "member_123",
      memberChannels: {
        email: false,
        linq: false,
        telegram: true,
      },
      occurredAt: FIXED_NOW,
    });
    const newerWake = buildHostedExecutionMemberChannelsUpdatedWake({
      eventId: "member.channels.updated:newer-disable",
      memberId: "member_123",
      memberChannels: {
        email: false,
        linq: false,
        telegram: false,
      },
      occurredAt: "2026-04-27T00:00:01.000Z",
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberChannelsItem({
          id: "mailbox_item_system_member_channels_001",
          laneSeq: "1",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: olderWake,
      });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberChannelsItem({
          id: "mailbox_item_system_member_channels_002",
          laneSeq: "2",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: newerWake,
      });

      mocks.executeHostedMailboxEvent.mockRejectedValueOnce(
        Object.assign(new Error("transient member channel failure"), {
          code: "HOSTED_MEMBER_CHANNELS_TRANSIENT",
        }),
      );
      const first = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-channels-update"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(first?.status, "retryable_failed");
      assert.equal(first.itemId, "mailbox_item_system_member_channels_001");
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          wake: expect.objectContaining({
            eventId: "member.channels.updated:older-enable",
          }),
        }),
      );

      const blocked = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-channels-update"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(blocked, null);
      assert.equal(mocks.executeHostedMailboxEvent.mock.calls.length, 1);
      assert.equal(
        await resolveHostedSystemMailboxNextWakeAt({
          allowedRouteActions: ["apply-member-channels-update"],
          now: () => FIXED_NOW,
          vaultRoot: workspace.vaultRoot,
        }),
        "2026-04-27T00:01:00.000Z",
      );

      const retry = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-channels-update"],
        executionContext: null,
        now: () => "2026-04-27T00:01:00.000Z",
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(retry?.status, "processed");
      assert.equal(retry.itemId, "mailbox_item_system_member_channels_001");

      const next = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-channels-update"],
        executionContext: null,
        now: () => "2026-04-27T00:01:00.000Z",
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(next?.status, "processed");
      assert.equal(next.itemId, "mailbox_item_system_member_channels_002");
      expect(mocks.executeHostedMailboxEvent.mock.calls.map((call) =>
        call[0]?.wake?.eventId
      )).toEqual([
        "member.channels.updated:older-enable",
        "member.channels.updated:older-enable",
        "member.channels.updated:newer-disable",
      ]);
    } finally {
      await workspace.cleanup();
    }
  });

  it("selects an imported channel update around queued Assistant Ask work", async () => {
    for (const [askLaneSeq, channelLaneSeq] of [["1", "2"], ["2", "1"]] as const) {
      const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
      const askWake = buildHostedExecutionAssistantAskCompletedWake({
        ask: {
          expiresAt: "2026-04-27T00:10:00.000Z",
          origin: {
            assistantInputId: `ain_${"a".repeat(32)}`,
            kind: "accepted_input",
            sessionId: "asst_session_channel_authority",
          },
          question: "What did the group decide?",
          requestId: `aask_req_channel_authority_${askLaneSeq}`,
          result: {
            answer: "The group answered.",
            outcome: "answered",
          },
          targetLabel: null,
        },
        eventId: `aask_done_channel_authority_${askLaneSeq}`,
        memberId: "member_123",
        occurredAt: FIXED_NOW,
      });
      const channelWake = buildHostedExecutionMemberChannelsUpdatedWake({
        eventId: `member.channels.updated:authority:${channelLaneSeq}`,
        memberId: "member_123",
        memberChannels: {
          email: false,
          linq: false,
          telegram: false,
        },
        occurredAt: FIXED_NOW,
      });

      try {
        await enqueueHostedSystemMailboxItem({
          item: createResolvedAssistantAskCompletionItem({
            dedupeKey: askWake.eventId,
            id: askWake.eventId,
            laneSeq: askLaneSeq,
          }),
          vaultRoot: workspace.vaultRoot,
          wake: askWake,
        });
        await enqueueHostedSystemMailboxItem({
          item: createResolvedMemberChannelsItem({
            id: `mailbox_item_system_member_channels_authority_${channelLaneSeq}`,
            laneSeq: channelLaneSeq,
          }),
          vaultRoot: workspace.vaultRoot,
          wake: channelWake,
        });

        const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
          allowedRouteActions: ["apply-member-channels-update"],
          executionContext: null,
          now: () => FIXED_NOW,
          runtime: createRuntime({}),
          runtimeEnv: {},
          vaultRoot: workspace.vaultRoot,
        });

        assert.equal(
          prepared?.itemId,
          `mailbox_item_system_member_channels_authority_${channelLaneSeq}`,
        );
        assert.equal(prepared.status, "processed");
        assert.equal(
          (await readHostedSystemMailboxState(workspace.vaultRoot)).pending[0]
            ?.routeAction,
          "continue-assistant-ask",
        );
      } finally {
        await workspace.cleanup();
      }
    }
  });

  it("applies sparse member preference deltas in mailbox order", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const olderWake = buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: "member.preferences.updated:older",
      memberId: "member_123",
      occurredAt: FIXED_NOW,
      preferences: {
        personality: {
          humor: 8,
        },
      },
    });
    const newerWake = buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: "member.preferences.updated:newer",
      memberId: "member_123",
      occurredAt: "2026-04-27T00:00:01.000Z",
      preferences: {
        personality: {
          detail: 7,
        },
      },
    });

    try {
      await mkdir(workspace.vaultRoot, { recursive: true });
      await writeFile(path.join(workspace.vaultRoot, VAULT_LAYOUT.metadata), "{}", "utf8");
      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberPreferencesItem({
          id: "mailbox_item_system_member_preferences_001",
          laneSeq: "1",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: olderWake,
      });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberPreferencesItem({
          id: "mailbox_item_system_member_preferences_002",
          laneSeq: "2",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: newerWake,
      });

      const first = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(first?.status, "processed");
      assert.equal(first.itemId, "mailbox_item_system_member_preferences_001");
      assert.equal(first.item.mailboxLaneSeq, "1");

      const second = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(second?.status, "processed");
      assert.equal(second.itemId, "mailbox_item_system_member_preferences_002");
      assert.equal(second.item.mailboxLaneSeq, "2");
      expect(mocks.executeHostedMailboxEvent.mock.calls.map((call) =>
        call[0]?.wake?.eventId
      )).toEqual([
        "member.preferences.updated:older",
        "member.preferences.updated:newer",
      ]);
      assert.equal(
        await resolveHostedSystemMailboxNextWakeAt({
          allowedRouteActions: ["apply-member-preferences"],
          now: () => FIXED_NOW,
          vaultRoot: workspace.vaultRoot,
        }),
        null,
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("orders a Web-approved preference wake by its own mailbox sequence", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionMemberPreferencesUpdatedWake({
      causalOrigin: "turn",
      eventId: "member.preferences.updated:turn-10",
      memberId: "member_123",
      occurredAt: FIXED_NOW,
      preferenceCausalSeq: "10",
      preferences: {
        personality: {
          humor: 8,
        },
      },
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberPreferencesItem({
          causalSeq: "12",
          id: "mailbox_item_system_member_preferences_turn_10",
          laneSeq: "12",
        }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });
      await expect(readHostedSystemMailboxState(workspace.vaultRoot)).resolves.toMatchObject({
        pending: [{
          preferenceCausalSeq: "12",
        }],
      });
      mocks.executeHostedMailboxEvent.mockImplementationOnce(async (input) => {
        expect(input.preferenceCausalSeq).toBe("12");
        return {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "member-preferences-updated",
          nextWakeAt: null,
          postCheckpointRecord: null,
          redactedLogEntries: [],
        };
      });

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      assert.deepEqual(
        (await readHostedSystemMailboxState(workspace.vaultRoot)).pending,
        [],
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("converges the canonical bank to Web-approved order when source sequences run backward", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const scheduledWake = buildHostedExecutionMemberPreferencesUpdatedWake({
      causalOrigin: "turn",
      eventId: "member.preferences.updated:scheduled-approved",
      memberId: "member_123",
      occurredAt: "2026-04-27T00:00:00.000Z",
      preferenceCausalSeq: "21",
      preferences: { tone: "casual" },
    });
    const acceptedWake = buildHostedExecutionMemberPreferencesUpdatedWake({
      causalOrigin: "turn",
      eventId: "member.preferences.updated:accepted-approved",
      memberId: "member_123",
      occurredAt: "2026-04-27T00:05:00.000Z",
      preferenceCausalSeq: "20",
      preferences: { tone: "formal" },
    });

    try {
      await mkdir(workspace.vaultRoot, { recursive: true });
      await writeFile(
        path.join(workspace.vaultRoot, VAULT_LAYOUT.metadata),
        "{}",
        "utf8",
      );
      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberPreferencesItem({
          causalSeq: "41",
          id: "mailbox_item_scheduled_approved",
          laneSeq: "41",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: scheduledWake,
      });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberPreferencesItem({
          causalSeq: "42",
          id: "mailbox_item_accepted_approved",
          laneSeq: "42",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: acceptedWake,
      });
      mocks.executeHostedMailboxEvent.mockImplementation(async (input) => {
        if (input.wake.kind !== "member.preferences.updated") {
          throw new TypeError("Expected a member preferences wake.");
        }
        const { applyHostedMemberPreferences } = await import(
          "../src/hosted-runtime/context.ts"
        );
        await applyHostedMemberPreferences(
          input.vaultRoot,
          input.wake,
          input.preferenceCausalSeq ?? "0",
          input.preferenceAppliedAt,
        );
        return {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "member-preferences-updated",
          nextWakeAt: null,
          postCheckpointRecord: null,
          redactedLogEntries: [],
        };
      });

      for (let index = 0; index < 2; index += 1) {
        const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
          allowedRouteActions: ["apply-member-preferences"],
          executionContext: null,
          now: () => "2026-04-27T00:06:00.000Z",
          runtime: createRuntime({}),
          runtimeEnv: {},
          vaultRoot: workspace.vaultRoot,
        });
        assert.equal(prepared?.status, "processed");
      }

      assert.equal(
        (await readPreferencesDocument(workspace.vaultRoot)).assistant?.tone,
        "formal",
      );
      expect(mocks.executeHostedMailboxEvent.mock.calls.map(
        (call) => call[0]?.preferenceCausalSeq,
      )).toEqual(["41", "42"]);
    } finally {
      await workspace.cleanup();
    }
  });

  it("preserves mailbox order when rollback restores multiple preference deltas", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const lowerSeqNewerTimestampWake = buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: "member.preferences.updated:lower-seq-newer-timestamp",
      memberId: "member_123",
      occurredAt: "2026-04-27T00:00:05.000Z",
      preferences: {
        personality: {
          humor: 9,
        },
      },
    });
    const higherSeqOlderTimestampWake = buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: "member.preferences.updated:higher-seq-older-timestamp",
      memberId: "member_123",
      occurredAt: "2026-04-27T00:00:01.000Z",
      preferences: {
        personality: {
          push: 8,
        },
      },
    });

    try {
      await restoreHostedSystemMailboxCheckpointRollbackState({
        state: {
          pending: [
            createPendingMemberPreferencesItem({
              itemId: "mailbox_item_system_member_preferences_lower_seq",
              laneSeq: "41",
              occurredAt: "2026-04-27T00:00:05.000Z",
              wake: lowerSeqNewerTimestampWake,
            }),
            createPendingMemberPreferencesItem({
              itemId: "mailbox_item_system_member_preferences_higher_seq",
              laneSeq: "42",
              occurredAt: "2026-04-27T00:00:01.000Z",
              wake: higherSeqOlderTimestampWake,
            }),
          ],
        },
        vaultRoot: workspace.vaultRoot,
      });

      const first = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(first?.status, "processed");
      assert.equal(first.itemId, "mailbox_item_system_member_preferences_lower_seq");
      assert.equal(first.item.mailboxLaneSeq, "41");

      const second = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(second?.status, "processed");
      assert.equal(second.itemId, "mailbox_item_system_member_preferences_higher_seq");
      assert.equal(second.item.mailboxLaneSeq, "42");
      expect(mocks.executeHostedMailboxEvent.mock.calls.map((call) =>
        call[0]?.wake?.eventId
      )).toEqual([
        "member.preferences.updated:lower-seq-newer-timestamp",
        "member.preferences.updated:higher-seq-older-timestamp",
      ]);
      assert.deepEqual(
        (await readHostedSystemMailboxState(workspace.vaultRoot)).pending,
        [],
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("retries an older preference delta before applying a newer delta", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const olderWake = buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: "member.preferences.updated:older-retry",
      memberId: "member_123",
      occurredAt: FIXED_NOW,
      preferences: {
        personality: {
          humor: 8,
        },
      },
    });
    const newerWake = buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: "member.preferences.updated:newer-due",
      memberId: "member_123",
      occurredAt: "2026-04-27T00:00:01.000Z",
      preferences: {
        personality: {
          detail: 7,
        },
      },
    });

    try {
      await mkdir(workspace.vaultRoot, { recursive: true });
      await writeFile(path.join(workspace.vaultRoot, VAULT_LAYOUT.metadata), "{}", "utf8");
      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberPreferencesItem({
          id: "mailbox_item_system_member_preferences_retry_001",
          laneSeq: "1",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: olderWake,
      });

      mocks.executeHostedMailboxEvent.mockRejectedValueOnce(
        Object.assign(new Error("transient preference failure"), {
          code: "HOSTED_MEMBER_PREFERENCES_TRANSIENT",
        }),
      );
      const failed = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(failed?.status, "retryable_failed");

      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberPreferencesItem({
          id: "mailbox_item_system_member_preferences_retry_002",
          laneSeq: "2",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: newerWake,
      });

      const blocked = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(blocked, null);
      expect(mocks.executeHostedMailboxEvent.mock.calls.map((call) =>
        call[0]?.wake?.eventId
      )).toEqual([
        "member.preferences.updated:older-retry",
      ]);
      assert.equal(
        await resolveHostedSystemMailboxNextWakeAt({
          allowedRouteActions: ["apply-member-preferences"],
          now: () => FIXED_NOW,
          vaultRoot: workspace.vaultRoot,
        }),
        "2026-04-27T00:01:00.000Z",
      );

      const retried = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => "2026-04-27T00:01:00.000Z",
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(retried?.status, "processed");
      assert.equal(retried.itemId, "mailbox_item_system_member_preferences_retry_001");

      const newer = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => "2026-04-27T00:01:00.000Z",
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(newer?.status, "processed");
      assert.equal(newer.itemId, "mailbox_item_system_member_preferences_retry_002");
      expect(mocks.executeHostedMailboxEvent.mock.calls.map((call) =>
        call[0]?.wake?.eventId
      )).toEqual([
        "member.preferences.updated:older-retry",
        "member.preferences.updated:older-retry",
        "member.preferences.updated:newer-due",
      ]);
    } finally {
      await workspace.cleanup();
    }
  });

  it("replays a canonical preference commit after a mailbox crash without regressing siblings", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const olderWake = buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: "member.preferences.updated:older-cross-lane-retry",
      memberId: "member_123",
      occurredAt: FIXED_NOW,
      preferences: {
        personality: {
          detail: 7,
          humor: 2,
        },
      },
    });

    try {
      await mkdir(workspace.vaultRoot, { recursive: true });
      await writeFile(path.join(workspace.vaultRoot, VAULT_LAYOUT.metadata), "{}", "utf8");
      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberPreferencesItem({
          id: "mailbox_item_system_member_preferences_cross_lane",
          laneSeq: "1",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: olderWake,
      });
      mocks.executeHostedMailboxEvent.mockRejectedValueOnce(
        Object.assign(new Error("transient preference failure"), {
          code: "HOSTED_MEMBER_PREFERENCES_TRANSIENT",
        }),
      );

      const failed = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(failed?.status, "retryable_failed");

      await updateAssistantPreferences({
        causalSeq: "2",
        preferences: {
          personality: {
            humor: 9,
          },
        },
        updatedAt: "2026-04-27T00:00:30.000Z",
        vaultRoot: workspace.vaultRoot,
      });

      mocks.executeHostedMailboxEvent.mockImplementationOnce(async (input) => {
        const { applyHostedMemberPreferences } = await import(
          "../src/hosted-runtime/context.ts"
        );
        await applyHostedMemberPreferences(
          input.vaultRoot,
          olderWake,
          input.preferenceCausalSeq ?? "0",
          input.preferenceAppliedAt,
        );
        throw Object.assign(new Error("crash after canonical preference commit"), {
          code: "HOSTED_MEMBER_PREFERENCES_POST_COMMIT_CRASH",
        });
      });

      const crashed = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => "2026-04-27T00:01:00.000Z",
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(crashed?.status, "retryable_failed");
      const afterCrash = await readPreferencesDocument(workspace.vaultRoot);
      assert.deepEqual(afterCrash.assistant?.personality, {
        detail: 7,
        humor: 9,
      });
      assert.equal(afterCrash.updatedAt, "2026-04-27T00:01:00.000Z");
      assert.equal(
        (await readHostedSystemMailboxState(workspace.vaultRoot)).pending.length,
        1,
      );

      mocks.executeHostedMailboxEvent.mockImplementationOnce(async (input) => {
        const { applyHostedMemberPreferences } = await import(
          "../src/hosted-runtime/context.ts"
        );
        await applyHostedMemberPreferences(
          input.vaultRoot,
          olderWake,
          input.preferenceCausalSeq ?? "0",
          input.preferenceAppliedAt,
        );
        return {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "member-preferences-updated",
          nextWakeAt: null,
          postCheckpointRecord: null,
          redactedLogEntries: [],
        };
      });

      const retried = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => "2026-04-27T00:02:00.000Z",
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(retried?.status, "processed");
      const preferences = await readPreferencesDocument(workspace.vaultRoot);
      assert.deepEqual(
        preferences.assistant?.personality,
        {
          detail: 7,
          humor: 9,
        },
      );
      assert.equal(preferences.updatedAt, "2026-04-27T00:01:00.000Z");
      assert.deepEqual(
        (await readHostedSystemMailboxState(workspace.vaultRoot)).pending,
        [],
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("drains a restored legacy preference item without a causal token", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: "member.preferences.updated:legacy-v1",
      memberId: "member_123",
      occurredAt: FIXED_NOW,
      preferences: { personality: { humor: 2 } },
    });

    try {
      await mkdir(workspace.vaultRoot, { recursive: true });
      await writeFile(path.join(workspace.vaultRoot, VAULT_LAYOUT.metadata), "{}", "utf8");
      await updateAssistantPreferences({
        causalOrigin: "turn",
        causalSeq: "0",
        preferences: { personality: { humor: 9 } },
        vaultRoot: workspace.vaultRoot,
      });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberPreferencesItem({ causalSeq: null }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });
      const statePath = path.join(
        resolveAssistantStatePaths(workspace.vaultRoot).assistantStateRoot,
        "hosted-system-mailbox.json",
      );
      const restoredState: {
        value: { pending: Array<Record<string, unknown>> };
      } = JSON.parse(await readFile(statePath, "utf8"));
      delete restoredState.value.pending[0]?.preferenceCausalSeq;
      await writeFile(statePath, `${JSON.stringify(restoredState, null, 2)}\n`, "utf8");
      mocks.executeHostedMailboxEvent.mockImplementationOnce(async (input) => {
        const { applyHostedMemberPreferences } = await import(
          "../src/hosted-runtime/context.ts"
        );
        await applyHostedMemberPreferences(
          input.vaultRoot,
          wake,
          input.preferenceCausalSeq ?? "0",
          input.preferenceAppliedAt,
        );
        return {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "member-preferences-updated",
          nextWakeAt: null,
          postCheckpointRecord: null,
          redactedLogEntries: [],
        };
      });

      const result = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(result?.status, "processed");
      assert.equal(
        (await readPreferencesDocument(workspace.vaultRoot))
          .assistant?.personality?.humor,
        9,
      );
      assert.deepEqual(
        (await readHostedSystemMailboxState(workspace.vaultRoot)).pending,
        [],
      );
    } finally {
      await workspace.cleanup();
    }
  });
});

function createLegacyUsageReferralNotificationWake(input: {
  eventId: string;
  externalThreadRouteAuthority?: {
    channel: "linq";
    containerMemberId: string;
    threadId: string;
  };
  memberId: string;
  notificationKey: string;
  target: string;
}) {
  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: input.eventId,
    memberId: input.memberId,
    notification: {
      deliveryDedupeToken: input.notificationKey,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: input.notificationKey,
      ...(input.externalThreadRouteAuthority
        ? {
            externalThreadRouteAuthority:
              input.externalThreadRouteAuthority,
          }
        : {}),
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

async function persistAlreadyImportedNotification(input: {
  eventId: string;
  mailboxItemId: string;
  mailboxLaneSeq: string;
  runtimeState: "restored" | "warm";
  vaultRoot: string;
  wake: ReturnType<typeof createLegacyUsageReferralNotificationWake>;
}): Promise<void> {
  if (input.runtimeState === "warm") {
    await enqueueHostedSystemMailboxItem({
      item: createResolvedNotificationItem({
        dedupeKey: input.eventId,
        id: input.mailboxItemId,
        laneSeq: input.mailboxLaneSeq,
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
            mailboxLaneSeq: input.mailboxLaneSeq,
            nextAttemptAt: null,
            occurredAt: input.wake.occurredAt,
            postCheckpointRecord: null,
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
        system: input.mailboxLaneSeq,
      },
    },
    vaultRoot: input.vaultRoot,
  });
}

function createAssistantNotificationMailboxMetrics() {
  return {
    bootstrapResult: null,
    conversationMetrics: null,
    mailboxLane: "assistant-notification" as const,
    nextWakeAt: null,
    postCheckpointRecord: null,
    redactedLogEntries: [],
  };
}

function createRuntimeWithExternalRouteAuthority(
  assertExternalThreadRouteAuthority: NonNullable<
    HostedRuntimePlatform["effectsPort"]["assertExternalThreadRouteAuthority"]
  >,
): HostedSystemMailboxRuntimeForTest {
  return createRuntime({
    effectsPort: {
      assertExternalThreadRouteAuthority,
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {},
    },
  });
}

function createRuntime(
  platformOverrides: Partial<HostedRuntimePlatform>,
): HostedSystemMailboxRuntimeForTest {
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
    ...platformOverrides,
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

function createDeviceSyncPortStub(): NonNullable<HostedRuntimePlatform["deviceSyncPort"]> {
  return {
    async ackDirtyStateProcessed() {
      throw new Error("ackDirtyStateProcessed should not be called");
    },
    async applyUpdates() {
      throw new Error("applyUpdates should not be called");
    },
    async createConnectLink() {
      throw new Error("createConnectLink should not be called");
    },
    async fetchDirtyStates() {
      return {
        hasMore: false,
        items: [],
        nextWakeAt: null,
        userId: "member_123",
      };
    },
    async fetchSnapshot() {
      throw new Error("fetchSnapshot should not be called");
    },
  };
}

function createResolvedNotificationItem(overrides: Partial<{
  dedupeKey: string;
  id: string;
  laneSeq: string;
  occurredAt: string;
}> = {}): HostedMailboxResolvedImportItem {
  const occurredAt = overrides.occurredAt ?? FIXED_NOW;
  const item: HostedMailboxItem = {
    createdAt: occurredAt,
    dedupeKey:
      overrides.dedupeKey
      ?? "assistant.notification.requested:gateway-billing",
    expiresAt: null,
    id: overrides.id ?? "mailbox_item_system_notification",
    kind: "assistant.notification.requested",
    lane: "system",
    laneSeq: overrides.laneSeq ?? "1",
    occurredAt,
    payloadBytes: 64,
    payloadInlineCiphertext: "ciphertext",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: occurredAt,
    userId: "member_123",
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

function createResolvedAssistantAskCompletionItem(overrides: Partial<{
  dedupeKey: string;
  id: string;
  laneSeq: string;
  occurredAt: string;
  requestId: string;
}> = {}): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: overrides.dedupeKey ?? "aask_done_system_internal",
    expiresAt: null,
    id: overrides.id ?? "mailbox_item_system_assistant_ask_completed",
    kind: "assistant.ask.completed",
    lane: "system",
    laneSeq: overrides.laneSeq ?? "1",
    occurredAt: overrides.occurredAt ?? FIXED_NOW,
    payloadBytes: 64,
    payloadInlineCiphertext: "ciphertext",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: FIXED_NOW,
    userId: "member_group_runtime",
  };

  return {
    item,
    payload: {
      payloadCiphertext: "ciphertext",
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      requestId: overrides.requestId ?? "aask_req_system_internal",
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

function createResolvedMemberPreferencesItem(overrides: Partial<{
  causalSeq: string | null;
  id: string;
  laneSeq: string;
}> = {}): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    causalSeq: overrides.causalSeq === undefined
      ? (overrides.laneSeq ?? "1")
      : overrides.causalSeq,
    createdAt: FIXED_NOW,
    dedupeKey: "member.preferences.updated:member_123",
    expiresAt: null,
    id: overrides.id ?? "mailbox_item_system_member_preferences",
    kind: "member.preferences.updated",
    lane: "system",
    laneSeq: overrides.laneSeq ?? "1",
    occurredAt: FIXED_NOW,
    payloadBytes: 64,
    payloadInlineCiphertext: "ciphertext",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: FIXED_NOW,
    userId: "member_123",
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
      action: "apply-member-preferences",
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

function createPendingMemberPreferencesItem(input: {
  itemId: string;
  laneSeq: string;
  occurredAt: string;
  wake: HostedSystemMailboxPendingItem["wake"];
}): HostedSystemMailboxPendingItem {
  return {
    attemptCount: 0,
    itemId: input.itemId,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    mailboxDedupeKey: "member.preferences.updated:member_123",
    mailboxLaneSeq: input.laneSeq,
    nextAttemptAt: null,
    occurredAt: input.occurredAt,
    postCheckpointRecord: null,
    requestId: null,
    routeAction: "apply-member-preferences",
    status: "pending",
    wake: input.wake,
  };
}

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
    userId: "member_123",
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

function createResolvedMemberChannelsItem(input: {
  id: string;
  laneSeq: string;
}): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: `member.channels.updated:${input.laneSeq}`,
    expiresAt: null,
    id: input.id,
    kind: "member.channels.updated",
    lane: "system",
    laneSeq: input.laneSeq,
    occurredAt: FIXED_NOW,
    payloadBytes: 64,
    payloadInlineCiphertext: "ciphertext",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: FIXED_NOW,
    userId: "member_123",
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
      action: "apply-member-channels-update",
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

function createResolvedRuntimeControlItem(
  overrides: Partial<Pick<
    HostedMailboxItem,
    "dedupeKey" | "id" | "kind" | "laneSeq"
  >> = {},
): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: "runtime-control:manual",
    expiresAt: null,
    id: "mailbox_item_system_runtime_control",
    kind: "runtime.manual-requested",
    lane: "system",
    laneSeq: "1",
    occurredAt: FIXED_NOW,
    payloadBytes: 64,
    payloadInlineCiphertext: "ciphertext",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: FIXED_NOW,
    userId: "member_123",
    ...overrides,
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
      action: "apply-runtime-control-request",
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

function createResolvedCodexAuthRuntimeControlItem(
  overrides: Partial<{ laneSeq: string }> = {},
): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: "runtime-control:codex-auth",
    expiresAt: null,
    id: "mailbox_item_system_codex_auth",
    kind: "runtime.codex-auth-requested",
    lane: "system",
    laneSeq: overrides.laneSeq ?? "1",
    occurredAt: FIXED_NOW,
    payloadBytes: 64,
    payloadInlineCiphertext: "ciphertext",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: FIXED_NOW,
    userId: "member_123",
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
      action: "apply-runtime-control-request",
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

function createResolvedDeviceSyncItem(overrides: Partial<{
  id: string;
  laneSeq: string;
}> = {}): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: "device-sync.wake:yield",
    expiresAt: null,
    id: overrides.id ?? "mailbox_item_system_device_sync",
    kind: "device-sync.wake",
    lane: "system",
    laneSeq: overrides.laneSeq ?? "1",
    occurredAt: FIXED_NOW,
    payloadBytes: 64,
    payloadInlineCiphertext: "ciphertext",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: FIXED_NOW,
    userId: "member_123",
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
      action: "run-device-sync-wake",
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
