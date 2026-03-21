import {
  type InboxBackfillResult,
  type InboxDoctorCheck,
  type InboxDoctorResult,
  type InboxParserToolStatus,
  type InboxParserToolchainStatus,
} from '../inbox-cli-contracts.js'
import { VaultCliError } from '../vault-cli-errors.js'
import type {
  InboxParserServiceRuntime,
  ParserDoctorRuntimeReport,
  ParserRuntimeDrainResult,
  ParserToolRuntimeStatus,
  ParsersRuntimeModule,
  RuntimeAttachmentParseJobRecord,
  RuntimeAttachmentRecord,
  RuntimeStore,
} from '../inbox-services.js'
import {
  isParseableAttachment,
  normalizeVaultPathOutput,
  passCheck,
  redactSensitivePath,
  resolveAttachmentParseState,
  warnCheck,
} from './shared.js'

export async function createParserServiceContext(
  vaultRoot: string,
  runtime: RuntimeStore,
  parsers: ParsersRuntimeModule,
): Promise<InboxParserServiceRuntime> {
  const configured = await parsers.createConfiguredParserRegistry({
    vaultRoot,
  })

  return parsers.createInboxParserService({
    vaultRoot,
    runtime,
    registry: configured.registry,
    ffmpeg: configured.ffmpeg,
  })
}

export function summarizeParserDrain(
  vaultRoot: string,
  results: ParserRuntimeDrainResult[],
): NonNullable<InboxBackfillResult['parse']> {
  return {
    attempted: results.length,
    succeeded: results.filter((result) => result.status === 'succeeded').length,
    failed: results.filter((result) => result.status === 'failed').length,
    results: results.map((result) => ({
      captureId: result.job.captureId,
      attachmentId: result.job.attachmentId,
      status: result.status,
      providerId: result.providerId ?? null,
      manifestPath: result.manifestPath
        ? normalizeVaultPathOutput(vaultRoot, result.manifestPath)
        : null,
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage ?? null,
    })),
  }
}

export function assertBootstrapStrictReady(
  doctor: InboxDoctorResult,
): void {
  const blockingChecks = doctor.checks.filter((check) => {
    if (check.status === 'fail') {
      return true
    }

    return check.name === 'parser-runtime'
  })
  const unavailableConfiguredTools = doctor.parserToolchain
    ? Object.entries(doctor.parserToolchain.tools).flatMap(([name, tool]) =>
        tool.source === 'config' && !tool.available
          ? [`${name}: ${tool.reason}`]
          : [],
      )
    : ['parser toolchain discovery did not return structured tool status']

  if (blockingChecks.length === 0 && unavailableConfiguredTools.length === 0) {
    return
  }

  throw new VaultCliError(
    'INBOX_BOOTSTRAP_STRICT_FAILED',
    'Inbox bootstrap strict readiness checks failed.',
    {
      blockingChecks: blockingChecks.map((check) => ({
        name: check.name,
        status: check.status,
        message: check.message,
      })),
      unavailableConfiguredTools,
    },
  )
}

export function toCliParserToolchain(
  vaultRoot: string,
  doctor: ParserDoctorRuntimeReport,
): InboxParserToolchainStatus {
  return {
    configPath: normalizeVaultPathOutput(vaultRoot, doctor.configPath),
    discoveredAt: doctor.discoveredAt,
    tools: {
      ffmpeg: toCliParserToolStatus(doctor.tools.ffmpeg),
      pdftotext: toCliParserToolStatus(doctor.tools.pdftotext),
      whisper: {
        ...toCliParserToolStatus(doctor.tools.whisper),
        modelPath: redactSensitivePath(doctor.tools.whisper.modelPath),
      },
      paddleocr: toCliParserToolStatus(doctor.tools.paddleocr),
    },
  }
}

export function toParserToolChecks(
  tools: ParserDoctorRuntimeReport['tools'],
): InboxDoctorCheck[] {
  return [
    toParserToolCheck('ffmpeg', tools.ffmpeg),
    toParserToolCheck('pdftotext', tools.pdftotext),
    toParserToolCheck('whisper', tools.whisper),
    toParserToolCheck('paddleocr', tools.paddleocr),
  ]
}

