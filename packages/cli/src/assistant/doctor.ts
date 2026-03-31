import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { AssistantStatePaths } from '@murph/runtime-state'
import {
  assistantAutomationStateSchema,
  assistantDiagnosticEventSchema,
  assistantDiagnosticsSnapshotSchema,
  assistantDoctorResultSchema,
  assistantFailoverStateSchema,
  assistantOutboxIntentSchema,
  assistantProviderRouteRecoverySchema,
  assistantRuntimeBudgetSnapshotSchema,
  assistantRuntimeEventSchema,
  assistantSessionSchema,
  assistantStatusResultSchema,
  assistantTranscriptEntrySchema,
  assistantTurnReceiptSchema,
  type AssistantDoctorCheck,
  type AssistantDoctorCheckStatus,
  type AssistantDoctorResult,
  type AssistantOutboxIntent,
  type AssistantTurnReceipt,
} from '@murph/assistant-core/assistant-cli-contracts'
import {
  inspectAndRepairAssistantStateSecrecy,
  type AssistantStateSecrecyAudit,
} from './doctor-security.js'
import { summarizeAssistantQuarantines } from '@murph/assistant-core/assistant/quarantine'
import { withAssistantRuntimeWriteLock } from '@murph/assistant-core/assistant/runtime-write-lock'
import {
  isMissingFileError,
  parseAssistantJsonLinesWithTailSalvage,
} from '@murph/assistant-core/assistant/shared'
import { redactAssistantDisplayPath } from './store.js'
import { resolveAssistantStatePaths } from '@murph/assistant-core/assistant/store/paths'

const STALE_OUTBOX_INTENT_MS = 15 * 60 * 1000

export async function runAssistantDoctor(
  vault: string,
  input: {
    repair?: boolean
  } = {},
): Promise<AssistantDoctorResult> {
  if (input.repair) {
    return withAssistantRuntimeWriteLock(vault, async (paths) =>
      runAssistantDoctorAtPaths(vault, paths, { repair: true }),
    )
  }

  return runAssistantDoctorAtPaths(vault, resolveAssistantStatePaths(vault), {
    repair: false,
  })
}

