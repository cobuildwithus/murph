import { createHash } from "node:crypto";

import {
  readAssistantInputEvent,
  type AssistantHostedGeneratedImageUploader,
  type AssistantHostedImageGenerationRegistrar,
  type AssistantHostedImageGenerationRegistrationRequest,
  type AssistantHostedImageGenerationRegistrationResult,
  type AssistantInputEventRecord,
} from "@murphai/assistant-engine";
import type {
  AssistantProviderUsageDraft,
} from "@murphai/assistant-engine/assistant-ask";
import {
  dispatchPreparedAssistantImageGeneration,
  finalizeAssistantImageGeneration,
  persistAssistantImageGenerationCapture,
  prepareAssistantImageGeneration,
  publishAssistantImageGeneration,
  type DispatchPreparedAssistantImageGenerationResult,
  type GeneratedAssistantImage,
  type GenerateImageToolResult,
  type PersistAssistantImageGenerationCaptureResult,
  type PersistedAssistantImage,
  type PrepareAssistantImageGenerationResult,
} from "@murphai/assistant-engine/assistant-codex";
import {
  createAssistantUsageId,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import type {
  HostedRuntimeUsageAllowanceResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  assistantResponseMediaSchema,
  type AssistantResponseMedia,
} from "@murphai/operator-config/assistant-cli-contracts";

import { assertAuthorizedHostedImageGenerationOrigin } from "./image-generation-completion.ts";
import type { HostedWorkspaceArtifactMaterializer } from "./models.ts";
import type { HostedRuntimeUsageAllowancePort } from "./platform.ts";
import { buildHostedStandaloneAssistantUsageRecord } from "./standalone-usage-record.ts";

const IMAGE_USAGE_ATTEMPT = 1;
const IMAGE_CAPTURE_KEY_PREFIX = "murph.background-image-generation";

export type HostedImageGenerationUnavailableReason =
  | "admission_unavailable"
  | "dispatch_unavailable"
  | "finalization_failed"
  | "insufficient_capacity"
  | "origin_usage_unavailable"
  | "provider_failed";

export type HostedImageGenerationStageOutcome =
  | { kind: "ready"; media: readonly AssistantResponseMedia[] }
  | { kind: "would_exhaust" }
  | { kind: "unavailable"; reason: HostedImageGenerationUnavailableReason };

export interface HostedImageGenerationStageInput {
  completedAt: string;
  operationId: string;
  originAssistantInputId: string;
  outcome: HostedImageGenerationStageOutcome;
}

export interface HostedImageGenerationControllerSnapshot {
  active: boolean;
  canonicalWritePending: boolean;
  ready: boolean;
  registrationCursor: number;
  unsettled: boolean;
  version: number;
}

export interface HostedImageGenerationController {
  readonly registrar: AssistantHostedImageGenerationRegistrar;
  admitRegistered(input: {
    afterSequence: number;
    recordedOriginInputIds: readonly string[];
    throughSequence: number;
  }): Promise<void>;
  completeCompletionTurns(input: {
    operationIds: readonly string[];
    phaseSucceeded: boolean;
    successfulUsageIds: readonly string[];
  }): void;
  drain(mode: "forced" | "graceful"): Promise<void>;
  hasUnselectedCompletion(): boolean;
  persistReadyCaptures(): Promise<void>;
  selectCompletionInputs(input: {
    inputIds: readonly string[];
    recordDeferredUsage(
      record: AssistantUsageRecord,
      acceptedInputIds?: readonly string[],
      options?: {
        reservationId?: string;
        suppressNoticeDelivery?: true;
      },
    ): void;
  }): string[];
  selectUnrunnableCompletionInputs(input: {
    recordDeferredUsage(
      record: AssistantUsageRecord,
      acceptedInputIds?: readonly string[],
      options?: {
        reservationId?: string;
        suppressNoticeDelivery?: true;
      },
    ): void;
    runnableInputIds: readonly string[];
  }): string[];
  snapshot(): HostedImageGenerationControllerSnapshot;
  stageReady(
    stage: (input: HostedImageGenerationStageInput) => Promise<{
      completionInputId: string;
    }>,
  ): Promise<{ stagedOperationIds: string[] }>;
  waitForChange(afterVersion: number, signal?: AbortSignal | null): Promise<number>;
}

export interface HostedImageGenerationEngine {
  dispatch(
    input: Parameters<typeof dispatchPreparedAssistantImageGeneration>[0],
  ): Promise<DispatchPreparedAssistantImageGenerationResult>;
  finalize(generated: GeneratedAssistantImage): Promise<GenerateImageToolResult>;
  persistCapture(
    generated: GeneratedAssistantImage,
  ): Promise<PersistAssistantImageGenerationCaptureResult>;
  prepare(
    input: Parameters<typeof prepareAssistantImageGeneration>[0],
  ): Promise<PrepareAssistantImageGenerationResult>;
  publish(persisted: PersistedAssistantImage): Promise<GenerateImageToolResult>;
}

export interface HostedImageGenerationControllerInput {
  codexHome?: string | null;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  generatedImageUploader?: AssistantHostedGeneratedImageUploader | null;
  imageEngine?: HostedImageGenerationEngine;
  materializeWorkspaceArtifacts?: HostedWorkspaceArtifactMaterializer | null;
  memberId: string;
  now?: () => string;
  notifyReady?: (() => void) | null;
  readOriginInput?: (input: {
    inputId: string;
    vault: string;
  }) => Promise<AssistantInputEventRecord | null>;
  usageAllowancePort?: HostedRuntimeUsageAllowancePort | null;
  vaultRoot: string;
}

type OperationPhase =
  | "active"
  | "capture"
  | "completion"
  | "pending"
  | "ready"
  | "terminal";

interface Operation {
  completedAt: string;
  completionInputId: string | null;
  completionSelected: boolean;
  generated: GeneratedAssistantImage | null;
  id: string;
  origin: AssistantHostedImageGenerationRegistrationRequest["origin"];
  phase: OperationPhase;
  prepared: Extract<
    PrepareAssistantImageGenerationResult,
    { status: "provider_required" }
  >;
  providerAbort: AbortController | null;
  ready: HostedImageGenerationStageOutcome | null;
  sequence: number;
  usageId: string;
  usageRecord: AssistantUsageRecord | null;
}

interface Registration {
  fingerprint: string;
  result: Promise<AssistantHostedImageGenerationRegistrationResult>;
}

export function createHostedImageGenerationController(
  input: HostedImageGenerationControllerInput,
): HostedImageGenerationController {
  return new ImageGenerationController(input);
}

class ImageGenerationController implements HostedImageGenerationController {
  readonly registrar: AssistantHostedImageGenerationRegistrar;
  private readonly engine: HostedImageGenerationEngine;
  private readonly now: () => string;
  private readonly operations = new Map<string, Operation>();
  private readonly readOriginInput: NonNullable<
    HostedImageGenerationControllerInput["readOriginInput"]
  >;
  private readonly registrations = new Map<string, Registration>();
  private readonly tasks = new Set<Promise<void>>();
  private readonly waiters = new Set<() => void>();
  private cursor = 0;
  private forced = false;
  private version = 0;

  constructor(private readonly input: HostedImageGenerationControllerInput) {
    this.engine = input.imageEngine ?? {
      dispatch: dispatchPreparedAssistantImageGeneration,
      finalize: finalizeAssistantImageGeneration,
      persistCapture: persistAssistantImageGenerationCapture,
      prepare: prepareAssistantImageGeneration,
      publish: publishAssistantImageGeneration,
    };
    this.now = input.now ?? (() => new Date().toISOString());
    this.readOriginInput = input.readOriginInput ?? readAssistantInputEvent;
    this.registrar = { register: (request) => this.register(request) };
  }

  async admitRegistered(input: {
    afterSequence: number;
    recordedOriginInputIds: readonly string[];
    throughSequence: number;
  }): Promise<void> {
    const recorded = new Set(input.recordedOriginInputIds);
    const tasks = [...this.operations.values()]
      .filter((operation) =>
        operation.phase === "pending"
        && operation.sequence > input.afterSequence
        && operation.sequence <= input.throughSequence
      )
      .map((operation) => {
        if (!recorded.has(operation.origin.assistantInputId)) {
          this.setReady(
            operation,
            unavailableOutcome("origin_usage_unavailable"),
          );
          return Promise.resolve();
        }
        return this.track(this.admit(operation));
      });
    await Promise.allSettled(tasks);
  }

  completeCompletionTurns(input: {
    operationIds: readonly string[];
    phaseSucceeded: boolean;
    successfulUsageIds: readonly string[];
  }): void {
    const ids = new Set(input.operationIds);
    const settledUsage = new Set(input.successfulUsageIds);
    for (const operation of this.operations.values()) {
      if (
        operation.phase !== "completion"
        || !operation.completionSelected
        || !ids.has(operation.id)
      ) {
        continue;
      }
      if (!input.phaseSucceeded) {
        operation.completionSelected = false;
      } else {
        if (
          operation.usageRecord
          && !settledUsage.has(operation.usageRecord.usageId)
        ) {
          console.warn("Hosted image usage settlement remains pending.", {
            operation: "generated_image_usage",
          });
          this.signal();
          continue;
        }
        operation.phase = "terminal";
      }
      this.signal();
    }
  }

  async drain(mode: "forced" | "graceful"): Promise<void> {
    if (mode === "forced") {
      this.forced = true;
      for (const operation of this.operations.values()) {
        operation.providerAbort?.abort(
          new DOMException("Hosted image generation was stopped.", "AbortError"),
        );
        operation.phase = "terminal";
        operation.generated = null;
        operation.ready = null;
      }
      this.signal();
      return;
    }
    while (this.tasks.size > 0) {
      await Promise.allSettled([...this.tasks]);
    }
  }

  hasUnselectedCompletion(): boolean {
    return [...this.operations.values()].some((operation) =>
      operation.phase === "completion"
      && !operation.completionSelected
      && operation.completionInputId !== null
    );
  }

  selectCompletionInputs(input: {
    inputIds: readonly string[];
    recordDeferredUsage(
      record: AssistantUsageRecord,
      acceptedInputIds?: readonly string[],
      options?: {
        reservationId?: string;
        suppressNoticeDelivery?: true;
      },
    ): void;
  }): string[] {
    const inputIds = new Set(input.inputIds);
    const selected: string[] = [];
    for (const operation of this.operations.values()) {
      if (
        operation.phase !== "completion"
        || operation.completionSelected
        || !operation.completionInputId
        || !inputIds.has(operation.completionInputId)
      ) {
        continue;
      }
      if (operation.usageRecord) {
        input.recordDeferredUsage(
          operation.usageRecord,
          [operation.completionInputId],
          { reservationId: operation.usageId },
        );
      }
      operation.completionSelected = true;
      selected.push(operation.id);
      this.signal();
    }
    return selected;
  }

  selectUnrunnableCompletionInputs(input: {
    recordDeferredUsage(
      record: AssistantUsageRecord,
      acceptedInputIds?: readonly string[],
      options?: {
        reservationId?: string;
        suppressNoticeDelivery?: true;
      },
    ): void;
    runnableInputIds: readonly string[];
  }): string[] {
    const runnableInputIds = new Set(input.runnableInputIds);
    const selected: string[] = [];
    for (const operation of this.operations.values()) {
      if (
        operation.phase !== "completion"
        || operation.completionSelected
        || !operation.completionInputId
        || runnableInputIds.has(operation.completionInputId)
      ) {
        continue;
      }
      if (operation.usageRecord) {
        // No Murph turn accepted this input. Explicit notice suppression keeps
        // settlement route-free, so a usage-limit notice cannot overtake the
        // durable completion if the channel is enabled again later.
        input.recordDeferredUsage(
          operation.usageRecord,
          undefined,
          {
            reservationId: operation.usageId,
            suppressNoticeDelivery: true,
          },
        );
      }
      operation.completionSelected = true;
      selected.push(operation.id);
      this.signal();
    }
    return selected;
  }

  snapshot(): HostedImageGenerationControllerSnapshot {
    const operations = [...this.operations.values()];
    const phases = operations.map(({ phase }) => phase);
    return {
      active: operations.some((operation) =>
        operation.phase === "active"
        || operation.phase === "pending"
        || (
          operation.phase === "completion"
          && operation.completionSelected
        )
      ),
      canonicalWritePending: phases.includes("capture"),
      ready: phases.includes("ready"),
      registrationCursor: this.cursor,
      unsettled: phases.some((phase) => phase !== "terminal"),
      version: this.version,
    };
  }

  async persistReadyCaptures(): Promise<void> {
    const operations = [...this.operations.values()]
      .filter((operation) => operation.phase === "capture")
      .sort((left, right) => left.sequence - right.sequence);
    for (const operation of operations) {
      const generated = operation.generated;
      if (!generated || this.forced) {
        operation.phase = "terminal";
        operation.generated = null;
        this.signal();
        continue;
      }
      operation.phase = "active";
      operation.generated = null;
      this.signal();
      let result: PersistAssistantImageGenerationCaptureResult;
      try {
        result = await this.engine.persistCapture(generated);
      } catch {
        this.setReady(
          operation,
          unavailableOutcome("finalization_failed"),
          generated.usageDraft,
        );
        continue;
      }
      if (this.forced) {
        operation.phase = "terminal";
        this.signal();
      } else if (
        result.status === "failed"
        || !result.persisted.persistedCapture
      ) {
        this.setReady(
          operation,
          unavailableOutcome("finalization_failed"),
          generated.usageDraft,
        );
      } else {
        void this.track(this.publishGenerated(operation, result.persisted));
      }
    }
  }

  async stageReady(
    stage: (input: HostedImageGenerationStageInput) => Promise<{
      completionInputId: string;
    }>,
  ): Promise<{ stagedOperationIds: string[] }> {
    const stagedOperationIds: string[] = [];
    const ready = [...this.operations.values()]
      .filter((operation) => operation.phase === "ready")
      .sort((left, right) => left.sequence - right.sequence);
    for (const operation of ready) {
      if (!operation.ready) {
        continue;
      }
      const result = await stage({
        completedAt: operation.completedAt,
        operationId: operation.id,
        originAssistantInputId: operation.origin.assistantInputId,
        outcome: operation.ready,
      });
      const completionInputId = result.completionInputId.trim();
      if (!completionInputId) {
        throw new TypeError("Image completion staging returned an empty input id.");
      }
      operation.completionInputId = completionInputId;
      operation.completionSelected = false;
      operation.ready = null;
      operation.phase = "completion";
      stagedOperationIds.push(operation.id);
      this.signal();
    }
    return { stagedOperationIds };
  }

  waitForChange(
    afterVersion: number,
    signal?: AbortSignal | null,
  ): Promise<number> {
    if (this.version !== afterVersion) {
      return Promise.resolve(this.version);
    }
    if (signal?.aborted) {
      return Promise.reject(abortReason(signal));
    }
    return new Promise<number>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        this.waiters.delete(changed);
        signal?.removeEventListener("abort", aborted);
        callback();
      };
      const changed = () => finish(() => resolve(this.version));
      const aborted = () => finish(() => reject(abortReason(signal)));
      this.waiters.add(changed);
      signal?.addEventListener("abort", aborted, { once: true });
      if (this.version !== afterVersion) changed();
    });
  }

  private async admit(operation: Operation): Promise<void> {
    if (operation.phase !== "pending") return;
    if (this.forced) {
      operation.phase = "terminal";
      this.signal();
      return;
    }
    operation.phase = "active";
    this.signal();
    let response: HostedRuntimeUsageAllowanceResponse | null = null;
    try {
      response = await this.input.usageAllowancePort?.applyUsageAllowance({
        action: "reserve_image",
        estimate: operation.prepared.estimate,
        requestId: operation.usageId,
      }) ?? null;
    } catch {
      await this.release(operation);
      this.setReady(operation, unavailableOutcome("admission_unavailable"));
      return;
    }
    if (this.forced) {
      if (response?.action === "reserve_image" && response.status === "reserved") {
        await this.release(operation);
      }
      operation.phase = "terminal";
      this.signal();
      return;
    }
    if (response?.action !== "reserve_image") {
      await this.release(operation);
      this.setReady(operation, unavailableOutcome("admission_unavailable"));
      return;
    }
    switch (response.status) {
      case "reserved":
        void this.track(this.runProvider(operation));
        return;
      case "would_exhaust":
        this.setReady(operation, { kind: "would_exhaust" });
        return;
      case "insufficient_capacity":
        this.setReady(operation, unavailableOutcome("insufficient_capacity"));
        return;
      case "already_dispatched":
      case "already_settled":
        this.setReady(operation, unavailableOutcome("dispatch_unavailable"));
    }
  }

  private async register(
    request: AssistantHostedImageGenerationRegistrationRequest,
  ): Promise<AssistantHostedImageGenerationRegistrationResult> {
    const toolCallId = request.toolCallId.trim();
    const sessionId = request.origin.sessionId.trim();
    if (!toolCallId || !sessionId || !this.input.vaultRoot.trim()) {
      return rejected("unavailable");
    }
    const normalized = {
      ...request,
      origin: { ...request.origin, sessionId },
      toolCallId,
    };
    const id = operationId(normalized);
    const fingerprint = requestFingerprint(normalized);
    const existing = this.registrations.get(id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return rejected("conflict");
      return await existing.result;
    }
    const result = this.prepareRegistration(id, fingerprint, normalized);
    this.registrations.set(id, { fingerprint, result });
    return result;
  }

  private async prepareRegistration(
    id: string,
    fingerprint: string,
    request: AssistantHostedImageGenerationRegistrationRequest,
  ): Promise<AssistantHostedImageGenerationRegistrationResult> {
    try {
      const origin = await this.readOriginInput({
        inputId: request.origin.assistantInputId,
        vault: this.input.vaultRoot,
      });
      if (!origin) {
        return rejected("unavailable");
      }
      assertAuthorizedHostedImageGenerationOrigin(origin);
      const prepared = await this.engine.prepare({
        args: request.args,
        captureIdempotencyKey:
          `${IMAGE_CAPTURE_KEY_PREFIX}:${id}:${fingerprint}`,
        codexHome: this.input.codexHome ?? null,
        env: this.input.env,
        hostedGeneratedImageUploader: this.input.generatedImageUploader ?? null,
        materializeWorkspaceArtifacts:
          this.input.materializeWorkspaceArtifacts ?? null,
        providerRequestOrdinal: request.providerRequestOrdinal,
        requireHostedGeneratedImageUploader: true,
        vaultRoot: this.input.vaultRoot,
      });
      if (prepared.status === "terminal") return inline(prepared.result);
      if (prepared.status === "cached") {
        return inline(await this.engine.finalize(prepared.generated));
      }
      const registeredAt = this.now();
      this.cursor += 1;
      const usageId = createAssistantUsageId({
        attemptCount: IMAGE_USAGE_ATTEMPT,
        providerRequestOrdinal: request.providerRequestOrdinal,
        turnId: `turn_generated_image_${id}`,
      });
      this.operations.set(id, {
        completedAt: registeredAt,
        completionInputId: null,
        completionSelected: false,
        generated: null,
        id,
        origin: request.origin,
        phase: "pending",
        prepared,
        providerAbort: null,
        ready: null,
        sequence: this.cursor,
        usageId,
        usageRecord: null,
      });
      this.signal();
      return { status: "admission_pending" };
    } catch {
      return rejected("unavailable");
    }
  }

  private async release(operation: Operation): Promise<void> {
    try {
      await this.input.usageAllowancePort?.applyUsageAllowance({
        action: "release",
        requestId: operation.usageId,
      });
    } catch {
      // A lost release never permits a provider retry or second dispatch.
    }
  }

  private async runProvider(operation: Operation): Promise<void> {
    const abort = new AbortController();
    operation.providerAbort = abort;
    let markStatus:
      Extract<
        HostedRuntimeUsageAllowanceResponse,
        { action: "mark_dispatched" }
      >["status"] | null = null;
    try {
      const result = await this.engine.dispatch({
        abortSignal: abort.signal,
        beforeDispatch: async () => {
          if (this.forced) throw new Error("Image controller is closing.");
          const response =
            await this.input.usageAllowancePort?.applyUsageAllowance({
              action: "mark_dispatched",
              requestId: operation.usageId,
            }) ?? null;
          markStatus = response?.action === "mark_dispatched"
            ? response.status
            : null;
          if (markStatus !== "dispatched") {
            throw new Error("Image dispatch claim was unavailable.");
          }
          if (this.forced || abort.signal.aborted) {
            throw new DOMException(
              "Hosted image generation was stopped.",
              "AbortError",
            );
          }
        },
        fetchImpl: this.input.fetchImpl,
        prepared: operation.prepared.prepared,
      });
      if (this.forced) {
        operation.phase = "terminal";
        this.signal();
      } else if (result.status === "generated") {
        this.setCapture(operation, result.generated);
      } else if (result.status === "provider_failed") {
        this.setReady(
          operation,
          unavailableOutcome("provider_failed"),
          result.result.usageDraft ?? null,
        );
      } else {
        await this.release(operation);
        this.setReady(operation, dispatchDeniedOutcome(markStatus));
      }
    } catch {
      if (this.forced || abort.signal.aborted) {
        operation.phase = "terminal";
        this.signal();
      } else if (markStatus === "dispatched") {
        this.setReady(operation, unavailableOutcome("provider_failed"));
      } else {
        await this.release(operation);
        this.setReady(operation, dispatchDeniedOutcome(markStatus));
      }
    } finally {
      operation.providerAbort = null;
    }
  }

  private async publishGenerated(
    operation: Operation,
    persisted: PersistedAssistantImage,
  ): Promise<void> {
    let finalized: GenerateImageToolResult;
    try {
      finalized = await this.engine.publish(persisted);
    } catch {
      this.setReady(
        operation,
        unavailableOutcome("finalization_failed"),
        persisted.usageDraft,
      );
      return;
    }
    const media = imageMedia(finalized.responseMedia ?? []);
    const savedImageRef = finalized.savedImageRef?.trim() ?? "";
    this.setReady(
      operation,
      finalized.rpcSuccess && media.length === 1 && savedImageRef
        ? {
            kind: "ready",
            media,
          }
        : unavailableOutcome("finalization_failed"),
      persisted.usageDraft,
      true,
    );
  }

  private setCapture(
    operation: Operation,
    generated: GeneratedAssistantImage,
  ): void {
    if (this.forced) {
      operation.phase = "terminal";
      this.signal();
      return;
    }
    if (!generated.usageDraft) {
      this.setReady(operation, unavailableOutcome("finalization_failed"));
      return;
    }
    operation.generated = generated;
    operation.phase = "capture";
    this.signal();
  }

  private setReady(
    operation: Operation,
    outcome: HostedImageGenerationStageOutcome,
    usageDraft: AssistantProviderUsageDraft | null = null,
    requireUsageRecord = false,
  ): void {
    if (this.forced) {
      operation.phase = "terminal";
      operation.ready = null;
      this.signal();
      return;
    }
    operation.completedAt = this.now();
    operation.generated = null;
    const usageRecord = usageDraft
      ? buildImageUsageRecord(this.input, operation, usageDraft)
      : null;
    operation.phase = "ready";
    operation.ready = requireUsageRecord && !usageRecord
      ? unavailableOutcome("finalization_failed")
      : outcome;
    operation.usageRecord = usageRecord;
    this.signal(true);
  }

  private signal(ready = false): void {
    this.version += 1;
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
    if (ready) this.input.notifyReady?.();
  }

  private track(task: Promise<void>): Promise<void> {
    this.tasks.add(task);
    const settled = () => {
      this.tasks.delete(task);
      this.signal();
    };
    void task.then(settled, settled);
    return task;
  }
}

