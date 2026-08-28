import {
  PREPARED_HOSTED_ASSISTANT_RUNTIME_STATE,
  createAssistantUsageRecord,
  createBrowserVaultRefreshSystemMailboxItem,
  createDeliveryEffect,
  createDueAssistantWorkspace,
  createPhaseInput,
  createPreparedDispatchesForDeliveryEffect,
  createSentDeliveryOutcome,
  createSystemMailboxItem,
  expectAssistantLaneCallWithoutDeviceSyncOptions,
  extractTopLevelFunctionBody,
  mocks,
  writeHostedPhaseExperimentSource,
} from "./hosted-runtime-workspace-assistant-phase.harness.ts";

import type {
  RuntimeAssistantConfigurationToolPort,
  RuntimeLabsToolPort,
  RuntimeSubscriptionToolPort,
  RuntimeUsageRecordPort,
} from "./hosted-runtime-workspace-assistant-phase.harness.ts";

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type HostedMailboxItem,
  type HostedRuntimeGroupSummary,
  type HostedRuntimeGroupToolRequest,
  type HostedRuntimeLatencyTraceRequest,
  type HostedRuntimeLogRequest,
} from "@murphai/hosted-execution/runtime-control";
import {
  ASSISTANT_USAGE_SCHEMA,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import {
  HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
} from "@murphai/hosted-execution/orchestration-control";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
} from "@murphai/hosted-execution/env";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeVault,
  patchAutomation,
  showAutomation,
  splitAutomationAvailabilityConflictBlock,
  upsertAutomation,
} from "@murphai/core";
import {
  buildOnboardingFirstPersonalReadAutomationSaveRequest,
  completeAssistantOnboarding,
  getAssistantCronJob,
  markAssistantContextSnapshotDirty,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
  readAssistantContextSnapshotState,
  saveAssistantAutomationState,
  saveAssistantSession,
  setAssistantCronJobEnabled,
  upsertAssistantInputEvent,
  type AssistantAutomationOperationScope,
  type AssistantExecutionContext,
} from "@murphai/assistant-engine";
import {
  runHostedWorkspaceAssistantPhase,
  type HostedWorkspaceRuntimeAssistantPhaseInput,
} from "../src/hosted-runtime/workspace-assistant-phase.ts";
import {
  isHostedDeviceSyncMaintenanceModuleLoadError,
  loadHostedDeviceSyncMaintenanceModule,
} from "../src/hosted-runtime/device-sync-maintenance-import.ts";

