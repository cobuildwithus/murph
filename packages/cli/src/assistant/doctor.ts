import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantAutomationStateSchema,
  assistantDiagnosticsSnapshotSchema,
  assistantDoctorResultSchema,
  assistantFailoverStateSchema,
  assistantOutboxIntentSchema,
  assistantSessionSchema,
  assistantStatusResultSchema,
  assistantTranscriptEntrySchema,
  assistantTurnReceiptSchema,
  type AssistantDoctorCheck,
  type AssistantDoctorCheckStatus,
  type AssistantDoctorResult,
  type AssistantOutboxIntent,
  type AssistantTurnReceipt,
} from '../assistant-cli-contracts.js'
import { isMissingFileError } from './shared.js'
import { redactAssistantDisplayPath } from './store.js'
import { resolveAssistantStatePaths } from './store/paths.js'

const STALE_OUTBOX_INTENT_MS = 15 * 60 * 1000

export async function runAssistantDoctor(vault: string): Promise<AssistantDoctorResult> {
  const paths = resolveAssistantStatePaths(vault)
  const sessionScan = await scanSessionFiles(paths.sessionsDirectory)
  const automationScan = await scanJsonFile(paths.automationPath, assistantAutomationStateSchema)
  const transcriptScan = await scanTranscriptFiles(paths.transcriptsDirectory)
  const receiptScan = await scanTurnReceiptFiles(paths.turnsDirectory)
  const outboxScan = await scanOutboxFiles(paths.outboxDirectory)
  const diagnosticsScan = await scanJsonFile(
    paths.diagnosticSnapshotPath,
    assistantDiagnosticsSnapshotSchema,
  )
  const failoverScan = await scanJsonFile(paths.failoverStatePath, assistantFailoverStateSchema)
  const statusScan = await scanJsonFile(paths.statusPath, assistantStatusResultSchema)
  const sessionIds = new Set(sessionScan.sessions.map((session) => session.sessionId))
  const outboxIntentIds = new Set(outboxScan.intents.map((intent) => intent.intentId))

  const transcriptOrphans = transcriptScan.sessionIds.filter(
    (sessionId) => !sessionIds.has(sessionId),
  )
  const receiptOrphans = receiptScan.receipts.filter(
    (receipt) => !sessionIds.has(receipt.sessionId),
  )
  const missingOutboxLinks = receiptScan.receipts.filter(
    (receipt) =>
      typeof receipt.deliveryIntentId === 'string' &&
      receipt.deliveryIntentId.length > 0 &&
      !outboxIntentIds.has(receipt.deliveryIntentId),
  )

  const checks: AssistantDoctorCheck[] = [
    createDoctorCheck({
      details: {
        parseErrors: sessionScan.parseErrors,
        sessions: sessionScan.sessions.length,
      },
      message:
        sessionScan.parseErrors === 0
          ? `${sessionScan.sessions.length} assistant session file(s) parsed cleanly.`
          : `${sessionScan.parseErrors} assistant session file(s) could not be parsed.`,
      name: 'session-files',
      status: sessionScan.parseErrors === 0 ? 'pass' : 'fail',
    }),
    createDoctorCheck({
      details: {
        present: automationScan.present,
        parseError: automationScan.parseError,
      },
      message:
        !automationScan.present
          ? 'assistant automation state has not been initialized yet.'
          : automationScan.parseError
            ? 'assistant automation state could not be parsed.'
            : 'assistant automation state parsed cleanly.',
      name: 'automation-state',
      status: automationScan.parseError ? 'fail' : 'pass',
    }),
    createDoctorCheck({
      details: {
        malformedLines: transcriptScan.malformedLines,
        orphanedTranscripts: transcriptOrphans.length,
        transcriptFiles: transcriptScan.fileCount,
      },
      message:
        transcriptScan.malformedLines > 0
          ? `${transcriptScan.malformedLines} malformed transcript line(s) detected across ${transcriptScan.fileCount} transcript file(s).`
          : transcriptOrphans.length > 0
            ? `${transcriptOrphans.length} transcript file(s) do not have a matching session record.`
            : `${transcriptScan.fileCount} transcript file(s) look healthy.`,
      name: 'transcript-files',
      status:
        transcriptScan.malformedLines > 0
          ? 'fail'
          : transcriptOrphans.length > 0
            ? 'warn'
            : 'pass',
    }),
    createDoctorCheck({
      details: {
        orphanedReceipts: receiptOrphans.length,
        parseErrors: receiptScan.parseErrors,
        receiptFiles: receiptScan.fileCount,
      },
      message:
        receiptScan.parseErrors > 0
          ? `${receiptScan.parseErrors} turn receipt file(s) could not be parsed.`
          : receiptOrphans.length > 0
            ? `${receiptOrphans.length} turn receipt file(s) reference missing sessions.`
            : `${receiptScan.fileCount} turn receipt file(s) parsed cleanly.`,
      name: 'turn-receipts',
      status:
        receiptScan.parseErrors > 0
          ? 'fail'
          : receiptOrphans.length > 0
            ? 'warn'
            : 'pass',
    }),
    createDoctorCheck({
      details: {
        parseErrors: outboxScan.parseErrors,
        staleOpenIntents: outboxScan.staleOpenIntents.length,
        totalIntents: outboxScan.intents.length,
      },
      message:
        outboxScan.parseErrors > 0
          ? `${outboxScan.parseErrors} outbox intent file(s) could not be parsed.`
          : outboxScan.staleOpenIntents.length > 0
            ? `${outboxScan.staleOpenIntents.length} outbox intent(s) are still pending, retryable, or sending after ${Math.trunc(STALE_OUTBOX_INTENT_MS / 60000)} minutes.`
            : `${outboxScan.intents.length} outbox intent(s) look healthy.`,
      name: 'outbox-intents',
      status:
        outboxScan.parseErrors > 0
          ? 'fail'
          : outboxScan.staleOpenIntents.length > 0
            ? 'warn'
            : 'pass',
    }),
    createDoctorCheck({
      details: {
        missingOutboxLinks: missingOutboxLinks.length,
      },
      message:
        missingOutboxLinks.length > 0
          ? `${missingOutboxLinks.length} turn receipt(s) reference a missing outbox intent.`
          : 'All receipt-to-outbox links resolve cleanly.',
      name: 'receipt-outbox-links',
      status: missingOutboxLinks.length > 0 ? 'warn' : 'pass',
    }),
    createDoctorCheck({
      details: {
        present: diagnosticsScan.present,
        parseError: diagnosticsScan.parseError,
      },
      message:
        !diagnosticsScan.present
          ? 'assistant diagnostics snapshot has not been written yet.'
          : diagnosticsScan.parseError
            ? 'assistant diagnostics snapshot could not be parsed.'
            : 'assistant diagnostics snapshot parsed cleanly.',
      name: 'diagnostics-snapshot',
      status: diagnosticsScan.parseError ? 'fail' : 'pass',
    }),
    createDoctorCheck({
      details: {
        present: failoverScan.present,
        parseError: failoverScan.parseError,
      },
      message:
        !failoverScan.present
          ? 'assistant failover state has not been written yet.'
          : failoverScan.parseError
            ? 'assistant failover state could not be parsed.'
            : 'assistant failover state parsed cleanly.',
      name: 'failover-state',
      status: failoverScan.parseError ? 'fail' : 'pass',
    }),
    createDoctorCheck({
      details: {
        present: statusScan.present,
        parseError: statusScan.parseError,
      },
      message:
        !statusScan.present
          ? 'assistant status snapshot has not been written yet.'
          : statusScan.parseError
            ? 'assistant status snapshot could not be parsed.'
            : 'assistant status snapshot parsed cleanly.',
      name: 'status-snapshot',
      status: statusScan.parseError ? 'fail' : 'pass',
    }),
  ]

  return assistantDoctorResultSchema.parse({
    vault: redactAssistantDisplayPath(vault),
    stateRoot: redactAssistantDisplayPath(paths.assistantStateRoot),
    ok: !checks.some((check) => check.status === 'fail'),
    sessionCount: sessionScan.sessions.length,
    transcriptFileCount: transcriptScan.fileCount,
    receiptCount: receiptScan.fileCount,
    outboxIntentCount: outboxScan.intents.length,
    checks,
  })
}

