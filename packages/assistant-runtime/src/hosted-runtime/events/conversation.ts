import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  deriveHostedExecutionErrorCode,
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  isHostedWhatsAppConversationMessageWake,
  readHostedLinqConversationMessageAccountLookupKey,
} from "@murphai/hosted-execution";
import {
  resolveHostedEmailSelfAddresses,
} from "@murphai/hosted-execution/hosted-email";
import {
  normalizeHostedEmailConversationCapture,
  normalizeHostedLinqConversationCapture,
  normalizeHostedTelegramConversationCapture,
  normalizeHostedWhatsAppConversationCapture,
} from "@murphai/inboxd/connectors/hosted-conversation";
import {
  createInboxPipeline,
  type PersistedCapture,
  openInboxRuntime,
} from "@murphai/inboxd";
import {
  createConfiguredParserRegistry,
  createInboxParserService,
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
  capture: PersistedCapture;
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
  const capture = await normalizeHostedConversationMessageWake(input);
  const runtime = await openInboxRuntime({
    vaultRoot: input.vaultRoot,
  });
  let pipeline: Awaited<ReturnType<typeof createInboxPipeline>> | null = null;

  try {
    pipeline = await createInboxPipeline({
      runtime,
      vaultRoot: input.vaultRoot,
    });
    let persistedCapture: PersistedCapture;
    try {
      persistedCapture = await pipeline.processCapture(capture);
    } catch (error) {
      throw new HostedConversationInboxProjectionError(
        "Canonical inbox capture projection failed.",
        { cause: error },
      );
    }
    const metrics = await drainHostedConversationParsers({
      captureId: persistedCapture.captureId,
      parserToolchain: input.runtime.parserToolchain ?? null,
      platform: input.runtime.platform,
      runtime,
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

async function drainHostedConversationParsers(input: {
  captureId: string;
  parserToolchain: NormalizedHostedAssistantRuntimeConfig["parserToolchain"];
  platform: Pick<NormalizedHostedAssistantRuntimeConfig["platform"], "logPort">;
  runtime: Awaited<ReturnType<typeof openInboxRuntime>>;
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
    parserService = createInboxParserService({
      ffmpeg: parserConfig.ffmpeg,
      registry: parserConfig.registry,
      runtime: input.runtime,
      vaultRoot: input.vaultRoot,
    });
  } catch (error) {
    return await logHostedConversationParserRetryFailure({
      captureId: input.captureId,
      error,
      platform: input.platform,
      safeFallbackMessage: "Hosted conversation parser setup failed.",
    });
  }

  try {
    const results = await parserService.drain({
      captureId: input.captureId,
    });
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
    return createHostedConversationParserMetrics({
      nextWakeAt: null,
      parserProcessed: results.length,
    });
  } catch (error) {
    return await logHostedConversationParserRetryFailure({
      captureId: input.captureId,
      error,
      platform: input.platform,
      safeFallbackMessage: "Hosted conversation parser drain failed.",
    });
  }
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
      downloadDriver: createHostedLinqAttachmentDownloadDriver({
        env: buildHostedLinqAttachmentDownloadEnv(input.runtime),
        platform: input.runtime.platform,
      }),
      linqMessage: input.wake.message.linqMessage,
      occurredAt: input.wake.occurredAt,
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
      threadTarget: input.wake.message.threadTarget ?? null,
    });
  }

  if (isHostedWhatsAppConversationMessageWake(input.wake)) {
    return normalizeHostedWhatsAppConversationCapture({
      accountId: input.wake.message.whatsappMessage.phoneNumberId ?? "cloud-api",
      externalId: input.wake.eventId,
      message: input.wake.message.whatsappMessage,
      occurredAt: input.wake.occurredAt,
      receivedAt: input.wake.occurredAt,
    });
  }

  throw new TypeError("Unsupported hosted conversation message wake kind.");
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