describe("runHostedWorkspaceAssistantPhase runtime logs", () => {
  it("keeps foreground reply orchestration separate from background maintenance", async () => {
    const source = await readFile(
      new URL("../src/hosted-runtime/workspace-assistant-phase.ts", import.meta.url),
      "utf8",
    );
    const body = extractTopLevelFunctionBody(source, "runForegroundAssistantReplyPhase");

    expect(body).toContain("collectForegroundDeliveryEffects");
    expect(body).not.toContain("prepareHostedSystemMailboxItemForCheckpoint");
    expect(body).not.toContain("runHostedDeviceSyncWakeLane");
    expect(body).not.toContain("readHostedProviderCleanupCheckpoint");
    expect(body).not.toContain("includeBackgroundDueIntents: true");
  });

  it("uses post-delivery wake normalization for member-channel barriers", async () => {
    const source = await readFile(
      new URL("../src/hosted-runtime/workspace-assistant-phase.ts", import.meta.url),
      "utf8",
    );
    const body = extractTopLevelFunctionBody(
      source,
      "buildHostedMemberChannelDeliveryBarrierResult",
    );

    expect(body).toContain("dropConsumedPostDeliveryWorkspaceAssistantWake");
    expect(body).toContain("resolveHostedPostDeliveryBaseNextWake(input.input)");
    expect(body).not.toContain("input.input.baseNextWake,");
  });

  it("hydrates the hosted default assistant target before running automation", async () => {
    const hostedDefaultTarget = {
      adapter: "codex-cli" as const,
      approvalPolicy: "never" as const,
      codexCommand: null,
      model: "gpt-5.6-terra",
      modelProvider: "openai",
      oss: false,
      profile: null,
      reasoningEffort: "medium" as const,
      sandbox: "danger-full-access" as const,
    };
    mocks.hydrateHostedExecutionDefaultTarget.mockImplementationOnce(async (value) => ({
      ...value,
      hosted: {
        ...value.hosted,
        defaultTarget: hostedDefaultTarget,
      },
    }));

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      requestAttemptId: "runtime-write-e2cfcf20-f792-4133-b40b-3f381b371dda",
      runtimeIssueProvenance: {
        releaseSha: "0123456789abcdef0123456789abcdef01234567",
        runtimeName: "cloudflare-hosted-runner",
      },
    }));

    expect(mocks.hydrateHostedExecutionDefaultTarget).toHaveBeenCalledWith(
      {
        hosted: expect.objectContaining({
          memberId: "member_synthetic_phase",
          releaseSha: "0123456789abcdef0123456789abcdef01234567",
          runtimeAttemptId:
            "runtime-write-e2cfcf20-f792-4133-b40b-3f381b371dda",
          runtimeName: "cloudflare-hosted-runner",
          userEnvKeys: [],
        }),
      },
      {
        homeDirectory: "/tmp/murph-operator-home",
        runtimeEnv: {},
      },
    );
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: expect.objectContaining({
          hosted: expect.objectContaining({
            defaultTarget: hostedDefaultTarget,
            releaseSha: "0123456789abcdef0123456789abcdef01234567",
            runtimeAttemptId:
              "runtime-write-e2cfcf20-f792-4133-b40b-3f381b371dda",
            runtimeName: "cloudflare-hosted-runner",
          }),
        }),
      }),
    );
  });

  it("rechecks exact Web ownership after the model and before turn commit", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-turn-commit-authority-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const authorityError = Object.assign(
      new Error("Web already answered the exact inbound"),
      {
        code: "HOSTED_LINQ_INSTANT_FIRST_TURN_ALREADY_ANSWERED",
        retryable: false,
      },
    );

    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        vaultRoot,
      });
      const persisted = await upsertAssistantInputEvent({
        event: {
          content: {
            text: "hello",
            transcriptText: "hello",
            userMessageContent: [{ text: "hello", type: "text" as const }],
          },
          conversation: {
            accountId: `hid_${"1".repeat(32)}`,
            actorId: `hid_${"2".repeat(32)}`,
            actorIsSelf: false,
            source: "linq",
            threadId: `hid_${"3".repeat(32)}`,
            threadIsDirect: true,
          },
          occurredAt: "2026-04-27T00:00:00.000Z",
          receivedAt: "2026-04-27T00:00:00.500Z",
          replyTarget: {
            channel: "linq",
            messageId: "linq_message_first_turn",
            threadId: "linq_chat_first_turn",
          },
          sourceMetadata: {
            externalThreadRouteAuthorityPresent: false,
            kind: "linq" as const,
            partCount: 0,
            reactionEligible: false,
            replyToMessageId: null,
            senderHandle: "+15555550123",
            service: "iMessage",
          },
          sourceRef: {
            dedupeKey: "dedupe_first_turn",
            eventId: "event_first_turn",
            itemId: "mailbox_item_first_turn",
            kind: "hosted-mailbox" as const,
            lane: "conversation" as const,
            laneSeq: "1",
            payloadSchema: "murph.hosted-mailbox-payload.v1",
            payloadSource: "inline" as const,
            source: "hosted-mailbox" as const,
            wakeSchema: "murph.hosted-execution-wake.v1",
          },
        },
        vault: vaultRoot,
      });
      const assistantAutomation = await vi.importActual<
        typeof import("@murphai/assistant-engine/assistant-automation")
      >("@murphai/assistant-engine/assistant-automation");
      mocks.readAssistantInputEvent.mockImplementation(
        assistantAutomation.readAssistantInputEvent,
      );
      mocks.assertHostedAssistantLinqTurnCommitAuthority
        .mockRejectedValueOnce(authorityError);
      mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
        const assertTurnCommitAuthority =
          laneInput.executionContext.hosted?.assertTurnCommitAuthority;
        if (!assertTurnCommitAuthority) {
          throw new Error("Expected hosted turn commit authority.");
        }
        await assertTurnCommitAuthority({
          acceptedInputs: [{
            id: persisted.inputId,
            source: "assistant-input",
          }],
          turnId: "turn_first_contact",
        });
        throw new Error("Expected turn commit authority to reject.");
      });

      await expect(runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [persisted.inputId],
        importedCount: 1,
        vaultRoot,
      }))).rejects.toMatchObject({
        code: "HOSTED_LINQ_INSTANT_FIRST_TURN_ALREADY_ANSWERED",
      });
      expect(
        mocks.assertHostedAssistantLinqTurnCommitAuthority,
      ).toHaveBeenCalledWith(expect.objectContaining({
        linqDeliveryContexts: [expect.objectContaining({
          replyToMessageId: "linq_message_first_turn",
          target: "linq_chat_first_turn",
          threadIsDirect: true,
        })],
      }));
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("starts the assistant lane before a scheduled group operation lazily reads the Web-owned shared snapshot", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "hosted-share-authority-"));
    const sequence: string[] = [];
    const request: NonNullable<
      HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["groupToolPort"]
    >["request"] = vi.fn(async (request) => {
      sequence.push("read_shared");
      expect(request).toEqual({
        action: "read_shared",
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      });
      return {
        action: "read_shared" as const,
        result: {
          members: [{
            currentTurnHandles: [],
            displayName: "Ada",
            memberId: "member_shared_current",
            participantId: "participant_shared_current",
            projections: [{
              dataStatus: "missing" as const,
              grantStatus: "not_granted" as const,
              projectionScope: { projectionKind: "steps-days.v0" as const },
              projectionScopeKey: "steps-days.v0",
              records: [],
            }],
          }],
          requestedProjectionScopeKeys: ["steps-days.v0"],
          status: "ok" as const,
        },
      };
    });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      sequence.push("assistant_lane");
      expect(request).not.toHaveBeenCalled();
      expect(laneInput.executionContext.hosted?.groupSharedReader).toBeUndefined();
      const createScheduledGroupTools =
        laneInput.executionContext.hosted?.createScheduledGroupTools;
      expect(createScheduledGroupTools).toEqual(expect.any(Function));
      if (!createScheduledGroupTools) {
        throw new Error("Expected the scheduled group capability factory.");
      }
      expect(createScheduledGroupTools({
        channel: "linq",
        target: "chat_direct",
        threadIsDirect: true,
      })).toBeNull();
      const scheduledGroupTools = createScheduledGroupTools({
        channel: "linq",
        target: "chat_current_group",
        threadIsDirect: false,
      });
      expect(scheduledGroupTools).not.toBeNull();
      if (!scheduledGroupTools) {
        throw new Error("Expected scheduled group capabilities.");
      }
      expect(scheduledGroupTools.groupTool).toEqual({ request });
      expect(request).not.toHaveBeenCalled();
      await expect(scheduledGroupTools.groupSharedReader.request({
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      })).resolves.toMatchObject({ status: "ok" });
      const telegramGroupTools = createScheduledGroupTools({
        channel: "telegram",
        target: "telegram_current_group",
        threadIsDirect: false,
      });
      expect(telegramGroupTools).not.toBeNull();
      if (!telegramGroupTools) {
        throw new Error("Expected scheduled Telegram group capabilities.");
      }
      expect(telegramGroupTools.groupPermissionOfferTool).toEqual({
        request: expect.any(Function),
      });
      await expect(telegramGroupTools.groupSharedReader.request({
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      })).resolves.toMatchObject({ status: "ok" });
      return {
        assistantAutomationProgressed: false,
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    try {
      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        runtimeGroupToolPort: { request },
        vaultRoot,
      }));
      expect(sequence).toEqual(["assistant_lane", "read_shared", "read_shared"]);
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("allows one scheduled access link only for exact not-granted evidence from the same model operation", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "hosted-scheduled-group-offer-"));
    const groupToolRequests: HostedRuntimeGroupToolRequest[] = [];
    let readGrantStatus: "granted" | "not_granted" = "not_granted";
    const request: NonNullable<
      HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["groupToolPort"]
    >["request"] = vi.fn(async (groupToolRequest) => {
      groupToolRequests.push(groupToolRequest);
      if (groupToolRequest.action === "read_shared") {
        return {
          action: "read_shared" as const,
          result: {
            members: [{
              currentTurnHandles: [],
              displayName: "Ada",
              memberId: "member_shared_current",
              participantId: "participant_shared_current",
              projections: [{
                dataStatus: "missing" as const,
                grantStatus: readGrantStatus,
                projectionScope: { projectionKind: "steps-days.v0" as const },
                projectionScopeKey: "steps-days.v0",
                records: [],
              }],
            }],
            requestedProjectionScopeKeys: ["steps-days.v0"],
            status: "ok" as const,
          },
        };
      }
      if (groupToolRequest.action === "create_join_link") {
        return {
          action: "create_join_link" as const,
          result: {
            group: null,
            status: "unavailable" as const,
            unavailableReason: "synthetic_web_unavailable",
          },
        };
      }
      throw new Error(`Unexpected group action: ${groupToolRequest.action}`);
    });

    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      const factory = laneInput.executionContext.hosted?.createScheduledGroupTools;
      if (!factory) {
        throw new Error("Expected the scheduled group capability factory.");
      }
      expect(factory({
        channel: "email",
        target: "chat_current_group",
        threadIsDirect: false,
      })).toBeNull();

      const createTools = (channel: "linq" | "telegram" = "linq") => {
        const tools = factory({
          channel,
          target: "chat_current_group",
          threadIsDirect: false,
        });
        if (!tools) {
          throw new Error("Expected scheduled group capabilities.");
        }
        return tools;
      };
      const requirePermissionOffer = (tools: ReturnType<typeof createTools>) => {
        const permissionOffer = tools.groupPermissionOfferTool;
        if (!permissionOffer) {
          throw new Error("Expected scheduled Linq permission offer capability.");
        }
        return permissionOffer;
      };
      const stepsOffer = {
        projectionScopes: [{ projectionKind: "steps-days.v0" as const }],
      };

      const beforeRead = createTools();
      await expect(requirePermissionOffer(beforeRead).request(stepsOffer))
        .resolves.toMatchObject({
          result: {
            unavailableReason: "scheduled_group_permission_offer_unavailable",
          },
        });

      const unobserved = createTools();
      await unobserved.groupSharedReader.request({
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      });
      await expect(requirePermissionOffer(unobserved).request({
        projectionScopes: [{ projectionKind: "device-sync-status.v0" }],
      })).resolves.toMatchObject({
        result: {
          unavailableReason: "scheduled_group_permission_offer_unavailable",
        },
      });

      const grantedMissing = createTools();
      await grantedMissing.groupSharedReader.request({
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      });
      readGrantStatus = "granted";
      await grantedMissing.groupSharedReader.request({
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      });
      await expect(requirePermissionOffer(grantedMissing).request(stepsOffer))
        .resolves.toMatchObject({
          result: {
            unavailableReason: "scheduled_group_permission_offer_unavailable",
          },
        });

      readGrantStatus = "not_granted";
      const allowed = createTools();
      await allowed.groupSharedReader.request({
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      });
      await expect(requirePermissionOffer(allowed).request(stepsOffer))
        .resolves.toMatchObject({
          result: { unavailableReason: "synthetic_web_unavailable" },
        });
      await expect(requirePermissionOffer(allowed).request(stepsOffer))
        .resolves.toMatchObject({
          result: {
            unavailableReason: "scheduled_group_permission_offer_unavailable",
          },
        });

      const telegramAllowed = createTools("telegram");
      await telegramAllowed.groupSharedReader.request({
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      });
      await expect(requirePermissionOffer(telegramAllowed).request(stepsOffer))
        .resolves.toMatchObject({
          result: { unavailableReason: "synthetic_web_unavailable" },
        });

      return {
        assistantAutomationProgressed: false,
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    try {
      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        runtimeGroupToolPort: { request },
        vaultRoot,
      }));
      expect(groupToolRequests.filter((item) => item.action === "read_shared"))
        .toHaveLength(5);
      expect(groupToolRequests.filter((item) => item.action === "create_join_link"))
        .toEqual([
          {
            action: "create_join_link",
            joinLink: {
              requestedVaultShareProjectionScopes: [
                { projectionKind: "steps-days.v0" },
              ],
            },
          },
          {
            action: "create_join_link",
            joinLink: {
              requestedVaultShareProjectionScopes: [
                { projectionKind: "steps-days.v0" },
              ],
            },
          },
        ]);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("exposes current-input authority with hosted personalization", async () => {
    const assistantPersonalizationToolPort = {
      request: vi.fn(),
    };
    const currentAssistantInputId = () =>
      "ain_33333333333333333333333333333333";

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      currentAssistantInputId,
      runtimeAssistantPersonalizationToolPort: assistantPersonalizationToolPort,
    }));

    expect(mocks.hydrateHostedExecutionDefaultTarget).toHaveBeenCalledWith(
      {
        hosted: expect.objectContaining({
          currentAssistantInputId,
          personalizationTool: assistantPersonalizationToolPort,
        }),
      },
      expect.any(Object),
    );
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: expect.objectContaining({
          hosted: expect.objectContaining({
            currentAssistantInputId,
            personalizationTool: assistantPersonalizationToolPort,
          }),
        }),
      }),
    );
  });

  it("resolves scheduled Linq routes through egress authority and fails closed", async () => {
    const signal = new AbortController().signal;
    const assertLinqRecentInboundEngagement = vi.fn()
      .mockResolvedValueOnce({
        resolvedRoute: {
          conversationThreadId: null,
          directRecipientPhoneNumber: null,
          fromPhoneNumber: "+15550002",
          target: "chat_current_group",
          targetKind: "thread" as const,
          threadIsDirect: false,
        },
      })
      .mockResolvedValueOnce({
        resolvedRoute: {
          conversationThreadId: "hid_current_direct",
          directRecipientPhoneNumber: "+15550001",
          fromPhoneNumber: "+15550002",
          target: "chat_current_direct",
          targetKind: "thread" as const,
          threadIsDirect: true,
        },
      })
      .mockResolvedValueOnce({
        resolvedRoute: {
          conversationThreadId: null,
          directRecipientPhoneNumber: "+15550001",
          fromPhoneNumber: "+15550002",
          target: "chat_current_direct",
          targetKind: "thread" as const,
          threadIsDirect: null,
        },
      });
    const phaseInput = createPhaseInput({});
    phaseInput.runtime.platform.effectsPort.assertLinqRecentInboundEngagement =
      assertLinqRecentInboundEngagement;
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(
      async ({ executionContext }) => {
        const resolveScheduledLinqRoute =
          executionContext.hosted?.resolveScheduledLinqRoute;
        if (!resolveScheduledLinqRoute) {
          throw new Error("Expected scheduled Linq route authority.");
        }

        await expect(resolveScheduledLinqRoute({
          homeRouteFallbackAllowed: false,
          signal,
          target: "chat_saved_group",
          targetKind: "thread",
        })).resolves.toEqual({
          target: "chat_current_group",
          threadIsDirect: false,
        });
        await expect(resolveScheduledLinqRoute({
          homeRouteFallbackAllowed: true,
          target: "chat_saved_direct",
          targetKind: "explicit",
        })).resolves.toEqual({
          conversationThreadId: "hid_current_direct",
          target: "chat_current_direct",
          threadIsDirect: true,
        });
        await expect(resolveScheduledLinqRoute({
          homeRouteFallbackAllowed: true,
          target: "chat_saved_direct",
          targetKind: "explicit",
        })).rejects.toMatchObject({
          code: "ASSISTANT_LINQ_AUDIENCE_AUTHORITY_UNAVAILABLE",
        });

        return {
          assistantAutomationCurrentTurnDeliveryIntentIds: [],
          assistantAutomationProgressed: false,
          nextWakeAt: null,
          redactedLogEntries: [],
        };
      },
    );

    await runHostedWorkspaceAssistantPhase(phaseInput);

    expect(assertLinqRecentInboundEngagement).toHaveBeenCalledWith({
      authorityCheckOnly: true,
      homeRouteFallbackAllowed: false,
      target: "chat_saved_group",
      targetKind: "thread",
    }, { signal });
  });

  it("resolves scheduled Telegram group authority through the live Web route owner", async () => {
    const signal = new AbortController().signal;
    const assertExternalThreadRouteAuthority = vi.fn(async () => undefined);
    const phaseInput = createPhaseInput({});
    phaseInput.runtime.platform.effectsPort.assertExternalThreadRouteAuthority =
      assertExternalThreadRouteAuthority;
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(
      async ({ executionContext }) => {
        const resolveScheduledExternalThreadRoute =
          executionContext.hosted?.resolveScheduledExternalThreadRoute;
        if (!resolveScheduledExternalThreadRoute) {
          throw new Error("Expected scheduled external thread route authority.");
        }

        await expect(resolveScheduledExternalThreadRoute({
          channel: "telegram",
          signal,
          target: "telegram_group_123",
        })).resolves.toEqual({
          channel: "telegram",
          containerMemberId: "member_synthetic_phase",
          threadId: "telegram_group_123",
        });

        return {
          assistantAutomationCurrentTurnDeliveryIntentIds: [],
          assistantAutomationProgressed: false,
          nextWakeAt: null,
          redactedLogEntries: [],
        };
      },
    );

    await runHostedWorkspaceAssistantPhase(phaseInput);

    expect(assertExternalThreadRouteAuthority).toHaveBeenCalledWith({
      channel: "telegram",
      containerMemberId: "member_synthetic_phase",
      threadId: "telegram_group_123",
    }, { signal });
  });

  it("passes the hosted assistant configuration port into assistant execution", async () => {
    const assistantConfigurationToolPort: RuntimeAssistantConfigurationToolPort = {
      request: vi.fn(),
    };

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      runtimeAssistantConfigurationToolPort: assistantConfigurationToolPort,
    }));

    expect(mocks.hydrateHostedExecutionDefaultTarget).toHaveBeenCalledWith(
      {
        hosted: expect.objectContaining({
          assistantConfigurationTool: assistantConfigurationToolPort,
        }),
      },
      expect.any(Object),
    );
  });

  it("passes the hosted subscription port into assistant execution", async () => {
    const subscriptionToolPort: RuntimeSubscriptionToolPort = {
      request: vi.fn(),
    };

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      runtimeSubscriptionToolPort: subscriptionToolPort,
    }));

    expect(mocks.hydrateHostedExecutionDefaultTarget).toHaveBeenCalledWith(
      {
        hosted: expect.objectContaining({
          subscriptionTool: subscriptionToolPort,
        }),
      },
      expect.any(Object),
    );
  });

  it("passes the hosted labs port into assistant execution when available", async () => {
    const labsToolPort: RuntimeLabsToolPort = {
      request: vi.fn(),
    };

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      runtimeLabsToolPort: labsToolPort,
    }));

    expect(mocks.hydrateHostedExecutionDefaultTarget).toHaveBeenCalledWith(
      {
        hosted: expect.objectContaining({
          labsTool: labsToolPort,
        }),
      },
      expect.any(Object),
    );
  });

  it("omits the hosted labs port from assistant execution when unavailable", async () => {
    await runHostedWorkspaceAssistantPhase(createPhaseInput({}));

    expect(mocks.hydrateHostedExecutionDefaultTarget).toHaveBeenCalledWith(
      {
        hosted: expect.not.objectContaining({
          labsTool: expect.anything(),
        }),
      },
      expect.any(Object),
    );
  });

  it("prepares hosted assistant automation state before running scheduled automation", async () => {
    const runtimeEnv = {};
    const runtimeForwardedEnv = {
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      LINQ_API_BASE_URL: "https://linq.example.test",
    };
    const operatorHomeRoot = "/tmp/murph-operator-home-runtime";
    const vaultRoot = "/tmp/murph-vault-runtime";
    const callOrder: string[] = [];

    mocks.prepareHostedAssistantAutomationForWake.mockImplementationOnce(
      async () => {
        callOrder.push("prepare");
        return PREPARED_HOSTED_ASSISTANT_RUNTIME_STATE;
      },
    );
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      callOrder.push("run");
      return {
        assistantAutomationProgressed: false,
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      operatorHomeRoot,
      runtimeEnv,
      runtimeForwardedEnv,
      vaultRoot,
    }));

    expect(mocks.prepareHostedAssistantAutomationForWake).toHaveBeenCalledWith(
      vaultRoot,
      expect.objectContaining({
        kind: "runtime.timer",
        triggerKind: "runtime_timer",
        userId: "member_synthetic_phase",
      }),
      runtimeForwardedEnv,
      expect.objectContaining({
        channelCapabilities: expect.objectContaining({
          emailSendReady: false,
        }),
      }),
      {
        operatorHomeRoot,
      },
    );
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantRuntimeState: PREPARED_HOSTED_ASSISTANT_RUNTIME_STATE,
      }),
    );
    expect(callOrder).toEqual(["prepare", "run"]);
  });

  it("passes hosted runtime environment explicitly without mutating process globals", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "hosted-phase-vault-"));
    const operatorHomeRoot = await mkdtemp(path.join(tmpdir(), "hosted-phase-home-"));
    const codexHome = path.join(operatorHomeRoot, ".codex-hosted");
    const codexShimPath = path.join(codexHome, "bin/codex");
    const previousCommand = process.env[HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV];
    const previousCodexHome = process.env.CODEX_HOME;
    const previousHome = process.env.HOME;
    const previousHostedMarker = process.env[HOSTED_RUNTIME_PROCESS_ENV];
    const previousVault = process.env.VAULT;
    const restoreEnv = (key: string, value: string | undefined) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };

    process.env[HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV] = "ambient-command";
    process.env.CODEX_HOME = "ambient-codex-home";
    process.env.HOME = "ambient-home";
    process.env[HOSTED_RUNTIME_PROCESS_ENV] = "0";
    process.env.VAULT = "ambient-vault";
    const runtimeEnv = {
      CODEX_HOME: codexHome,
      [HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV]: codexShimPath,
      [HOSTED_RUNTIME_PROCESS_ENV]: "1",
      NODE_ENV: "test",
      PATH: "/usr/bin",
    };
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      expect(process.env[HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV]).toBe("ambient-command");
      expect(process.env.CODEX_HOME).toBe("ambient-codex-home");
      expect(process.env.HOME).toBe("ambient-home");
      expect(process.env[HOSTED_RUNTIME_PROCESS_ENV]).toBe("0");
      expect(process.env.VAULT).toBe("ambient-vault");
      expect(laneInput.operatorHomeRoot).toBe(operatorHomeRoot);
      expect(laneInput.runtimeEnv).toEqual(runtimeEnv);
      expect(laneInput.vaultRoot).toBe(vaultRoot);
      return {
        assistantAutomationProgressed: false,
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    try {
      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        operatorHomeRoot,
        runtimeEnv,
        vaultRoot,
      }));

      expect(process.env[HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV])
        .toBe("ambient-command");
      expect(process.env.CODEX_HOME).toBe("ambient-codex-home");
      expect(process.env.HOME).toBe("ambient-home");
      expect(process.env[HOSTED_RUNTIME_PROCESS_ENV]).toBe("0");
      expect(process.env.VAULT).toBe("ambient-vault");
    } finally {
      restoreEnv(HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV, previousCommand);
      restoreEnv("CODEX_HOME", previousCodexHome);
      restoreEnv("HOME", previousHome);
      restoreEnv(HOSTED_RUNTIME_PROCESS_ENV, previousHostedMarker);
      restoreEnv("VAULT", previousVault);
      await rm(vaultRoot, { force: true, recursive: true });
      await rm(operatorHomeRoot, { force: true, recursive: true });
    }
  });

  it("defers hosted usage records until after a progressed assistant checkpoint", async () => {
    const events: string[] = [];
    const deferredUsageRecords: AssistantUsageRecord[] = [];
    const usageRecordPort: RuntimeUsageRecordPort = {
      async recordUsage(record) {
        events.push(`record:${record.usageId}`);
        return {
          platformAiUsageAllowedAfter: true,
          recorded: true,
          usageId: record.usageId,
        };
      },
    };
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
      );
      events.push("assistant");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: true,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      recordDeferredUsage: (record) => {
        deferredUsageRecords.push(record);
        return Promise.resolve();
      },
      runtimeUsageRecordPort: usageRecordPort,
    }));

    const hydratedContext = mocks.hydrateHostedExecutionDefaultTarget.mock.calls[0]?.[0];
    expect(hydratedContext?.hosted?.usageRecorder).toEqual({
      recordUsage: expect.any(Function),
    });
    expect(deferredUsageRecords).toEqual([
      expect.objectContaining({
        usageId: "turn_direct_usage.attempt-1",
      }),
    ]);
    expect(events).toEqual(["assistant"]);

    events.push("checkpoint");
    for (const record of deferredUsageRecords) {
      await usageRecordPort.recordUsage(record);
    }

    expect(events).toEqual([
      "assistant",
      "checkpoint",
      "record:turn_direct_usage.attempt-1",
    ]);
  });

  it("propagates deferred usage completion to hosted recorder callers", async () => {
    let releaseDeferredUsage: () => void = () => undefined;
    const deferredUsage = new Promise<void>((resolve) => {
      releaseDeferredUsage = resolve;
    });
    let markDeferredUsageStarted: () => void = () => undefined;
    const deferredUsageStarted = new Promise<void>((resolve) => {
      markDeferredUsageStarted = resolve;
    });
    const laneFinished = vi.fn();
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
      );
      laneFinished();
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: false,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    const phase = runHostedWorkspaceAssistantPhase(createPhaseInput({
      recordDeferredUsage: () => {
        markDeferredUsageStarted();
        return deferredUsage;
      },
      runtimeUsageRecordPort: {
        async recordUsage() {
          throw new Error("The assistant phase must not write usage directly.");
        },
      },
    }));

    await deferredUsageStarted;
    expect(laneFinished).not.toHaveBeenCalled();

    releaseDeferredUsage();
    await phase;
    expect(laneFinished).toHaveBeenCalledOnce();
  });

  it("forwards exact accepted input IDs for deferred route resolution", async () => {
    const deferredAcceptedInputIds: unknown[] = [];
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
        ["assistant_input_a"],
      );
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
        ["assistant_input_b"],
      );
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
        ["assistant_input_a", "assistant_input_b"],
      );
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
        ["assistant_input_telegram_a", "assistant_input_telegram_b"],
      );
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
        ["assistant_input_personal_linq_a", "assistant_input_personal_linq_b"],
      );
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
        ["assistant_input_external_linq_a", "assistant_input_external_linq_b"],
      );
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
        ["assistant_input_late"],
      );
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
        ["assistant_input_unknown"],
      );
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
      );
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: true,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });
    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      initialAssistantInputBatch: {
        assistantInputIds: [
          "assistant_input_a",
          "assistant_input_b",
          "assistant_input_telegram_a",
          "assistant_input_telegram_b",
          "assistant_input_personal_linq_a",
          "assistant_input_personal_linq_b",
          "assistant_input_external_linq_a",
          "assistant_input_external_linq_b",
        ],
        emailDeliveryContexts: [],
        linqDeliveryContexts: [],
      },
      recordDeferredUsage: (_record, providerRequestAcceptedInputIds) => {
        deferredAcceptedInputIds.push(providerRequestAcceptedInputIds);
        return Promise.resolve();
      },
      runtimeUsageRecordPort: {
        async recordUsage(record) {
          return {
            platformAiUsageAllowedAfter: true,
            recorded: true,
            usageId: record.usageId,
          };
        },
      },
    }));

    expect(deferredAcceptedInputIds).toEqual([
      ["assistant_input_a"],
      ["assistant_input_b"],
      ["assistant_input_a", "assistant_input_b"],
      ["assistant_input_telegram_a", "assistant_input_telegram_b"],
      ["assistant_input_personal_linq_a", "assistant_input_personal_linq_b"],
      ["assistant_input_external_linq_a", "assistant_input_external_linq_b"],
      ["assistant_input_late"],
      ["assistant_input_unknown"],
      undefined,
    ]);
  });

  it("flushes deferred usage after existing post-checkpoint work", async () => {
    const events: string[] = [];
    const deferredUsageRecords: AssistantUsageRecord[] = [];
    const usageRecordPort: RuntimeUsageRecordPort = {
      async recordUsage(record) {
        events.push(`record:${record.usageId}`);
        return {
          platformAiUsageAllowedAfter: true,
          recorded: true,
          usageId: record.usageId,
        };
      },
    };
    const defaultRoute = {
      channel: "linq",
      deliverySource: null,
      deliveryTarget: "chat_synthetic_seed_route",
      identityId: "identity_synthetic_seed_route",
      participantId: "participant_synthetic_seed_route",
      threadIsDirect: true,
      threadId: "thread_synthetic_seed_route",
    };
    mocks.readAssistantInputEvent.mockResolvedValueOnce({
      conversation: {
        accountId: defaultRoute.identityId,
        actorId: defaultRoute.participantId,
        actorIsSelf: false,
        source: defaultRoute.channel,
        threadId: defaultRoute.threadId,
        threadIsDirect: true,
      },
      replyTarget: {
        channel: defaultRoute.channel,
        messageId: "message_synthetic_seed_route",
        threadId: defaultRoute.deliveryTarget,
      },
    });
    mocks.applyMurphManagedAutomations.mockImplementationOnce(async () => {
      events.push("managed-automation");
      return {
        created: 1,
        skipped: 0,
        updated: 0,
      };
    });
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 0,
      enabledJobs: 1,
      nextRunAt: "2026-04-30T17:00:00.000Z",
      runningJobs: 0,
      totalJobs: 1,
    });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
      );
      events.push("assistant");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: true,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      recordDeferredUsage: (record) => {
        deferredUsageRecords.push(record);
        return Promise.resolve();
      },
      runtimeUsageRecordPort: usageRecordPort,
    }));

    const hydratedContext = mocks.hydrateHostedExecutionDefaultTarget.mock.calls[0]?.[0];
    expect(hydratedContext?.hosted?.usageRecorder).toEqual({
      recordUsage: expect.any(Function),
    });
    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    expect(mocks.maintainAssistantAutoReplyRouteState).not.toHaveBeenCalled();
    expect(deferredUsageRecords).toEqual([
      expect.objectContaining({
        usageId: "turn_direct_usage.attempt-1",
      }),
    ]);
    expect(events).toEqual(["assistant"]);

    events.push("checkpoint");
    await result.afterCheckpoint?.();

    expect(mocks.maintainAssistantAutoReplyRouteState).toHaveBeenCalledOnce();
    expect(mocks.maintainAssistantAutoReplyRouteState).toHaveBeenCalledWith({
      shouldYield: null,
      signal: null,
      vault: "/tmp/murph-vault",
    });

    expect(events).toEqual([
      "assistant",
      "checkpoint",
      "managed-automation",
    ]);

    for (const record of deferredUsageRecords) {
      await usageRecordPort.recordUsage(record);
    }

    expect(events).toEqual([
      "assistant",
      "checkpoint",
      "managed-automation",
      "record:turn_direct_usage.attempt-1",
    ]);
  });

  it("defers hosted usage records until after a system mailbox checkpoint", async () => {
    const events: string[] = [];
    const deferredUsageRecords: AssistantUsageRecord[] = [];
    const usageRecordPort: RuntimeUsageRecordPort = {
      async recordUsage(record) {
        events.push(`record:${record.usageId}`);
        return {
          platformAiUsageAllowedAfter: true,
          recorded: true,
          usageId: record.usageId,
        };
      },
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(
      async ({ executionContext }) => {
        await executionContext.hosted?.usageRecorder?.recordUsage(
          createAssistantUsageRecord(),
        );
        events.push("system-mailbox");
        return {
          item: createSystemMailboxItem(),
          itemId: "system_mailbox_item_processed",
          metrics: {
            bootstrapResult: null,
            conversationMetrics: null,
            mailboxLane: "assistant-notification",
            redactedLogEntries: [],
          },
          status: "processed",
        };
      },
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      recordDeferredUsage: (record) => {
        deferredUsageRecords.push(record);
        return Promise.resolve();
      },
      runtimeUsageRecordPort: usageRecordPort,
    }));

    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result.checkpointReason).toBe("system_mailbox_receipt");
    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    expect(deferredUsageRecords).toEqual([
      expect.objectContaining({
        usageId: "turn_direct_usage.attempt-1",
      }),
    ]);
    expect(events).toEqual(["system-mailbox"]);

    events.push("checkpoint");
    await result.afterCheckpoint?.();

    expect(events).toEqual([
      "system-mailbox",
      "checkpoint",
    ]);

    for (const record of deferredUsageRecords) {
      await usageRecordPort.recordUsage(record);
    }

    expect(events).toEqual([
      "system-mailbox",
      "checkpoint",
      "record:turn_direct_usage.attempt-1",
    ]);
  });

  it("collects no-progress deferred usage records for runner-owned flushing", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const deferredUsageRecords: AssistantUsageRecord[] = [];
    let usagePortCalled = false;
    const usageRecordPort: RuntimeUsageRecordPort = {
      async recordUsage() {
        usagePortCalled = true;
        throw new Error("Phase should not flush deferred usage directly.");
      },
    };
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
      );
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: false,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      recordDeferredUsage: (record) => {
        deferredUsageRecords.push(record);
        return Promise.resolve();
      },
      runtimeUsageRecordPort: usageRecordPort,
    }));

    expect(result.progressed).toBe(false);
    expect(deferredUsageRecords).toEqual([
      expect.objectContaining({
        usageId: "turn_direct_usage.attempt-1",
      }),
    ]);
    expect(usagePortCalled).toBe(false);
    const usageFailureLog = logRequests.flatMap((request) => request.entries)
      .find((entry) => entry.errorCode === "assistant_usage_record_failed");
    expect(usageFailureLog).toBeUndefined();
  });

  it("checkpoints background route migration when the assistant pass otherwise makes no progress", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: false,
      nextWakeAt: null,
      redactedLogEntries: [],
    });
    mocks.maintainAssistantAutoReplyRouteState.mockResolvedValueOnce({
      changed: true,
      trusted: true,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      progressed: true,
    }));
    expect(mocks.maintainAssistantAutoReplyRouteState).toHaveBeenCalledOnce();
  });

  it("does not turn migration-only foreground progress into managed automation work", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: false,
      nextWakeAt: null,
      redactedLogEntries: [],
    });
    mocks.maintainAssistantAutoReplyRouteState.mockResolvedValueOnce({
      changed: true,
      trusted: true,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      progressed: true,
    }));
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
  });

  it("keeps device-sync options out of the assistant lane when active input is fresh", async () => {
    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions({
      executionContext: expect.objectContaining({
        hosted: expect.objectContaining({
          progressDeliveryDependencies: {},
          providerFetch: null,
        }),
      }),
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
  });

  it("keeps plain webhook nudges out of idle device-sync maintenance", async () => {
    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
  });

  it("checkpoints due message-volume receipt recovery without a system mailbox item", async () => {
    mocks.queueHostedAssistantPendingMessageVolumeReceiptsForVault.mockResolvedValueOnce(1);
    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:01:00.000Z",
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(
      mocks.queueHostedAssistantPendingMessageVolumeReceiptsForVault,
    ).toHaveBeenCalledWith({
      effectsPort: expect.objectContaining({
        recordOutboundMessageVolumeReceipt: expect.any(Function),
      }),
      now: new Date("2026-04-27T00:00:00.000Z"),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      progressed: true,
    }));
  });

  it("keeps browser-vault refresh control work behind fresh conversation input", async () => {
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createBrowserVaultRefreshSystemMailboxItem(),
      itemId: "system_mailbox_item_browser_vault_refresh",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("browserVaultReplicaRefreshRequested");
    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
  });

  it("keeps non-device system mailbox nudges out of idle device-sync maintenance", async () => {
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_processed",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:30:00.000Z",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
    }));
  });

  it("runs the assistant lane before system mailbox work when cron is already due", async () => {
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: "2026-04-27T00:00:00.000Z",
      runningJobs: 0,
      totalJobs: 1,
    });
    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-27T00:00:00.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.getAssistantCronStatus).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        turnEnvironment: expect.objectContaining({
          env: expect.objectContaining({
            [HOSTED_RUNTIME_PROCESS_ENV]: "1",
          }),
        }),
      }),
    );
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
  });

  it("runs a selected model-free mailbox row before already-due cron work", async () => {
    const dueAt = "2026-04-27T00:00:00.000Z";
    mocks.getAssistantCronStatus.mockResolvedValue({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: dueAt,
      runningJobs: 0,
      totalJobs: 1,
    });
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(
      async (input) => {
        if (
          (input?.allowedRouteActions?.length ?? 0) > 0
          || (input?.allowedWakeKinds?.length ?? 0) > 0
        ) {
          return { at: null, executionClass: null, reason: null };
        }
        return {
          at: dueAt,
          executionClass: "model_free",
          reason: "mailbox",
        };
      },
    );
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => dueAt,
      workspace: createDueAssistantWorkspace({ nextWakeAt: dueAt }),
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: dueAt,
      nextWakeReason: "mailbox",
      progressed: false,
    }));
  });

  it("keeps fresh conversation input ahead of a due model-free mailbox row", async () => {
    const dueAt = "2026-04-27T00:00:00.000Z";
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(
      async (input) =>
        (input?.allowedRouteActions?.length ?? 0) > 0
          || (input?.allowedWakeKinds?.length ?? 0) > 0
          ? { at: null, executionClass: null, reason: null }
          : {
              at: dueAt,
              executionClass: "model_free",
              reason: "mailbox",
            },
    );
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      nextWakeAt: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => dueAt,
    }));

    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: dueAt,
      nextWakeReason: "mailbox",
      progressed: true,
    }));
  });

  it("hands a due model-free mailbox row off after a foreground reply", async () => {
    const dueAt = "2026-04-27T00:00:00.000Z";
    const deliveryEffect = createDeliveryEffect();
    mocks.resolveHostedSystemMailboxNextWakeAt.mockResolvedValue(dueAt);
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(
      async (input) =>
        (input?.allowedRouteActions?.length ?? 0) > 0
          || (input?.allowedWakeKinds?.length ?? 0) > 0
          ? { at: null, executionClass: null, reason: null }
          : {
              at: dueAt,
              executionClass: "model_free",
              reason: "mailbox",
            },
    );
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [deliveryEffect.effectId],
      assistantAutomationProgressed: true,
      nextWakeAt: dueAt,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
    });
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createSentDeliveryOutcome(),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => dueAt,
    }));

    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: dueAt,
      nextWakeReason: "mailbox",
      progressed: true,
    }));
  });

  it("preserves model-free ownership after recording a default-owned predecessor", async () => {
    const predecessorAt = "2026-04-27T00:00:00.000Z";
    const dueAt = "2026-04-27T00:00:01.000Z";
    const nowAt = "2026-04-27T00:00:02.000Z";
    let predecessorRecorded = false;
    mocks.getAssistantCronStatus.mockResolvedValue({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: predecessorAt,
      runningJobs: 0,
      totalJobs: 1,
    });
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(
      async (input) => {
        if (
          (input?.allowedRouteActions?.length ?? 0) > 0
          || (input?.allowedWakeKinds?.length ?? 0) > 0
        ) {
          return { at: null, executionClass: null, reason: null };
        }
        return !predecessorRecorded
          ? {
              at: predecessorAt,
              executionClass: "default_owned",
              reason: "assistant",
            }
          : {
              at: dueAt,
              executionClass: "model_free",
              reason: "mailbox",
            };
      },
    );
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_default_owned",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockImplementationOnce(async () => {
      predecessorRecorded = true;
      return {
        failed: 0,
        nextWakeAt: dueAt,
        nextWakeReason: "mailbox",
        recorded: 1,
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => nowAt,
      workspace: createDueAssistantWorkspace({
        nextWakeAt: predecessorAt,
        nextWakeReason: "mailbox",
      }),
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: predecessorAt,
      progressed: true,
    }));
    await expect(result.afterCheckpoint?.()).resolves.toEqual(expect.objectContaining({
      nextWakeAt: dueAt,
      nextWakeReason: "mailbox",
    }));
  });

  it("does not treat a running cron job's past nextRunAt as runnable due work", async () => {
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 0,
      enabledJobs: 1,
      nextRunAt: "2026-04-27T00:00:00.000Z",
      runningJobs: 1,
      totalJobs: 1,
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createBrowserVaultRefreshSystemMailboxItem(),
      itemId: "system_mailbox_item_browser_vault_refresh",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "browser-vault",
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:00:00.000Z",
      }),
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
    }));
  });

  it("re-arms an immediate assistant wake when cron remains due after the background pass", async () => {
    const dueAt = "2026-04-27T00:00:00.000Z";
    mocks.getAssistantCronStatus
      .mockResolvedValueOnce({
        dueJobs: 1,
        enabledJobs: 2,
        nextRunAt: dueAt,
        runningJobs: 0,
        totalJobs: 2,
      })
      .mockResolvedValueOnce({
        dueJobs: 1,
        enabledJobs: 2,
        nextRunAt: dueAt,
        runningJobs: 0,
        totalJobs: 2,
      });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      nextWakeAt: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => dueAt,
      workspace: {
        checkpointedAt: dueAt,
        createdAt: dueAt,
        nextWakeAt: dueAt,
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: dueAt,
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(mocks.getAssistantCronStatus).toHaveBeenCalledTimes(2);
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: dueAt,
      progressed: true,
    }));
  });

  it("runs idle device-sync work for a due scheduled device-sync wake", async () => {
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeLogContext: {
          attemptId: "attempt_synthetic_phase",
          leaseGeneration: "3",
          workspaceVersion: "8",
        },
        skipDirtyPendingFetch: false,
        timeoutMs: 120_000,
      }),
    );
    expect(mocks.scheduleDeviceActivityTriggeredAutomations).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "/tmp/murph-vault",
      }),
    );
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("keeps activity-scheduling failures out of job-attempt telemetry", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });
    mocks.scheduleDeviceActivityTriggeredAutomations.mockRejectedValueOnce(
      new Error("synthetic activity scheduling secret"),
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
    const entries = logRequests.flatMap((request) => request.entries);
    expect(entries.filter((entry) => entry.eventCode === "device-sync.job_failed"))
      .toHaveLength(0);
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        component: "runtime",
        errorCode: "runtime_error",
        eventCode: "assistant.device_activity_automation_failed",
        level: "warn",
        phase: "idle",
        redactedJson: expect.objectContaining({
          deviceActivityAutomationScheduleFailed: true,
          errorCode: "runtime_error",
          failureEventOrigin: "device_activity_automation",
          safeErrorMessage: "Hosted execution runtime failed.",
          wakeKind: "runtime.timer",
        }),
      }),
    ]));
    expect(JSON.stringify(entries)).not.toContain("synthetic activity scheduling secret");
    expect(JSON.stringify(entries)).not.toContain("synthetic-device-sync-secret");
  });

  it("schedules an assistant wake when idle device sync matches device activity automation", async () => {
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });
    mocks.scheduleDeviceActivityTriggeredAutomations.mockResolvedValueOnce({
      matched: 1,
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      scheduled: 1,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.scheduleDeviceActivityTriggeredAutomations).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "/tmp/murph-vault",
      }),
    );
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      nextWakeReason: "assistant",
      progressed: true,
    }));
  });

  it("schedules an assistant wake when idle device sync finds an already due activity handoff", async () => {
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });
    mocks.scheduleDeviceActivityTriggeredAutomations.mockResolvedValueOnce({
      matched: 0,
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      scheduled: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.scheduleDeviceActivityTriggeredAutomations).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "/tmp/murph-vault",
      }),
    );
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      nextWakeReason: "assistant",
      progressed: true,
    }));
  });

  it("refreshes assistant cron state after system-mailbox device sync queues due activity work", async () => {
    mocks.getAssistantCronStatus
      .mockResolvedValueOnce({
        dueJobs: 0,
        enabledJobs: 0,
        nextRunAt: null,
        runningJobs: 0,
        totalJobs: 0,
      })
      .mockResolvedValueOnce({
        dueJobs: 1,
        enabledJobs: 1,
        nextRunAt: "2026-04-27T00:00:00.000Z",
        runningJobs: 0,
        totalJobs: 1,
      });
    const deviceSyncItem = {
      ...createSystemMailboxItem(),
      routeAction: "run-device-sync-wake" as const,
      wake: {
        eventId: "evt_synthetic_device_sync_due_activity_handoff",
        kind: "device-sync.wake" as const,
        occurredAt: "2026-04-27T00:00:00.000Z",
        reason: "webhook" as const,
        userId: "member_synthetic_phase",
      },
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: deviceSyncItem,
      itemId: "system_mailbox_item_due_activity_handoff",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "device-sync",
        nextWakeAt: "2026-04-27T00:05:00.000Z",
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-27T00:00:00.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.getAssistantCronStatus).toHaveBeenCalledTimes(2);
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      progressed: true,
    }));
  });

  it("logs and reschedules idle device-sync failures without throwing", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedDeviceSyncWakeLane.mockRejectedValueOnce(
      new Error("synthetic idle device sync failure"),
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
    expect("afterCheckpoint" in result).toBe(false);
    await Promise.resolve();
    expect(logRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "assistant.device_connect",
      "device-sync.maintenance_failed",
    ]);
    const failureEntries = logRequests.flatMap((request) => request.entries);
    const failureLog = failureEntries
      .find((entry) => entry.eventCode === "device-sync.maintenance_failed");
    expect(failureEntries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ eventCode: "device-sync.job_failed" }),
    ]));
    expect(failureLog).toEqual(expect.objectContaining({
      component: "device-sync",
      errorCode: "runtime_error",
      eventCode: "device-sync.maintenance_failed",
      level: "warn",
      phase: "idle",
      redactedJson: expect.objectContaining({
        errorCode: "runtime_error",
        errorMessagePresent: true,
        failureEventOrigin: "idle_maintenance",
        idleMaintenanceFailed: true,
        retryAt: "2026-04-27T00:00:30.000Z",
        safeErrorMessage: "Hosted execution runtime failed.",
      }),
    }));
    expect(JSON.stringify(logRequests)).not.toContain("synthetic idle device sync failure");
    expect(JSON.stringify(logRequests)).not.toContain("synthetic-whoop-secret");
  });

  it("refreshes dirty assistant context snapshots during idle hosted work", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-context-snapshot-"));
    const vaultRoot = path.join(parentRoot, "vault");

    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        timezone: "America/New_York",
        vaultRoot,
      });
      await writeHostedPhaseExperimentSource(vaultRoot);
      await markAssistantContextSnapshotDirty({
        domains: ["experiments"],
        vaultRoot,
      });
      mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockResolvedValueOnce({
        captureIds: ["cap_terminal_cleanup"],
        linqMessageIds: ["linq_msg_terminal_cleanup"],
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 0,
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      }));

      expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
      expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "assistant_runtime_commit",
        progressed: true,
        redactedStatus: expect.objectContaining({
          assistantContextSnapshotPendingDirtyDomainCount: 0,
          assistantContextSnapshotRefreshAttempted: true,
          assistantContextSnapshotRefreshed: true,
        }),
      }));
      expect("nextWakeAt" in result).toBe(false);
      await expect(readAssistantContextSnapshotState(vaultRoot)).resolves.toMatchObject({
        lastCompleted: {
          promptBlock: expect.stringContaining("Hosted phase sleep consistency"),
        },
        pendingDirtyDomains: [],
      });
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("preserves durable outbox wakes after context snapshot refresh", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-context-snapshot-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const outboxWakeAt = "2026-04-27T00:05:00.000Z";

    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        vaultRoot,
      });
      await writeHostedPhaseExperimentSource(vaultRoot);
      await markAssistantContextSnapshotDirty({
        domains: ["experiments"],
        vaultRoot,
      });
      mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValue(outboxWakeAt);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 0,
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      }));

      expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "assistant_runtime_commit",
        nextWakeAt: outboxWakeAt,
        progressed: true,
        redactedStatus: expect.objectContaining({
          assistantContextSnapshotRefreshAttempted: true,
          assistantContextSnapshotRefreshed: true,
        }),
      }));
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("reselects a durable device-sync continuation after an earlier outbox wake is serviced", async () => {
    const outboxWakeAt = "2026-04-27T00:00:05.000Z";
    const deviceSyncContinuationAt = "2026-04-27T00:00:30.000Z";
    const resolvedDeviceSync = {
      providerConfigs: {
        whoop: {
          clientId: "synthetic-whoop-client",
          clientSecret: "synthetic-whoop-secret",
        },
      },
      publicBaseUrl: "https://device-sync.example.test",
      secret: "synthetic-device-sync-secret",
    } as const;

    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValueOnce(outboxWakeAt);
    mocks.resolveHostedDeviceSyncNextWakeAt.mockReturnValueOnce(deviceSyncContinuationAt);

    const firstPass = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync,
    }));

    expect(firstPass).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: outboxWakeAt,
      nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
      progressed: true,
    }));
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();

    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValueOnce(null);
    mocks.resolveHostedDeviceSyncNextWakeAt.mockReturnValueOnce(deviceSyncContinuationAt);

    const restartedAtOutboxWake = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => outboxWakeAt,
      resolvedDeviceSync,
      workspace: createDueAssistantWorkspace({
        nextWakeAt: outboxWakeAt,
        nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
      }),
    }));

    expect(restartedAtOutboxWake).toEqual(expect.objectContaining({
      nextWakeAt: deviceSyncContinuationAt,
      nextWakeReason: "device-sync.reconcile",
    }));
    expect(mocks.resolveHostedDeviceSyncNextWakeAt).toHaveBeenCalledTimes(2);
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
  });

  it("preserves dirty assistant context snapshots and requests an immediate wake after preemption", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-context-snapshot-"));
    const vaultRoot = path.join(parentRoot, "vault");
    let yieldChecks = 0;

    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        vaultRoot,
      });
      await markAssistantContextSnapshotDirty({
        domains: ["experiments"],
        vaultRoot,
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 0,
        now: () => "2026-04-27T00:00:00.000Z",
        shouldYieldBackgroundMaintenance: () => {
          yieldChecks += 1;
          return yieldChecks > 3;
        },
        vaultRoot,
      }));

      expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "assistant_runtime_commit",
        nextWakeAt: "2026-04-27T00:00:00.000Z",
        progressed: true,
        redactedStatus: expect.objectContaining({
          assistantContextSnapshotPendingDirtyDomainCount: 1,
          assistantContextSnapshotRefreshAttempted: true,
          assistantContextSnapshotRefreshed: false,
        }),
      }));
      await expect(readAssistantContextSnapshotState(vaultRoot)).resolves.toMatchObject({
        lastCompleted: null,
        pendingDirtyDomains: ["experiments"],
      });
      expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).not.toHaveBeenCalled();
      expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
      expect(mocks.markAssistantAutoReplyLinqCleanupQueued).not.toHaveBeenCalled();
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("preserves dirty assistant context snapshots and requests an immediate wake after refresh failure", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-context-snapshot-"));
    const vaultRoot = path.join(parentRoot, "vault");

    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        vaultRoot,
      });
      await rm(path.join(vaultRoot, "bank/experiments"), {
        force: true,
        recursive: true,
      });
      await mkdir(path.join(vaultRoot, "bank"), {
        recursive: true,
      });
      await writeFile(
        path.join(vaultRoot, "bank/experiments"),
        "not a directory\n",
        "utf8",
      );
      await markAssistantContextSnapshotDirty({
        domains: ["experiments"],
        vaultRoot,
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 0,
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      }));

      expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "assistant_runtime_commit",
        nextWakeAt: "2026-04-27T00:00:00.000Z",
        nextWakeReason: "assistant",
        progressed: true,
        redactedStatus: expect.objectContaining({
          assistantContextSnapshotPendingDirtyDomainCount: 1,
          assistantContextSnapshotRefreshAttempted: true,
          assistantContextSnapshotRefreshed: false,
        }),
      }));
      await expect(readAssistantContextSnapshotState(vaultRoot)).resolves.toMatchObject({
        lastRefreshAttempt: {
          errorCode: expect.any(String),
          status: "failed",
        },
        pendingDirtyDomains: ["experiments"],
      });
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("keeps scheduled device-sync work deferred when foreground input is fresh", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("keeps assistant-labeled scheduled wakes on the assistant lane when device sync is absent", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result.progressed).toBe(false);
    expect("checkpointReason" in result).toBe(false);
    expect("nextWakeAt" in result).toBe(false);
  });

  it("keeps projected due device-sync wakes out when foreground input is fresh", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("keeps the foreground reply running when follow-up device-sync wake projection cannot load", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const moduleLoadError = new Error("synthetic device-sync module load failure");
    vi.mocked(loadHostedDeviceSyncMaintenanceModule).mockRejectedValueOnce(
      moduleLoadError,
    );
    vi.mocked(isHostedDeviceSyncMaintenanceModuleLoadError).mockReturnValue(true);
    const deliveryEffect = createDeliveryEffect();
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [deliveryEffect.effectId],
      assistantAutomationProgressed: true,
      nextWakeAt: null,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
    });
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createSentDeliveryOutcome(),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        includeBackgroundDueIntents: false,
        preferredIntentIds: [deliveryEffect.effectId],
      }),
    );
    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [deliveryEffect],
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      }),
    );
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    const moduleLoadFailureLog = logRequests
      .flatMap((request) => request.entries)
      .find((entry) => entry.eventCode === "device-sync.module_load_failed");
    expect(moduleLoadFailureLog).toEqual(expect.objectContaining({
      component: "device-sync",
      eventCode: "device-sync.module_load_failed",
      level: "warn",
      phase: "invoke",
      redactedJson: expect.objectContaining({
        followUpWakeProjection: true,
        projectionPath: "follow-up-wake",
      }),
    }));
    expect("nextWakeReason" in result ? result.nextWakeReason : null)
      .not.toBe("device-sync.reconcile");
    expect(postCheckpoint?.nextWakeReason ?? null).not.toBe("device-sync.reconcile");
    expect(JSON.stringify(logRequests)).not.toContain("synthetic-whoop-secret");
  });

  it("keeps due device-sync wakes out when non-conversation mailbox input is fresh", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("does not consume due assistant wakes when non-conversation mailbox input is fresh", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result.progressed).toBe(false);
    expect("checkpointReason" in result).toBe(false);
    expect("nextWakeAt" in result).toBe(false);
  });

  it("passes the foreground-input yield hook to due idle device-sync work", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => false);
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      shouldYieldBackgroundMaintenance,
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledWith(
      expect.objectContaining({
        shouldYieldDeviceSync: shouldYieldBackgroundMaintenance,
      }),
    );
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
  });

  it("passes the foreground-input yield hook to system mailbox maintenance", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => false);

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      shouldYieldBackgroundMaintenance,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        shouldYieldBackgroundMaintenance,
      }),
    );
  });

  });
