import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ASSISTANT_RUNTIME_ISSUE_SCHEMA,
  type AssistantRuntimeIssueRecord,
} from "@murphai/runtime-state/node";
import {
  ASSISTANT_USAGE_SCHEMA,
  type AssistantUsageRecord,
} from "../src/assistant-usage.ts";
import {
  HOSTED_ASSISTANT_DEFAULT_REASONING_EFFORT,
  HOSTED_ASSISTANT_LUNA_MODEL,
  HOSTED_ASSISTANT_MODEL_OVERRIDES,
  HOSTED_ASSISTANT_PRODUCT_MODELS,
  HOSTED_ASSISTANT_PROVIDERS,
  HOSTED_ASSISTANT_REASONING_EFFORT_OVERRIDES,
  HOSTED_ASSISTANT_REASONING_EFFORTS,
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
  isHostedAssistantProductModel,
  isHostedAssistantReasoningEffort,
  parseHostedAssistantModelOverride,
  parseHostedAssistantReasoningEffortOverride,
} from "../src/assistant-model.ts";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_KINDS,
  HOSTED_MAILBOX_LANES,
  HOSTED_RETIRED_MAILBOX_KINDS,
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BYTE_SIZE_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SHA_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_AT_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_REASON_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_STATUS_KEY,
  HOSTED_RUNTIME_LOG_EVENT_CODES,
  HOSTED_RUNTIME_ORCHESTRATION_LATENCY_DIAGNOSTICS_HEADER,
  HOSTED_WORKSPACE_CHECKPOINT_REASONS,
  HOSTED_WORKSPACE_INVOCATION_STATUSES,
  buildHostedMailboxPayloadScope,
  buildHostedMailboxPayloadSecureBoxAad,
  buildHostedAiUsageAllowDecisionBody,
  isHostedMailboxKind,
  isHostedMailboxLane,
  isHostedRetiredMailboxKind,
  isHostedRuntimeFutureMailboxContinuation,
  isHostedRuntimeMailboxContinuation,
  normalizeHostedAiUsageAllowanceElevenLabsTtsModelId,
  normalizeHostedAiUsageAllowanceOpenAiImageModelId,
  normalizeHostedAiUsageAllowancePricedModelId,
  parseHostedRunnerNudgeRequest,
  readHostedIngressLatencySource,
  resolveHostedAiUsageTokenPricingBasis,
  mergeHostedRuntimeLatencyPhaseBreakdownJson,
  sanitizeHostedRuntimeOrchestrationLatencyDiagnostics,
  signHostedAiUsageAllowDecision,
  verifyHostedAiUsageAllowDecision,
} from "../src/runtime-control.ts";
import {
  parseHostedMailboxFetchRequest,
  parseHostedMailboxFetchResponse,
  parseHostedMailboxItem,
  parseHostedRunnerNudgeResult,
  parseHostedRunnerStatusResponse,
  parseHostedMailboxLaneCounterState,
  parseHostedMailboxPayload,
  parseHostedMailboxPayloadFetchRequest,
  parseHostedMailboxPayloadFetchResponse,
  parseHostedBrowserVaultReplicaPublishRequest,
  parseHostedBrowserVaultReplicaPublishResponse,
  parseHostedCodexAuthUpdate,
  parseHostedCodexAuthUpdateResponse,
  parseHostedRuntimeDeviceSyncBridgeEnvelope,
  parseHostedRuntimeAssistantConfigurationControlRequest,
  parseHostedRuntimeAssistantConfigurationToolRequest,
  parseHostedRuntimeAssistantConfigurationToolResponse,
  parseHostedRuntimeIMessageContactToolRequest,
  parseHostedRuntimeIMessageContactToolResponse,
  parseHostedRuntimeIssueExportRequest,
  parseHostedRuntimeIssueExportResponse,
  parseHostedRuntimeHealthDataAdmissionResponse,
  parseHostedRuntimeLatencyTraceRequest,
  parseHostedRuntimeLatencyTraceResponse,
  parseHostedRuntimeLogEntry,
  parseHostedRuntimeRedactedJson,
  parseHostedRuntimeLogRequest,
  parseHostedRuntimeLogResponse,
  parseHostedRuntimeUsageRecordRequest,
  parseHostedRuntimeUsageRecordResponse,
  parseHostedRuntimeWebStatusResponse,
  parseHostedWorkspaceCheckpointRequest,
  parseHostedWorkspaceCheckpointResponse,
  parseHostedWorkspaceReadResponse,
  parseHostedWorkspaceInvocationRequest,
  parseHostedWorkspaceInvocationResult,
  parseHostedWorkspaceState,
} from "../src/parsers.ts";