function buildImageUsageRecord(
  input: HostedImageGenerationControllerInput,
  operation: Operation,
  usageDraft: AssistantProviderUsageDraft,
): AssistantUsageRecord | null {
  try {
    const record = buildHostedStandaloneAssistantUsageRecord({
      attemptCount: IMAGE_USAGE_ATTEMPT,
      attribution: {
        credentialSource: "platform",
        featureKey: "assistant_generated_image",
        surface: "hosted-runtime",
        triggerKind: "image-generation",
      },
      memberId: input.memberId,
      occurredAt: operation.completedAt,
      providerUsage: usageDraft,
      sessionId: operation.origin.sessionId,
      turnId: `turn_generated_image_${operation.id}`,
    });
    return record.usageId === operation.usageId ? record : null;
  } catch {
    return null;
  }
}

function imageMedia(media: readonly AssistantResponseMedia[]): AssistantResponseMedia[] {
  if (media.length !== 1) return [];
  try {
    const parsed = assistantResponseMediaSchema.parse(media[0]);
    return parsed.kind === "image" ? [parsed] : [];
  } catch {
    return [];
  }
}

function operationId(
  request: AssistantHostedImageGenerationRegistrationRequest,
): string {
  return `img_${createHash("sha256")
    .update(request.origin.assistantInputId)
    .update("\0")
    .update(request.toolCallId)
    .digest("hex")}`;
}

