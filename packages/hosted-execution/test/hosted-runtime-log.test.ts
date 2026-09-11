import { describe, expect, it } from "vitest";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_HYDRATION_LIMIT,
} from "@murphai/device-syncd/hosted-runtime";
import {
  HOSTED_RUNTIME_DEVICE_SYNC_CONTINUATION_OWNER_MAX_COUNT,
} from "../src/runtime-control.ts";
import {
  parseHostedRuntimeLogEntry,
  parseHostedRuntimeRedactedJson,
  parseHostedRuntimeLogRequest,
  parseHostedRuntimeLogResponse,
} from "../src/parsers.ts";

describe("hosted runtime log contracts", () => {
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

  it("bounds device-sync continuation owners to the runtime connection authority", () => {
    expect(HOSTED_RUNTIME_DEVICE_SYNC_CONTINUATION_OWNER_MAX_COUNT).toBe(
      HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_HYDRATION_LIMIT,
    );
    const continuationSeqs = Array.from(
      { length: HOSTED_RUNTIME_DEVICE_SYNC_CONTINUATION_OWNER_MAX_COUNT },
      (_, index) => String(index + 1),
    );
    expect(parseHostedRuntimeRedactedJson({
      hostedMailboxSystemDeviceSyncContinuationSeqs: continuationSeqs,
    }, "Hosted runtime redacted JSON")).toEqual({
      hostedMailboxSystemDeviceSyncContinuationSeqs: continuationSeqs,
    });
    expect(() => parseHostedRuntimeRedactedJson({
      hostedMailboxSystemDeviceSyncContinuationSeqs: [
        ...continuationSeqs,
        String(HOSTED_RUNTIME_DEVICE_SYNC_CONTINUATION_OWNER_MAX_COUNT + 1),
      ],
    }, "Hosted runtime redacted JSON")).toThrow(
      new RegExp(
        `at most ${HOSTED_RUNTIME_DEVICE_SYNC_CONTINUATION_OWNER_MAX_COUNT} redacted values`,
        "u",
      ),
    );
  });

  it("accepts retired device-sync environment logs from warm runners", () => {
    const entry = {
      at: "2026-04-26T00:00:03.000Z",
      component: "device-sync",
      eventCode: "device-sync.legacy_platform_env_present",
      level: "info",
      phase: "invoke",
      redactedJson: {
        junctionPlatformEnvPresent: true,
        legacyPlatformEnvKeyCount: 4,
      },
    };

    expect(parseHostedRuntimeLogRequest({ entries: [entry] })).toEqual({
      entries: [entry],
    });
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
        junctionWorkoutStreamMaxTimestampCount: 100_000,
        junctionWorkoutStreamTimestampCardinalityKind: "over_limit",
        junctionWorkoutStreamTimestampCount: 100_127,
        messageReactionsAvailable: true,
        reasoningEffort: "low",
        retryable: false,
      },
      workspaceVersion: "5",
    };

    expect(parseHostedRuntimeLogEntry(entry)).toEqual(entry);
    expect(parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        reasoningEffort: "high",
      },
    }).redactedJson).toEqual({
      reasoningEffort: "high",
    });
    expect(parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        reasoningEffort: null,
      },
    }).redactedJson).toEqual({
      reasoningEffort: null,
    });
    expect(() => parseHostedRuntimeLogEntry({
      ...entry,
      redactedJson: {
        reasoningEffort: "member-specific-private-value",
      },
    })).toThrow(/known reasoning effort or null/u);
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
    const nonAttemptDeviceSyncFailureEntries = [
      {
        ...entry,
        component: "device-sync",
        errorCode: "runtime_error",
        eventCode: "device-sync.dirty_ack_persistence_failed",
        level: "warn",
        phase: "checkpoint",
        redactedJson: {
          safeErrorMessage: "Hosted device-sync dirty checkpoint ack failed.",
        },
      },
      {
        ...entry,
        component: "device-sync",
        errorCode: "runtime_error",
        eventCode: "device-sync.maintenance_failed",
        level: "warn",
        phase: "idle",
        redactedJson: {
          safeErrorMessage: "Hosted idle device-sync maintenance failed.",
        },
      },
      {
        ...entry,
        component: "runtime",
        errorCode: "runtime_error",
        eventCode: "assistant.device_activity_automation_failed",
        level: "warn",
        phase: "idle",
        redactedJson: {
          safeErrorMessage: "Hosted device activity automation scheduling failed.",
        },
      },
    ] as const;
    for (const failureEntry of nonAttemptDeviceSyncFailureEntries) {
      expect(parseHostedRuntimeLogEntry(failureEntry)).toEqual(failureEntry);
      expect(() => parseHostedRuntimeLogEntry({
        ...failureEntry,
        redactedJson: {
          failurePresent: true,
        },
      })).toThrow(/redacted safe error message/u);
    }
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
    expect(parseHostedRuntimeLogRequest({
      entries: [{
        ...entry,
        attemptId: "attempt_device_sync_lifecycle",
        component: "device-sync",
        eventCode: "device-sync.pass_finished",
        leaseGeneration: "15",
        phase: "invoke",
        redactedJson: {
          configured: true,
          deviceSyncJobTimingCount: 1,
          deviceSyncJobTimingSampleLimit: 16,
          deviceSyncJobTimingSummaries: [{
            attempts: 1,
            connectionSourceReadCount: 1,
            connectionSourceReadElapsedMs: 250,
            credentialRefreshCount: 0,
            credentialRefreshElapsedMs: 0,
            durableProgressCommitted: false,
            elapsedMs: 45_000,
            jobCount: 1,
            jobKind: "resource",
            outcome: "yielded",
            provider: "junction",
            providerExecutionElapsedMs: 44_900,
            providerInventoryRequestCount: 1,
            providerInventoryRequestElapsedMs: 34_000,
            providerResourceRequestCount: 1,
            providerResourceRequestElapsedMs: 6_000,
            providerUnattributedElapsedMs: 4_650,
            resource: "sleep",
            snapshotImportCount: 0,
            snapshotImportElapsedMs: 0,
            snapshotCanonicalCoreElapsedMs: 0,
            snapshotCanonicalWriteElapsedMs: 0,
            snapshotEventIdentityIndexCacheHitCount: 0,
            snapshotEventIdentityIndexElapsedMs: 0,
            snapshotNormalizationElapsedMs: 0,
          }],
          deviceSyncJobTimingTruncated: false,
          elapsedMs: 45000,
          lifecycle: "finished",
          nextWakeAtPresent: true,
          outcome: "yielded",
          passStage: "worker_drain",
          postCheckpointRecordPresent: true,
          processedJobs: 3,
          retainFollowUpWakeUntilCheckpoint: true,
          skipped: true,
          stagedDirtyAckCount: 1,
          timeoutMs: 45000,
          wakeKind: "device-sync.wake",
          wakeReason: "reconcile_due",
          yieldReason: "timeout",
        },
        workspaceVersion: "16",
      }],
    }).entries[0]).toEqual(expect.objectContaining({
      attemptId: "attempt_device_sync_lifecycle",
      eventCode: "device-sync.pass_finished",
      redactedJson: expect.objectContaining({
        outcome: "yielded",
        passStage: "worker_drain",
        yieldReason: "timeout",
      }),
    }));
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
});
