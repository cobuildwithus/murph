import {
  createAssistantInputAttachmentEvidenceFromInboxCapture,
  readAssistantInputEvent,
  updateAssistantInputAttachmentEvidence,
  type AssistantInputEventRecord,
} from "@murphai/assistant-engine";
import { createIntegratedInboxServices } from "@murphai/inbox-services";
import { openInboxRuntime } from "@murphai/inboxd/runtime";
import {
  createConfiguredParserRegistry,
  createInboxParserService,
} from "@murphai/parsers";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import type { NormalizedHostedAssistantRuntimeConfig } from "./models.ts";
import {
  classifyHostedAssistantInputMediaSemanticState,
} from "./media-parser-evidence.ts";
import {
  readExistingHostedPendingAssistantInputIds,
} from "./pending-input-index.ts";

const HOSTED_PARSER_MAINTENANCE_INPUT_LIMIT = 4;
const HOSTED_PARSER_MAINTENANCE_RETRY_DELAY_MS = 60_000;
const HOSTED_PARSER_MISSING_JOB_REASON_CODE =
  "attachment.parser_job_missing";

export interface HostedConversationParserMaintenanceResult {
  evidenceUpdated: number;
  nextWakeAt: string | null;
  parserProcessed: number;
  progressed: boolean;
}

export async function readHostedConversationParserContinuationWakeAt(input: {
  memberId: string;
  vaultRoot: string;
}): Promise<string | null> {
  let runtime: Awaited<ReturnType<typeof openInboxRuntime>> | null = null;
  try {
    runtime = await openInboxRuntime({ vaultRoot: input.vaultRoot });
    runtime.requeueAttachmentParseJobs({ state: "running" });
    const hasPendingParserJob = runtime.listAttachmentParseJobs({
      limit: 1,
      state: "pending",
    }).length > 0;
    if (hasPendingParserJob) {
      return new Date().toISOString();
    }
    const pendingEvents = await readHostedPendingParserEvidenceEvents({
      vaultRoot: input.vaultRoot,
    });
    return pendingEvents.some(({ event }) =>
      classifyHostedAssistantInputMediaSemanticState(event) === "pending"
    )
      ? new Date().toISOString()
      : null;
  } catch (error) {
    emitHostedParserMaintenanceFailure({
      error,
      memberId: input.memberId,
      operation: "continuation",
    });
    return parserRetryAt();
  } finally {
    runtime?.close();
  }
}