function requestFingerprint(
  request: AssistantHostedImageGenerationRegistrationRequest,
): string {
  return createHash("sha256").update(JSON.stringify({
    args: {
      ...request.args,
      referenceImageRefs: [...(request.args.referenceImageRefs ?? [])],
    },
    origin: request.origin,
    toolCallId: request.toolCallId,
  })).digest("hex");
}

function unavailableOutcome(
  reason: HostedImageGenerationUnavailableReason,
): Extract<HostedImageGenerationStageOutcome, { kind: "unavailable" }> {
  return { kind: "unavailable", reason };
}

function dispatchDeniedOutcome(
  status:
    Extract<
      HostedRuntimeUsageAllowanceResponse,
      { action: "mark_dispatched" }
    >["status"] | null,
): HostedImageGenerationStageOutcome {
  return status === "would_exhaust"
    ? { kind: "would_exhaust" }
    : unavailableOutcome("dispatch_unavailable");
}

function inline(
  result: GenerateImageToolResult,
): AssistantHostedImageGenerationRegistrationResult {
  return { result, status: "inline_result" };
}

function rejected(
  reason: "conflict" | "unavailable",
): AssistantHostedImageGenerationRegistrationResult {
  return { reason, status: "rejected" };
}

function abortReason(signal: AbortSignal | null | undefined): unknown {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Image controller wait was aborted.", "AbortError");
}
