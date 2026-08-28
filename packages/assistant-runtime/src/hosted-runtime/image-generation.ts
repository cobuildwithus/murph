import { createHash } from "node:crypto";

import {
  readAssistantInputEvent,
  ASSISTANT_HOSTED_IMAGE_COMPLETION_SCHEMA,
  renderAssistantHostedImageCompletionSystemText,
  upsertAssistantInputEvent,
  type AssistantHostedImageGenerationLauncher,
  type AssistantHostedImageGenerationResult,
  type AssistantGeneratedImageCapturePersistenceMetadata,
  type AssistantRuntimeIssueInput,
} from "@murphai/assistant-engine";
import {
  enqueueHostedPendingAssistantInputId,
} from "./pending-input-index.ts";

interface CompletedImageGeneration {
  completedAt: string;
  continuationSessionId: string;
  operationId: string;
  originAssistantInputId: string;
  originAssistantInputIdExact: boolean;
  result: AssistantHostedImageGenerationResult;
  scopeId: string | null;
}

interface PendingCanonicalWrite {
  metadata: AssistantGeneratedImageCapturePersistenceMetadata;
  reject(reason: unknown): void;
  run(): Promise<void>;
}

export interface HostedImageGenerationController {
  readonly launcher: AssistantHostedImageGenerationLauncher;
  close(): Promise<void>;
  flushCanonicalWrites(
    persist: (
      write: () => Promise<void>,
      metadata: AssistantGeneratedImageCapturePersistenceMetadata,
    ) => Promise<void>,
  ): Promise<number>;
  hasCompleted(): boolean;
  hasWork(): boolean;
  releaseAcceptedInputs(
    inputIds: readonly string[],
    hasCompleteTerminalEvidence: (inputId: string) => Promise<boolean>,
  ): Promise<void>;
  stageCompleted(): Promise<readonly string[]>;
}

