import { describe, expect, it, vi } from "vitest";

import type {
  AssistantHostedImageGenerationRegistrationRequest,
  AssistantInputEventRecord,
} from "@murphai/assistant-engine";
import type {
  AssistantProviderUsageDraft,
} from "@murphai/assistant-engine/assistant-ask";
import type {
  DispatchPreparedAssistantImageGenerationResult,
  GenerateImageToolResult,
  PrepareAssistantImageGenerationResult,
} from "@murphai/assistant-engine/assistant-codex";
import type {
  AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import type {
  HostedRuntimeUsageAllowanceRequest,
  HostedRuntimeUsageAllowanceResponse,
} from "@murphai/hosted-execution/runtime-control";

import {
  createHostedImageGenerationController,
  type HostedImageGenerationController,
  type HostedImageGenerationControllerInput,
  type HostedImageGenerationEngine,
} from "../src/hosted-runtime/image-generation-controller.ts";

describe("hosted image generation controller", () => {
  it("registers distinct operations and makes exact replay idempotent without admission", async () => {
    const harness = createHarness();
    const first = await harness.controller.registrar.register(
      createRegistrationRequest({ providerRequestOrdinal: 1, toolCallId: "call-a" }),
    );
    const replay = await harness.controller.registrar.register(
      createRegistrationRequest({ providerRequestOrdinal: 99, toolCallId: "call-a" }),
    );
    const conflict = await harness.controller.registrar.register(
      createRegistrationRequest({
        prompt: "different prompt",
        providerRequestOrdinal: 1,
        toolCallId: "call-a",
      }),
    );
    const second = await harness.controller.registrar.register(
      createRegistrationRequest({ providerRequestOrdinal: 2, toolCallId: "call-b" }),
    );

    expect(first).toEqual({ status: "admission_pending" });
    expect(replay).toEqual({ status: "admission_pending" });
    expect(conflict).toEqual({
      reason: "conflict",
      status: "rejected",
    });
    expect(second).toEqual({ status: "admission_pending" });
    expect(harness.controller.snapshot().registrationCursor).toBe(2);
    expect(harness.allowanceRequests).toEqual([]);
    expect(harness.providerFetchCount()).toBe(0);

    await harness.controller.drain("forced");
  });

  it("fails closed before reservation when originating usage was not recorded", async () => {
    const harness = createHarness();
    const before = harness.controller.snapshot().registrationCursor;
    await harness.controller.registrar.register(createRegistrationRequest());
    const through = harness.controller.snapshot().registrationCursor;

    await harness.controller.admitRegistered({
      afterSequence: before,
      recordedOriginInputIds: [],
      throughSequence: through,
    });

    expect(harness.allowanceRequests).toEqual([]);
    expect(harness.providerFetchCount()).toBe(0);
    expect(harness.controller.snapshot().ready).toBe(true);
    const stagedInputs: unknown[] = [];
    const staged = await harness.controller.stageReady(async (input) => {
      stagedInputs.push(input);
      return { completionInputId: "ain_completion_usage_failed" };
    });
    expect(staged.stagedOperationIds).toHaveLength(1);
    expect(stagedInputs).toEqual([
      expect.objectContaining({
        originAssistantInputId: "ain_origin",
        outcome: {
          kind: "unavailable",
          reason: "origin_usage_unavailable",
        },
      }),
    ]);
  });

  it("admits multiple operations without awaiting provider completion and retains exact usage correlation", async () => {
    const harness = createHarness();
    const before = harness.controller.snapshot().registrationCursor;
    await harness.controller.registrar.register(
      createRegistrationRequest({ providerRequestOrdinal: 1, toolCallId: "call-a" }),
    );
    await harness.controller.registrar.register(
      createRegistrationRequest({ providerRequestOrdinal: 2, toolCallId: "call-b" }),
    );
    const through = harness.controller.snapshot().registrationCursor;

    await harness.controller.admitRegistered({
      afterSequence: before,
      recordedOriginInputIds: ["ain_origin"],
      throughSequence: through,
    });

    expect(harness.providerFetchCount()).toBe(2);
    expect(harness.controller.snapshot().active).toBe(true);
    expect(harness.controller.snapshot().ready).toBe(false);
    expect(harness.providerGate.settled()).toBe(false);

    harness.providerGate.resolve();
    await vi.waitFor(() => {
      expect(harness.controller.snapshot().canonicalWritePending).toBe(true);
    });
    await harness.controller.persistReadyCaptures();
    await harness.controller.drain("graceful");
    expect(harness.controller.snapshot().ready).toBe(true);

    let completionOrdinal = 0;
    const staged = await harness.controller.stageReady(async (input) => {
      expect(input.outcome.kind).toBe("ready");
      completionOrdinal += 1;
      return { completionInputId: `ain_completion_${completionOrdinal}` };
    });
    expect(staged.stagedOperationIds).toHaveLength(2);

    const recorded: {
      acceptedInputIds: readonly string[] | undefined;
      options: { reservationId?: string } | undefined;
      record: AssistantUsageRecord;
    }[] = [];
    const selected = harness.controller.selectCompletionInputs({
      inputIds: ["ain_completion_1", "ain_completion_2"],
      recordDeferredUsage(record, acceptedInputIds, options) {
        recorded.push({ acceptedInputIds, options, record });
      },
    });
    expect(selected).toHaveLength(2);
    expect(recorded).toHaveLength(2);
    expect(new Set(recorded.map(({ record }) => record.usageId)).size).toBe(2);
    for (const item of recorded) {
      expect(item.options?.reservationId).toBe(item.record.usageId);
      expect(item.record.featureKey).toBe("assistant_generated_image");
      expect(item.record.credentialSource).toBe("platform");
      expect(item.acceptedInputIds).toHaveLength(1);
    }
    harness.controller.completeCompletionTurns({
      operationIds: selected,
      phaseSucceeded: true,
      successfulUsageIds: recorded.map(({ record }) => record.usageId),
    });
    expect(harness.controller.snapshot().unsettled).toBe(false);

    const reserveRequests = harness.allowanceRequests.filter(
      (request) => request.action === "reserve_image",
    );
    expect(reserveRequests.map(({ requestId }) => requestId)).toEqual(
      recorded.map(({ record }) => record.usageId),
    );
  });

  it("persists capture canonically, then publishes off-path before becoming ready", async () => {
    const harness = createHarness({ holdPublication: true });
    const before = harness.controller.snapshot().registrationCursor;
    await harness.controller.registrar.register(createRegistrationRequest());
    await harness.controller.admitRegistered({
      afterSequence: before,
      recordedOriginInputIds: ["ain_origin"],
      throughSequence: harness.controller.snapshot().registrationCursor,
    });

    harness.providerGate.resolve();
    await vi.waitFor(() => {
      expect(harness.controller.snapshot().canonicalWritePending).toBe(true);
    });
    expect(harness.controller.snapshot()).toEqual(
      expect.objectContaining({ active: false, ready: false }),
    );
    expect(harness.persistCount()).toBe(0);
    await expect(
      harness.controller.stageReady(async () => {
        throw new Error("staging must not run before capture persistence");
      }),
    ).resolves.toEqual({ stagedOperationIds: [] });

    await harness.controller.persistReadyCaptures();
    await vi.waitFor(() => {
      expect(harness.publishCount()).toBe(1);
    });
    expect(harness.persistCount()).toBe(1);
    expect(harness.controller.snapshot()).toEqual(
      expect.objectContaining({ active: true, ready: false }),
    );
    await expect(
      harness.controller.stageReady(async () => {
        throw new Error("staging must not await publication");
      }),
    ).resolves.toEqual({ stagedOperationIds: [] });

    harness.publicationGate.resolve();
    await harness.controller.drain("graceful");
    expect(harness.controller.snapshot()).toEqual(
      expect.objectContaining({ active: false, ready: true }),
    );
    await harness.controller.stageReady(async (input) => {
      expect(input.outcome.kind).toBe("ready");
      return { completionInputId: "ain_completion_finalized" };
    });
    expect(harness.persistCount()).toBe(1);
    expect(harness.publishCount()).toBe(1);
  });

  it.each(["already_dispatched", "already_settled"] as const)(
    "never marks or dispatches when reserve reports %s",
    async (reserveStatus) => {
      const harness = createHarness({ reserveStatus });
      const before = harness.controller.snapshot().registrationCursor;
      await harness.controller.registrar.register(createRegistrationRequest());

      await harness.controller.admitRegistered({
        afterSequence: before,
        recordedOriginInputIds: ["ain_origin"],
        throughSequence: harness.controller.snapshot().registrationCursor,
      });

      expect(harness.allowanceRequests.map(({ action }) => action)).toEqual([
        "reserve_image",
      ]);
      expect(harness.providerFetchCount()).toBe(0);
      expect(harness.controller.snapshot().ready).toBe(true);
    },
  );

  it.each([
    {
      outcome: { kind: "would_exhaust" },
      reserveStatus: "would_exhaust",
    },
    {
      outcome: { kind: "unavailable", reason: "insufficient_capacity" },
      reserveStatus: "insufficient_capacity",
    },
  ] as const)(
    "stages $reserveStatus without marking or calling the provider",
    async ({ outcome, reserveStatus }) => {
      const harness = createHarness({ reserveStatus });
      const before = harness.controller.snapshot().registrationCursor;
      await harness.controller.registrar.register(createRegistrationRequest());
      await harness.controller.admitRegistered({
        afterSequence: before,
        recordedOriginInputIds: ["ain_origin"],
        throughSequence: harness.controller.snapshot().registrationCursor,
      });

      expect(harness.allowanceRequests.map(({ action }) => action)).toEqual([
        "reserve_image",
      ]);
      expect(harness.providerFetchCount()).toBe(0);
      const outcomes: unknown[] = [];
      await harness.controller.stageReady(async (input) => {
        outcomes.push(input.outcome);
        return { completionInputId: `ain_completion_${reserveStatus}` };
      });
      expect(outcomes).toEqual([outcome]);
    },
  );

  it("does not call the provider when the dispatch claim is ambiguous", async () => {
    const harness = createHarness({ markStatus: "already_dispatched" });
    const before = harness.controller.snapshot().registrationCursor;
    await harness.controller.registrar.register(createRegistrationRequest());

    await harness.controller.admitRegistered({
      afterSequence: before,
      recordedOriginInputIds: ["ain_origin"],
      throughSequence: harness.controller.snapshot().registrationCursor,
    });
    await harness.controller.drain("graceful");

    expect(harness.providerFetchCount()).toBe(0);
    expect(harness.allowanceRequests.map(({ action }) => action)).toEqual([
      "reserve_image",
      "mark_dispatched",
      "release",
    ]);
    expect(harness.controller.snapshot().ready).toBe(true);
  });

  it("keeps provider-failure usage for the completion turn", async () => {
    const harness = createHarness({ dispatchMode: "provider_failed" });
    const before = harness.controller.snapshot().registrationCursor;
    await harness.controller.registrar.register(createRegistrationRequest());
    await harness.controller.admitRegistered({
      afterSequence: before,
      recordedOriginInputIds: ["ain_origin"],
      throughSequence: harness.controller.snapshot().registrationCursor,
    });
    await harness.controller.drain("graceful");

    const outcomes: unknown[] = [];
    await harness.controller.stageReady(async (input) => {
      outcomes.push(input.outcome);
      return { completionInputId: "ain_completion_failed" };
    });
    expect(outcomes).toEqual([
      { kind: "unavailable", reason: "provider_failed" },
    ]);

    const records: AssistantUsageRecord[] = [];
    harness.controller.selectCompletionInputs({
      inputIds: ["ain_completion_failed"],
      recordDeferredUsage(record, _acceptedInputIds, options) {
        expect(options?.reservationId).toBe(record.usageId);
        records.push(record);
      },
    });
    expect(records).toHaveLength(1);
  });

  it("does not expose generated media when exact provider usage is missing", async () => {
    const harness = createHarness({ omitGeneratedUsage: true });
    const before = harness.controller.snapshot().registrationCursor;
    await harness.controller.registrar.register(createRegistrationRequest());
    await harness.controller.admitRegistered({
      afterSequence: before,
      recordedOriginInputIds: ["ain_origin"],
      throughSequence: harness.controller.snapshot().registrationCursor,
    });
    harness.providerGate.resolve();
    await harness.controller.drain("graceful");

    const outcomes: unknown[] = [];
    await harness.controller.stageReady(async (input) => {
      outcomes.push(input.outcome);
      return { completionInputId: "ain_completion_missing_usage" };
    });

    expect(outcomes).toEqual([
      { kind: "unavailable", reason: "finalization_failed" },
    ]);
    expect(harness.publishCount()).toBe(0);
  });

  it("does not publish media without a stable canonical capture", async () => {
    const harness = createHarness({ omitPersistedCapture: true });
    const before = harness.controller.snapshot().registrationCursor;
    await harness.controller.registrar.register(createRegistrationRequest());
    await harness.controller.admitRegistered({
      afterSequence: before,
      recordedOriginInputIds: ["ain_origin"],
      throughSequence: harness.controller.snapshot().registrationCursor,
    });
    harness.providerGate.resolve();
    await vi.waitFor(() => {
      expect(harness.controller.snapshot().canonicalWritePending).toBe(true);
    });
    await harness.controller.persistReadyCaptures();

    const outcomes: unknown[] = [];
    await harness.controller.stageReady(async (input) => {
      outcomes.push(input.outcome);
      return { completionInputId: "ain_completion_missing_capture" };
    });
    expect(outcomes).toEqual([
      { kind: "unavailable", reason: "finalization_failed" },
    ]);
    expect(harness.publishCount()).toBe(0);
  });

  it("retains the published outcome across a staging retry", async () => {
    const harness = createHarness();
    const before = harness.controller.snapshot().registrationCursor;
    await harness.controller.registrar.register(createRegistrationRequest());
    await harness.controller.admitRegistered({
      afterSequence: before,
      recordedOriginInputIds: ["ain_origin"],
      throughSequence: harness.controller.snapshot().registrationCursor,
    });
    harness.providerGate.resolve();
    await vi.waitFor(() => {
      expect(harness.controller.snapshot().canonicalWritePending).toBe(true);
    });
    await harness.controller.persistReadyCaptures();
    await harness.controller.drain("graceful");

    await expect(
      harness.controller.stageReady(async () => {
        throw new Error("canonical staging failed");
      }),
    ).rejects.toThrow("canonical staging failed");
    await harness.controller.stageReady(async () => ({
      completionInputId: "ain_completion_retry",
    }));

    expect(harness.publishCount()).toBe(1);
  });

  it("rejects self-authored and unauthorized group origins before preparation", async () => {
    for (const origin of [
      { actorIsSelf: true, groupAuthority: true, threadIsDirect: true },
      { actorIsSelf: false, groupAuthority: false, threadIsDirect: false },
      { actorIsSelf: false, groupAuthority: true, threadIsDirect: null },
    ]) {
      const harness = createHarness({ origin });
      await expect(
        harness.controller.registrar.register(createRegistrationRequest()),
      ).resolves.toEqual({
        reason: "unavailable",
        status: "rejected",
      });
      expect(harness.controller.snapshot().registrationCursor).toBe(0);
      expect(harness.providerFetchCount()).toBe(0);
    }
  });

  it("returns from forced drain without waiting for a hung reservation", async () => {
    const harness = createHarness({ holdReservation: true });
    const before = harness.controller.snapshot().registrationCursor;
    await harness.controller.registrar.register(createRegistrationRequest());
    const admission = harness.controller.admitRegistered({
      afterSequence: before,
      recordedOriginInputIds: ["ain_origin"],
      throughSequence: harness.controller.snapshot().registrationCursor,
    });
    await vi.waitFor(() => {
      expect(harness.allowanceRequests.map(({ action }) => action)).toEqual([
        "reserve_image",
      ]);
    });

    let forcedDrainFinished = false;
    const forcedDrain = harness.controller.drain("forced").then(() => {
      forcedDrainFinished = true;
    });
    try {
      await vi.waitFor(() => {
        expect(forcedDrainFinished).toBe(true);
      }, { timeout: 500 });
      expect(harness.reservationGate.settled()).toBe(false);
      expect(harness.controller.snapshot().unsettled).toBe(false);
    } finally {
      harness.reservationGate.resolve();
      await admission;
      await forcedDrain;
      await harness.controller.drain("graceful");
    }
    expect(harness.providerFetchCount()).toBe(0);
  });

  it("returns from forced drain without waiting for a hung publication", async () => {
    const harness = createHarness({ holdPublication: true });
    const before = harness.controller.snapshot().registrationCursor;
    await harness.controller.registrar.register(createRegistrationRequest());
    await harness.controller.admitRegistered({
      afterSequence: before,
      recordedOriginInputIds: ["ain_origin"],
      throughSequence: harness.controller.snapshot().registrationCursor,
    });
    harness.providerGate.resolve();
    await vi.waitFor(() => {
      expect(harness.controller.snapshot().canonicalWritePending).toBe(true);
    });
    await harness.controller.persistReadyCaptures();
    await vi.waitFor(() => {
      expect(harness.publishCount()).toBe(1);
    });

    let forcedDrainFinished = false;
    const forcedDrain = harness.controller.drain("forced").then(() => {
      forcedDrainFinished = true;
    });
    try {
      await vi.waitFor(() => {
        expect(forcedDrainFinished).toBe(true);
      }, { timeout: 500 });
      expect(harness.publicationGate.settled()).toBe(false);
      expect(harness.controller.snapshot().unsettled).toBe(false);
    } finally {
      harness.publicationGate.resolve();
      await forcedDrain;
      await harness.controller.drain("graceful");
    }
  });

  it("does not begin provider fetch when forced during dispatch marking", async () => {
    const harness = createHarness({ holdMarkDispatched: true });
    const before = harness.controller.snapshot().registrationCursor;
    await harness.controller.registrar.register(createRegistrationRequest());
    await harness.controller.admitRegistered({
      afterSequence: before,
      recordedOriginInputIds: ["ain_origin"],
      throughSequence: harness.controller.snapshot().registrationCursor,
    });
    await vi.waitFor(() => {
      expect(harness.allowanceRequests.map(({ action }) => action)).toEqual([
        "reserve_image",
        "mark_dispatched",
      ]);
    });

    let forcedDrainFinished = false;
    const forcedDrain = harness.controller.drain("forced").then(() => {
      forcedDrainFinished = true;
    });
    try {
      await vi.waitFor(() => {
        expect(forcedDrainFinished).toBe(true);
      }, { timeout: 500 });
      expect(harness.markDispatchedGate.settled()).toBe(false);
      expect(harness.providerFetchCount()).toBe(0);
    } finally {
      harness.markDispatchedGate.resolve();
      await forcedDrain;
      await harness.controller.drain("graceful");
    }
    expect(harness.providerFetchCount()).toBe(0);
  });

  it("aborts and drains only its active provider request", async () => {
    const harness = createHarness();
    const before = harness.controller.snapshot().registrationCursor;
    await harness.controller.registrar.register(createRegistrationRequest());
    await harness.controller.admitRegistered({
      afterSequence: before,
      recordedOriginInputIds: ["ain_origin"],
      throughSequence: harness.controller.snapshot().registrationCursor,
    });

    await harness.controller.drain("forced");

    expect(harness.providerAbortCount()).toBe(1);
    expect(harness.controller.snapshot()).toEqual(
      expect.objectContaining({
        active: false,
        ready: false,
        unsettled: false,
      }),
    );
  });
});

function createHarness(input: {
  dispatchMode?: "generated" | "provider_failed";
  holdMarkDispatched?: boolean;
  holdPublication?: boolean;
  holdReservation?: boolean;
  markStatus?: Extract<
    HostedRuntimeUsageAllowanceResponse,
    { action: "mark_dispatched" }
  >["status"];
  reserveStatus?: Extract<
    HostedRuntimeUsageAllowanceResponse,
    { action: "reserve_image" }
  >["status"];
  omitGeneratedUsage?: boolean;
  omitPersistedCapture?: boolean;
  origin?: {
    actorIsSelf: boolean;
    groupAuthority: boolean;
    threadIsDirect: boolean | null;
  };
} = {}): {
  allowanceRequests: HostedRuntimeUsageAllowanceRequest[];
  controller: HostedImageGenerationController;
  markDispatchedGate: ReturnType<typeof createDeferred>;
  persistCount(): number;
  publicationGate: ReturnType<typeof createDeferred>;
  publishCount(): number;
  providerAbortCount(): number;
  providerFetchCount(): number;
  providerGate: ReturnType<typeof createDeferred>;
  reservationGate: ReturnType<typeof createDeferred>;
} {
  const allowanceRequests: HostedRuntimeUsageAllowanceRequest[] = [];
  const markDispatchedGate = createDeferred();
  const providerGate = createDeferred();
  const publicationGate = createDeferred();
  const reservationGate = createDeferred();
  if (input.holdMarkDispatched !== true) {
    markDispatchedGate.resolve();
  }
  if (input.holdPublication !== true) {
    publicationGate.resolve();
  }
  if (input.holdReservation !== true) {
    reservationGate.resolve();
  }
  let persistCount = 0;
  let providerAbortCount = 0;
  let providerFetchCount = 0;
  let publishCount = 0;
  const persistCapture: HostedImageGenerationEngine["persistCapture"] =
    async (generated) => {
      persistCount += 1;
      return {
        persisted: {
          bytes: generated.bytes,
          finalization: generated.finalization,
          persistedCapture: input.omitPersistedCapture === true
            ? null
            : {
                captureId: "cap_test",
                imageRef: "captures/generated/test.png",
                manifestPath: null,
              },
          usageDraft: generated.usageDraft,
        },
        status: "persisted",
      };
    };
  const publish: HostedImageGenerationEngine["publish"] = async (persisted) => {
    publishCount += 1;
    await publicationGate.promise;
    return {
      responseMedia: [
        {
          alt: "Generated image",
          kind: "image",
          source: "gpt-image-2",
          url: `https://images.example.test/${persisted.usageDraft?.providerRequestOrdinal ?? 0}.png`,
        },
      ],
      rpcSuccess: true,
      rpcText: "legacy inline text is intentionally ignored",
      savedImageRef: "captures/generated/test.png",
      usageDraft: persisted.usageDraft,
    };
  };
  const imageEngine: HostedImageGenerationEngine = {
    async dispatch(dispatchInput) {
      try {
        await dispatchInput.beforeDispatch?.();
      } catch {
        return {
          result: {
            rpcSuccess: false,
            rpcText: "image generation was not dispatched",
          },
          status: "pre_dispatch_failed",
        };
      }
      providerFetchCount += 1;
      if (input.dispatchMode === "provider_failed") {
        return {
          result: {
            rpcSuccess: false,
            rpcText: "image generation failed",
            usageDraft: createUsageDraft(
              dispatchInput.prepared.providerRequestOrdinal,
            ),
          },
          status: "provider_failed",
        };
      }
      await waitForProviderGate(
        providerGate.promise,
        dispatchInput.abortSignal ?? null,
        () => {
          providerAbortCount += 1;
        },
      );
      return {
        generated: {
          bytes: Uint8Array.of(1, 2, 3),
          finalization: dispatchInput.prepared.finalization,
          savedCapture: null,
          usageDraft: input.omitGeneratedUsage === true
            ? null
            : createUsageDraft(
                dispatchInput.prepared.providerRequestOrdinal,
              ),
        },
        status: "generated",
      };
    },
    async finalize(generated) {
      const capture = await persistCapture(generated);
      return capture.status === "failed"
        ? capture.result
        : publish(capture.persisted);
    },
    persistCapture,
    async prepare(prepareInput) {
      return createProviderRequiredPreparation(prepareInput);
    },
    publish,
  };
  const controllerInput: HostedImageGenerationControllerInput = {
    env: { OPENAI_API_KEY: "test-only-key" },
    fetchImpl: vi.fn<typeof fetch>(),
    generatedImageUploader: {
      async uploadGeneratedImage() {
        return {
          alt: "Generated image",
          kind: "image",
          source: "gpt-image-2",
          url: "https://images.example.test/uploaded.png",
        };
      },
    },
    imageEngine,
    memberId: "member_test",
    readOriginInput: async () => createOriginInput(input.origin),
    usageAllowancePort: {
      async applyUsageAllowance(
        request,
      ): Promise<HostedRuntimeUsageAllowanceResponse> {
        allowanceRequests.push(request);
        switch (request.action) {
          case "reserve_image":
            await reservationGate.promise;
            return {
              action: "reserve_image",
              requestId: request.requestId,
              status: input.reserveStatus ?? "reserved",
            };
          case "mark_dispatched":
            await markDispatchedGate.promise;
            return {
              action: "mark_dispatched",
              requestId: request.requestId,
              status: input.markStatus ?? "dispatched",
            };
          case "release":
            return {
              action: "release",
              requestId: request.requestId,
              status: "released",
            };
        }
      },
    },
    vaultRoot: "/nonexistent-test-vault",
  };
  return {
    allowanceRequests,
    controller: createHostedImageGenerationController(controllerInput),
    markDispatchedGate,
    persistCount: () => persistCount,
    providerAbortCount: () => providerAbortCount,
    providerFetchCount: () => providerFetchCount,
    providerGate,
    publicationGate,
    publishCount: () => publishCount,
    reservationGate,
  };
}

function createOriginInput(input?: {
  actorIsSelf: boolean;
  groupAuthority: boolean;
  threadIsDirect: boolean | null;
}): AssistantInputEventRecord {
  const inputId = "ain_00000000000000000000000000000000";
  const timestamp = "2026-07-25T20:00:00.000Z";
  const threadIsDirect = input?.threadIsDirect === undefined
    ? true
    : input.threadIsDirect;
  return {
    attachmentEvidence: {
      attachments: [],
      optionalInboxCaptureId: null,
      reasonCode: null,
      source: null,
      status: "not_attempted",
      updatedAt: null,
    },
    content: {
      attachmentDescriptors: [],
      text: "Generate an image",
      transcriptText: "Generate an image",
      userMessageContent: [{ text: "Generate an image", type: "text" }],
    },
    conversation: {
      accountId: "account_test",
      actorId: "actor_test",
      actorIsSelf: input?.actorIsSelf ?? false,
      source: "linq",
      threadId: "thread_test",
      threadIsDirect,
    },
    cursor: {
      createdAt: timestamp,
      inputId,
      occurredAt: timestamp,
      sourceKind: "hosted-mailbox",
      sourcePosition: "hosted-mailbox:conversation:1:item_test",
    },
    idempotencyKey: `sha256:${"0".repeat(64)}`,
    inputId,
    occurredAt: timestamp,
    projection: {
      captureId: null,
      lastAttemptedAt: null,
      reasonCode: null,
      status: "not_attempted",
      updatedAt: null,
    },
    receivedAt: timestamp,
    replyTarget: {
      channel: "linq",
      messageId: "message_test",
      threadId: "thread_test",
    },
    schema: "murph.assistant-input-event.v1",
    sourceMetadata: {
      ...(input?.groupAuthority === true
        ? { externalThreadRouteAuthorityPresent: true }
        : {}),
      kind: "linq",
      partCount: 1,
      reactionEligible: true,
      replyToMessageId: null,
      service: "imessage",
    },
    sourceRef: {
      dedupeKey: "origin_test",
      eventId: "event_test",
      itemId: "item_test",
      kind: "hosted-mailbox",
      lane: "conversation",
      laneSeq: "1",
      payloadSchema: "murph.test-conversation.v1",
      payloadSource: "inline",
      source: "hosted-mailbox",
      wakeSchema: "murph.test-wake.v1",
    },
    storedAt: timestamp,
    updatedAt: timestamp,
  };
}

function createRegistrationRequest(input: {
  prompt?: string;
  providerRequestOrdinal?: number;
  toolCallId?: string;
} = {}): AssistantHostedImageGenerationRegistrationRequest {
  return {
    args: {
      alt: "Generated image",
      outputFormat: "png",
      prompt: input.prompt ?? "A cyclist climbing a mountain",
      quality: "medium",
      size: "1024x1024",
    },
    origin: {
      assistantInputId: "ain_origin",
      kind: "accepted_input",
      sessionId: "session_test",
    },
    providerRequestOrdinal: input.providerRequestOrdinal ?? 1,
    toolCallId: input.toolCallId ?? "call-image",
  };
}

function createProviderRequiredPreparation(
  input: Parameters<HostedImageGenerationEngine["prepare"]>[0],
): Extract<PrepareAssistantImageGenerationResult, { status: "provider_required" }> {
  return {
    estimate: {
      model: "gpt-image-2",
      promptUtf8Bytes: input.args.prompt.length,
      quality: input.args.quality,
      referenceImageCount: input.args.referenceImageRefs?.length ?? 0,
      size: input.args.size,
    },
    prepared: {
      apiKey: "test-only-key",
      finalization: {
        args: input.args,
        captureIdentity: null,
        codexHome: null,
        hostedGeneratedImageUploader: input.hostedGeneratedImageUploader ?? null,
        promptHash: "prompt-hash",
        referenceImages: [],
        vaultRoot: null,
      },
      providerPrompt: input.args.prompt,
      providerRequestOrdinal: input.providerRequestOrdinal,
    },
    status: "provider_required",
  };
}

function createUsageDraft(
  providerRequestOrdinal: number,
): AssistantProviderUsageDraft {
  return {
    provider: "openai",
    providerRequestOrdinal,
    providerRequestOutcome: "succeeded",
    usage: {
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com/v1",
      cacheWriteTokens: null,
      cachedInputTokens: 0,
      inputTokens: 12,
      outputTokens: 34,
      providerMetadataJson: null,
      providerName: "openai",
      providerRequestId: `image-request-${providerRequestOrdinal}`,
      rawUsageJson: {
        input_tokens: 12,
        output_tokens: 34,
        total_tokens: 46,
      },
      rawUsageJsonHash: null,
      reasoningTokens: 0,
      requestedModel: "gpt-image-2",
      servedModel: "gpt-image-2",
      tokenPricingBasis: "standard",
      totalTokens: 46,
      turnProfileJson: null,
      usageExtractionSourcePath: "openai.images.generate",
      usageExtractionVersion: "openai-images-usage-v1",
    },
  };
}

function createDeferred(): {
  promise: Promise<void>;
  resolve(): void;
  settled(): boolean;
} {
  let isSettled = false;
  let resolvePromise = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = () => {
      isSettled = true;
      resolve();
    };
  });
  return {
    promise,
    resolve: resolvePromise,
    settled: () => isSettled,
  };
}

async function waitForProviderGate(
  gate: Promise<void>,
  signal: AbortSignal | null,
  onAbort: () => void,
): Promise<void> {
  if (!signal) {
    await gate;
    return;
  }
  if (signal.aborted) {
    onAbort();
    throw signal.reason;
  }
  await Promise.race([
    gate,
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        onAbort();
        reject(signal.reason);
      }, { once: true });
    }),
  ]);
}