describe("hosted runtime control contracts", () => {
  it("parses fail-closed health-data admission and rejects revoked processing", () => {
    expect(parseHostedRuntimeHealthDataAdmissionResponse({
      consentState: "missing",
      processingAllowed: true,
      userId: "member_123",
    })).toEqual({
      consentState: "missing",
      processingAllowed: true,
      userId: "member_123",
    });
    expect(parseHostedRuntimeHealthDataAdmissionResponse({
      consentState: "missing",
      processingAllowed: false,
      userId: "member_123",
    })).toEqual({
      consentState: "missing",
      processingAllowed: false,
      userId: "member_123",
    });
    expect(parseHostedRuntimeHealthDataAdmissionResponse({
      consentState: "revoked",
      processingAllowed: false,
      userId: "member_123",
    })).toEqual({
      consentState: "revoked",
      processingAllowed: false,
      userId: "member_123",
    });
    expect(() => parseHostedRuntimeHealthDataAdmissionResponse({
      consentState: "revoked",
      processingAllowed: true,
      userId: "member_123",
    })).toThrow(/cannot allow processing after consent revocation/u);
    expect(() => parseHostedRuntimeHealthDataAdmissionResponse({
      consentState: "unknown",
      processingAllowed: true,
      userId: "member_123",
    })).toThrow(/consentState is not supported/u);
  });

  it("classifies typed and retryable mailbox continuations", () => {
    expect(isHostedRuntimeMailboxContinuation({
      nextWakeAt: "2026-04-27T00:00:15.000Z",
      nextWakeReason: "mailbox",
    })).toBe(true);
    expect(isHostedRuntimeMailboxContinuation({
      nextWakeAt: "2026-04-27T00:00:05.000Z",
      nextWakeReason: "assistant",
      redactedStatus: {
        hostedMailboxRetryableBlockedCount: 1,
      },
    })).toBe(true);
    expect(isHostedRuntimeMailboxContinuation({
      nextWakeAt: "2026-04-27T00:00:05.000Z",
      nextWakeReason: "assistant",
      redactedStatus: {
        hostedMailboxRetryableBlockedCount: 0,
      },
    })).toBe(false);
    expect(() => isHostedRuntimeMailboxContinuation({
      nextWakeAt: "2026-04-27T00:00:05.000Z",
      redactedStatus: {
        hostedMailboxRetryableBlockedCount: -1,
      },
    })).toThrow(/must be a non-negative integer/u);
    expect(() => isHostedRuntimeMailboxContinuation({
      nextWakeAt: "2026-04-27T00:00:05.000Z",
      redactedStatus: {
        hostedMailboxRetryableBlockedCount: false,
      },
    })).toThrow(/must be a non-negative integer/u);
  });

  it("classifies only future mailbox continuations for retry deferral", () => {
    const nowMs = Date.parse("2026-04-27T00:00:10.000Z");

    expect(isHostedRuntimeFutureMailboxContinuation({
      nextWakeAt: "2026-04-27T00:00:15.000Z",
      nextWakeReason: "mailbox",
    }, nowMs)).toBe(true);
    expect(isHostedRuntimeFutureMailboxContinuation({
      nextWakeAt: "2026-04-27T00:00:10.000Z",
      nextWakeReason: "mailbox",
    }, nowMs)).toBe(false);
    expect(isHostedRuntimeFutureMailboxContinuation({
      nextWakeAt: "2026-04-27T00:00:15.000Z",
      nextWakeReason: "assistant",
    }, nowMs)).toBe(false);
    expect(isHostedRuntimeFutureMailboxContinuation({
      nextWakeAt: new Date("2026-04-27T00:00:15.000Z"),
      nextWakeReason: "assistant",
      redactedStatus: {
        hostedMailboxRetryableBlockedCount: 1,
      },
    }, nowMs)).toBe(true);
  });

  it("signs hosted AI usage allow decisions over the canonical decision body", async () => {
    const body = buildHostedAiUsageAllowDecisionBody({
      expiresAt: "2026-04-27T00:00:30.000Z",
      issuedAt: "2026-04-27T00:00:00.000Z",
      nonce: "0123456789abcdef0123456789abcdef",
      userId: "member_123",
    });
    const decision = await signHostedAiUsageAllowDecision({
      body,
      keyId: "test",
      secret: "test-ai-usage-allow-secret",
    });

    await expect(verifyHostedAiUsageAllowDecision({
      decision,
      secret: "test-ai-usage-allow-secret",
    })).resolves.toBe(true);
    await expect(verifyHostedAiUsageAllowDecision({
      decision: {
        ...decision,
        userId: "member_other",
      },
      secret: "test-ai-usage-allow-secret",
    })).resolves.toBe(false);
  });

  it("freezes the mailbox lanes, item kinds, checkpoint reasons, and log codes", () => {
    expect(HOSTED_MAILBOX_LANES).toEqual([
      "system",
      "conversation",
    ]);
    expect(HOSTED_MAILBOX_KINDS).toEqual([
      "conversation.message",
      "member.activated",
      "member.channels.updated",
      "member.preferences.updated",
      "assistant.notification.requested",
      "assistant.ask.requested",
      "assistant.ask.completed",
      "clinical-records.sync-requested",
      "device-sync.wake",
      "environment-voice.captured",
      "health.daily-metric.reported",
      "meal-photo.captured",
      "member.action.requested",
      "member.action.completed",
      "vault-share.delivery",
      "vault-share.revoke",
      "group-newsletter.email-needed",
      "runtime.manual-requested",
      "runtime.pending-effects-reconcile-requested",
      "runtime.maintenance-requested",
      "runtime.browser-vault-refresh-requested",
      "runtime.provider-setup-continuation-requested",
      "runtime.codex-auth-requested",
      "runtime.device-sync-recovery-requested",
      "runtime.mailbox-lag-observed",
    ]);
    expect(HOSTED_RETIRED_MAILBOX_KINDS).toEqual([
      "group-newsletter.email-needed",
    ]);
    expect(isHostedRetiredMailboxKind("group-newsletter.email-needed")).toBe(true);
    expect(isHostedRetiredMailboxKind("conversation.message")).toBe(false);
    expect(HOSTED_WORKSPACE_CHECKPOINT_REASONS).toEqual([
      "import",
      "active_turn_input",
      "active_turn_acceptance",
      "outbox_sending",
      "outbox_receipt",
      "activation_bootstrap",
      "canonical_runtime_commit",
      "assistant_runtime_commit",
      "provider_cleanup",
      "system_mailbox_receipt",
      "idle_shutdown",
    ]);
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain("mailbox.imported");
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain("mailbox.appended");
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain("mailbox.dedupe_conflict");
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain("mailbox.post_checkpoint_effects_finished");
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain("assistant.device_connect");
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain(
      "assistant.onboarding_followup_reconciled",
    );
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain("device-sync.dense_raw_retention");
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain("device-sync.import_completed");
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain("device-sync.job_failed");
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain("device-sync.legacy_platform_env_present");
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain("device-sync.module_load_failed");
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain("device-sync.wake_projection_failed");
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain("checkpoint.cas_conflict");
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain("checkpoint.optional_sidecar_degraded");
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain("checkpoint.idle_shutdown_snapshot_skipped");
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain("checkpoint.snapshot_preempted");
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain("runner.accepted_attempt_failed");
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain("runner.provider_egress_diagnostic");
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).toContain("workspace.codex_home_snapshot_failed");
    expect(HOSTED_RUNTIME_LOG_EVENT_CODES).not.toContain("run.acquired");
    expect(HOSTED_WORKSPACE_INVOCATION_STATUSES).toEqual([
      "idle",
      "budget_exhausted",
      "scheduled",
      "failed",
    ]);
    expect(isHostedMailboxLane("conversation")).toBe(true);
    expect(isHostedMailboxLane("global")).toBe(false);
    expect(isHostedMailboxKind("conversation.message")).toBe(true);
    expect(isHostedMailboxKind("runtime.manual-requested")).toBe(true);
    expect(
      isHostedMailboxKind("runtime.pending-effects-reconcile-requested"),
    ).toBe(true);
    expect(isHostedMailboxKind("runtime.maintenance-requested")).toBe(true);
    expect(
      isHostedMailboxKind("runtime.provider-setup-continuation-requested"),
    ).toBe(true);
    expect(isHostedMailboxKind("runtime.codex-auth-requested")).toBe(true);
    expect(isHostedMailboxKind("run.acquired")).toBe(false);
  });

  it("normalizes hosted ElevenLabs TTS allowance model ids", () => {
    expect(normalizeHostedAiUsageAllowanceElevenLabsTtsModelId(" eleven_multilingual_v2 ")).toBe(
      "eleven_multilingual_v2",
    );
    expect(normalizeHostedAiUsageAllowanceElevenLabsTtsModelId("ELEVEN_FLASH_V2")).toBe(
      "eleven_flash_v2",
    );
    expect(normalizeHostedAiUsageAllowanceElevenLabsTtsModelId("eleven_monolingual_v1")).toBeNull();
  });

  it("builds one shared mailbox payload secure-box aad and scope contract", () => {
    const metadata = {
      dedupeKey: "conversation:member_123:message_1",
      itemId: "mailbox_item_1",
      kind: "conversation.message",
      lane: "conversation",
      laneSeq: "7",
      occurredAt: "2026-04-26T00:00:00.000Z",
      payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
      payloadStorage: "inline" as const,
      userId: "member_123",
    };

    expect(buildHostedMailboxPayloadScope("inline")).toBe(
      "hosted-mailbox-payload:hosted-mailbox-inline-payload",
    );
    expect(buildHostedMailboxPayloadScope("sidecar")).toBe(
      "hosted-mailbox-payload:hosted-mailbox-ref-payload",
    );
    expect(buildHostedMailboxPayloadSecureBoxAad(metadata)).toEqual({
      field: "hosted-mailbox-inline-payload",
      objectKey: JSON.stringify({
        dedupeKey: "conversation:member_123:message_1",
        kind: "conversation.message",
        lane: "conversation",
        occurredAt: "2026-04-26T00:00:00.000Z",
        payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
        payloadStorage: "inline",
      }),
      purpose: "hosted-mailbox-payload",
      rowId: "mailbox_item_1",
      sequence: "7",
      table: "hosted_mailbox_item",
    });
  });

  it("normalizes hosted AI usage priced model aliases without accepting unpriced models", () => {
    expect(normalizeHostedAiUsageAllowancePricedModelId("gpt-5.6-terra")).toBe("gpt-5.6-terra");
    expect(normalizeHostedAiUsageAllowancePricedModelId("openai/gpt-5.6-terra")).toBe("gpt-5.6-terra");
    expect(normalizeHostedAiUsageAllowancePricedModelId("gpt-5.6-terra-2026-07-08")).toBe("gpt-5.6-terra");
    expect(normalizeHostedAiUsageAllowancePricedModelId("openai/gpt-5.6-terra-2026-07-08")).toBe("gpt-5.6-terra");
    expect(normalizeHostedAiUsageAllowancePricedModelId("gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(normalizeHostedAiUsageAllowancePricedModelId("openai/gpt-5.6-terra-2026-07-08")).toBe("gpt-5.6-terra");
    expect(normalizeHostedAiUsageAllowancePricedModelId("gpt-5.6-luna-2026-07-08")).toBe("gpt-5.6-luna");
    expect(normalizeHostedAiUsageAllowancePricedModelId("gpt-5.5")).toBeNull();
    expect(normalizeHostedAiUsageAllowancePricedModelId("gpt-sol")).toBeNull();
    expect(normalizeHostedAiUsageAllowancePricedModelId("openai/gpt-terra")).toBeNull();
    expect(normalizeHostedAiUsageAllowancePricedModelId("gpt-5.6-luma-2026-07-08")).toBeNull();
    expect(normalizeHostedAiUsageAllowancePricedModelId("gpt-image-2")).toBeNull();
    expect(normalizeHostedAiUsageAllowancePricedModelId("gpt-5.4-mini")).toBeNull();
    expect(normalizeHostedAiUsageAllowancePricedModelId("gpt-4.1-mini-2026-04-23")).toBeNull();
  });

  it("parses the hosted assistant product models and nullable default override", () => {
    expect(HOSTED_ASSISTANT_PRODUCT_MODELS).toEqual([
      HOSTED_ASSISTANT_LUNA_MODEL,
      HOSTED_ASSISTANT_TERRA_MODEL,
      HOSTED_ASSISTANT_SOL_MODEL,
    ]);
    expect(HOSTED_ASSISTANT_MODEL_OVERRIDES).toEqual([
      HOSTED_ASSISTANT_LUNA_MODEL,
      HOSTED_ASSISTANT_SOL_MODEL,
    ]);
    expect(isHostedAssistantProductModel(HOSTED_ASSISTANT_LUNA_MODEL)).toBe(true);
    expect(isHostedAssistantProductModel(HOSTED_ASSISTANT_TERRA_MODEL)).toBe(true);
    expect(isHostedAssistantProductModel(HOSTED_ASSISTANT_SOL_MODEL)).toBe(true);
    expect(isHostedAssistantProductModel("gpt-5.5")).toBe(false);
    expect(parseHostedAssistantModelOverride(HOSTED_ASSISTANT_LUNA_MODEL))
      .toBe(HOSTED_ASSISTANT_LUNA_MODEL);
    expect(parseHostedAssistantModelOverride(HOSTED_ASSISTANT_SOL_MODEL))
      .toBe(HOSTED_ASSISTANT_SOL_MODEL);
    expect(parseHostedAssistantModelOverride(HOSTED_ASSISTANT_TERRA_MODEL))
      .toBeNull();
    expect(parseHostedAssistantModelOverride(" gpt-5.6-sol ")).toBeNull();
  });

  it("parses the common hosted reasoning efforts and nullable low default", () => {
    expect(HOSTED_ASSISTANT_REASONING_EFFORTS).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(HOSTED_ASSISTANT_DEFAULT_REASONING_EFFORT).toBe("low");
    expect(HOSTED_ASSISTANT_REASONING_EFFORT_OVERRIDES).toEqual([
      "medium",
      "high",
      "xhigh",
    ]);
    for (const effort of HOSTED_ASSISTANT_REASONING_EFFORTS) {
      expect(isHostedAssistantReasoningEffort(effort)).toBe(true);
    }
    expect(isHostedAssistantReasoningEffort("none")).toBe(false);
    expect(parseHostedAssistantReasoningEffortOverride("medium")).toBe("medium");
    expect(parseHostedAssistantReasoningEffortOverride("high")).toBe("high");
    expect(parseHostedAssistantReasoningEffortOverride("xhigh")).toBe("xhigh");
    expect(parseHostedAssistantReasoningEffortOverride("low")).toBeNull();
    expect(parseHostedAssistantReasoningEffortOverride(" high ")).toBeNull();
  });

  it("parses strict hosted assistant configuration read and update contracts", () => {
    expect(parseHostedRuntimeAssistantConfigurationToolRequest({
      action: "read",
    })).toEqual({ action: "read" });

    for (const model of HOSTED_ASSISTANT_PRODUCT_MODELS) {
      expect(parseHostedRuntimeAssistantConfigurationToolRequest({
        action: "update",
        model,
      })).toEqual({ action: "update", model });
    }
    for (const reasoningEffort of HOSTED_ASSISTANT_REASONING_EFFORTS) {
      expect(parseHostedRuntimeAssistantConfigurationToolRequest({
        action: "update",
        reasoningEffort,
      })).toEqual({ action: "update", reasoningEffort });
    }
    for (const provider of HOSTED_ASSISTANT_PROVIDERS) {
      expect(parseHostedRuntimeAssistantConfigurationToolRequest({
        action: "update",
        provider,
      })).toEqual({ action: "update", provider });
    }
    expect(parseHostedRuntimeAssistantConfigurationToolRequest({
      action: "update",
      model: HOSTED_ASSISTANT_LUNA_MODEL,
      reasoningEffort: "low",
    })).toEqual({
      action: "update",
      model: HOSTED_ASSISTANT_LUNA_MODEL,
      reasoningEffort: "low",
    });

    expect(() => parseHostedRuntimeAssistantConfigurationToolRequest({
      action: "update",
    })).toThrow(/requires a model, provider, or reasoning effort/u);
    expect(() => parseHostedRuntimeAssistantConfigurationToolRequest({
      action: "read",
      model: HOSTED_ASSISTANT_LUNA_MODEL,
    })).toThrow(/not allowed/u);
    expect(() => parseHostedRuntimeAssistantConfigurationToolRequest({
      action: "update",
      reasoningEffort: "none",
    })).toThrow(/not supported/u);

    const assistantInputId = `ain_${"c".repeat(32)}`;
    expect(parseHostedRuntimeAssistantConfigurationControlRequest({
      action: "update",
      assistantInputId,
      provider: "venice",
    })).toEqual({
      action: "update",
      assistantInputId,
      provider: "venice",
    });
    expect(parseHostedRuntimeAssistantConfigurationControlRequest({
      action: "update",
      assistantInputId,
      reasoningEffort: "medium",
    })).toEqual({
      action: "update",
      assistantInputId,
      reasoningEffort: "medium",
    });
    expect(() => parseHostedRuntimeAssistantConfigurationControlRequest({
      action: "update",
      assistantInputId: `ain_${"c".repeat(31)}`,
      reasoningEffort: "medium",
    })).toThrow(/assistantInputId is invalid/u);
    expect(() => parseHostedRuntimeAssistantConfigurationControlRequest({
      action: "update",
      assistantInputId,
      approval: {},
      reasoningEffort: "medium",
    })).toThrow(/not allowed/u);

    expect(parseHostedRuntimeIMessageContactToolRequest({
      assistantInputId,
    })).toEqual({ assistantInputId });
    expect(() => parseHostedRuntimeIMessageContactToolRequest({
      assistantInputId: `ain_${"c".repeat(31)}`,
    })).toThrow(/assistantInputId is invalid/u);
    expect(parseHostedRuntimeIMessageContactToolResponse({
      phoneNumber: "+15550100001",
      status: "assigned",
      verifiedSenderPhoneHint: "*** 0009",
    })).toEqual({
      phoneNumber: "+15550100001",
      status: "assigned",
      verifiedSenderPhoneHint: "*** 0009",
    });
    expect(parseHostedRuntimeIMessageContactToolResponse({
      phoneNumber: null,
      status: "unavailable",
      verifiedSenderPhoneHint: null,
    })).toEqual({
      phoneNumber: null,
      status: "unavailable",
      verifiedSenderPhoneHint: null,
    });
    expect(parseHostedRuntimeIMessageContactToolResponse({
      phoneNumber: null,
      status: "identity_required",
      verifiedSenderPhoneHint: null,
    })).toEqual({
      phoneNumber: null,
      status: "identity_required",
      verifiedSenderPhoneHint: null,
    });
    expect(() => parseHostedRuntimeIMessageContactToolResponse({
      phoneNumber: "+15550100001",
      status: "unavailable",
      verifiedSenderPhoneHint: null,
    })).toThrow(/requires null phoneNumber/u);
    expect(() => parseHostedRuntimeIMessageContactToolResponse({
      phoneNumber: "+15550100001",
      status: "existing",
      verifiedSenderPhoneHint: "+15550100009",
    })).toThrow(/verifiedSenderPhoneHint is invalid/u);

    expect(() => parseHostedRuntimeAssistantConfigurationControlRequest({
      action: "update",
      approval: {},
      reasoningEffort: "high",
      target: {
        model: HOSTED_ASSISTANT_TERRA_MODEL,
        reasoningEffort: "high",
      },
    })).toThrow(/not allowed/u);

    const snapshot = {
      availableModels: [...HOSTED_ASSISTANT_PRODUCT_MODELS],
      availableProviders: ["openai", "venice"] as const,
      availableReasoningEfforts: [...HOSTED_ASSISTANT_REASONING_EFFORTS],
      configurationAvailable: true,
      dormantSolPreference: false,
      model: HOSTED_ASSISTANT_TERRA_MODEL,
      provider: "openai" as const,
      reasoningEffort: "low" as const,
      solAvailable: false,
    };
    expect(parseHostedRuntimeAssistantConfigurationToolResponse({
      action: "read",
      result: snapshot,
    })).toEqual({
      action: "read",
      result: snapshot,
    });
    const {
      availableProviders: _legacyAvailableProviders,
      provider: _legacyProvider,
      ...legacySnapshot
    } = snapshot;
    expect(parseHostedRuntimeAssistantConfigurationToolResponse({
      action: "read",
      result: legacySnapshot,
    })).toEqual({
      action: "read",
      result: {
        ...legacySnapshot,
        availableProviders: ["openai"],
        provider: "openai",
      },
    });
    expect(() => parseHostedRuntimeAssistantConfigurationToolResponse({
      action: "read",
      result: {
        ...snapshot,
        provider: undefined,
      },
    })).toThrow(/provider is not supported/u);
    expect(parseHostedRuntimeAssistantConfigurationToolResponse({
      action: "update",
      result: {
        ...snapshot,
        appliesAt: "next_turn",
        requiredPlan: "edge",
        status: "upgrade_required",
      },
    })).toEqual({
      action: "update",
      result: {
        ...snapshot,
        appliesAt: "next_turn",
        requiredPlan: "edge",
        status: "upgrade_required",
      },
    });
    expect(() => parseHostedRuntimeAssistantConfigurationToolResponse({
      action: "read",
      result: {
        ...snapshot,
        reasoningEffort: "none",
      },
    })).toThrow(/not supported/u);
  });

  it("normalizes OpenAI image usage priced model aliases separately", () => {
    expect(normalizeHostedAiUsageAllowanceOpenAiImageModelId("gpt-image-2"))
      .toBe("gpt-image-2");
    expect(normalizeHostedAiUsageAllowanceOpenAiImageModelId("openai/gpt-image-2"))
      .toBe("gpt-image-2");
    expect(normalizeHostedAiUsageAllowanceOpenAiImageModelId("gpt-image-2-2026-07-01"))
      .toBe("gpt-image-2");
    expect(normalizeHostedAiUsageAllowanceOpenAiImageModelId("gpt-5.6-terra"))
      .toBeNull();
  });

  it("uses OpenAI flex token pricing only for supported OpenAI flex models", () => {
    expect(resolveHostedAiUsageTokenPricingBasis({
      model: "gpt-5.6-terra",
      providerName: "hosted-openai",
      serviceTier: "flex",
    })).toBe("openai-flex");
    expect(resolveHostedAiUsageTokenPricingBasis({
      model: "openai/gpt-5.6-terra-2026-07-08",
      providerName: "openai",
      serviceTier: "flex",
    })).toBe("openai-flex");
    expect(resolveHostedAiUsageTokenPricingBasis({
      model: "gpt-5.6-sol",
      providerName: "hosted-openai",
      serviceTier: "flex",
    })).toBe("openai-flex");
    expect(resolveHostedAiUsageTokenPricingBasis({
      model: "openai/gpt-5.6-terra-2026-07-08",
      providerName: "openai",
      serviceTier: "flex",
    })).toBe("openai-flex");
    expect(resolveHostedAiUsageTokenPricingBasis({
      model: "openai/gpt-5.6-luna-2026-07-08",
      providerName: "hosted-openai",
      serviceTier: "flex",
    })).toBe("openai-flex");
    expect(resolveHostedAiUsageTokenPricingBasis({
      model: "gpt-5.6-terra",
      providerName: "openai-local-test",
      serviceTier: "flex",
    })).toBe("standard");
    expect(resolveHostedAiUsageTokenPricingBasis({
      model: "gpt-5.4-mini",
      providerName: "hosted-openai",
      serviceTier: "flex",
    })).toBe("standard");
    expect(resolveHostedAiUsageTokenPricingBasis({
      model: "gpt-5.6-luna",
      providerName: "vercel-ai-gateway",
      serviceTier: "flex",
    })).toBe("standard");
    expect(resolveHostedAiUsageTokenPricingBasis({
      model: "gpt-5.6-terra",
      providerName: "hosted-openai",
      serviceTier: null,
    })).toBe("standard");
  });

  it("parses workspace invocation request and status-only result without invocation-drain fields", () => {
    const workspaceInvocationRequest = {
      attemptId: "attempt_1",
      budget: {
        maxMailboxItems: 25,
        maxRuntimeMs: 30_000,
      },
      idleCheckpointDelayMs: 180_000,
      leaseGeneration: "7",
      providerEgressToken: "provider-egress-token-contract",
      userId: "member_123",
      workspaceVersion: "4",
    };
    const workspaceState = {
      checkpointedAt: "2026-04-27T00:00:00.000Z",
      createdAt: "2026-04-27T00:00:00.000Z",
      inboxMediaRetentionWakeAt: null,
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: null,
      updatedAt: "2026-04-27T00:00:00.000Z",
      userId: "member_123",
      version: "4",
    };

    expect(parseHostedWorkspaceInvocationRequest(workspaceInvocationRequest)).toEqual(
      workspaceInvocationRequest,
    );
    expect(parseHostedWorkspaceInvocationRequest({
      ...workspaceInvocationRequest,
      processingMode: "inbox_media_retention",
    })).toEqual({
      ...workspaceInvocationRequest,
      processingMode: "inbox_media_retention",
    });
    expect(parseHostedWorkspaceInvocationRequest({
      ...workspaceInvocationRequest,
      processingMode: "system_mailbox",
    })).toEqual({
      ...workspaceInvocationRequest,
      processingMode: "system_mailbox",
    });
    expect(() => parseHostedWorkspaceInvocationRequest({
      ...workspaceInvocationRequest,
      processingMode: "assistant",
    })).toThrow(
      "Hosted workspace invocation request processingMode is not supported.",
    );
    expect(parseHostedWorkspaceInvocationRequest({
      ...workspaceInvocationRequest,
      workspace: workspaceState,
    })).toEqual({
      ...workspaceInvocationRequest,
      workspace: workspaceState,
    });
    expect(() => parseHostedWorkspaceInvocationRequest({
      ...workspaceInvocationRequest,
      reason: "nudge",
    })).toThrow(
      "Hosted workspace invocation request.reason is no longer supported.",
    );
    expect(() => parseHostedWorkspaceInvocationRequest({
      ...workspaceInvocationRequest,
      source: "manual",
    })).toThrow(
      "Hosted workspace invocation request.source is no longer supported.",
    );
    expect(() => parseHostedWorkspaceInvocationRequest({
      attemptId: "attempt_3",
      checkpointNextWakeAt: null,
      leaseGeneration: "9",
      userId: "member_123",
      workspaceVersion: "4",
    })).toThrow(
      "Hosted workspace invocation request.checkpointNextWakeAt is no longer supported.",
    );
    for (const field of [
      "committedSeq",
      "deadlineAt",
      "events",
      "finalizeRequired",
      "inputCommittedSeq",
      "inputCursorVersion",
      "requestedTargetSeq",
      "resumeFinalize",
      "run",
      "runDrain",
      "runId",
      "runToken",
      "targetCommittedSeqHint",
      "targetReached",
      "wake",
    ]) {
      expect(() => parseHostedWorkspaceInvocationRequest({
        attemptId: "attempt_1",
        leaseGeneration: "7",
        [field]: field === "events" ? [] : "legacy",
        userId: "member_123",
        workspaceVersion: "4",
      })).toThrow(`Hosted workspace invocation request.${field} is no longer supported.`);
    }
    expect(parseHostedWorkspaceInvocationResult({
      nextWakeAt: null,
      redactedStatus: {
        count: 1,
      },
      status: "idle",
    })).toEqual({
      nextWakeAt: null,
      redactedStatus: {
        count: 1,
      },
      status: "idle",
    });
    expect(parseHostedWorkspaceInvocationResult({
      status: "scheduled",
    })).toEqual({
      status: "scheduled",
    });
    expect(parseHostedWorkspaceInvocationResult({
      immediateRecheckRequested: true,
      nextWakeAt: "2026-04-26T00:00:05.000Z",
      nextWakeReason: "assistant",
      status: "idle",
    })).toEqual({
      immediateRecheckRequested: true,
      nextWakeAt: "2026-04-26T00:00:05.000Z",
      nextWakeReason: "assistant",
      status: "idle",
    });
    expect(() => parseHostedWorkspaceInvocationResult({
      immediateRecheckRequested: false,
      status: "idle",
    })).toThrow(
      "Hosted workspace invocation result immediateRecheckRequested must be true when present.",
    );
    expect(() => parseHostedWorkspaceInvocationResult({
      idleShutdownCheckpointed: true,
      status: "idle",
    })).toThrow("Hosted workspace invocation result.idleShutdownCheckpointed is no longer supported.");
    expect(() => parseHostedWorkspaceInvocationResult({
      idleShutdownCheckpointSkipped: "warm_workspace_unavailable",
      status: "idle",
    })).toThrow("Hosted workspace invocation result.idleShutdownCheckpointSkipped is no longer supported.");
  });

  it("parses mailbox fetch contracts without run ownership fields", () => {
    const item = createMailboxItem({
      consumedAt: "2026-04-26T00:00:03.000Z",
    });

    expect(parseHostedMailboxItem(item)).toEqual(item);
    expect(parseHostedMailboxFetchRequest({
      cursorMode: "imported_seq",
      lanes: [
        { importedSeq: "0", lane: "conversation" },
        { importedSeq: "4", lane: "system" },
      ],
      limitPerLane: 25,
      requestId: "mailbox-fetch-1",
    })).toEqual({
      cursorMode: "imported_seq",
      lanes: [
        { importedSeq: "0", lane: "conversation" },
        { importedSeq: "4", lane: "system" },
      ],
      limitPerLane: 25,
      requestId: "mailbox-fetch-1",
    });
    expect(parseHostedMailboxFetchResponse({
      conversationUsageStatus: "low",
      fetchedAt: "2026-04-26T00:00:02.000Z",
      items: [item],
      maxSeqByLane: [
        { lane: "conversation", maxSeq: "11" },
        { lane: "system", maxSeq: "4" },
      ],
      userId: "member_123",
    })).toEqual({
      conversationUsageStatus: "low",
      fetchedAt: "2026-04-26T00:00:02.000Z",
      items: [item],
      maxSeqByLane: [
        { lane: "conversation", maxSeq: "11" },
        { lane: "system", maxSeq: "4" },
      ],
      userId: "member_123",
    });
    expect(parseHostedMailboxFetchResponse({
      fetchedAt: "2026-04-26T00:00:02.000Z",
      items: [],
      maxSeqByLane: [],
      userId: "member_123",
    })).toEqual({
      fetchedAt: "2026-04-26T00:00:02.000Z",
      items: [],
      maxSeqByLane: [],
      userId: "member_123",
    });
    expect(parseHostedMailboxFetchResponse({
      conversationUsageStatus: null,
      fetchedAt: "2026-04-26T00:00:02.000Z",
      items: [],
      maxSeqByLane: [],
      userId: "member_123",
    })).toEqual({
      conversationUsageStatus: null,
      fetchedAt: "2026-04-26T00:00:02.000Z",
      items: [],
      maxSeqByLane: [],
      userId: "member_123",
    });

    expect(() => parseHostedMailboxItem({
      ...item,
      lane: "global",
    })).toThrow(/Hosted mailbox lane/u);
    expect(() => parseHostedMailboxItem({
      ...item,
      laneSeq: "not-a-seq",
    })).toThrow(/non-negative base-10 integer string/u);
    expect(() => parseHostedMailboxItem({
      ...item,
      laneSeq: "-1",
    })).toThrow(/non-negative base-10 integer string/u);
    expect(() => parseHostedMailboxItem({
      ...item,
      causalSeq: "not-a-seq",
    })).toThrow(/non-negative base-10 integer string/u);
    expect(() => parseHostedMailboxFetchRequest({
      lanes: [
        { importedSeq: "0", lane: "conversation" },
      ],
      limitPerLane: 0,
      requestId: "mailbox-fetch-1",
    })).toThrow(/positive integer/u);
    expect(() => parseHostedMailboxFetchRequest({
      cursorMode: "consumed_seq",
      lanes: [
        { importedSeq: "0", lane: "conversation" },
      ],
      limitPerLane: 25,
      requestId: "mailbox-fetch-1",
    })).toThrow(/Hosted mailbox fetch request cursorMode/u);
    expect(() => parseHostedMailboxFetchResponse({
      conversationUsageStatus: "healthy",
      fetchedAt: "2026-04-26T00:00:02.000Z",
      items: [],
      maxSeqByLane: [],
      userId: "member_123",
    })).toThrow(/conversationUsageStatus/u);
    expect(() => parseHostedMailboxFetchResponse({
      fetchedAt: "2026-04-26T00:00:02.000Z",
      items: [],
      maxSeqByLane: [
        { lane: "conversation", maxSeq: "0x10" },
      ],
      userId: "member_123",
    })).toThrow(/non-negative base-10 integer string/u);
  });

  it("parses minimal mailbox records and payload sidecars", () => {
    const minimalItem = {
      createdAt: "2026-04-26T00:00:01.000Z",
      dedupeKey: "system:member_123:activation",
      id: "mailbox_system_1",
      kind: "member.activated",
      lane: "system",
      laneSeq: "1",
      occurredAt: "2026-04-26T00:00:00.000Z",
      payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
      updatedAt: "2026-04-26T00:00:01.000Z",
      userId: "member_123",
    };
    const nullableItem = {
      ...minimalItem,
      consumedAt: null,
      expiresAt: null,
      payloadBytes: null,
      payloadInlineCiphertext: null,
      payloadRef: null,
    };
    const payload = {
      createdAt: "2026-04-26T00:00:01.000Z",
      mailboxItemId: "mailbox_system_1",
      payloadCiphertext: "ciphertext",
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      userId: "member_123",
    };

    expect(parseHostedMailboxItem(minimalItem)).toEqual({
      ...minimalItem,
      causalSeq: "0",
    });
    expect(parseHostedMailboxItem(nullableItem)).toEqual({
      ...nullableItem,
      causalSeq: "0",
    });
    expect(parseHostedMailboxPayload(payload)).toEqual(payload);
    expect(parseHostedMailboxLaneCounterState({
      lane: "system",
      nextSeq: "2",
      updatedAt: "2026-04-26T00:00:02.000Z",
      userId: "member_123",
    })).toEqual({
      lane: "system",
      nextSeq: "2",
      updatedAt: "2026-04-26T00:00:02.000Z",
      userId: "member_123",
    });
  });

  it("parses raw mailbox payload fetches with retryable unavailable states", () => {
    const payload = {
      createdAt: "2026-04-26T00:00:01.000Z",
      mailboxItemId: "mailbox_system_1",
      payloadCiphertext: "ciphertext",
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      userId: "member_123",
    };

    expect(parseHostedMailboxPayloadFetchRequest({
      dedupeKey: "dedupe_1",
      mailboxItemId: "mailbox_system_1",
      payloadRef: "payload_ref_1",
      requestId: "payload-fetch-1",
    })).toEqual({
      dedupeKey: "dedupe_1",
      mailboxItemId: "mailbox_system_1",
      payloadRef: "payload_ref_1",
      requestId: "payload-fetch-1",
    });
    expect(parseHostedMailboxPayloadFetchResponse({
      fetchedAt: "2026-04-26T00:00:02.000Z",
      payload,
    })).toEqual({
      fetchedAt: "2026-04-26T00:00:02.000Z",
      payload,
    });
    expect(parseHostedMailboxPayloadFetchResponse({
      fetchedAt: "2026-04-26T00:00:02.000Z",
      payload: null,
      unavailable: {
        code: "not_found",
        retryable: true,
      },
    })).toEqual({
      fetchedAt: "2026-04-26T00:00:02.000Z",
      payload: null,
      unavailable: {
        code: "not_found",
        retryable: true,
      },
    });
    expect(() => parseHostedMailboxPayloadFetchResponse({
      fetchedAt: "2026-04-26T00:00:02.000Z",
      payload: null,
    })).toThrow(/requires payload or unavailable/u);
    expect(() => parseHostedMailboxPayloadFetchResponse({
      fetchedAt: "2026-04-26T00:00:02.000Z",
      payload,
      unavailable: {
        code: "gone",
        retryable: false,
      },
    })).toThrow(/must not include both/u);
  });

  it("delegates device-sync bridge envelopes to the device-sync runtime owner", () => {
    expect(parseHostedRuntimeDeviceSyncBridgeEnvelope({
      connectionId: "conn_123",
      expectedConnectedAt: "2026-04-25T00:00:00.000Z",
      hint: {
        jobs: [
          {
            kind: "reconcile",
            payload: {
              windowStart: "2026-04-25T00:00:00.000Z",
            },
          },
        ],
      },
      kind: "device-sync.wake",
      provider: "oura",
      requestId: "device-sync-wake-1",
    })).toEqual({
      connectionId: "conn_123",
      expectedConnectedAt: "2026-04-25T00:00:00.000Z",
      hint: {
        jobs: [
          {
            kind: "reconcile",
            payload: {
              windowStart: "2026-04-25T00:00:00.000Z",
            },
          },
        ],
      },
      kind: "device-sync.wake",
      provider: "oura",
      requestId: "device-sync-wake-1",
    });
    expect(parseHostedRuntimeDeviceSyncBridgeEnvelope({
      kind: "device-sync.snapshot",
      request: {
        provider: "oura",
        userId: "member_123",
      },
      requestId: "device-sync-snapshot-1",
    })).toEqual({
      kind: "device-sync.snapshot",
      request: {
        includeCredentialMaterial: false,
        provider: "oura",
        userId: "member_123",
      },
      requestId: "device-sync-snapshot-1",
    });
    expect(parseHostedRuntimeDeviceSyncBridgeEnvelope({
      kind: "device-sync.apply",
      request: {
        occurredAt: "2026-04-26T00:00:05.000Z",
        updates: [],
        userId: "member_123",
      },
      requestId: "device-sync-apply-1",
    })).toEqual({
      kind: "device-sync.apply",
      request: {
        occurredAt: "2026-04-26T00:00:05.000Z",
        updates: [],
        userId: "member_123",
      },
      requestId: "device-sync-apply-1",
    });
    expect(() => parseHostedRuntimeDeviceSyncBridgeEnvelope({
      kind: "device-sync.apply",
      request: {
        updates: "not-array",
        userId: "member_123",
      },
      requestId: "device-sync-apply-1",
    })).toThrow(/Hosted device-sync runtime apply request updates/u);
  });

  it("parses usage records and issue exports through their contract owners", () => {
    const usage = createAssistantUsageRecord();
    const issue = createAssistantRuntimeIssueRecord();
    const noticeDeliveryTarget = {
      channel: "linq",
      replyToMessageId: "linq_message_123",
      routeAuthority: {
        accountLookupKey: "hbidx:phone:v1:account",
        channel: "linq",
        containerMemberId: "member_thread_123",
        threadId: "linq_chat_123",
      },
      target: "linq_chat_123",
    } as const;

    expect(parseHostedRuntimeUsageRecordRequest({
      noticeDeliveryTarget,
      usage,
    })).toEqual({
      noticeDeliveryTarget,
      usage,
    });
    expect(parseHostedRuntimeUsageRecordRequest({
      noticeDeliveryTarget: null,
      usage,
    })).toEqual({
      noticeDeliveryTarget: null,
      usage,
    });
    expect(parseHostedRuntimeUsageRecordRequest({
      noticeDeliveryTarget: {
        channel: "linq",
        replyToMessageId: "linq_message_1",
        routeAuthority: {
          channel: "linq",
          containerMemberId: "container_member_1",
          threadId: "linq_thread_1",
        },
        target: "linq_chat_1",
      },
      usage,
    })).toEqual({
      noticeDeliveryTarget: {
        channel: "linq",
        replyToMessageId: "linq_message_1",
        routeAuthority: {
          channel: "linq",
          containerMemberId: "container_member_1",
          threadId: "linq_thread_1",
        },
        target: "linq_chat_1",
      },
      usage,
    });
    expect(parseHostedRuntimeUsageRecordRequest({
      noticeDeliveryTarget: {
        channel: "telegram",
        replyToMessageId: "telegram_message_1",
        target: "telegram_thread_1",
      },
      usage,
    })).toEqual({
      noticeDeliveryTarget: {
        channel: "telegram",
        replyToMessageId: "telegram_message_1",
        target: "telegram_thread_1",
      },
      usage,
    });
    expect(parseHostedRuntimeUsageRecordResponse({
      recorded: true,
      usageId: usage.usageId,
    })).toEqual({
      recorded: true,
      usageId: usage.usageId,
    });
    expect(parseHostedRuntimeIssueExportRequest({
      issues: [issue],
    })).toEqual({
      issues: [issue],
    });
    expect(parseHostedRuntimeIssueExportResponse({
      issueIds: [issue.issueId],
      recorded: 1,
    })).toEqual({
      issueIds: [issue.issueId],
      recorded: 1,
    });
    expect(parseHostedRuntimeUsageRecordRequest({
      noticeDeliveryTarget: {
        ...noticeDeliveryTarget,
        routeAuthority: null,
      },
      usage,
    })).toEqual({
      noticeDeliveryTarget: {
        ...noticeDeliveryTarget,
        routeAuthority: null,
      },
      usage,
    });
    expect(() => parseHostedRuntimeUsageRecordRequest({
      unexpected: true,
      usage,
    })).toThrow(/unexpected is not allowed/u);
    expect(() => parseHostedRuntimeUsageRecordRequest({
      usage: {
        ...usage,
        usageId: "wrong",
      },
    })).toThrow(
      /usageId must match the canonical turnId\/providerRequestOrdinal\/attemptCount-derived value/u,
    );
    expect(() => parseHostedRuntimeIssueExportRequest({
      issues: [
        {
          ...issue,
          issueId: "wrong",
        },
      ],
    })).toThrow(/issueId/u);
    expect(() => parseHostedRuntimeUsageRecordResponse({
      recorded: -1,
      usageId: usage.usageId,
    })).toThrow(/boolean/u);
    expect(() => parseHostedRuntimeUsageRecordResponse({
      recorded: true,
      usageId: "",
    })).toThrow(/non-empty string/u);
  });

  it("parses hosted Codex auth updates with exact bounded callback shapes", () => {
    expect(parseHostedCodexAuthUpdate({
      attemptId: "hca_abcdefghijklmnop",
      phase: "device_code",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.openai.com/device",
    })).toEqual({
      attemptId: "hca_abcdefghijklmnop",
      phase: "device_code",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.openai.com/device",
    });
    expect(parseHostedCodexAuthUpdate({
      attemptId: "hca_abcdefghijklmnop",
      phase: "connected",
    })).toEqual({
      attemptId: "hca_abcdefghijklmnop",
      phase: "connected",
    });
    expect(parseHostedCodexAuthUpdateResponse({ applied: false })).toEqual({
      applied: false,
      status: "superseded",
    });
    expect(parseHostedCodexAuthUpdateResponse({
      applied: true,
      status: "already_applied",
    })).toEqual({
      applied: true,
      status: "already_applied",
    });
    expect(() => parseHostedCodexAuthUpdateResponse({
      applied: true,
      status: "superseded",
    })).toThrow(/conflicts/u);

    expect(() => parseHostedCodexAuthUpdate({
      attemptId: "hca_abcdefghijklmnop",
      phase: "device_code",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://example.test/device",
    })).toThrow(/OpenAI auth host/u);
    expect(() => parseHostedCodexAuthUpdate({
      attemptId: "hca_abcdefghijklmnop",
      phase: "connected",
      verificationUrl: "https://auth.openai.com/device",
    })).toThrow(/not allowed/u);
  });

  it("parses hosted runtime latency trace callbacks with exact safe keys", () => {
    expect([
      readHostedIngressLatencySource("linq"),
      readHostedIngressLatencySource("telegram"),
      readHostedIngressLatencySource("signal"),
      readHostedIngressLatencySource("email"),
      readHostedIngressLatencySource(null),
    ]).toEqual([
      "linq",
      "telegram",
      null,
      null,
      null,
    ]);

    expect(parseHostedRuntimeLatencyTraceRequest({
      event: {
        assistantInputId: "input_1",
        at: "2026-04-26T00:00:00.000Z",
        mailboxItemId: "mailbox_item_1",
        runnerJobAcceptedAt: "2026-04-26T00:00:00.100Z",
        runtimeAttemptId: "attempt_1",
        runtimePhaseStartedAt: "2026-04-26T00:00:00.200Z",
        source: "linq",
        type: "assistant_input_staged",
        workspaceRestoreDoneAt: "2026-04-26T00:00:00.300Z",
      },
    })).toEqual({
      event: {
        assistantInputId: "input_1",
        at: "2026-04-26T00:00:00.000Z",
        mailboxItemId: "mailbox_item_1",
        runnerJobAcceptedAt: "2026-04-26T00:00:00.100Z",
        runtimeAttemptId: "attempt_1",
        runtimePhaseStartedAt: "2026-04-26T00:00:00.200Z",
        source: "linq",
        type: "assistant_input_staged",
        workspaceRestoreDoneAt: "2026-04-26T00:00:00.300Z",
      },
    });
    expect(parseHostedRuntimeLatencyTraceRequest({
      event: {
        assistantInputIds: ["input_1", "input_2"],
        at: "2026-04-26T00:00:01.000Z",
        providerRequestOrdinal: 0,
        runtimeAttemptId: null,
        source: "linq",
        type: "provider_started",
      },
    })).toEqual({
      event: {
        assistantInputIds: ["input_1", "input_2"],
        at: "2026-04-26T00:00:01.000Z",
        providerRequestOrdinal: 0,
        runtimeAttemptId: null,
        source: "linq",
        type: "provider_started",
      },
    });
    expect(parseHostedRuntimeLatencyTraceRequest({
      event: {
        assistantInputIds: ["input_1", "input_2"],
        at: "2026-04-26T00:00:01.500Z",
        milestone: "progress_update_accepted",
        runtimeAttemptId: "attempt_1",
        source: "linq",
        type: "assistant_milestone",
      },
    })).toEqual({
      event: {
        assistantInputIds: ["input_1", "input_2"],
        at: "2026-04-26T00:00:01.500Z",
        milestone: "progress_update_accepted",
        runtimeAttemptId: "attempt_1",
        source: "linq",
        type: "assistant_milestone",
      },
    });
    expect(parseHostedRuntimeLatencyTraceRequest({
      event: {
        assistantInputIds: ["input_1", "input_2"],
        at: "2026-04-26T00:00:01.600Z",
        milestone: "first_codex_text_observed",
        runtimeAttemptId: "attempt_1",
        source: "linq",
        type: "assistant_milestone",
      },
    })).toEqual({
      event: {
        assistantInputIds: ["input_1", "input_2"],
        at: "2026-04-26T00:00:01.600Z",
        milestone: "first_codex_text_observed",
        runtimeAttemptId: "attempt_1",
        source: "linq",
        type: "assistant_milestone",
      },
    });
    expect(parseHostedRuntimeLatencyTraceRequest({
      event: {
        assistantInputIds: ["input_1", "input_2"],
        at: "2026-04-26T00:00:01.750Z",
        checkpointPublicationExpectedBy: "2026-04-26T00:15:00.000Z",
        milestone: "terminal_non_reply_committed",
        runtimeAttemptId: "attempt_1",
        source: "linq",
        type: "assistant_milestone",
      },
    })).toEqual({
      event: {
        assistantInputIds: ["input_1", "input_2"],
        at: "2026-04-26T00:00:01.750Z",
        checkpointPublicationExpectedBy: "2026-04-26T00:15:00.000Z",
        milestone: "terminal_non_reply_committed",
        runtimeAttemptId: "attempt_1",
        source: "linq",
        type: "assistant_milestone",
      },
    });
    expect(parseHostedRuntimeLatencyTraceRequest({
      event: {
        at: "2026-04-26T00:00:02.000Z",
        milestone: "checkpoint_publication_expected_by",
        runtimeAttemptId: "attempt_1",
        source: "linq",
        type: "runtime_milestone",
      },
    })).toEqual({
      event: {
        at: "2026-04-26T00:00:02.000Z",
        milestone: "checkpoint_publication_expected_by",
        runtimeAttemptId: "attempt_1",
        source: "linq",
        type: "runtime_milestone",
      },
    });
    expect(parseHostedRuntimeLatencyTraceRequest({
      event: {
        at: "2026-04-26T00:00:02.000Z",
        milestone: "mailbox_import_done",
        runtimeAttemptId: "attempt_1",
        source: "linq",
        type: "runtime_milestone",
      },
    })).toEqual({
      event: {
        at: "2026-04-26T00:00:02.000Z",
        milestone: "mailbox_import_done",
        runtimeAttemptId: "attempt_1",
        source: "linq",
        type: "runtime_milestone",
      },
    });
    expect(parseHostedRuntimeLatencyTraceResponse({
      matchedCount: 1,
      recorded: true,
      unmatchedCount: 0,
    })).toEqual({
      matchedCount: 1,
      recorded: true,
      unmatchedCount: 0,
    });

    expect(() => parseHostedRuntimeLatencyTraceRequest({
      event: {
        assistantInputId: "input_1",
        at: "2026-04-26T00:00:00.000Z",
        mailboxItemId: "mailbox_item_1",
        source: "linq",
        type: "assistant_input_staged",
        userId: "member_1",
      },
    })).toThrow(/userId is not allowed/u);
    expect(() => parseHostedRuntimeLatencyTraceRequest({
      event: {
        assistantInputIds: Array.from({ length: 65 }, (_, index) => `input_${index}`),
        at: "2026-04-26T00:00:01.000Z",
        providerRequestOrdinal: 0,
        source: "linq",
        type: "provider_started",
      },
    })).toThrow(/at most 64 ids/u);
    expect(() => parseHostedRuntimeLatencyTraceRequest({
      event: {
        assistantInputIds: ["input_1"],
        at: "2026-04-26T00:00:01.000Z",
        message: "raw text",
        providerRequestOrdinal: 0,
        source: "linq",
        type: "provider_started",
      },
    })).toThrow(/message is not allowed/u);
    expect(() => parseHostedRuntimeLatencyTraceRequest({
      event: {
        assistantInputIds: ["input_1"],
        at: "2026-04-26T00:00:01.500Z",
        message: "raw text",
        milestone: "first_codex_output_observed",
        runtimeAttemptId: "attempt_1",
        source: "linq",
        type: "assistant_milestone",
      },
    })).toThrow(/message is not allowed/u);
    expect(() => parseHostedRuntimeLatencyTraceRequest({
      event: {
        at: "2026-04-26T00:00:02.000Z",
        milestone: "provider_done",
        source: "linq",
        type: "runtime_milestone",
      },
    })).toThrow(/milestone/u);
  });

  it("round-trips phaseBreakdown on both latency events and rejects unsafe leaves", () => {
    const stagedBreakdown = {
      schemaVersion: 1,
      orchestration: {
        temporalActivityStartedAtEpochMs: 1_777_000_000_000,
        temporalActivityRequestStartedAtEpochMs: 1_777_000_000_010,
        tokenAcquireStartedAtEpochMs: 1_777_000_000_011,
        tokenAcquiredAtEpochMs: 1_777_000_000_012,
        directEnsureRequestStartedAtEpochMs: 1_777_000_000_013,
        directEnsureResponseReceivedAtEpochMs: 1_777_000_000_014,
        directEnsureOrchestrationAttemptId:
          "web-ingress-123e4567-e89b-42d3-a456-426614174000",
        runtimeControlAuthStartedAtEpochMs: 1_777_000_000_015,
        runtimeControlAuthFinishedAtEpochMs: 1_777_000_000_016,
        cloudflareRouteReceivedAtEpochMs: 1_777_000_000_020,
        runtimeInvocationOrchestrationAttemptId:
          "web-ingress-123e4567-e89b-42d3-a456-426614174000",
        userRunnerRpcStartedAtEpochMs: 1_777_000_000_021,
        runtimeConsentLockAcquiredAtEpochMs: 1_777_000_000_022,
        healthDataAdmissionReadStartedAtEpochMs: 1_777_000_000_023,
        healthDataAdmissionReadFinishedAtEpochMs: 1_777_000_000_024,
        userRunnerEnsureStartedAtEpochMs: 1_777_000_000_030,
        runnerStateBindStartedAtEpochMs: 1_777_000_000_031,
        runnerStateBindFinishedAtEpochMs: 1_777_000_000_032,
        runnerStateReadStartedAtEpochMs: 1_777_000_000_033,
        runnerStateReadFinishedAtEpochMs: 1_777_000_000_034,
        activeFenceObservedAtEpochMs: 1_777_000_000_035,
        activeFenceTargetWasPriorVersion: true,
        activeWakeStartedAtEpochMs: 1_777_000_000_040,
        activeWakeFinishedAtEpochMs: 1_777_000_000_050,
        activeWakeElapsedMs: 10,
        activeWakeAccepted: false,
        activeWakeFoundNoActiveChild: true,
        replacementFenceClearStartedAtEpochMs: 1_777_000_000_055,
        replacementFenceClearedAtEpochMs: 1_777_000_000_060,
        replacementFenceClearElapsedMs: 5,
        replacedStaleFence: true,
        freshStartRequestedAtEpochMs: 1_777_000_000_070,
        freshStartFenceBoundAtEpochMs: 1_777_000_000_080,
        freshStartContainerReadyAtEpochMs: 1_777_000_000_090,
        freshStartInvocationPreparedAtEpochMs: 1_777_000_000_100,
        freshStartInvocationAcceptedAtEpochMs: 1_777_000_000_110,
        shellPrewarmFirstHintAtEpochMs: 1_777_000_000_061,
        shellPrewarmFinishedAtEpochMs: 1_777_000_000_063,
        shellPrewarmOperationElapsedMs: 2,
        shellPrewarmHintCount: 2,
        shellPrewarmOutcome: "cold_start_observed",
        shellPrewarmSource: "linq-typing-started",
        workspaceReadElapsedMs: 30,
        runtimeStoreEnsureElapsedMs: 40,
        runtimeInvocationPreparationElapsedMs: 60,
      },
      dispatch: {
        invokeReceivedAtEpochMs: 1_777_000_000_000,
        containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
      },
      restore: {
        sizeGuardMs: 1,
        dataKeyUnwrapMs: 2,
        scratchPrepareMs: 3,
        presignGetMs: 4,
        objectFetchMs: 5,
        objectFetchResponseHeadersMs: 2,
        objectFetchBodyReadMs: 3,
        decryptMs: 6,
        archiveExtractMs: 7,
        durableRootReplaceMs: 9,
        cleanupMs: 10,
        extractMs: 11,
        encryptedBytes: 12,
        plainBytes: 13,
        replaySafeReadMaxAttempt: 1,
      },
      boot: { nodeStartupMs: 14, restoreWasCold: true },
      wake: {
        runtimeWakeNotifiedAtEpochMs: 1_777_000_000_100,
        foregroundWaitResolvedAtEpochMs: 1_777_000_000_110,
        foregroundImportStartedAtEpochMs: 1_777_000_000_111,
        foregroundWakeOrdinal: 1,
        activeRuntimePassOrdinal: 2,
        activeRuntimePassStartedAtEpochMs: 1_777_000_000_090,
        activeRuntimePassForeground: false,
      },
    };
    expect(parseHostedRuntimeLatencyTraceRequest({
      event: {
        assistantInputId: "input_1",
        at: "2026-04-26T00:00:00.000Z",
        mailboxItemId: "mailbox_item_1",
        phaseBreakdown: stagedBreakdown,
        source: "linq",
        type: "assistant_input_staged",
      },
    })).toEqual({
      event: {
        assistantInputId: "input_1",
        at: "2026-04-26T00:00:00.000Z",
        mailboxItemId: "mailbox_item_1",
        phaseBreakdown: stagedBreakdown,
        source: "linq",
        type: "assistant_input_staged",
      },
    });

    const providerBreakdown = {
      schemaVersion: 1,
      dispatch: {
        invokeReceivedAtEpochMs: 1_777_000_000_000,
      },
      preProvider: {
        mailboxImportDoneToAssistantPhaseMs: 29,
        workspaceAssistantPreAutomationMs: 11,
        automationLaneToAssistantServiceMs: 7,
        automationReadinessMs: 1,
        automationInputSelectionMs: 1,
        automationPassSetupMs: 1,
        automationCandidateScanMs: 1,
        automationGroupAndOperationScopeMs: 1,
        automationTerminalEvidenceMs: 1,
        automationSessionPreflightMs: 1,
        automationCrossSessionContextMs: 0,
        automationPromptPreparationMs: 0,
        automationServiceHandoffMs: 0,
        executionTargetHydrateMs: 2,
        systemMailboxMaintenanceMs: 3,
        memberPreferencesPrePlanningMs: 4,
        automationBootstrapMs: 5,
        outboxScanBytesRead: 8_192,
        outboxScanElapsedMs: 23,
        outboxScanFilesRead: 10,
        outboxScanPerformed: true,
        receiptScanBytesRead: 4_096,
        receiptScanElapsedMs: 19,
        receiptScanFilesRead: 12,
        receiptScanLockWaitMs: 3,
        receiptScanPerformed: false,
      },
      assistant: {
        runtimeLeaseGeneration: "18446744073709551615",
        terminalNonReplyCommittedAtEpochMs: 1_777_000_000_125,
      },
      provider: {
        assistantServicePreLockMs: 5,
        codexAppServerInitializeMs: 7,
        codexAppServerPreProviderMs: 17,
        codexAppServerSpawnReadyMs: 1,
        codexAppServerThreadResumeMs: 9,
        codexAppServerThreadStartMs: 0,
        codexAppServerWarmReuseMs: 0,
        codexProcessPreparationMs: 3,
        turnLockWaitMs: 1,
        sessionResolveMs: 2,
        promptBuildMs: 3,
        admissionMs: 4,
        preProviderSetupMs: 5,
        providerPlanAndGateMs: 13,
        linqEgressGuardMs: 6,
      },
    };
    expect(parseHostedRuntimeLatencyTraceRequest({
      event: {
        assistantInputIds: ["input_1"],
        at: "2026-04-26T00:00:01.000Z",
        phaseBreakdown: providerBreakdown,
        providerRequestOrdinal: 0,
        source: "linq",
        type: "provider_started",
      },
    })).toEqual({
      event: {
        assistantInputIds: ["input_1"],
        at: "2026-04-26T00:00:01.000Z",
        phaseBreakdown: providerBreakdown,
        providerRequestOrdinal: 0,
        source: "linq",
        type: "provider_started",
      },
    });

    // Secret-safety + robustness: a malformed phaseBreakdown is DROPPED (never
    // reaches storage) while the core latency event still parses. phaseBreakdown is
    // best-effort telemetry, so an unsafe/unknown shape must not poison the event
    // and lose the essential milestones. Each unsafe input below must leave the
    // returned event with no phaseBreakdown key.
    for (const unsafeProvider of [
      { sessionResolveMs: "not-a-number" }, // string leaf
      { sessionResolveMs: { secret: 1 } }, // object leaf
      { sessionResolveMs: [1, 2, 3] }, // array leaf
      { codexAppServerWarmReuseMs: "0" }, // numeric leaf must stay numeric
      { providerPlanAndGateMs: 1.5 }, // durations must stay integer milliseconds
      { networkToken: 1 }, // unknown sub key
    ]) {
      const parsed = parseHostedRuntimeLatencyTraceRequest({
        event: {
          assistantInputIds: ["input_1"],
          at: "2026-04-26T00:00:01.000Z",
          phaseBreakdown: { schemaVersion: 1, provider: unsafeProvider },
          providerRequestOrdinal: 0,
          source: "linq",
          type: "provider_started",
        },
      });
      expect(parsed.event.type).toBe("provider_started");
      expect("phaseBreakdown" in parsed.event).toBe(false);
    }

    for (const unsafeAssistant of [
      { runtimeLeaseGeneration: 1 }, // generation must stay a string
      { runtimeLeaseGeneration: "01" }, // generation must be canonical
      { runtimeLeaseGeneration: "1".repeat(21) }, // header-compatible bound
      { runtimeLeaseGeneration: "1", callbackToken: 1 }, // unknown sub key
    ]) {
      const parsed = parseHostedRuntimeLatencyTraceRequest({
        event: {
          assistantInputIds: ["input_1"],
          at: "2026-04-26T00:00:01.000Z",
          phaseBreakdown: { schemaVersion: 1, assistant: unsafeAssistant },
          providerRequestOrdinal: 0,
          source: "linq",
          type: "provider_started",
        },
      });
      expect(parsed.event.type).toBe("provider_started");
      expect("phaseBreakdown" in parsed.event).toBe(false);
    }

    for (const unsafePreProvider of [
      { receiptScanPerformed: 1 }, // boolean leaf must stay boolean
      { outboxScanBytesRead: -1 }, // counts must be non-negative
      { receiptScanBytesRead: -1 }, // counts must be non-negative
      { outboxScanElapsedMs: "23" }, // durations must stay numeric
      { automationSessionPreflightMs: "2" }, // nested durations must stay numeric
      {
        automationLaneToAssistantServiceMs: 7,
        automationReadinessMs: 7,
      }, // a partial subdivision is ambiguous and must be dropped
      {
        automationLaneToAssistantServiceMs: 7,
        automationReadinessMs: 2,
        automationInputSelectionMs: 1,
        automationPassSetupMs: 1,
        automationCandidateScanMs: 1,
        automationGroupAndOperationScopeMs: 1,
        automationTerminalEvidenceMs: 1,
        automationSessionPreflightMs: 1,
        automationCrossSessionContextMs: 0,
        automationPromptPreparationMs: 0,
        automationServiceHandoffMs: 0,
      }, // all leaves are required to sum exactly to their parent
      { mailboxImportDoneToAssistantPhaseMs: -1 }, // durations must be non-negative
      { receiptScanFilesRead: 12, receiptScanPath: 1 }, // arbitrary metadata is forbidden
    ]) {
      const parsed = parseHostedRuntimeLatencyTraceRequest({
        event: {
          assistantInputIds: ["input_1"],
          at: "2026-04-26T00:00:01.000Z",
          phaseBreakdown: { schemaVersion: 1, preProvider: unsafePreProvider },
          providerRequestOrdinal: 0,
          source: "linq",
          type: "provider_started",
        },
      });
      expect(parsed.event.type).toBe("provider_started");
      expect("phaseBreakdown" in parsed.event).toBe(false);
    }

    // Orchestration diagnostics are the same metadata-only boundary: epoch-ms
    // numbers, explicit booleans, and two exact UUID-shaped correlation ids.
    for (const unsafeOrchestration of [
      { temporalActivityStartedAtEpochMs: 1, requestUrl: 1 }, // unknown sub key
      { tokenAcquireStartedAtEpochMs: -1 }, // web-side negative leaf
      { directEnsureResponseReceivedAtEpochMs: 1.5 }, // web-side non-integer leaf
      { directEnsureOrchestrationAttemptId: "web-ingress-not-a-uuid" }, // correlation id must be bounded
      { runtimeInvocationOrchestrationAttemptId: "attempt_1" }, // arbitrary attempt ids are forbidden
      { runtimeControlAuthStartedAtEpochMs: "1777000000015" }, // CF-side string leaf
      { cloudflareRouteReceivedAtEpochMs: 1.5 }, // non-integer leaf
      { userRunnerEnsureStartedAtEpochMs: -1 }, // negative leaf
      { activeFenceTargetWasPriorVersion: 1 }, // boolean leaf must stay boolean
      { activeWakeAccepted: 1 }, // boolean leaf must stay boolean
      { activeWakeFoundNoActiveChild: "true" }, // boolean leaf must stay boolean
      { activeWakeElapsedMs: 1.5 }, // duration must be an integer
      { freshStartRequestedAtEpochMs: "1777000000070" }, // string leaf
      { shellPrewarmHintCount: -1 }, // counts must be non-negative
      { shellPrewarmFirstHintAtEpochMs: "1777000000061" }, // timestamps stay numeric
      { shellPrewarmOutcome: "started" }, // outcomes stay in the bounded enum
      { shellPrewarmSource: "linq" }, // sources stay in the bounded enum
      { runtimeStoreEnsureElapsedMs: -1 }, // duration must be non-negative
    ]) {
      const parsed = parseHostedRuntimeLatencyTraceRequest({
        event: {
          assistantInputId: "input_1",
          at: "2026-04-26T00:00:00.000Z",
          mailboxItemId: "mailbox_item_1",
          phaseBreakdown: { schemaVersion: 1, orchestration: unsafeOrchestration },
          source: "linq",
          type: "assistant_input_staged",
        },
      });
      expect(parsed.event.type).toBe("assistant_input_staged");
      expect("phaseBreakdown" in parsed.event).toBe(false);
    }

    // Dispatch is the same trust boundary: unknown sub keys and non-integer or
    // negative epoch leaves must drop the whole breakdown (never partially
    // salvage it) while the staged event itself still parses.
    for (const unsafeDispatch of [
      { invokeReceivedAtEpochMs: 1, routedThroughColo: 1 }, // unknown sub key
      { invokeReceivedAtEpochMs: 1.5 }, // non-integer leaf
      { containerEnsureReadyStartedAtEpochMs: -1 }, // negative leaf
      { invokeReceivedAtEpochMs: "1777000000000" }, // string leaf
    ]) {
      const parsed = parseHostedRuntimeLatencyTraceRequest({
        event: {
          assistantInputId: "input_1",
          at: "2026-04-26T00:00:00.000Z",
          mailboxItemId: "mailbox_item_1",
          phaseBreakdown: { schemaVersion: 1, dispatch: unsafeDispatch },
          source: "linq",
          type: "assistant_input_staged",
        },
      });
      expect(parsed.event.type).toBe("assistant_input_staged");
      expect("phaseBreakdown" in parsed.event).toBe(false);
    }

    // Wake diagnostics follow the same metadata-only contract as dispatch:
    // numeric epoch stamps only, no ids, paths, tokens, or arbitrary labels.
    for (const unsafeWake of [
      { runtimeWakeNotifiedAtEpochMs: 1, threadId: 1 }, // unknown sub key
      { foregroundWaitResolvedAtEpochMs: 1.5 }, // non-integer leaf
      { foregroundImportStartedAtEpochMs: -1 }, // negative leaf
      { runtimeWakeNotifiedAtEpochMs: "1777000000100" }, // string leaf
      { activeRuntimePassForeground: 0 }, // boolean leaf must stay boolean
    ]) {
      const parsed = parseHostedRuntimeLatencyTraceRequest({
        event: {
          assistantInputId: "input_1",
          at: "2026-04-26T00:00:00.000Z",
          mailboxItemId: "mailbox_item_1",
          phaseBreakdown: { schemaVersion: 1, wake: unsafeWake },
          source: "linq",
          type: "assistant_input_staged",
        },
      });
      expect(parsed.event.type).toBe("assistant_input_staged");
      expect("phaseBreakdown" in parsed.event).toBe(false);
    }

    // Unknown top-level breakdown key is likewise dropped, not thrown, and the
    // core staged event survives.
    const droppedStaged = parseHostedRuntimeLatencyTraceRequest({
      event: {
        assistantInputId: "input_1",
        at: "2026-04-26T00:00:00.000Z",
        mailboxItemId: "mailbox_item_1",
        phaseBreakdown: { schemaVersion: 1, network: { token: 1 } },
        source: "linq",
        type: "assistant_input_staged",
      },
    });
    expect(droppedStaged.event.type).toBe("assistant_input_staged");
    expect("phaseBreakdown" in droppedStaged.event).toBe(false);

    // A malformed LEAF (not just an unknown key) inside the staged breakdown must
    // drop ONLY the breakdown while PRESERVING the core staged milestone fields the
    // dashboard depends on (runnerJobAcceptedAt, runtimeAttemptId,
    // runtimePhaseStartedAt, workspaceRestoreDoneAt). This proves the lenient
    // wrapper salvages the essential milestones, not merely that it omits the key.
    const malformedLeafStaged = parseHostedRuntimeLatencyTraceRequest({
      event: {
        assistantInputId: "input_1",
        at: "2026-04-26T00:00:00.000Z",
        mailboxItemId: "mailbox_item_1",
        phaseBreakdown: {
          schemaVersion: 1,
          // Body-read duration is a string, not a non-negative integer: malformed leaf.
          restore: { objectFetchBodyReadMs: "not-a-number" },
          boot: { restoreWasCold: true },
        },
        runnerJobAcceptedAt: "2026-04-26T00:00:00.100Z",
        runtimeAttemptId: "attempt_staged_1",
        runtimePhaseStartedAt: "2026-04-26T00:00:00.200Z",
        source: "linq",
        type: "assistant_input_staged",
        workspaceRestoreDoneAt: "2026-04-26T00:00:00.300Z",
      },
    });
    expect("phaseBreakdown" in malformedLeafStaged.event).toBe(false);
    expect(malformedLeafStaged.event).toEqual({
      assistantInputId: "input_1",
      at: "2026-04-26T00:00:00.000Z",
      mailboxItemId: "mailbox_item_1",
      runnerJobAcceptedAt: "2026-04-26T00:00:00.100Z",
      runtimeAttemptId: "attempt_staged_1",
      runtimePhaseStartedAt: "2026-04-26T00:00:00.200Z",
      source: "linq",
      type: "assistant_input_staged",
      workspaceRestoreDoneAt: "2026-04-26T00:00:00.300Z",
    });
  });

  it("merges latency phase breakdown JSON idempotently and sanitizes stored leaves", () => {
    const merged = mergeHostedRuntimeLatencyPhaseBreakdownJson({
      existing: {
        schemaVersion: 1,
        wake: {
          runtimeWakeNotifiedAtEpochMs: 1_777_000_000_100,
          foregroundImportStartedAtEpochMs: true,
          threadId: 1,
        },
      },
      incoming: {
        schemaVersion: 1,
        wake: {
          runtimeWakeNotifiedAtEpochMs: 999,
          foregroundWaitResolvedAtEpochMs: 1_777_000_000_110,
          foregroundImportStartedAtEpochMs: 1_777_000_000_111,
          foregroundWakeOrdinal: 1,
          activeRuntimePassOrdinal: 2,
          activeRuntimePassStartedAtEpochMs: 1_777_000_000_090,
          activeRuntimePassForeground: false,
        },
      },
      phases: ["wake"],
    });

    expect(merged).toEqual({
      changed: true,
      value: {
        schemaVersion: 1,
        wake: {
          runtimeWakeNotifiedAtEpochMs: 1_777_000_000_100,
          foregroundWaitResolvedAtEpochMs: 1_777_000_000_110,
          foregroundImportStartedAtEpochMs: 1_777_000_000_111,
          foregroundWakeOrdinal: 1,
          activeRuntimePassOrdinal: 2,
          activeRuntimePassStartedAtEpochMs: 1_777_000_000_090,
          activeRuntimePassForeground: false,
        },
      },
    });

    const idempotent = mergeHostedRuntimeLatencyPhaseBreakdownJson({
      existing: merged.value,
      incoming: {
        schemaVersion: 1,
        wake: {
          runtimeWakeNotifiedAtEpochMs: 999,
          foregroundWaitResolvedAtEpochMs: 1_777_000_000_110,
          activeRuntimePassForeground: true,
        },
      },
      phases: ["wake"],
    });

    expect(idempotent).toEqual({
      changed: false,
      value: merged.value,
    });

    const earlierProgressMerged = mergeHostedRuntimeLatencyPhaseBreakdownJson({
      existing: {
        assistant: {
          progressUpdateAcceptedAtEpochMs: 1_777_000_030_000,
        },
        schemaVersion: 1,
      },
      incoming: {
        assistant: {
          progressUpdateAcceptedAtEpochMs: 1_777_000_029_999,
        },
        schemaVersion: 1,
      },
      phases: ["assistant"],
    });

    expect(earlierProgressMerged).toEqual({
      changed: true,
      value: {
        assistant: {
          progressUpdateAcceptedAtEpochMs: 1_777_000_029_999,
        },
        schemaVersion: 1,
      },
    });
    expect(mergeHostedRuntimeLatencyPhaseBreakdownJson({
      existing: earlierProgressMerged.value,
      incoming: {
        assistant: {
          progressUpdateAcceptedAtEpochMs: 1_777_000_030_001,
        },
        schemaVersion: 1,
      },
      phases: ["assistant"],
    })).toEqual({
      changed: false,
      value: earlierProgressMerged.value,
    });

    const providerMerged = mergeHostedRuntimeLatencyPhaseBreakdownJson({
      existing: {},
      incoming: {
        schemaVersion: 1,
        provider: {
          codexAppServerInitializeMs: 7,
          codexAppServerPreProviderMs: 17,
          codexAppServerSpawnReadyMs: 1,
          codexAppServerThreadResumeMs: 9,
          codexAppServerWarmReuseMs: 0,
          turnLockWaitMs: 2,
        },
      },
      phases: ["provider"],
    });

    expect(providerMerged.value.provider).toEqual({
      codexAppServerInitializeMs: 7,
      codexAppServerPreProviderMs: 17,
      codexAppServerSpawnReadyMs: 1,
      codexAppServerThreadResumeMs: 9,
      codexAppServerWarmReuseMs: 0,
      turnLockWaitMs: 2,
    });

    const historyMerged = mergeHostedRuntimeLatencyPhaseBreakdownJson({
      existing: {
        schemaVersion: 1,
        preProvider: {
          outboxScanBytesRead: -1,
          outboxScanPerformed: true,
          receiptScanBytesRead: -1,
          receiptScanPath: 1,
          receiptScanPerformed: "false",
        },
      },
      incoming: {
        schemaVersion: 1,
        preProvider: {
          outboxScanBytesRead: 8_192,
          outboxScanFilesRead: 10,
          outboxScanPerformed: false,
          receiptScanBytesRead: 4_096,
          receiptScanFilesRead: 12,
          receiptScanPerformed: false,
        },
      },
      phases: ["preProvider"],
    });

    expect(historyMerged.value.preProvider).toEqual({
      outboxScanBytesRead: 8_192,
      outboxScanFilesRead: 10,
      outboxScanPerformed: true,
      receiptScanBytesRead: 4_096,
      receiptScanFilesRead: 12,
      receiptScanPerformed: false,
    });
  });

  it("sanitizes orchestration diagnostics with the package-owned phase schema", () => {
    expect(HOSTED_RUNTIME_ORCHESTRATION_LATENCY_DIAGNOSTICS_HEADER).toBe(
      "x-hosted-runtime-orchestration-latency",
    );

    expect(sanitizeHostedRuntimeOrchestrationLatencyDiagnostics({
      activeFenceTargetWasPriorVersion: true,
      activeWakeAccepted: true,
      activeWakeElapsedMs: 25,
      activeWakeFinishedAtEpochMs: 1_777_000_000_125,
      activeWakeFoundNoActiveChild: false,
      activeWakeStartedAtEpochMs: 1_777_000_000_100,
      directEnsureRequestStartedAtEpochMs: 1_777_000_000_012,
      directEnsureResponseReceivedAtEpochMs: 1_777_000_000_132,
      extraLeaf: 1,
      freshStartRequestedAtEpochMs: -1,
      replacedStaleFence: "true",
      runtimeControlAuthFinishedAtEpochMs: 1_777_000_000_110,
      runtimeControlAuthStartedAtEpochMs: 1_777_000_000_090,
      runtimeInvocationPreparationElapsedMs: 120,
      runtimeStoreEnsureElapsedMs: 80,
      tokenAcquiredAtEpochMs: 1_777_000_000_010,
      tokenAcquireStartedAtEpochMs: 1_777_000_000_000,
      workspaceReadElapsedMs: 70,
    })).toEqual({
      activeFenceTargetWasPriorVersion: true,
      activeWakeAccepted: true,
      activeWakeElapsedMs: 25,
      activeWakeFinishedAtEpochMs: 1_777_000_000_125,
      activeWakeFoundNoActiveChild: false,
      activeWakeStartedAtEpochMs: 1_777_000_000_100,
      directEnsureRequestStartedAtEpochMs: 1_777_000_000_012,
      directEnsureResponseReceivedAtEpochMs: 1_777_000_000_132,
      runtimeControlAuthFinishedAtEpochMs: 1_777_000_000_110,
      runtimeControlAuthStartedAtEpochMs: 1_777_000_000_090,
      runtimeInvocationPreparationElapsedMs: 120,
      runtimeStoreEnsureElapsedMs: 80,
      tokenAcquiredAtEpochMs: 1_777_000_000_010,
      tokenAcquireStartedAtEpochMs: 1_777_000_000_000,
      workspaceReadElapsedMs: 70,
    });

    expect(sanitizeHostedRuntimeOrchestrationLatencyDiagnostics({
      activeWakeAccepted: "true",
      freshStartRequestedAtEpochMs: -1,
    })).toBeNull();
  });

  it("keeps the direct-wake trigger as a boolean orchestration leaf", () => {
    expect(sanitizeHostedRuntimeOrchestrationLatencyDiagnostics({
      cloudflareRouteReceivedAtEpochMs: 1_777_000_000_000,
      triggeredByWebDirect: true,
    })).toEqual({
      cloudflareRouteReceivedAtEpochMs: 1_777_000_000_000,
      triggeredByWebDirect: true,
    });

    // Non-boolean values are dropped like any other schema-mismatched leaf.
    expect(sanitizeHostedRuntimeOrchestrationLatencyDiagnostics({
      triggeredByWebDirect: 1,
    })).toBeNull();

    const merged = mergeHostedRuntimeLatencyPhaseBreakdownJson({
      existing: {},
      incoming: {
        orchestration: {
          cloudflareRouteReceivedAtEpochMs: 1_777_000_000_000,
          triggeredByWebDirect: true,
        },
        schemaVersion: 1,
      },
      phases: ["orchestration"],
    });
    expect(merged.value.orchestration).toEqual({
      cloudflareRouteReceivedAtEpochMs: 1_777_000_000_000,
      triggeredByWebDirect: true,
    });
  });

  it("parses workspace checkpoint contracts as the hosted commit primitive", () => {
    const workspace = createWorkspaceState();

    expect(parseHostedWorkspaceState(workspace)).toEqual(workspace);
    expect(parseHostedWorkspaceReadResponse({
      fetchedAt: "2026-04-26T00:00:02.000Z",
      workspace,
    })).toEqual({
      fetchedAt: "2026-04-26T00:00:02.000Z",
      workspace,
    });
    expect(parseHostedWorkspaceReadResponse({
      fetchedAt: "2026-04-26T00:00:02.000Z",
      hostedAssistantModelOverride: HOSTED_ASSISTANT_SOL_MODEL,
      hostedAssistantReasoningEffortOverride: "high",
      workspace: null,
    })).toEqual({
      fetchedAt: "2026-04-26T00:00:02.000Z",
      hostedAssistantModelOverride: HOSTED_ASSISTANT_SOL_MODEL,
      hostedAssistantReasoningEffortOverride: "high",
      workspace: null,
    });
    expect(parseHostedWorkspaceReadResponse({
      fetchedAt: "2026-04-26T00:00:02.000Z",
      hostedAssistantModelOverride: HOSTED_ASSISTANT_LUNA_MODEL,
      hostedAssistantReasoningEffortOverride: "xhigh",
      workspace: null,
    })).toEqual({
      fetchedAt: "2026-04-26T00:00:02.000Z",
      hostedAssistantModelOverride: HOSTED_ASSISTANT_LUNA_MODEL,
      hostedAssistantReasoningEffortOverride: "xhigh",
      workspace: null,
    });
    for (const invalidOverride of [
      null,
      HOSTED_ASSISTANT_TERRA_MODEL,
      "gpt-5.5",
      " gpt-5.6-sol ",
      56,
    ]) {
      expect(parseHostedWorkspaceReadResponse({
        fetchedAt: "2026-04-26T00:00:02.000Z",
        hostedAssistantModelOverride: invalidOverride,
        workspace: null,
      })).toEqual({
        fetchedAt: "2026-04-26T00:00:02.000Z",
        workspace: null,
      });
    }
    for (const invalidReasoningEffortOverride of [
      null,
      "low",
      "none",
      " high ",
      56,
    ]) {
      expect(parseHostedWorkspaceReadResponse({
        fetchedAt: "2026-04-26T00:00:02.000Z",
        hostedAssistantReasoningEffortOverride: invalidReasoningEffortOverride,
        workspace: null,
      })).toEqual({
        fetchedAt: "2026-04-26T00:00:02.000Z",
        workspace: null,
      });
    }
    expect(parseHostedWorkspaceCheckpointRequest({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      handledConversationMailboxItemIds: ["item_terminal_7"],
      idleCheckpointTrigger: "shutdown_signal",
      leaseGeneration: "9",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "import",
      redactedStatus: {
        assistantContextSnapshotRefreshAttempted: true,
        assistantContextSnapshotRefreshed: false,
        importedConversationSeq: "11",
        importedSystemSeq: "4",
      },
      runtimeWakePendingAtCheckpoint: false,
      snapshotRef: null,
    })).toEqual({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      handledConversationMailboxItemIds: ["item_terminal_7"],
      idleCheckpointTrigger: "shutdown_signal",
      leaseGeneration: "9",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "import",
      redactedStatus: {
        assistantContextSnapshotRefreshAttempted: true,
        assistantContextSnapshotRefreshed: false,
        importedConversationSeq: "11",
        importedSystemSeq: "4",
      },
      runtimeWakePendingAtCheckpoint: false,
      snapshotRef: null,
    });
    for (const key of [
      "assistantContextSnapshotRefreshAttempted",
      "assistantContextSnapshotRefreshed",
    ] as const) {
      for (const value of [null, "true", 1, [true], { value: true }] as const) {
        expect(() => parseHostedWorkspaceCheckpointRequest({
          attemptId: "attempt_1",
          expectedWorkspaceVersion: "4",
          leaseGeneration: "9",
          reason: "import",
          redactedStatus: {
            [key]: value,
          },
          snapshotRef: null,
        })).toThrow(/must be a boolean/u);
      }
    }
    expect(parseHostedWorkspaceCheckpointResponse({
      checkpointed: true,
      conversationInputAhead: true,
      replacedSnapshotRef: null,
      workspace,
    })).toEqual({
      checkpointed: true,
      conversationInputAhead: true,
      replacedSnapshotRef: null,
      workspace,
    });
    expect(parseHostedWorkspaceCheckpointResponse({
      checkpointed: true,
      conversationInputAhead: false,
      workspace,
    })).toEqual({
      checkpointed: true,
      conversationInputAhead: false,
      workspace,
    });
    expect(() => parseHostedWorkspaceCheckpointResponse({
      checkpointed: true,
      conversationInputAhead: null,
      workspace,
    })).toThrow(/conversationInputAhead must be a boolean/u);
    expect(parseHostedWorkspaceCheckpointResponse({
      checkpointConflictReason: "foreground_pending",
      checkpointed: false,
      workspace,
    })).toEqual({
      checkpointConflictReason: "foreground_pending",
      checkpointed: false,
      workspace,
    });
    expect(parseHostedBrowserVaultReplicaPublishResponse({
      published: false,
      workspace: null,
    })).toEqual({
      published: false,
      workspace: null,
    });
    const replicaRef = {
      byteLength: 12,
      dataVersion: "v1",
      generatedAt: "2026-04-26T00:00:00.000Z",
      keyId: "browser-vault-replica:key",
      objectKey: "users/browser-vault-replicas/user/replica.json",
      replicaSchema: "murph.browser-vault-replica",
      runtimeRootKeyId: "udrk:runtime:test-root",
      schema: "murph.hosted-browser-vault-replica-ref.v1",
      sourceBundleHash: "snapshot_1_hash",
    };
    expect(parseHostedBrowserVaultReplicaPublishRequest({ replicaRef })).toEqual({
      replicaRef,
    });
    expect(() => parseHostedBrowserVaultReplicaPublishRequest({
      replicaRef,
      unexpectedField: true,
    })).toThrow(/not allowed/u);
    expect(() => parseHostedBrowserVaultReplicaPublishRequest({
      expectedSourceStateHash: "snapshot_1_hash",
      replicaRef,
    })).toThrow(/expectedSourceStateHash is not allowed/u);
    expect(() => parseHostedBrowserVaultReplicaPublishRequest({
      replicaRef: {
        ...replicaRef,
        generatedAt: "not-a-date",
      },
    })).toThrow(/replicaRef\.generatedAt must be a valid ISO-8601 timestamp/u);

    expect(() => parseHostedWorkspaceCheckpointRequest({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      handledConversationMailboxItemIds: ["not a mailbox item id"],
      leaseGeneration: "9",
      reason: "idle_shutdown",
      snapshotRef: null,
    })).toThrow(/must be a mailbox item id/u);

    expect(() => parseHostedWorkspaceCheckpointRequest({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      handledConversationMailboxItemIds: ["item_duplicate", "item_duplicate"],
      leaseGeneration: "9",
      reason: "idle_shutdown",
      snapshotRef: null,
    })).toThrow(/must not contain duplicates/u);

    expect(() => parseHostedWorkspaceCheckpointRequest({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      handledConversationMailboxItemIds: Array.from(
        { length: 257 },
        (_, index) => `item_${index}`,
      ),
      leaseGeneration: "9",
      reason: "idle_shutdown",
      snapshotRef: null,
    })).toThrow(/must contain at most 256 ids/u);

    expect(() => parseHostedWorkspaceCheckpointRequest({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      idleCheckpointTrigger: "deploy_rollout",
      leaseGeneration: "9",
      reason: "idle_shutdown",
      snapshotRef: null,
    })).toThrow(/Hosted idle checkpoint trigger/u);

    expect(() => parseHostedWorkspaceCheckpointRequest({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
      reason: "idle_shutdown",
      runtimeWakePendingAtCheckpoint: "false",
      snapshotRef: null,
    })).toThrow(/runtimeWakePendingAtCheckpoint must be a boolean/u);

    expect(() => parseHostedWorkspaceCheckpointRequest({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
      reason: "finalize",
      snapshotRef: null,
    })).toThrow(/Hosted workspace checkpoint reason/u);

    const minimalWorkspace = {
      createdAt: "2026-04-26T00:00:00.000Z",
      snapshotRef: null,
      updatedAt: "2026-04-26T00:00:00.000Z",
      userId: "member_123",
      version: "0",
    };

    expect(parseHostedWorkspaceState(minimalWorkspace)).toEqual(minimalWorkspace);
    expect(() => parseHostedWorkspaceCheckpointRequest({
      attemptId: "attempt_2",
      expectedWorkspaceVersion: "0",
      leaseGeneration: "10",
      reason: "maintenance",
    })).toThrow(/Hosted workspace checkpoint reason/u);

    expect(parseHostedWorkspaceCheckpointRequest({
      attemptId: "attempt_3",
      expectedWorkspaceVersion: "0",
      leaseGeneration: "10",
      inboxMediaRetentionWakeAt: "2026-04-26T00:05:00.000Z",
      reason: "canonical_runtime_commit",
    })).toEqual({
      attemptId: "attempt_3",
      expectedWorkspaceVersion: "0",
      leaseGeneration: "10",
      inboxMediaRetentionWakeAt: "2026-04-26T00:05:00.000Z",
      reason: "canonical_runtime_commit",
      snapshotRef: null,
    });
  });

  it("reserves canonical receipt protocol fields outside the ordinary status budget", () => {
    const ordinaryStatus = Object.fromEntries(
      Array.from({ length: 96 }, (_, index) => [`diagnostic${index}Count`, index]),
    );
    const receiptStatus = {
      ...ordinaryStatus,
      [HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BYTE_SIZE_STATUS_KEY]: 1,
      [HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SHA_STATUS_KEY]: "a".repeat(64),
    };
    const recoveryStatus = {
      ...receiptStatus,
      [HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_AT_STATUS_KEY]:
        "2099-07-09T00:00:00.000Z",
      [HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_REASON_STATUS_KEY]:
        "assistant",
      [HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_STATUS_KEY]: "pending",
    };
    const request = {
      attemptId: "attempt_receipt_recovery_status_budget",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
      reason: "idle_shutdown",
      redactedStatus: recoveryStatus,
      snapshotRef: null,
    };

    expect(parseHostedWorkspaceCheckpointRequest(request).redactedStatus)
      .toEqual(recoveryStatus);
    expect(() => parseHostedWorkspaceCheckpointRequest({
      ...request,
      redactedStatus: {
        ...recoveryStatus,
        overflowCount: 1,
      },
    })).toThrow(/at most 96 fields/u);
  });

  it("exports the structural redacted JSON parser with privacy guards intact", () => {
    expect(parseHostedRuntimeRedactedJson(
      { importedCount: 2 },
      "Hosted runtime redacted JSON",
    )).toEqual({ importedCount: 2 });
    expect(() => parseHostedRuntimeRedactedJson({
      source: "Provider failed at https://provider.example.test/private",
    }, "Hosted runtime redacted JSON")).toThrow(/URL/u);
    expect(() => parseHostedRuntimeRedactedJson({
      source: "retrying hosted-user-runtime:opaque-test",
    }, "Hosted runtime redacted JSON")).toThrow(/direct identifier/u);
  });

  it("keeps runtime logs structured and privacy-bounded", () => {
    const entry = {
      at: "2026-04-26T00:00:03.000Z",
      attemptId: "attempt_1",
      component: "mailbox",
      eventCode: "mailbox.imported",
      leaseGeneration: "9",
      level: "info",
      mailboxLane: "conversation",
      mailboxSeqEnd: "11",
      mailboxSeqStart: "10",
      phase: "import",
      redactedJson: {
        importedCount: 2,
        messageReactionsAvailable: true,
        retryable: false,
      },
      workspaceVersion: "5",
    };

    expect(parseHostedRuntimeLogEntry(entry)).toEqual(entry);
    expect(parseHostedRuntimeLogRequest({
      entries: [entry],
    })).toEqual({
      entries: [entry],
    });
    const expectedSnapshotPreemptionEntry = {
      at: "2026-04-26T00:00:03.500Z",
      attemptId: "attempt_1",
      component: "workspace",
      errorCode: "runtime_wake_during_checkpoint",
      eventCode: "checkpoint.snapshot_preempted",
      leaseGeneration: "9",
      level: "info",
      phase: "checkpoint",
      redactedJson: {
        errorCode: "runtime_wake_during_checkpoint",
        snapshotOutcomeKind: "expected_preemption",
        snapshotPreemptionKind: "runtime_wake",
      },
      workspaceVersion: "5",
    };
    expect(parseHostedRuntimeLogEntry(expectedSnapshotPreemptionEntry)).toEqual(
      expectedSnapshotPreemptionEntry,
    );
    const openAiDiagnosticEntry = {
      at: "2026-04-26T00:00:04.000Z",
      attemptId: "attempt_1",
      component: "runner",
      eventCode: "runner.provider_egress_diagnostic",
      leaseGeneration: "9",
      level: "debug",
      phase: "fetch",
      redactedJson: {
        cacheNamespaceFingerprint: `hmac-sha256:${"a".repeat(64)}`,
        cacheNamespaceFingerprintPresent: true,
        cacheNamespacePresent: true,
        cacheRetentionKind: "24h",
        codexCompactionImplementationKind: "responses_compaction_v2",
        codexCompactionPhaseKind: "pre_turn",
        codexCompactionReasonKind: "context_limit",
        codexCompactionTriggerKind: "auto",
        codexRequestKind: "compaction",
        codexTurnMetadataStatus: "valid",
        diagnosticVersion: 1,
        endpointKind: "responses",
        fingerprintKind: "hmac-sha256",
        inputBytes: 8192,
        inputCount: 1,
        inputFingerprintPresent: true,
        inputPrefixFingerprints: [`hmac-sha256:${"b".repeat(64)}`],
        inputPrefixLengths: [8192],
        inputPresent: true,
        inputType: "array",
        instructionsBytes: 4096,
        instructionsPresent: true,
        jsonType: "object",
        jsonValid: true,
        methodKind: "POST",
        modelKind: "gpt-5.6-terra",
        previousResponseFingerprint: `hmac-sha256:${"c".repeat(64)}`,
        previousResponseFingerprintPresent: true,
        previousResponsePresent: true,
        providerKind: "openai",
        requestBytes: 16384,
        requestFieldCount: 9,
        requestFingerprintPresent: true,
        requestPrefixFingerprints: [`hmac-sha256:${"d".repeat(64)}`],
        requestPrefixLengths: [8192],
        storePresent: true,
        streamPresent: true,
        toolCount: 1,
      },
      workspaceVersion: "5",
    };
    expect(parseHostedRuntimeLogRequest({
      entries: [openAiDiagnosticEntry],
    })).toEqual({
      entries: [openAiDiagnosticEntry],
    });
    expect(parseHostedRuntimeLogResponse({ loggedCount: 1 })).toEqual({ loggedCount: 1 });
    expect(() => parseHostedRuntimeLogResponse({ loggedCount: 1.5 })).toThrow(
      /non-negative integer/u,
    );
    expect(parseHostedRuntimeLogEntry({
      ...entry,
      errorCode: undefined,
      eventCode: "runner.error",
      level: "warn",
      phase: "error",
      redactedJson: {
        errorCode: "runtime_error",
        safeErrorMessage: "Hosted runtime work failed after mailbox import.",
      },
    })).toEqual({
      ...entry,
      errorCode: "runtime_error",
      eventCode: "runner.error",
      level: "warn",
      phase: "error",
      redactedJson: {
        errorCode: "runtime_error",
        safeErrorMessage: "Hosted runtime work failed after mailbox import.",
      },
    });
    expect(parseHostedRuntimeLogEntry({
      ...entry,
      component: "runner",
      errorCode: "post_checkpoint_failed",
      eventCode: "runner.error",
      level: "warn",
      phase: "checkpoint",
      redactedJson: {
        failureSummaries: ["Post-checkpoint delivery cleanup failed."],
        nestedErrorCode: "runtime_error",
      },
    }).errorCode).toBe("post_checkpoint_failed");
    const acceptedAttemptFailureEntry = {
      ...entry,
      component: "runner",
      errorCode: "runner_child_failed",
      eventCode: "runner.accepted_attempt_failed",
      level: "warn",
      phase: "error",
      redactedJson: {
        attemptStillActive: true,
        safeErrorMessage: "Hosted runtime accepted attempt failed.",
      },
    };
    expect(parseHostedRuntimeLogEntry(acceptedAttemptFailureEntry)).toEqual(
      acceptedAttemptFailureEntry,
    );
    expect(() => parseHostedRuntimeLogEntry({
      ...acceptedAttemptFailureEntry,
      redactedJson: {
        attemptStillActive: true,
      },
    })).toThrow(/redacted safe error message/u);
    const computerToolFailureEntry = {
      ...entry,
      component: "assistant",
      errorCode: "HOSTED_COMPUTER_EVAL_FAILED",
      eventCode: "assistant.computer_tool_failed",
      level: "warn",
      phase: "error",
      redactedJson: {
        computerOperationKind: "act",
        httpStatus: 502,
        kernelErrorPresent: true,
        kernelStderrPresent: false,
        kernelStdoutPresent: false,
        playwrightCodeHash: "abc123",
        safeErrorMessage: "Hosted computer tool failed.",
        timeoutMs: 20000,
        unknownOutcome: true,
      },
    };
    expect(parseHostedRuntimeLogEntry(computerToolFailureEntry)).toEqual(
      computerToolFailureEntry,
    );
    expect(parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        safeErrorMessage: "Provider returned 502 for /v2/usercollection/daily_sleep.",
      },
    }).redactedJson).toEqual({
      safeErrorMessage: "Provider returned 502 for /v2/usercollection/daily_sleep.",
    });
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      errorCode: undefined,
      eventCode: "runner.error",
      level: "warn",
      phase: "error",
      redactedJson: {
        safeErrorMessage: "Hosted runtime work failed after mailbox import.",
      },
    })).toThrow(/machine-readable errorCode/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      errorCode: "runtime_error",
      eventCode: "runner.error",
      level: "warn",
      phase: "error",
      redactedJson: {
        errorMessagePresent: true,
      },
    })).toThrow(/redacted safe error message/u);

    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      message: 1,
    })).toThrow(/not allowed/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      errorCode: ["person", "example.test"].join("@"),
    })).toThrow(/email address/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        safeErrorMessage: "Provider failed at https://provider.example.test/private",
      },
    })).toThrow(/URL/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        safeErrorMessage: "Provider failed while notifying 415-555-0100",
      },
    })).toThrow(/phone number/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        safeErrorMessage: "Provider failed for hosted-user-runtime:member_123",
      },
    })).toThrow(/direct identifier/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        safeErrorDetail: "retrying member_abc123",
      },
    })).toThrow(/direct identifier/u);
    expect(parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        safeErrorCause: "authorization=Bearer [redacted].",
        safeErrorDetail: "request failed with token=[redacted]",
      },
    })).toMatchObject({
      redactedJson: {
        safeErrorCause: "authorization=Bearer [redacted].",
        safeErrorDetail: "request failed with token=[redacted]",
      },
    });
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        safeErrorDetail: "request failed with token=[redacted]suffix",
      },
    })).toThrow(/secret-shaped content/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        safeErrorDetail: "request failed with token=[redacted].suffix",
      },
    })).toThrow(/secret-shaped content/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      outboxIntentRef: "<HOME_DIR>/intent.json",
    })).toThrow(/local filesystem path/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      attemptId: "attempt with spaces",
    })).toThrow(/bounded opaque identifier/u);
    expect(() => parseHostedRuntimeLogRequest({
      entries: Array.from({ length: 51 }, () => entry),
    })).toThrow(/at most 50 entries/u);
    expect(parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        authorizationHeaderValue: "redacted",
        bodyJson: "redacted",
        messageContent: "redacted",
        messageText: 1,
        payloadValue: "redacted",
        tokenPreview: "redacted",
      },
    }).redactedJson).toEqual({
      authorizationHeaderValue: "redacted",
      bodyJson: "redacted",
      messageContent: "redacted",
      messageText: 1,
      payloadValue: "redacted",
      tokenPreview: "redacted",
    });
    expect(parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        authorizationHeaderPresent: false,
        codexInvalidOutputErrorMessageLength: 96,
        codexResumeFailureErrorMessageLength: 251,
        executionContextHosted: true,
        messageStatus: "failed",
        promptTokenCount: 120,
        rawPayloadBytes: 2048,
        routePlanningActiveExperimentContextElapsedMs: 6000,
        routePlanningAssistantContextSnapshotElapsedMs: 8,
        routePlanningCliBootstrapElapsedMs: null,
        routePlanningElapsedMs: 16,
        routePlanningFallbackInstructionsElapsedMs: null,
        routePlanningAnyBootstrapContextPrepared: true,
        routePlanningBootstrapContextPrepared: false,
        routePlanningMeasuredElapsedMs: 15,
        routePlanningMemoryOverviewElapsedMs: null,
        routePlanningPrimaryInstructionsElapsedMs: 12,
        routePlanningPrimarySystemPromptElapsedMs: 12,
        routePlanningResumeBindingElapsedMs: 0,
        routePlanningSlowestStage: "assistant_context_snapshot",
        routePlanningSlowestStageElapsedMs: 8,
        routePlanningSupportedExperimentProtocolsElapsedMs: 0,
        routePlanningTargetCapabilitiesElapsedMs: 1,
        routePlanningUnaccountedElapsedMs: 1,
        routePlanningVaultOverviewElapsedMs: null,
      },
    }).redactedJson).toEqual({
      authorizationHeaderPresent: false,
      codexInvalidOutputErrorMessageLength: 96,
      codexResumeFailureErrorMessageLength: 251,
      executionContextHosted: true,
      messageStatus: "failed",
      promptTokenCount: 120,
      rawPayloadBytes: 2048,
      routePlanningActiveExperimentContextElapsedMs: 6000,
      routePlanningAssistantContextSnapshotElapsedMs: 8,
      routePlanningCliBootstrapElapsedMs: null,
      routePlanningElapsedMs: 16,
      routePlanningFallbackInstructionsElapsedMs: null,
      routePlanningAnyBootstrapContextPrepared: true,
      routePlanningBootstrapContextPrepared: false,
      routePlanningMeasuredElapsedMs: 15,
      routePlanningMemoryOverviewElapsedMs: null,
      routePlanningPrimaryInstructionsElapsedMs: 12,
      routePlanningPrimarySystemPromptElapsedMs: 12,
      routePlanningResumeBindingElapsedMs: 0,
      routePlanningSlowestStage: "assistant_context_snapshot",
      routePlanningSlowestStageElapsedMs: 8,
      routePlanningSupportedExperimentProtocolsElapsedMs: 0,
      routePlanningTargetCapabilitiesElapsedMs: 1,
      routePlanningUnaccountedElapsedMs: 1,
      routePlanningVaultOverviewElapsedMs: null,
    });
    for (const timingKey of [
      "routePlanningActiveExperimentContextElapsedMs",
      "routePlanningAssistantContextSnapshotElapsedMs",
      "routePlanningElapsedMs",
      "routePlanningPrimarySystemPromptElapsedMs",
      "routePlanningVaultOverviewElapsedMs",
    ] as const) {
      expect(() => parseHostedRuntimeLogEntry({
        ...entry,
        redactedJson: {
          [timingKey]: "prompt-like timing text",
        },
      })).toThrow(/finite number or null/u);
      expect(() => parseHostedRuntimeLogEntry({
        ...entry,
        redactedJson: {
          [timingKey]: -1,
        },
      })).toThrow(/nonnegative finite number or null/u);
    }
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        routePlanningGlucoseContextElapsedMs: 12,
      },
    })).toThrow(/allowed route-planning diagnostic key/u);
    for (const [removedKey, removedValue] of [
      ["routePlanningFreshThreadFallbackPrepared", true],
      ["routePlanningFreshThreadFallbackPromptElapsedMs", 12],
    ] as const) {
      expect(() => parseHostedRuntimeLogEntry({
        ...entry,
        redactedJson: {
          [removedKey]: removedValue,
        },
      })).toThrow(/allowed route-planning diagnostic key/u);
    }
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        routePlanningSlowestStage: "oura_sleep_context",
      },
    })).toThrow(/known route-planning stage/u);
    expect(parseHostedRuntimeLogRequest({
      entries: [{
        ...entry,
        component: "device-sync",
        eventCode: "device-sync.dense_raw_retention",
        phase: "invoke",
        redactedJson: {
          denseRawAfterBytes: 500,
          denseRawBeforeBytes: 9000,
          denseRawCandidateCount: 3,
          denseRawEligibleBytes: 12345,
          denseRawEligibleCount: 2,
          denseRawFreedBytes: 8500,
          hasMore: false,
          processedJobs: 2,
          skippedCount: 1,
          tombstonedDenseRawArtifactCount: 2,
        },
      }],
    }).entries[0]?.redactedJson).toEqual({
      denseRawAfterBytes: 500,
      denseRawBeforeBytes: 9000,
      denseRawCandidateCount: 3,
      denseRawEligibleBytes: 12345,
      denseRawEligibleCount: 2,
      denseRawFreedBytes: 8500,
      hasMore: false,
      processedJobs: 2,
      skippedCount: 1,
      tombstonedDenseRawArtifactCount: 2,
    });
    expect(parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        assistantNotificationErrorMessage: "Hosted assistant notification failed.",
        customProviderErrorDetail: "Provider rejected the request after resume.",
        failureAssistantProviderErrorBodyMessage: "provider rejected the request",
        providerHttpStatusText: "Bad Request",
        providerRequestBodyFieldNames: "client_id.client_secret.grant_type.refresh_token.scope",
        safeErrorMessage: "Codex app-server failed before producing a reply.",
      },
    }).redactedJson).toEqual({
      assistantNotificationErrorMessage: "Hosted assistant notification failed.",
      customProviderErrorDetail: "Provider rejected the request after resume.",
      failureAssistantProviderErrorBodyMessage: "provider rejected the request",
      providerHttpStatusText: "Bad Request",
      providerRequestBodyFieldNames: "client_id.client_secret.grant_type.refresh_token.scope",
      safeErrorMessage: "Codex app-server failed before producing a reply.",
    });
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        localMessageTimingStage: "delivery-finished",
      },
    })).toThrow(/not allowed/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        payload: { nested: true },
      },
    })).toThrow(/shallow redacted scalar/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        source: "<HOME_DIR>/private.txt",
      },
    })).toThrow(/local filesystem path/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        source: `sent to ${["person", "example.test"].join("@")}`,
      },
    })).toThrow(/email address/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        source: "+1 415 555 0132",
      },
    })).toThrow(/phone number/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        source: "authorization: bearer-secret",
      },
    })).toThrow(/secret-shaped/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        source: "x".repeat(2049),
      },
    })).toThrow(/at most 2048 characters/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: Object.fromEntries(
        Array.from({ length: 97 }, (_, index) => [`count${index}`, index]),
      ),
    })).toThrow(/at most 96 fields/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        values: Array.from({ length: 17 }, (_, index) => index),
      },
    })).toThrow(/at most 16 redacted values/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        count: Number.POSITIVE_INFINITY,
      },
    })).toThrow(/finite redacted value/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        values: [{ nested: true }],
      },
    })).toThrow(/shallow redacted scalar/u);
    expect(parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        codexActionToolSummaries: [
          {
            callCount: 1,
            kind: "dynamic.tool.call",
            namespacePresent: true,
            outputBytesMax: 64,
            outputBytesTotal: 96,
            tool: "readSummary",
          },
          {
            callCount: 1,
            kind: "command.execution",
            outputBytesMax: 32,
            outputBytesTotal: 32,
          },
        ],
      },
    }).redactedJson).toEqual({
      codexActionToolSummaries: [
        {
          callCount: 1,
          kind: "dynamic.tool.call",
          namespacePresent: true,
          outputBytesMax: 64,
          outputBytesTotal: 96,
          tool: "readSummary",
        },
        {
          callCount: 1,
          kind: "command.execution",
          outputBytesMax: 32,
          outputBytesTotal: 32,
        },
      ],
    });
    expect(parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        deliveryErrorSummaries: [
          {
            deliveryChannel: "telegram",
            deliveryStatus: "failed_ambiguous",
            deliveryErrorCode: "TELEGRAM_API_BAD_REQUEST",
            deliveryErrorDetailDescription: "Forbidden: reaction is unavailable.",
            deliveryErrorDetailFieldCount: 7,
            deliveryErrorDetailOperation: "Telegram Bot API setMessageReaction",
            deliveryErrorDetailProviderCode: 403,
            deliveryErrorDetailRetryable: false,
            deliveryErrorDetailStatus: 403,
            deliveryErrorMessage: "Telegram HTTP 400 bad request.",
            journalStatus: "500",
            retryable: true,
            targetKind: "message",
          },
        ],
      },
    }).redactedJson).toEqual({
      deliveryErrorSummaries: [
        {
          deliveryChannel: "telegram",
          deliveryStatus: "failed_ambiguous",
          deliveryErrorCode: "TELEGRAM_API_BAD_REQUEST",
          deliveryErrorDetailDescription: "Forbidden: reaction is unavailable.",
          deliveryErrorDetailFieldCount: 7,
          deliveryErrorDetailOperation: "Telegram Bot API setMessageReaction",
          deliveryErrorDetailProviderCode: 403,
          deliveryErrorDetailRetryable: false,
          deliveryErrorDetailStatus: 403,
          deliveryErrorMessage: "Telegram HTTP 400 bad request.",
          journalStatus: "500",
          retryable: true,
          targetKind: "message",
        },
      ],
    });
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        deliveryErrorSummaries: [
          Object.fromEntries(
            Array.from({ length: 17 }, (_, index) => [`extraCode${index}`, index]),
          ),
        ],
      },
    })).toThrow(/at most 16 fields/u);
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        deliveryErrorSummaries: [
          {
            deliveryErrorCode: "TELEGRAM_API_BAD_REQUEST",
            nestedDetail: { status: 403 },
          },
        ],
      },
    })).toThrow(/shallow redacted scalar/u);
    for (const key of [
      "assistantContextSnapshotRefreshAttempted",
      "assistantContextSnapshotRefreshed",
    ] as const) {
      for (const value of [null, "true", 1, [true], { value: true }] as const) {
        expect(() => parseHostedRuntimeLogEntry({
          ...entry,
          redactedJson: {
            codexActionToolSummaries: [
              {
                [key]: value,
              },
            ],
          },
        })).toThrow(/must be a boolean/u);
      }
    }
    expect(parseHostedRuntimeLogEntry({
      at: "2026-04-26T00:00:03.000Z",
      component: "runner",
      eventCode: "runner.idle",
      level: "debug",
      phase: "idle",
      redactedJson: {
        checks: [true, false, null, "ok", 1],
      },
    })).toEqual({
      at: "2026-04-26T00:00:03.000Z",
      component: "runner",
      eventCode: "runner.idle",
      level: "debug",
      phase: "idle",
      redactedJson: {
        checks: [true, false, null, "ok", 1],
      },
    });
    expect(parseHostedRuntimeLogEntry({
      at: "2026-04-26T00:00:04.000Z",
      component: "assistant",
      eventCode: "assistant.pass_finished",
      level: "info",
      phase: "invoke",
    }).eventCode).toBe("assistant.pass_finished");
    expect(parseHostedRuntimeLogRequest({
      entries: [{
        at: "2026-04-26T00:00:04.500Z",
        component: "assistant",
        eventCode: "assistant.device_connect",
        level: "info",
        phase: "invoke",
        redactedJson: {
          deviceConnectIssueLinkAvailable: true,
          deviceConnectPortPresent: true,
          deviceConnectProviderCount: 1,
          deviceConnectProviders: ["whoop"],
          deviceConnectReturnTarget: "telegram",
          deviceConnectStage: "request",
          deviceConnectStatus: "issued",
          expiresAtPresent: true,
          provider: "whoop",
        },
      }],
    }).entries[0]?.eventCode).toBe("assistant.device_connect");
    expect(parseHostedRuntimeLogEntry({
      at: "2026-04-26T00:00:05.000Z",
      component: "mailbox",
      eventCode: "mailbox.system_processed",
      level: "info",
      phase: "checkpoint",
    }).eventCode).toBe("mailbox.system_processed");
    expect(parseHostedRuntimeLogEntry({
      at: "2026-04-26T00:00:06.000Z",
      component: "outbox",
      eventCode: "outbox.delivery_finished",
      level: "info",
      phase: "outbox",
    }).eventCode).toBe("outbox.delivery_finished");
    for (const retiredEventCode of [
      "workspace.codex_continuity_repaired",
      "device-sync.reconnect_notice_created",
      "device-sync.reconnect_notice_duplicate",
      "device-sync.reconnect_notice_skipped",
    ]) {
      expect(() => parseHostedRuntimeLogEntry({
        ...entry,
        eventCode: retiredEventCode,
      })).toThrow(/Hosted runtime log eventCode/u);
    }
  });

  it("parses runner nudge and status without run identifiers or committed sequence targets", () => {
    const nudge = {
      accepted: true,
      alarmScheduled: true,
      immediateDriveStarted: true,
      inFlight: true,
      kind: "processing-ensured",
      nextAlarmAt: "2026-04-26T00:00:05.000Z",
    };
    const status = {
      heartbeatAt: "2026-04-26T00:00:04.000Z",
      inFlight: true,
      lastErrorAt: null,
      lastErrorCode: null,
      lastInvocationAt: "2026-04-26T00:00:01.000Z",
      mailboxLag: [
        { importedSeq: "10", lag: "1", lane: "conversation", maxSeq: "11" },
        { importedSeq: "4", lag: "0", lane: "system", maxSeq: "4" },
      ],
      nextAlarmAt: "2026-04-26T00:00:05.000Z",
      recentLogs: [],
      userId: "member_123",
      workspace: createWorkspaceState(),
    };
    const webStatus = {
      mailboxLag: [],
      userId: "member_123",
      workspace: null,
    };
    const removedRunnerStatusFields = [
      "bundleRef",
      "committedSeq",
      "lastError",
      "lastEventId",
      "nextWakeAt",
      "pendingIngressEventCount",
      "pendingWakeCount",
      "run",
      "runId",
      "timeline",
    ] as const;

    expect(parseHostedRunnerNudgeResult(nudge)).toEqual(nudge);
    expect(parseHostedRunnerStatusResponse(status)).toEqual(status);
    expect(parseHostedRunnerNudgeResult(nudge)).not.toHaveProperty("runId");
    for (const field of removedRunnerStatusFields) {
      const removedValue = field === "run" ? { runId: "run_legacy" } : "legacy";
      expect(() => parseHostedRunnerStatusResponse({
        ...status,
        [field]: removedValue,
      })).toThrow(`Hosted runner status response must not include legacy ${field}`);
      expect(() => parseHostedRuntimeWebStatusResponse({
        ...webStatus,
        [field]: removedValue,
      })).toThrow(`Hosted runtime web status response must not include legacy ${field}`);
    }
    expect(() => parseHostedRunnerNudgeResult({
      ...nudge,
      leaseGeneration: "9",
    })).toThrow(/leaseGeneration has been removed/u);
    expect(() => parseHostedRuntimeWebStatusResponse({
      ...webStatus,
      lastRunAt: "2026-04-26T00:00:01.000Z",
    })).toThrow(/lastRunAt has been renamed to lastInvocationAt/u);
    expect(() => parseHostedRuntimeWebStatusResponse({
      ...webStatus,
      leaseGeneration: "9",
    })).toThrow(/leaseGeneration has been removed/u);
    expect(parseHostedRunnerNudgeResult({
      accepted: true,
      alarmScheduled: false,
      inFlight: true,
      kind: "processing-ensured",
    })).toEqual({
      accepted: true,
      alarmScheduled: false,
      inFlight: true,
      kind: "processing-ensured",
    });
    expect(parseHostedRunnerStatusResponse({
      inFlight: false,
      mailboxLag: [],
      userId: "member_123",
      workspace: null,
    })).toEqual({
      inFlight: false,
      mailboxLag: [],
      userId: "member_123",
      workspace: null,
    });
  });

  it("rejects legacy runner nudge allow decisions", () => {
    expect(parseHostedRunnerNudgeRequest({})).toEqual({});
    expect(() => parseHostedRunnerNudgeRequest({
      aiUsageAllowDecision: {
        allowed: false,
        schema: "murph.hosted-ai-usage-allow-decision.v1",
      },
    })).toThrow("runner nudge request must not include legacy fields.");
  });

  it("publishes the runtime-control subpath without restoring removed client surfaces", async () => {
    const packageJsonPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      exports?: Record<string, unknown>;
    };

    expect(Object.keys(packageJson.exports ?? {}).sort()).toContain("./runtime-control");
    const rootModule = await import("@murphai/hosted-execution") as Record<string, unknown>;
    const runtimeControlModule = await import("@murphai/hosted-execution/runtime-control");
    expect(rootModule.HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA).toBeUndefined();
    expect(runtimeControlModule.HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA).toBe(
      HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    );
  });
});