export function requireAttachmentParseJobs(
  runtime: RuntimeStore,
  action: 'show status' | 'parse' | 'reparse',
): NonNullable<RuntimeStore['listAttachmentParseJobs']> {
  if (!runtime.listAttachmentParseJobs) {
    throw unsupportedAttachmentParse(action)
  }

  return runtime.listAttachmentParseJobs
}

export function requireAttachmentReparseSupport(
  runtime: RuntimeStore,
): {
  listAttachmentParseJobs: NonNullable<RuntimeStore['listAttachmentParseJobs']>
  requeueAttachmentParseJobs: NonNullable<RuntimeStore['requeueAttachmentParseJobs']>
} {
  if (!runtime.listAttachmentParseJobs || !runtime.requeueAttachmentParseJobs) {
    throw unsupportedAttachmentParse('reparse')
  }

  return {
    listAttachmentParseJobs: runtime.listAttachmentParseJobs,
    requeueAttachmentParseJobs: runtime.requeueAttachmentParseJobs,
  }
}

export function buildAttachmentParseStatus(input: {
  runtime: RuntimeStore
  listAttachmentParseJobs: NonNullable<RuntimeStore['listAttachmentParseJobs']>
  captureId: string
  attachmentId: string
  fallbackAttachment: RuntimeAttachmentRecord
}) {
  const jobs = input.listAttachmentParseJobs({
    attachmentId: input.attachmentId,
    limit: 20,
  })
  const attachment = refreshAttachmentForCapture(
    input.runtime,
    input.captureId,
    input.attachmentId,
    input.fallbackAttachment,
  )

  return {
    currentState: resolveAttachmentParseState(attachment, jobs),
    jobs: jobs.map(toCliAttachmentParseJob),
  }
}

function refreshAttachmentForCapture(
  runtime: RuntimeStore,
  captureId: string,
  attachmentId: string,
  fallbackAttachment: RuntimeAttachmentRecord,
): RuntimeAttachmentRecord {
  return (
    runtime
      .getCapture(captureId)
      ?.attachments.find(
        (attachment) => attachment.attachmentId === attachmentId,
      ) ?? fallbackAttachment
  )
}

function toCliAttachmentParseJob(job: RuntimeAttachmentParseJobRecord) {
  return {
    jobId: job.jobId,
    captureId: job.captureId,
    attachmentId: job.attachmentId,
    pipeline: job.pipeline,
    state: job.state,
    attempts: job.attempts,
    providerId: job.providerId ?? null,
    resultPath: job.resultPath ?? null,
    errorCode: job.errorCode ?? null,
    errorMessage: job.errorMessage ?? null,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
  }
}

function toCliParserToolStatus(
  tool: ParserToolRuntimeStatus,
): InboxParserToolStatus {
  return {
    available: tool.available,
    command: redactSensitivePath(tool.command),
    modelPath:
      tool.modelPath === undefined ? undefined : redactSensitivePath(tool.modelPath),
    source: tool.source,
    reason: tool.reason,
  }
}

function toParserToolCheck(
  name: keyof ParserDoctorRuntimeReport['tools'],
  tool: ParserToolRuntimeStatus,
): InboxDoctorCheck {
  const details: Record<string, unknown> = {
    source: tool.source,
  }

  const command = redactSensitivePath(tool.command)
  if (command) {
    details.command = command
  }

  if (tool.modelPath !== undefined) {
    details.modelPath = redactSensitivePath(tool.modelPath)
  }

  return tool.available
    ? passCheck(`parser-${name}`, tool.reason, details)
    : warnCheck(`parser-${name}`, tool.reason, details)
}

function unsupportedAttachmentParse(
  action: 'show status' | 'parse' | 'reparse',
): VaultCliError {
  return new VaultCliError(
    'INBOX_ATTACHMENT_PARSE_UNSUPPORTED',
    `Attachment parse ${action} is not available through the current inbox runtime boundary.`,
  )
}

export { isParseableAttachment }
