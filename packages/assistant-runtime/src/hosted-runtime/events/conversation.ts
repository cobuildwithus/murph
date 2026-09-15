import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  deriveHostedExecutionErrorCode,
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  readHostedLinqConversationMessageAccountLookupKey,
} from "@murphai/hosted-execution";
import {
  resolveHostedEmailSelfAddresses,
} from "@murphai/hosted-execution/hosted-email";
import {
  parseHostedEmailThreadTarget,
} from "@murphai/runtime-state";
import {
  normalizeHostedEmailConversationCapture,
  normalizeHostedLinqConversationCapture,
  normalizeHostedTelegramConversationCapture,
} from "@murphai/inboxd/connectors/hosted-conversation";
import {
  createInboxPipeline,
  type PersistedCapture,
  openInboxRuntime,
} from "@murphai/inboxd/runtime";
import {
  createConfiguredParserRegistry,
  createInboxParserService,
  type PreparedAttachmentParseJob,
  type RunAttachmentParseJobResult,
} from "@murphai/parsers";

import {
  buildHostedLinqChannelEnv,
  buildHostedTelegramChannelEnv,
} from "../channel-activity.ts";
import {
  compactHostedRuntimeLogCodes,
  writeHostedRuntimeLogBestEffort,
} from "../runtime-logs.ts";
import { readHostedRawEmailMessage } from "./email.ts";
import {
  createHostedLinqAttachmentDownloadDriver,
  HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
  withHostedLinqAttachmentDownloadRetry,
} from "./linq.ts";
import {
  createHostedTelegramAttachmentDownloadDriver,
  createHostedTelegramEffectsAttachmentDownloadDriver,
  logHostedTelegramAttachmentDownloadUnavailable,
  withHostedTelegramAttachmentDownloadLogging,
  withHostedTelegramAttachmentDownloadRetry,
} from "./telegram.ts";
import type {
  HostedConversationWakeMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "../models.ts";

const HOSTED_CONVERSATION_PARSER_RETRY_DELAY_MS = 60_000;

export interface HostedConversationWakeLocalImportResult {
  capture: PersistedCapture | null;
  metrics: HostedConversationWakeMetrics;
}

export class HostedConversationInboxProjectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HostedConversationInboxProjectionError";
  }
}