function createMailboxItem(overrides: Record<string, unknown> = {}) {
  return {
    causalSeq: "17",
    createdAt: "2026-04-26T00:00:01.000Z",
    dedupeKey: "conversation:member_123:message_10",
    id: "mailbox_10",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: "10",
    occurredAt: "2026-04-26T00:00:00.000Z",
    payloadBytes: 128,
    payloadInlineCiphertext: "ciphertext",
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: "2026-04-26T00:00:01.000Z",
    userId: "member_123",
    ...overrides,
  };
}

function createWorkspaceState() {
  return {
    checkpointedAt: "2026-04-26T00:00:04.000Z",
    createdAt: "2026-04-26T00:00:00.000Z",
    inboxMediaRetentionWakeAt: null,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatus: {
      importedConversationSeq: "11",
      importedSystemSeq: "4",
    },
    snapshotRef: null,
    updatedAt: "2026-04-26T00:00:04.000Z",
    userId: "member_123",
    version: "5",
  };
}

function createAssistantUsageRecord(): AssistantUsageRecord {
  return {
    apiKeyEnv: null,
    attemptCount: 1,
    baseUrl: null,
    cacheWriteTokens: null,
    cachedInputTokens: null,
    credentialSource: "platform",
    featureKey: null,
    gatewayTags: ["hosted-runtime"],
    inputTokens: 10,
    memberId: "member_123",
    occurredAt: "2026-04-26T00:00:06.000Z",
    outputTokens: 5,
    provider: "openai",
    providerName: null,
    providerRequestId: null,
    rawUsageJson: null,
    rawUsageJsonHash: null,
    reasoningTokens: null,
    reportingUserId: "member_123",
    requestedModel: "model_test",
    routeId: "hosted-runtime",
    schema: ASSISTANT_USAGE_SCHEMA,
    servedModel: "model_test",
    sessionId: "session_123",
    stripeMeterSource: "murph",
    surface: "hosted-runtime",
    tokenPricingBasis: "standard",
    totalTokens: 15,
    triggerKind: "conversation.message",
    turnId: "turn_usage",
    turnProfileJson: null,
    usageId: "turn_usage.attempt-1",
    usageExtractionSourcePath: null,
    usageExtractionVersion: "legacy",
  };
}

function createAssistantRuntimeIssueRecord(): AssistantRuntimeIssueRecord {
  const fingerprint = "abcdef1234567890abcdef12";

  return {
    component: "hosted.runtime",
    details: {
      retryable: true,
      statusCode: 503,
    },
    environment: "hosted",
    errorCode: "tool_timeout",
    fingerprint,
    issueId: `ari_1234567890abcdef_${fingerprint}`,
    issueKind: "tool_error",
    occurredAt: "2026-04-26T00:00:07.000Z",
    operation: "hosted-runtime.import",
    phase: "tool_call",
    schema: ASSISTANT_RUNTIME_ISSUE_SCHEMA,
    severity: "error",
    summary: "Assistant runtime issue: tool error during tool_call (hosted-runtime.import).",
    surface: "hosted-runtime",
  };
}