export async function runHostedConversationParserMaintenance(input: {
  memberId: string;
  parserToolchain: NormalizedHostedAssistantRuntimeConfig["parserToolchain"];
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<HostedConversationParserMaintenanceResult> {
  const runtime = await openInboxRuntime({ vaultRoot: input.vaultRoot });
  let progressed = runtime.requeueAttachmentParseJobs({ state: "running" }) > 0;
  try {
    throwIfHostedParserMaintenanceAborted(input.signal ?? null);
    const pendingEvents = await readHostedPendingParserEvidenceEvents({
      vaultRoot: input.vaultRoot,
    });
    const staleTerminalEvent = pendingEvents.find(({ event }) =>
      classifyHostedAssistantInputMediaSemanticState(event) === "pending"
      && event.projection.captureId !== null
      && runtime.listAttachmentParseJobs({
        captureId: event.projection.captureId,
        limit: 1,
        state: "pending",
      }).length === 0
    );
    if (staleTerminalEvent?.event.projection.captureId) {
      const updated = await refreshHostedParserAttachmentEvidence({
        event: staleTerminalEvent.event,
        terminalizeMissingParserWork: true,
        vaultRoot: input.vaultRoot,
      });
      return {
        evidenceUpdated: updated ? 1 : 0,
        nextWakeAt: updated ? new Date().toISOString() : parserRetryAt(),
        parserProcessed: 0,
        progressed: progressed || updated,
      };
    }

    const targetedEvent = pendingEvents.find(({ event }) =>
      classifyHostedAssistantInputMediaSemanticState(event) === "pending"
      && event.projection.captureId !== null
      && runtime.listAttachmentParseJobs({
        captureId: event.projection.captureId,
        limit: 1,
        state: "pending",
      }).length > 0
    )?.event ?? null;
    const captureId = targetedEvent?.projection.captureId ?? null;
    if (
      runtime.listAttachmentParseJobs({
        ...(captureId ? { captureId } : {}),
        limit: 1,
        state: "pending",
      }).length === 0
    ) {
      return {
        evidenceUpdated: 0,
        nextWakeAt: null,
        parserProcessed: 0,
        progressed,
      };
    }

    let parserService: ReturnType<typeof createInboxParserService>;
    try {
      const parserConfig = await createConfiguredParserRegistry({
        allowEnvToolchain: false,
        allowSystemToolchainLookup: false,
        readVaultToolchainConfig: false,
        ...(input.parserToolchain
          ? {
              toolchain: {
                source: "platform" as const,
                tools: input.parserToolchain.tools,
              },
            }
          : {}),
        vaultRoot: input.vaultRoot,
      });
      parserService = createInboxParserService({
        ffmpeg: parserConfig.ffmpeg,
        registry: parserConfig.registry,
        runtime,
        vaultRoot: input.vaultRoot,
      });
    } catch (error) {
      throwIfHostedParserMaintenanceAborted(input.signal ?? null);
      emitHostedParserMaintenanceFailure({
        error,
        memberId: input.memberId,
        operation: "setup",
      });
      return parserRetryResult(progressed);
    }

    let results: Awaited<ReturnType<typeof parserService.drain>>;
    try {
      results = await parserService.drain({
        ...(captureId ? { captureId } : {}),
        maxJobs: 1,
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch (error) {
      throwIfHostedParserMaintenanceAborted(input.signal ?? null);
      emitHostedParserMaintenanceFailure({
        error,
        memberId: input.memberId,
        operation: "drain",
      });
      return parserRetryResult(progressed);
    }
    progressed = progressed || results.length > 0;

    let evidenceUpdated = 0;
    if (targetedEvent && results.length > 0) {
      evidenceUpdated = await refreshHostedParserAttachmentEvidence({
        event: targetedEvent,
        vaultRoot: input.vaultRoot,
      }) ? 1 : 0;
      progressed = progressed || evidenceUpdated > 0;
    }
    const hasMorePending = runtime.listAttachmentParseJobs({
      limit: 1,
      state: "pending",
    }).length > 0;
    return {
      evidenceUpdated,
      nextWakeAt:
        hasMorePending || results.length > 0
          ? new Date().toISOString()
          : null,
      parserProcessed: results.length,
      progressed,
    };
  } finally {
    runtime.close();
  }
}

async function readHostedPendingParserEvidenceEvents(input: {
  vaultRoot: string;
}): Promise<Array<{ event: AssistantInputEventRecord }>> {
  const inputIds = (await readExistingHostedPendingAssistantInputIds(input))
    .slice(0, HOSTED_PARSER_MAINTENANCE_INPUT_LIMIT);
  const events: Array<{ event: AssistantInputEventRecord }> = [];
  for (const inputId of inputIds) {
    const event = await readAssistantInputEvent({
      inputId,
      vault: input.vaultRoot,
    });
    if (event) {
      events.push({ event });
    }
  }
  return events;
}

async function refreshHostedParserAttachmentEvidence(input: {
  event: AssistantInputEventRecord;
  terminalizeMissingParserWork?: boolean;
  vaultRoot: string;
}): Promise<boolean> {
  const captureId = input.event.projection.captureId;
  if (!captureId) {
    return false;
  }
  try {
    const shown = await createIntegratedInboxServices().show({
      captureId,
      requestId: null,
      vault: input.vaultRoot,
    });
    const refreshedEvidence = createAssistantInputAttachmentEvidenceFromInboxCapture({
      capture: {
        attachments: shown.capture.attachments,
        captureId,
      },
      descriptorAttachmentIdForAttachment: (_attachment, index) =>
        input.event.content.attachmentDescriptors[index]?.attachmentId ?? null,
      source: "local-parser-drain",
    });
    const terminalizeMissingParserWork =
      input.terminalizeMissingParserWork === true
      && classifyHostedAssistantInputMediaSemanticState({
        attachmentEvidence: refreshedEvidence,
        content: input.event.content,
      }) === "pending";
    await updateAssistantInputAttachmentEvidence({
      attachmentEvidence: terminalizeMissingParserWork
        ? {
            ...refreshedEvidence,
            attachments: refreshedEvidence.attachments.map((attachment) =>
              (attachment.kind === "audio" || attachment.kind === "video")
                && (
                  attachment.parseState === null
                  || attachment.parseState === "pending"
                  || attachment.parseState === "running"
                )
                ? { ...attachment, parseState: "unsupported" as const }
                : attachment
            ),
            reasonCode: HOSTED_PARSER_MISSING_JOB_REASON_CODE,
            status: "failed" as const,
          }
        : refreshedEvidence,
      inputId: input.event.inputId,
      vault: input.vaultRoot,
    });
    return true;
  } catch {
    return false;
  }
}

function parserRetryResult(
  progressed: boolean,
): HostedConversationParserMaintenanceResult {
  return {
    evidenceUpdated: 0,
    nextWakeAt: parserRetryAt(),
    parserProcessed: 0,
    progressed,
  };
}

function parserRetryAt(): string {
  return new Date(Date.now() + HOSTED_PARSER_MAINTENANCE_RETRY_DELAY_MS)
    .toISOString();
}

function throwIfHostedParserMaintenanceAborted(signal: AbortSignal | null): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Aborted", "AbortError");
}

function emitHostedParserMaintenanceFailure(input: {
  error: unknown;
  memberId: string;
  operation: "continuation" | "drain" | "setup";
}): void {
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(input.error);
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: {
      failureCode: `inbox_parser_${input.operation}_failed`,
      ...(typeof diagnostics?.errorCode === "string"
        ? { failureErrorCode: diagnostics.errorCode }
        : {}),
      failureErrorDetailPresent: typeof diagnostics?.errorDetail === "string",
      parserOperation: input.operation,
    },
    error: input.error,
    level: "warn",
    message: "Hosted parser maintenance failed; retrying from the durable parser queue.",
    phase: "checkpoint",
    userId: input.memberId,
  });
}
