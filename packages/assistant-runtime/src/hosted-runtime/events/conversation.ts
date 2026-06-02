import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution";
import {
  deriveHostedExecutionErrorCode,
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  isHostedWhatsAppConversationMessageWake,
  readHostedLinqConversationMessageContact,
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
} from "./telegram.ts";
import type {
  HostedConversationWakeMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "../models.ts";

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
    const parserProcessed = await drainHostedConversationParsers({
      captureId: persistedCapture.captureId,
      parserToolchain: input.runtime.parserToolchain ?? null,
      platform: input.runtime.platform,
      runtime,
      vaultRoot: input.vaultRoot,
    });

    const metrics: HostedConversationWakeMetrics = {
      nextWakeAt: null,
      parserProcessed,
    };
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
}): Promise<number> {
  const pendingJobs = input.runtime.listAttachmentParseJobs({
    captureId: input.captureId,
    limit: 1,
    state: "pending",
  });
  if (pendingJobs.length === 0) {
    return 0;
  }

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
    const parserService = createInboxParserService({
      ffmpeg: parserConfig.ffmpeg,
      registry: parserConfig.registry,
      runtime: input.runtime,
      vaultRoot: input.vaultRoot,
    });
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
          eventCode: "mailbox.parser_jobs_failed",
          level: "warn",
          phase: "import",
          redactedJson: {
            captureIdPresent: Boolean(input.captureId),
            errorCodes: compactHostedRuntimeLogCodes(
              parserFailures.map((failure) => failure.errorCode ?? "parser_failed"),
            ),
            parserFailed: parserFailures.length,
            parserObservedFailedJobs: observedFailedJobs.length,
            parserProcessed: results.length,
            parserSucceeded: results.length - failedResults.length,
          },
        },
        platform: input.platform,
      });
    }
    return results.length;
  } catch (error) {
    const errorCode = deriveHostedExecutionErrorCode(error);
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
        },
      },
      platform: input.platform,
    });
    return 0;
  }
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

async function normalizeHostedConversationMessageWake(input: {
  wake: HostedExecutionConversationMessageWake;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "forwardedEnv" | "platform" | "platformEnv" | "userEnv">
    & Partial<Pick<NormalizedHostedAssistantRuntimeConfig, "parserToolchain">>;
}) {
  if (isHostedLinqConversationMessageWake(input.wake)) {
    const contact = readHostedLinqConversationMessageContact(input.wake.message);
    return normalizeHostedLinqConversationCapture({
      accountId: contact.lookupKey,
      attachmentDownloadTimeoutMs: HOSTED_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
      downloadDriver: createHostedLinqAttachmentDownloadDriver({
        platform: input.runtime.platform,
      }),
      linqMessage: input.wake.message.linqMessage,
      occurredAt: input.wake.occurredAt,
    });
  }

  if (isHostedTelegramConversationMessageWake(input.wake)) {
    return normalizeHostedTelegramConversationCapture({
      accountId: "bot",
      downloadDriver:
        createHostedTelegramEffectsAttachmentDownloadDriver({
          effectsPort: input.runtime.platform.effectsPort,
        })
        ?? createHostedTelegramAttachmentDownloadDriver({
          env: buildHostedTelegramChannelEnv({
            forwardedEnv: input.runtime.forwardedEnv,
            platformEnv: input.runtime.platformEnv,
          }),
          fetchImplementation: input.runtime.platform.providerFetch ?? null,
        }),
      externalId: input.wake.eventId,
      message: input.wake.message.telegramMessage,
      occurredAt: input.wake.occurredAt,
      receivedAt: input.wake.occurredAt,
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