export function createHostedImageGenerationController(input: {
  enqueuePendingInputId?: typeof enqueueHostedPendingAssistantInputId;
  notifyReady(): void;
  onStarted(): void;
  recordRuntimeIssue?(issue: AssistantRuntimeIssueInput): void;
  signal?: AbortSignal | null;
  shutdownSignal?: AbortSignal | null;
  vaultRoot: string;
  withCanonicalWritePersistence<T>(run: () => Promise<T>): Promise<T>;
}): HostedImageGenerationController {
  const closeController = new AbortController();
  const runSignal = input.signal
    ? AbortSignal.any([input.signal, closeController.signal])
    : closeController.signal;
  const completed: CompletedImageGeneration[] = [];
  const canonicalWrites: PendingCanonicalWrite[] = [];
  const acceptedCompletionInputIds = new Set<string>();
  const completionInputScopes = new Map<string, {
    operationId: string;
    scopeId: string;
  }>();
  const operations = new Set<string>();
  const activeOperations = new Map<string, {
    continuationSessionId: string;
    operationId: string;
    originAssistantInputId: string;
    originAssistantInputIdExact: boolean;
    scopeId: string | null;
  }>();
  const pendingScopes = new Map<string, {
    operationId: string;
    status: "pending" | "queued";
  }>();
  const tasks = new Set<Promise<void>>();
  const enqueuePendingInputId =
    input.enqueuePendingInputId ?? enqueueHostedPendingAssistantInputId;
  const persistCanonicalWrite = <T>(
    write: () => Promise<T>,
    metadata: AssistantGeneratedImageCapturePersistenceMetadata,
  ): Promise<T> =>
    input.withCanonicalWritePersistence(
      () => new Promise<T>((resolve, reject) => {
        canonicalWrites.push({
          metadata,
          reject,
          async run() {
            try {
              resolve(await write());
            } catch (error) {
              reject(error);
            }
          },
        });
        input.notifyReady();
      }),
    );
  const completeOperation = (
    operationId: string,
    result: AssistantHostedImageGenerationResult,
  ): void => {
    const operation = activeOperations.get(operationId);
    if (!operation) {
      return;
    }
    activeOperations.delete(operationId);
    completed.push({
      completedAt: new Date().toISOString(),
      continuationSessionId: operation.continuationSessionId,
      operationId,
      originAssistantInputId: operation.originAssistantInputId,
      originAssistantInputIdExact: operation.originAssistantInputIdExact,
      result,
      scopeId: operation.scopeId,
    });
    if (operation.scopeId) {
      pendingScopes.set(operation.scopeId, {
        operationId,
        status: "queued",
      });
    }
    input.notifyReady();
  };
  const completeActiveOperationsAsFailed = (): void => {
    for (const operationId of [...activeOperations.keys()]) {
      completeOperation(operationId, {
        media: null,
        runtimeIssue: null,
        savedImageRef: null,
      });
    }
  };
  input.shutdownSignal?.addEventListener(
    "abort",
    completeActiveOperationsAsFailed,
    { once: true },
  );

  const launcher: AssistantHostedImageGenerationLauncher = {
    launch(request) {
      const continuationSessionId = request.continuationSessionId?.trim() || null;
      if (!continuationSessionId) {
        // The host binds continuation identity. Accepting a missing one would
        // stage a completion without an exact session and silently reopen
        // conversation-based resolution, so fail closed before any operation,
        // pending scope, or start side effect is recorded.
        throw new TypeError(
          "Hosted image generation requires a continuation session id.",
        );
      }
      if (operations.has(request.operationId)) {
        return "already-started";
      }
      const scopeId = request.scopeId?.trim() || null;
      if (scopeId && pendingScopes.has(scopeId)) {
        return "already-pending";
      }
      operations.add(request.operationId);
      activeOperations.set(request.operationId, {
        continuationSessionId,
        operationId: request.operationId,
        originAssistantInputId: request.originAssistantInputId,
        originAssistantInputIdExact: request.originAssistantInputIdExact,
        scopeId,
      });
      if (scopeId) {
        pendingScopes.set(scopeId, {
          operationId: request.operationId,
          status: "pending",
        });
      }
      input.onStarted();
      if (input.shutdownSignal?.aborted) {
        completeActiveOperationsAsFailed();
        return "started";
      }
      const task = (async () => {
        try {
          const result = await request.run(runSignal, persistCanonicalWrite);
          if (closeController.signal.aborted) {
            return;
          }
          if (runSignal.aborted && input.shutdownSignal?.aborted !== true) {
            return;
          }
          completeOperation(request.operationId, result);
        } catch {
          if (closeController.signal.aborted) {
            return;
          }
          if (runSignal.aborted && input.shutdownSignal?.aborted !== true) {
            return;
          }
          completeOperation(request.operationId, {
            failureDiagnostic:
              "image generation failed before a diagnostic was returned",
            media: null,
            runtimeIssue: null,
            savedImageRef: null,
          });
        }
      })();
      tasks.add(task);
      void task.finally(() => tasks.delete(task));
      return "started";
    },
    readStatus(scopeId) {
      return pendingScopes.get(scopeId)?.status ?? null;
    },
  };

  return {
    launcher,
    async close() {
      input.shutdownSignal?.removeEventListener(
        "abort",
        completeActiveOperationsAsFailed,
      );
      closeController.abort();
      const abortReason = new Error("Hosted image generation closed.");
      for (const pending of canonicalWrites.splice(0)) {
        pending.reject(abortReason);
      }
      await Promise.allSettled([...tasks]);
      completed.splice(0);
      acceptedCompletionInputIds.clear();
      completionInputScopes.clear();
      pendingScopes.clear();
      activeOperations.clear();
    },
    async flushCanonicalWrites(persist) {
      let flushed = 0;
      while (canonicalWrites.length > 0) {
        const pending = canonicalWrites[0]!;
        try {
          await persist(pending.run, pending.metadata);
        } catch (error) {
          pending.reject(error);
        }
        canonicalWrites.shift();
        flushed += 1;
      }
      return flushed;
    },
    async stageCompleted() {
      const stagedInputIds: string[] = [];
      while (completed.length > 0) {
        const completion = completed[0]!;
        let completionInputId: string | null = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const inputId = await stageImageGenerationCompletion({
              completion,
              vaultRoot: input.vaultRoot,
            });
            await enqueuePendingInputId({
              inputId,
              vaultRoot: input.vaultRoot,
            });
            completionInputId = inputId;
            break;
          } catch {
            if (attempt === 1) {
              return stagedInputIds;
            }
          }
        }
        if (completion.result.runtimeIssue) {
          input.recordRuntimeIssue?.(completion.result.runtimeIssue);
        }
        completed.shift();
        if (
          completion.scopeId
          && completionInputId
        ) {
          completionInputScopes.set(completionInputId, {
            operationId: completion.operationId,
            scopeId: completion.scopeId,
          });
        }
        if (completionInputId) {
          stagedInputIds.push(completionInputId);
        }
      }
      return stagedInputIds;
    },
    hasCompleted() {
      return completed.length > 0;
    },
    hasWork() {
      return tasks.size > 0
        || completed.length > 0
        || canonicalWrites.length > 0;
    },
    async releaseAcceptedInputs(inputIds, hasCompleteTerminalEvidence) {
      for (const inputId of inputIds) {
        if (completionInputScopes.has(inputId)) {
          acceptedCompletionInputIds.add(inputId);
        }
      }
      for (const inputId of acceptedCompletionInputIds) {
        const scope = completionInputScopes.get(inputId);
        if (!scope) {
          acceptedCompletionInputIds.delete(inputId);
          continue;
        }
        let terminalEvidenceComplete = false;
        try {
          terminalEvidenceComplete = await hasCompleteTerminalEvidence(inputId);
        } catch {
          // Status is advisory invocation-local truth. An evidence read failure
          // must retain it fail-closed without replacing the assistant turn's
          // own success or failure. A later pass can prove terminal evidence.
          continue;
        }
        if (!terminalEvidenceComplete) {
          continue;
        }
        acceptedCompletionInputIds.delete(inputId);
        completionInputScopes.delete(inputId);
        if (
          pendingScopes.get(scope.scopeId)?.operationId === scope.operationId
        ) {
          pendingScopes.delete(scope.scopeId);
        }
      }
    },
  };
}