export async function importHostedConversationMessageWakeIntoLocalInbox(input: {
  wake: HostedExecutionConversationMessageWake;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "forwardedEnv" | "platform" | "platformEnv" | "userEnv">
    & Partial<Pick<NormalizedHostedAssistantRuntimeConfig, "parserToolchain">>;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<HostedConversationWakeLocalImportResult> {
  if (shouldSkipHostedEmailRawInboxProjection(input.wake)) {
    return {
      capture: null,
      metrics: createHostedConversationParserMetrics(),
    };
  }

  const capture = await normalizeHostedConversationMessageWake(input);
  const runtime = await openInboxRuntime({
    vaultRoot: input.vaultRoot,
  });
  let pipeline: Awaited<ReturnType<typeof createInboxPipeline>> | null = null;

  try {
    assertHostedConversationProjectionLive(input.signal ?? null);
    pipeline = await createInboxPipeline({
      runtime,
      vaultRoot: input.vaultRoot,
    });
    assertHostedConversationProjectionLive(input.signal ?? null);
    let persistedCapture: PersistedCapture;
    try {
      persistedCapture = await pipeline.processCapture(capture);
    } catch (error) {
      if (isHostedConversationProjectionAbortError(error, input.signal ?? null)) {
        throw readHostedConversationProjectionAbortReason(error, input.signal ?? null);
      }
      throw new HostedConversationInboxProjectionError(
        "Canonical inbox capture projection failed.",
        { cause: error },
      );
    }
    assertHostedConversationProjectionLive(input.signal ?? null);
    const metrics = await drainHostedConversationParsers({
      captureId: persistedCapture.captureId,
      parserToolchain: input.runtime.parserToolchain ?? null,
      platform: input.runtime.platform,
      runtime,
      signal: input.signal ?? null,
      vaultRoot: input.vaultRoot,
    });

    return {
      capture: persistedCapture,
      metrics,
    };
  } finally {
    if (pipeline) {
      pipeline.close();
    } else {
      runtime.close();
    }
  }
}

export type HostedConversationAudioPreparationResult =
  | { status: "prepared"; result: HostedConversationWakeLocalImportResult; elapsedMs: number }
  | { status: "failed"; error: unknown; elapsedMs: number };

/** Only the mailbox owner may supply an admitted, single-audio, same-context pair. */
export async function prepareHostedConversationAudioPairIntoLocalInbox(input: {
  wakes: readonly [HostedExecutionConversationMessageWake, HostedExecutionConversationMessageWake];
  runtime: Parameters<typeof importHostedConversationMessageWakeIntoLocalInbox>[0]["runtime"];
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<{
  results: readonly [HostedConversationAudioPreparationResult, HostedConversationAudioPreparationResult | null];
  timing: {
    audioPairCount: number;
    audioPairPreparationMs: number;
    audioParsePreparationOverlapMs: number;
  };
}> {
  const signal = input.signal ?? null;
  assertHostedConversationProjectionLive(signal);
  const startedAt = Date.now();
  // Exactly two downloads, each retaining the connector's existing byte/time bounds.
  // Catch immediately: an earlier failure must still join the already-owned sibling.
  const captures = input.wakes.map((wake) =>
    normalizeHostedConversationMessageWake({ ...input, wake }).then(
      (capture) => ({ status: "prepared" as const, capture }),
      (error: unknown) => ({ status: "failed" as const, error }),
    ),
  );
  let runtime: Awaited<ReturnType<typeof openInboxRuntime>> | null = null;
  let pipeline: Awaited<ReturnType<typeof createInboxPipeline>> | null = null;
  const results: [HostedConversationAudioPreparationResult | null, HostedConversationAudioPreparationResult | null] = [null, null];
  const claimed: Array<{
    index: 0 | 1;
    capture: PersistedCapture;
    job: PreparedAttachmentParseJob;
    startedAt: number;
    readyAt: number | null;
  }> = [];
  let activeIndex: 0 | 1 = 0;
  try {
    runtime = await openInboxRuntime({ vaultRoot: input.vaultRoot });
    assertHostedConversationProjectionLive(signal);
    pipeline = await createInboxPipeline({ runtime, vaultRoot: input.vaultRoot });
    for (const index of [0, 1] as const) {
      activeIndex = index;
      assertHostedConversationProjectionLive(signal);
      const normalized = await captures[index];
      assertHostedConversationProjectionLive(signal);
      if (normalized.status === "failed") {
        results[index] = { ...normalized, elapsedMs: elapsedAudioPreparationMs(startedAt) };
        break;
      }
      let capture: PersistedCapture;
      try {
        // Never overlap raw/ledger/index mutation or allow a later raw write past a failure.
        capture = await pipeline.processCapture(normalized.capture);
      } catch (error) {
        results[index] = {
          status: "failed",
          error: new HostedConversationInboxProjectionError("Canonical inbox capture projection failed.", { cause: error }),
          elapsedMs: elapsedAudioPreparationMs(startedAt),
        };
        break;
      }
      assertHostedConversationProjectionLive(signal);
      if (!hasPendingHostedConversationMediaParseJob({ captureId: capture.captureId, runtime })) {
        results[index] = {
          status: "prepared",
          result: { capture, metrics: createHostedConversationParserMetrics() },
          elapsedMs: elapsedAudioPreparationMs(startedAt),
        };
        continue;
      }
      try {
        const service = await createHostedConversationParserService({
          parserToolchain: input.runtime.parserToolchain ?? null,
          runtime,
          vaultRoot: input.vaultRoot,
        });
        assertHostedConversationProjectionLive(signal);
        // A pair contains exactly one audio attachment per capture. Claim in order;
        // only the preparation promise runs concurrently. No cooperative parser abort.
        const parseStartedAt = Date.now();
        const job = service.prepareOnce({ captureId: capture.captureId });
        if (!job) throw new Error("Hosted audio parse job was not available for preparation.");
        const owned: (typeof claimed)[number] = { index, capture, job, startedAt: parseStartedAt, readyAt: null };
        claimed.push(owned);
        void job.ready.then(() => { owned.readyAt = Date.now(); });
      } catch (error) {
        assertHostedConversationProjectionLive(signal);
        results[index] = {
          status: "prepared",
          result: {
            capture,
            metrics: await logHostedConversationParserRetryFailure({
              captureId: capture.captureId,
              error,
              platform: input.runtime.platform,
              safeFallbackMessage: "Hosted conversation parser setup failed.",
            }),
          },
          elapsedMs: elapsedAudioPreparationMs(startedAt),
        };
        break;
      }
    }
  } catch (error) {
    if (isHostedConversationProjectionAbortError(error, signal)) {
      throw readHostedConversationProjectionAbortReason(error, signal);
    }
    results[activeIndex] = {
      status: "failed", error, elapsedMs: elapsedAudioPreparationMs(startedAt),
    };
  } finally {
    // Even on preemption or failure, finish every claim before runtime.close().
    // A completed sibling stays reusable, but this does not admit its assistant input.
    try {
      await Promise.all(captures);
      for (const owned of claimed) {
        try {
          const result = await owned.job.complete();
          if (!runtime) throw new Error("Hosted audio preparation runtime is unavailable.");
          const metrics = await reportHostedConversationParserResults({
            captureId: owned.capture.captureId,
            platform: input.runtime.platform,
            runtime,
          }, result ? [result] : []);
          results[owned.index] = {
            status: "prepared", result: { capture: owned.capture, metrics },
            elapsedMs: elapsedAudioPreparationMs(startedAt),
          };
        } catch (error) {
          results[owned.index] = {
            status: "prepared",
            result: {
              capture: owned.capture,
              metrics: await logHostedConversationParserRetryFailure({
                captureId: owned.capture.captureId, error, platform: input.runtime.platform,
                safeFallbackMessage: "Hosted conversation parser drain failed.",
              }),
            },
            elapsedMs: elapsedAudioPreparationMs(startedAt),
          };
        }
      }
    } finally {
      if (pipeline) pipeline.close();
      else runtime?.close();
    }
  }
  assertHostedConversationProjectionLive(signal);
  const first = results[0];
  if (!first) throw new Error("Hosted audio pair did not prepare its first capture.");
  return {
    results: [first, results[1]],
    timing: {
      audioPairCount: 1,
      audioPairPreparationMs: elapsedAudioPreparationMs(startedAt),
      // Intersection of artifact/parse/scratch-cleanup spans, not isolated
      // download or transcription timers. Carried on the existing import log.
      audioParsePreparationOverlapMs: readAudioParsePreparationOverlapMs(claimed),
    },
  };
}

function readAudioParsePreparationOverlapMs(
  claimed: readonly { startedAt: number; readyAt: number | null }[],
): number {
  const [left, right] = claimed;
  if (!left || !right || left.readyAt === null || right.readyAt === null) return 0;
  return Math.max(0, Math.min(left.readyAt, right.readyAt) - Math.max(left.startedAt, right.startedAt));
}

function elapsedAudioPreparationMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

async function drainHostedConversationParsers(input: {
  captureId: string;
  parserToolchain: NormalizedHostedAssistantRuntimeConfig["parserToolchain"];
  platform: Pick<NormalizedHostedAssistantRuntimeConfig["platform"], "logPort">;
  runtime: Awaited<ReturnType<typeof openInboxRuntime>>;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<HostedConversationWakeMetrics> {
  const hasPendingJob = input.runtime.listAttachmentParseJobs({
    captureId: input.captureId,
    limit: 1,
    state: "pending",
  }).length > 0;
  if (
    !hasPendingJob ||
    !hasPendingHostedConversationMediaParseJob({
      captureId: input.captureId,
      runtime: input.runtime,
    })
  ) {
    return createHostedConversationParserMetrics();
  }

  let parserService: ReturnType<typeof createInboxParserService>;
  try {
    parserService = await createHostedConversationParserService(input);
  } catch (error) {
    return await logHostedConversationParserRetryFailure({
      captureId: input.captureId,
      error,
      platform: input.platform,
      safeFallbackMessage: "Hosted conversation parser setup failed.",
    });
  }

  assertHostedConversationProjectionLive(input.signal ?? null);
  // The parser drain is not abort-safe: a cooperative abort can terminalize
  // the claimed parse job. Let the bounded parser pipeline finish, then land
  // hosted preemption at the post-drain liveness boundary.
  let results: Awaited<ReturnType<typeof parserService.drain>>;
  try {
    results = await parserService.drain({
      captureId: input.captureId,
    });
  } catch (error) {
    return await logHostedConversationParserRetryFailure({
      captureId: input.captureId,
      error,
      platform: input.platform,
      safeFallbackMessage: "Hosted conversation parser drain failed.",
    });
  }
  return await reportHostedConversationParserResults(input, results);
}

async function createHostedConversationParserService(input: {
  parserToolchain: NormalizedHostedAssistantRuntimeConfig["parserToolchain"];
  runtime: Awaited<ReturnType<typeof openInboxRuntime>>;
  vaultRoot: string;
}): Promise<ReturnType<typeof createInboxParserService>> {
  const parserConfig = await createConfiguredParserRegistry({
    ...(input.parserToolchain
      ? {
          allowEnvToolchain: false,
          allowSystemToolchainLookup: false,
          readVaultToolchainConfig: false,
          toolchain: {
            source: "platform",
            tools: input.parserToolchain.tools,
          },
        }
      : {}),
    vaultRoot: input.vaultRoot,
  });
  return createInboxParserService({
    ffmpeg: parserConfig.ffmpeg,
    registry: parserConfig.registry,
    runtime: input.runtime,
    vaultRoot: input.vaultRoot,
  });
}

async function reportHostedConversationParserResults(input: {
  captureId: string;
  platform: Pick<NormalizedHostedAssistantRuntimeConfig["platform"], "logPort">;
  runtime: Awaited<ReturnType<typeof openInboxRuntime>>;
  signal?: AbortSignal | null;
}, results: readonly RunAttachmentParseJobResult[]): Promise<HostedConversationWakeMetrics> {
  const failedResults = results.filter((result) => result.status === "failed");
  const observedFailedJobs = input.runtime.listAttachmentParseJobs({
    captureId: input.captureId,
    state: "failed",
  });
  const parserFailures = collectHostedParserFailures({
    failedJobs: observedFailedJobs,
    failedResults,
  });
  if (parserFailures.length > 0) {
    await writeHostedRuntimeLogBestEffort({
      entry: {
        component: "mailbox",
        errorCode: "parser_jobs_failed",
        eventCode: "mailbox.parser_jobs_failed",
        level: "warn",
        phase: "import",
        redactedJson: {
          captureIdPresent: Boolean(input.captureId),
          errorCode: "parser_jobs_failed",
          errorCodes: compactHostedRuntimeLogCodes(
            parserFailures.map((failure) => failure.errorCode ?? "parser_failed"),
          ),
          nextWakeAtPresent: false,
          safeErrorMessage: "One or more hosted conversation parser jobs failed.",
          parserFailed: parserFailures.length,
          parserObservedFailedJobs: observedFailedJobs.length,
          parserProcessed: results.length,
          parserSucceeded: results.length - failedResults.length,
        },
      },
      platform: input.platform,
    });
  }
  // Failed-job warnings are durable once drained, so emit them before landing
  // a hosted preemption abort: a retried import skips drain when no jobs are
  // pending and would otherwise never log these terminal parser failures.
  assertHostedConversationProjectionLive(input.signal ?? null);
  return createHostedConversationParserMetrics({
    nextWakeAt: null,
    parserProcessed: results.length,
  });
}

async function logHostedConversationParserRetryFailure(input: {
  captureId: string;
  error: unknown;
  platform: Pick<NormalizedHostedAssistantRuntimeConfig["platform"], "logPort">;
  safeFallbackMessage: string;
}): Promise<HostedConversationWakeMetrics> {
  const errorCode = deriveHostedExecutionErrorCode(input.error);
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(input.error);
  const nextWakeAt = new Date(Date.now() + HOSTED_CONVERSATION_PARSER_RETRY_DELAY_MS)
    .toISOString();
  await writeHostedRuntimeLogBestEffort({
    entry: {
      component: "mailbox",
      errorCode,
      eventCode: "mailbox.parser_drain_failed",
      level: "warn",
      phase: "import",
      redactedJson: {
        captureIdPresent: Boolean(input.captureId),
        errorCode,
        nextWakeAtPresent: true,
        parserTerminalizedPendingJobs: 0,
        safeErrorMessage:
          typeof diagnostics?.errorMessage === "string"
            ? diagnostics.errorMessage
            : input.safeFallbackMessage,
      },
    },
    platform: input.platform,
  });
  return createHostedConversationParserMetrics({
    nextWakeAt,
  });
}

function assertHostedConversationProjectionLive(signal: AbortSignal | null): void {
  if (signal?.aborted) {
    throw readHostedConversationProjectionAbortReason(
      new DOMException("Aborted", "AbortError"),
      signal,
    );
  }
}

function isHostedConversationProjectionAbortError(
  error: unknown,
  signal: AbortSignal | null,
): boolean {
  return signal?.aborted === true
    || (
      error instanceof DOMException
      && error.name === "AbortError"
    )
    || (
      error instanceof Error
      && error.name === "AbortError"
    );
}

function readHostedConversationProjectionAbortReason(
  error: unknown,
  signal: AbortSignal | null,
): unknown {
  return signal?.reason ?? error;
}

function createHostedConversationParserMetrics(input: {
  nextWakeAt?: string | null;
  parserProcessed?: number;
} = {}): HostedConversationWakeMetrics {
  return {
    nextWakeAt: input.nextWakeAt ?? null,
    parserProcessed: input.parserProcessed ?? 0,
  };
}

interface HostedParserFailureLogItem {
  errorCode?: string | null;
  jobId: string;
}

function collectHostedParserFailures(input: {
  failedJobs: readonly HostedParserFailureLogItem[];
  failedResults: ReadonlyArray<{
    errorCode?: string | null;
    job: HostedParserFailureLogItem;
  }>;
}): HostedParserFailureLogItem[] {
  const failuresByJobId = new Map<string, HostedParserFailureLogItem>();
  for (const result of input.failedResults) {
    failuresByJobId.set(result.job.jobId, {
      errorCode: result.errorCode ?? result.job.errorCode ?? null,
      jobId: result.job.jobId,
    });
  }
  for (const job of input.failedJobs) {
    if (!failuresByJobId.has(job.jobId)) {
      failuresByJobId.set(job.jobId, job);
    }
  }

  return [...failuresByJobId.values()];
}

function hasPendingHostedConversationMediaParseJob(input: {
  captureId: string;
  runtime: Awaited<ReturnType<typeof openInboxRuntime>>;
}): boolean {
  const capture = input.runtime.getCapture(input.captureId);
  if (!capture) {
    return false;
  }

  return capture.attachments.some((attachment) => {
    if (attachment.kind !== "audio" && attachment.kind !== "video") {
      return false;
    }
    return input.runtime.listAttachmentParseJobs({
      attachmentId: attachment.attachmentId,
      captureId: input.captureId,
      limit: 1,
      state: "pending",
    }).length > 0;
  });
}

async function normalizeHostedConversationMessageWake(input: {
  wake: HostedExecutionConversationMessageWake;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "forwardedEnv" | "platform" | "platformEnv" | "userEnv">
    & Partial<Pick<NormalizedHostedAssistantRuntimeConfig, "parserToolchain">>;
  signal?: AbortSignal | null;
}) {
  if (isHostedLinqConversationMessageWake(input.wake)) {
    return normalizeHostedLinqConversationCapture({
      accountId: readHostedLinqConversationMessageAccountLookupKey(input.wake.message),
      attachmentDownloadTimeoutMs: HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
      downloadDriver: withHostedLinqAttachmentDownloadRetry(
        createHostedLinqAttachmentDownloadDriver({
          env: buildHostedLinqAttachmentDownloadEnv(input.runtime),
          platform: input.runtime.platform,
        }),
      ),
      linqMessage: input.wake.message.linqMessage,
      occurredAt: input.wake.occurredAt,
      signal: input.signal ?? undefined,
    });
  }

  if (isHostedTelegramConversationMessageWake(input.wake)) {
    const downloadDriver =
      createHostedTelegramEffectsAttachmentDownloadDriver({
        effectsPort: input.runtime.platform.effectsPort,
      })
      ?? createHostedTelegramAttachmentDownloadDriver({
        env: buildHostedTelegramChannelEnv({
          forwardedEnv: input.runtime.forwardedEnv,
          platformEnv: input.runtime.platformEnv,
        }),
        fetchImplementation: input.runtime.platform.providerFetch ?? null,
      });
    if (
      !downloadDriver
      && (input.wake.message.telegramMessage.attachments?.length ?? 0) > 0
    ) {
      await logHostedTelegramAttachmentDownloadUnavailable(input.runtime.platform);
    }

    return normalizeHostedTelegramConversationCapture({
      accountId: "bot",
      downloadDriver: withHostedTelegramAttachmentDownloadLogging(
        withHostedTelegramAttachmentDownloadRetry(downloadDriver),
        input.runtime.platform,
      ),
      externalId: input.wake.eventId,
      message: input.wake.message.telegramMessage,
      occurredAt: input.wake.occurredAt,
      receivedAt: input.wake.occurredAt,
      signal: input.signal ?? undefined,
    });
  }

  if (isHostedEmailConversationMessageWake(input.wake)) {
    const bytes = await readHostedRawEmailMessage(
      input.wake,
      input.runtime.platform.effectsPort,
    );

    return normalizeHostedEmailConversationCapture({
      accountAddress: input.wake.message.identityId,
      accountId: input.wake.message.identityId,
      rawMessage: bytes,
      selfAddresses: resolveHostedEmailSelfAddresses({
        extra: [input.wake.message.selfAddress],
        senderIdentity: input.wake.message.identityId,
      }),
      source: "email",
      threadIsDirect: input.wake.message.threadIsDirect,
      threadTarget: input.wake.message.threadTarget ?? null,
    });
  }

  throw new TypeError("Unsupported hosted conversation message wake kind.");
}

function shouldSkipHostedEmailRawInboxProjection(
  wake: HostedExecutionConversationMessageWake,
): boolean {
  if (!isHostedEmailConversationMessageWake(wake)) {
    return false;
  }

  const threadTarget = wake.message.threadTarget?.trim() ?? "";
  if (!threadTarget) {
    return false;
  }

  // Group email prompt fields are already minimized on the Worker path; raw
  // .eml bytes can carry group addresses, subjects, bodies, and quoted
  // headers. Threading uses threadTarget, so the runtime vault does not need a
  // raw inbox projection for group-routed email wakes.
  return parseHostedEmailThreadTarget(threadTarget)?.targetKind === "group";
}

function buildHostedLinqAttachmentDownloadEnv(input: Pick<
  NormalizedHostedAssistantRuntimeConfig,
  "forwardedEnv" | "platformEnv" | "userEnv"
>): Record<string, string> {
  const env = buildHostedLinqChannelEnv({
    forwardedEnv: input.forwardedEnv,
    userEnv: input.userEnv,
  });
  const cdnBaseUrl =
    readHostedLinqAttachmentEnvValue(input.forwardedEnv, "LINQ_ATTACHMENT_CDN_BASE_URL")
    ?? readHostedLinqAttachmentEnvValue(input.platformEnv, "LINQ_ATTACHMENT_CDN_BASE_URL");
  if (cdnBaseUrl) {
    env.LINQ_ATTACHMENT_CDN_BASE_URL = cdnBaseUrl;
  }
  return env;
}

function readHostedLinqAttachmentEnvValue(
  env: Readonly<Record<string, string>> | undefined,
  key: string,
): string | null {
  const value = env?.[key]?.trim();
  return value ? value : null;
}