function createDoctorCheck(input: {
  details?: Record<string, unknown>
  message: string
  name: string
  status: AssistantDoctorCheckStatus
}): AssistantDoctorCheck {
  return {
    name: input.name,
    status: input.status,
    message: input.message,
    details: input.details,
  }
}

async function scanJsonFile<T>(
  filePath: string,
  schema: { parse(input: unknown): T },
): Promise<{
  parseError: boolean
  present: boolean
}> {
  try {
    const raw = await readFile(filePath, 'utf8')
    schema.parse(JSON.parse(raw) as unknown)
    return {
      parseError: false,
      present: true,
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        parseError: false,
        present: false,
      }
    }

    return {
      parseError: true,
      present: true,
    }
  }
}

async function scanSessionFiles(directory: string): Promise<{
  parseErrors: number
  sessions: Array<{ sessionId: string }>
}> {
  const entries = await readDirectoryFiles(directory)
  const sessions: Array<{ sessionId: string }> = []
  let parseErrors = 0

  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue
    }
    const filePath = path.join(directory, entry)
    try {
      const raw = await readFile(filePath, 'utf8')
      const session = assistantSessionSchema.parse(JSON.parse(raw) as unknown)
      sessions.push({ sessionId: session.sessionId })
    } catch {
      parseErrors += 1
    }
  }

  return {
    parseErrors,
    sessions,
  }
}