async function stageImageGenerationCompletion(input: {
  completion: CompletedImageGeneration;
  vaultRoot: string;
}): Promise<string> {
  const origin = await readAssistantInputEvent({
    inputId: input.completion.originAssistantInputId,
    vault: input.vaultRoot,
  });
  if (!origin) {
    throw new TypeError("Hosted image completion origin input was not found.");
  }
  if (!origin.conversation || !origin.replyTarget) {
    throw new TypeError("Hosted image completion origin has no reply route.");
  }

  const sourceIdentity = `image-completion:${createHash("sha256")
    .update(input.completion.operationId)
    .digest("hex")}`;
  const text = renderAssistantHostedImageCompletionSystemText({
    originAssistantInputId: input.completion.originAssistantInputId,
    originAssistantInputIdExact:
      input.completion.originAssistantInputIdExact,
    result: input.completion.result,
  });
  const event = await upsertAssistantInputEvent({
    event: {
      content: {
        attachmentDescriptors: [],
        text,
        transcriptText: text,
        userMessageContent: [{ text, type: "text" }],
      },
      conversation: {
        ...origin.conversation,
        actorId: null,
        actorIsSelf: false,
        // Continuation identity is host-bound and independent of the pending
        // image coordination scope.
        sessionId: input.completion.continuationSessionId,
      },
      occurredAt: input.completion.completedAt,
      receivedAt: input.completion.completedAt,
      replyTarget: origin.replyTarget,
      sourceMetadata: origin.sourceMetadata,
      sourceRef: {
        dedupeKey: sourceIdentity,
        eventId: sourceIdentity,
        itemId: sourceIdentity,
        kind: "hosted-mailbox",
        lane: "system",
        laneSeq: sourceIdentity,
        payloadSchema: ASSISTANT_HOSTED_IMAGE_COMPLETION_SCHEMA,
        payloadSource: "inline",
        source: "hosted-mailbox",
        wakeSchema: ASSISTANT_HOSTED_IMAGE_COMPLETION_SCHEMA,
      },
    },
    vault: input.vaultRoot,
  });
  return event.inputId;
}