async function runAssistantDoctorAtPaths(
  vault: string,
  paths: AssistantStatePaths,
  input: {
    repair: boolean
  },
): Promise<AssistantDoctorResult> {
  const [
    quarantine,
    sessionScan,
    providerRouteRecoveryScan,
    automationScan,
    transcriptScan,
    receiptScan,
    outboxScan,
    diagnosticEventScan,
    runtimeEventScan,
    diagnosticsScan,
    failoverScan,
    statusScan,
    runtimeBudgetScan,
    secrecyAudit,
  ] = await Promise.all([
    summarizeAssistantQuarantines({ paths }),
    scanSessionFiles(paths.sessionsDirectory),
    scanJsonDirectory(paths.providerRouteRecoveryDirectory, assistantProviderRouteRecoverySchema),
    scanJsonFile(paths.automationPath, assistantAutomationStateSchema),
    scanTranscriptFiles(paths.transcriptsDirectory),
    scanTurnReceiptFiles(paths.turnsDirectory),
    scanOutboxFiles(paths.outboxDirectory),
    scanJsonLinesFile(paths.diagnosticEventsPath, assistantDiagnosticEventSchema),
    scanJsonLinesFile(paths.runtimeEventsPath, assistantRuntimeEventSchema),
    scanJsonFile(paths.diagnosticSnapshotPath, assistantDiagnosticsSnapshotSchema),
    scanJsonFile(paths.failoverStatePath, assistantFailoverStateSchema),
    scanJsonFile(paths.statusPath, assistantStatusResultSchema),
    scanJsonFile(paths.resourceBudgetPath, assistantRuntimeBudgetSnapshotSchema),
    inspectAndRepairAssistantStateSecrecy(paths, {
      repair: input.repair,
    }),
  ])
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
        fileCount: providerRouteRecoveryScan.fileCount,
        parseErrors: providerRouteRecoveryScan.parseErrors,
      },
      message:
        providerRouteRecoveryScan.parseErrors > 0
          ? `${providerRouteRecoveryScan.parseErrors} provider route recovery file(s) could not be parsed.`
          : providerRouteRecoveryScan.fileCount === 0
            ? 'assistant provider route recovery state has not been written yet.'
            : `${providerRouteRecoveryScan.fileCount} provider route recovery file(s) parsed cleanly.`,
      name: 'provider-route-recovery-files',
      status: providerRouteRecoveryScan.parseErrors > 0 ? 'fail' : 'pass',
    }),
    buildAssistantStatePermissionCheck(secrecyAudit),
    buildAssistantStateSessionSecretCheck(secrecyAudit, input.repair),
    buildAssistantStateProviderRouteRecoverySecretCheck(secrecyAudit, input.repair),
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
        salvagedTailLines: transcriptScan.salvagedTailLines,
        transcriptFiles: transcriptScan.fileCount,
      },
      message:
        transcriptScan.malformedLines > 0
          ? `${transcriptScan.malformedLines} malformed transcript line(s) detected across ${transcriptScan.fileCount} transcript file(s).`
          : transcriptScan.salvagedTailLines > 0
            ? `${transcriptScan.salvagedTailLines} torn transcript tail line(s) were recovered during diagnostics.`
            : transcriptOrphans.length > 0
              ? `${transcriptOrphans.length} transcript file(s) do not have a matching session record.`
              : `${transcriptScan.fileCount} transcript file(s) look healthy.`,
      name: 'transcript-files',
      status:
        transcriptScan.malformedLines > 0
          ? 'fail'
          : transcriptScan.salvagedTailLines > 0
            ? 'warn'
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
        quarantinedFiles: outboxScan.quarantinedFiles,
        staleOpenIntents: outboxScan.staleOpenIntents.length,
        totalIntents: outboxScan.intents.length,
      },
      message:
        outboxScan.parseErrors > 0
          ? `${outboxScan.parseErrors} outbox intent file(s) could not be parsed.`
          : outboxScan.quarantinedFiles > 0
            ? `${outboxScan.quarantinedFiles} outbox intent file(s) were quarantined after parse failure.`
            : outboxScan.staleOpenIntents.length > 0
              ? `${outboxScan.staleOpenIntents.length} outbox intent(s) are still pending, retryable, or sending after ${Math.trunc(STALE_OUTBOX_INTENT_MS / 60000)} minutes.`
              : `${outboxScan.intents.length} outbox intent(s) look healthy.`,
      name: 'outbox-intents',
      status:
        outboxScan.parseErrors > 0
          ? 'fail'
          : outboxScan.quarantinedFiles > 0
            ? 'warn'
            : outboxScan.staleOpenIntents.length > 0
              ? 'warn'
              : 'pass',
    }),
    createDoctorCheck({
      details: {
        malformedLines: diagnosticEventScan.malformedLines,
        present: diagnosticEventScan.present,
        salvagedTailLines: diagnosticEventScan.salvagedTailLines,
        totalEvents: diagnosticEventScan.totalEvents,
      },
      message:
        !diagnosticEventScan.present
          ? 'assistant diagnostic event log has not been written yet.'
          : diagnosticEventScan.malformedLines > 0
            ? `${diagnosticEventScan.malformedLines} malformed diagnostic event line(s) detected.`
            : diagnosticEventScan.salvagedTailLines > 0
              ? `${diagnosticEventScan.salvagedTailLines} torn diagnostic event tail line(s) were recovered during diagnostics.`
              : `${diagnosticEventScan.totalEvents} assistant diagnostic event(s) parsed cleanly.`,
      name: 'diagnostic-events',
      status:
        diagnosticEventScan.malformedLines > 0
          ? 'fail'
          : diagnosticEventScan.salvagedTailLines > 0
            ? 'warn'
            : 'pass',
    }),
    createDoctorCheck({
      details: {
        malformedLines: runtimeEventScan.malformedLines,
        present: runtimeEventScan.present,
        salvagedTailLines: runtimeEventScan.salvagedTailLines,
        totalEvents: runtimeEventScan.totalEvents,
      },
      message:
        !runtimeEventScan.present
          ? 'assistant runtime event journal has not been written yet.'
          : runtimeEventScan.malformedLines > 0
            ? `${runtimeEventScan.malformedLines} malformed runtime event line(s) detected.`
            : runtimeEventScan.salvagedTailLines > 0
              ? `${runtimeEventScan.salvagedTailLines} torn runtime event tail line(s) were recovered during diagnostics.`
              : `${runtimeEventScan.totalEvents} assistant runtime event(s) parsed cleanly.`,
      name: 'runtime-events',
      status:
        runtimeEventScan.malformedLines > 0
          ? 'fail'
          : runtimeEventScan.salvagedTailLines > 0
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
    createDoctorCheck({
      details: {
        present: runtimeBudgetScan.present,
        parseError: runtimeBudgetScan.parseError,
      },
      message:
        !runtimeBudgetScan.present
          ? 'assistant runtime budget snapshot has not been written yet.'
          : runtimeBudgetScan.parseError
            ? 'assistant runtime budget snapshot could not be parsed.'
            : 'assistant runtime budget snapshot parsed cleanly.',
      name: 'runtime-budget',
      status: runtimeBudgetScan.parseError ? 'fail' : 'pass',
    }),
    createDoctorCheck({
      details: {
        byKind: quarantine.byKind,
        recent: quarantine.recent.length,
        total: quarantine.total,
      },
      message:
        quarantine.total > 0
          ? `${quarantine.total} assistant runtime artifact(s) are quarantined and should be reviewed.`
          : 'No quarantined assistant runtime artifacts were found.',
      name: 'quarantine-artifacts',
      status: quarantine.total > 0 ? 'warn' : 'pass',
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
    quarantineCount: quarantine.total,
    checks,
  })
}

function buildAssistantStatePermissionCheck(
  secrecyAudit: AssistantStateSecrecyAudit,
): AssistantDoctorCheck {
  const unresolvedIssues = secrecyAudit.permissionAudit.issues.filter(
    (issue) => !issue.repaired,
  ).length

  return createDoctorCheck({
    details: {
      incorrectEntries: secrecyAudit.permissionAudit.incorrectEntries,
      repairedEntries: secrecyAudit.permissionAudit.repairedEntries,
      scannedDirectories: secrecyAudit.permissionAudit.scannedDirectories,
      scannedFiles: secrecyAudit.permissionAudit.scannedFiles,
      scannedOtherEntries: secrecyAudit.permissionAudit.scannedOtherEntries,
      unresolvedIssues,
    },
    message:
      unresolvedIssues > 0
        ? `${unresolvedIssues} assistant-state path permission or entry-type issue(s) still need manual repair.`
        : secrecyAudit.permissionAudit.repairedEntries > 0
          ? `${secrecyAudit.permissionAudit.repairedEntries} assistant-state permission issue(s) were repaired.`
          : 'assistant-state permissions are private and consistent.',
    name: 'assistant-state-permissions',
    status:
      unresolvedIssues > 0
        ? 'fail'
        : secrecyAudit.permissionAudit.repairedEntries > 0
          ? 'warn'
          : 'pass',
  })
}

function buildAssistantStateSessionSecretCheck(
  secrecyAudit: AssistantStateSecrecyAudit,
  repair: boolean,
): AssistantDoctorCheck {
  const blockingIssues =
    secrecyAudit.sessionInlineSecretFiles +
    secrecyAudit.malformedSessionSecretSidecars
  const status: AssistantDoctorCheckStatus =
    blockingIssues > 0
      ? 'fail'
      : secrecyAudit.orphanSessionSecretSidecars > 0 || secrecyAudit.repairedSessionFiles > 0
        ? 'warn'
        : 'pass'

  return createDoctorCheck({
    details: {
      filesScanned: secrecyAudit.sessionFilesScanned,
      inlineSecretFiles: secrecyAudit.sessionInlineSecretFiles,
      inlineSecretHeaders: secrecyAudit.sessionInlineSecretHeaders,
      malformedSecretSidecars: secrecyAudit.malformedSessionSecretSidecars,
      orphanSecretSidecars: secrecyAudit.orphanSessionSecretSidecars,
      repairedFiles: secrecyAudit.repairedSessionFiles,
      sidecarFiles: secrecyAudit.sessionSecretSidecarFiles,
    },
    message:
      secrecyAudit.sessionInlineSecretFiles > 0
        ? `${secrecyAudit.sessionInlineSecretFiles} assistant session file(s) still embed secret headers inline.`
        : secrecyAudit.malformedSessionSecretSidecars > 0
          ? `${secrecyAudit.malformedSessionSecretSidecars} assistant session secret sidecar(s) are malformed.`
          : secrecyAudit.orphanSessionSecretSidecars > 0
            ? `${secrecyAudit.orphanSessionSecretSidecars} assistant session secret sidecar(s) are orphaned.`
            : secrecyAudit.repairedSessionFiles > 0
              ? `${secrecyAudit.repairedSessionFiles} assistant session file(s) were repaired and secrets were moved into private sidecars${repair ? '' : ' during this run'}.`
              : 'assistant session secrets are stored only in private sidecars.',
    name: 'assistant-session-secrets',
    status,
  })
}

function buildAssistantStateProviderRouteRecoverySecretCheck(
  secrecyAudit: AssistantStateSecrecyAudit,
  repair: boolean,
): AssistantDoctorCheck {
  const blockingIssues =
    secrecyAudit.providerRouteRecoveryInlineSecretFiles +
    secrecyAudit.malformedProviderRouteRecoverySecretSidecars
  const status: AssistantDoctorCheckStatus =
    blockingIssues > 0
      ? 'fail'
      : secrecyAudit.orphanProviderRouteRecoverySecretSidecars > 0 ||
          secrecyAudit.repairedProviderRouteRecoveryFiles > 0
        ? 'warn'
        : 'pass'

  return createDoctorCheck({
    details: {
      filesScanned: secrecyAudit.providerRouteRecoveryFilesScanned,
      inlineSecretFiles: secrecyAudit.providerRouteRecoveryInlineSecretFiles,
      inlineSecretHeaders: secrecyAudit.providerRouteRecoveryInlineSecretHeaders,
      malformedSecretSidecars:
        secrecyAudit.malformedProviderRouteRecoverySecretSidecars,
      orphanSecretSidecars: secrecyAudit.orphanProviderRouteRecoverySecretSidecars,
      repairedFiles: secrecyAudit.repairedProviderRouteRecoveryFiles,
      sidecarFiles: secrecyAudit.providerRouteRecoverySecretSidecarFiles,
    },
    message:
      secrecyAudit.providerRouteRecoveryInlineSecretFiles > 0
        ? `${secrecyAudit.providerRouteRecoveryInlineSecretFiles} provider route recovery file(s) still embed secret headers inline.`
        : secrecyAudit.malformedProviderRouteRecoverySecretSidecars > 0
          ? `${secrecyAudit.malformedProviderRouteRecoverySecretSidecars} provider route recovery secret sidecar(s) are malformed.`
          : secrecyAudit.orphanProviderRouteRecoverySecretSidecars > 0
            ? `${secrecyAudit.orphanProviderRouteRecoverySecretSidecars} provider route recovery secret sidecar(s) are orphaned.`
            : secrecyAudit.repairedProviderRouteRecoveryFiles > 0
              ? `${secrecyAudit.repairedProviderRouteRecoveryFiles} provider route recovery file(s) were repaired and secrets were moved into private sidecars${repair ? '' : ' during this run'}.`
              : 'provider route recovery secrets are stored only in private sidecars.',
    name: 'provider-route-recovery-secrets',
    status,
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

async function scanJsonDirectory<T>(
  directory: string,
  schema: { parse(input: unknown): T },
): Promise<{
  fileCount: number
  parseErrors: number
}> {
  const files = await readDirectoryFiles(directory)
  let fileCount = 0
  let parseErrors = 0

  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue
    }

    fileCount += 1
    try {
      const raw = await readFile(path.join(directory, file), 'utf8')
      schema.parse(JSON.parse(raw) as unknown)
    } catch {
      parseErrors += 1
    }
  }

  return {
    fileCount,
    parseErrors,
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
  salvagedTailLines: number
  sessionIds: string[]
}> {
  const entries = await readDirectoryFiles(directory)
  let malformedLines = 0
  let fileCount = 0
  let salvagedTailLines = 0
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
      const parsed = parseAssistantJsonLinesWithTailSalvage(raw, (value) =>
        assistantTranscriptEntrySchema.parse(value),
      )
      malformedLines += parsed.malformedLineCount
      salvagedTailLines += parsed.salvagedTailLineCount
    } catch {
      malformedLines += 1
    }
  }

  return {
    fileCount,
    malformedLines,
    salvagedTailLines,
    sessionIds,
  }
}

async function scanJsonLinesFile<T>(
  filePath: string,
  schema: { parse(input: unknown): T },
): Promise<{
  malformedLines: number
  present: boolean
  salvagedTailLines: number
  totalEvents: number
}> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = parseAssistantJsonLinesWithTailSalvage(raw, (value) =>
      schema.parse(value),
    )
    return {
      malformedLines: parsed.malformedLineCount,
      present: true,
      salvagedTailLines: parsed.salvagedTailLineCount,
      totalEvents: parsed.values.length,
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        malformedLines: 0,
        present: false,
        salvagedTailLines: 0,
        totalEvents: 0,
      }
    }

    return {
      malformedLines: 1,
      present: true,
      salvagedTailLines: 0,
      totalEvents: 0,
    }
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
  quarantinedFiles: number
  staleOpenIntents: AssistantOutboxIntent[]
}> {
  const files = await readDirectoryFiles(directory)
  const quarantinedFiles = (
    await readDirectoryFiles(path.join(directory, '.quarantine'))
  ).filter((file) => file.endsWith('.meta.json')).length
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
    quarantinedFiles,
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