async function scanTranscriptFiles(directory: string): Promise<{
  fileCount: number
  malformedLines: number
  sessionIds: string[]
}> {
  const entries = await readDirectoryFiles(directory)
  let malformedLines = 0
  let fileCount = 0
  const sessionIds: string[] = []

  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) {
      continue
    }
    fileCount += 1
    const filePath = path.join(directory, entry)
    sessionIds.push(entry.replace(/\.jsonl$/u, ''))
    try {
      const raw = await readFile(filePath, 'utf8')
      const lines = raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
      for (const line of lines) {
        try {
          assistantTranscriptEntrySchema.parse(JSON.parse(line) as unknown)
        } catch {
          malformedLines += 1
        }
      }
    } catch {
      malformedLines += 1
    }
  }

  return {
    fileCount,
    malformedLines,
    sessionIds,
  }
}

async function scanTurnReceiptFiles(directory: string): Promise<{
  fileCount: number
  parseErrors: number
  receipts: AssistantTurnReceipt[]
}> {
  const files = await readDirectoryFiles(directory)
  const receipts: AssistantTurnReceipt[] = []
  let fileCount = 0
  let parseErrors = 0

  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue
    }
    fileCount += 1
    try {
      const raw = await readFile(path.join(directory, file), 'utf8')
      receipts.push(assistantTurnReceiptSchema.parse(JSON.parse(raw) as unknown))
    } catch {
      parseErrors += 1
    }
  }

  return {
    fileCount,
    parseErrors,
    receipts,
  }
}

async function scanOutboxFiles(directory: string): Promise<{
  intents: AssistantOutboxIntent[]
  parseErrors: number
  staleOpenIntents: AssistantOutboxIntent[]
}> {
  const files = await readDirectoryFiles(directory)
  const intents: AssistantOutboxIntent[] = []
  let parseErrors = 0

  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue
    }
    try {
      const raw = await readFile(path.join(directory, file), 'utf8')
      intents.push(assistantOutboxIntentSchema.parse(JSON.parse(raw) as unknown))
    } catch {
      parseErrors += 1
    }
  }

  return {
    intents,
    parseErrors,
    staleOpenIntents: intents.filter((intent) => isStaleOutboxIntent(intent)),
  }
}

function isStaleOutboxIntent(intent: AssistantOutboxIntent): boolean {
  if (
    intent.status !== 'pending' &&
    intent.status !== 'retryable' &&
    intent.status !== 'sending'
  ) {
    return false
  }

  const referenceTimestamp = intent.lastAttemptAt ?? intent.updatedAt
  const referenceTime = Date.parse(referenceTimestamp)
  if (!Number.isFinite(referenceTime)) {
    return true
  }

  return Date.now() - referenceTime >= STALE_OUTBOX_INTENT_MS
}

async function readDirectoryFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, {
      withFileTypes: true,
    })
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }
    throw error
  }
}
