import { assistantStopResultSchema } from '@murph/assistant-core/assistant-cli-contracts'
import { tryKillProcess } from '../process-kill.js'
import { VaultCliError } from '@murph/assistant-core/vault-cli-errors'
import {
  redactAssistantDisplayPath,
  resolveAssistantStatePaths,
} from './store.js'
import {
  clearAssistantAutomationRunLock,
  inspectAssistantAutomationRunLock,
} from '@murph/assistant-core/assistant/automation/runtime-lock'

const ASSISTANT_AUTOMATION_STOP_TIMEOUT_MS = 5_000
const ASSISTANT_AUTOMATION_FORCE_KILL_TIMEOUT_MS = 1_000
const ASSISTANT_AUTOMATION_STOP_POLL_INTERVAL_MS = 100

export async function stopAssistantAutomation(input: {
  forceKillTimeoutMs?: number
  killProcess?: (pid: number, signal?: NodeJS.Signals | number) => void
  now?: () => Date
  pollIntervalMs?: number
  sleep?: (milliseconds: number) => Promise<void>
  timeoutMs?: number
  vault: string
}) {
  const paths = resolveAssistantStatePaths(input.vault)
  const now = input.now ?? (() => new Date())
  const sleep =
    input.sleep ??
    (async (milliseconds: number) => {
      await new Promise((resolve) => {
        setTimeout(resolve, milliseconds)
      })
    })
  const killProcess =
    input.killProcess ??
    ((pid: number, signal?: NodeJS.Signals | number) => {
      process.kill(pid, signal)
    })
  const pollIntervalMs = normalizePositiveInt(
    input.pollIntervalMs,
    ASSISTANT_AUTOMATION_STOP_POLL_INTERVAL_MS,
  )
  const timeoutMs = normalizePositiveInt(
    input.timeoutMs,
    ASSISTANT_AUTOMATION_STOP_TIMEOUT_MS,
  )
  const forceKillTimeoutMs = normalizePositiveInt(
    input.forceKillTimeoutMs,
    ASSISTANT_AUTOMATION_FORCE_KILL_TIMEOUT_MS,
  )

  const initial = await inspectAssistantAutomationRunLock(paths)
  if (initial.state === 'unlocked') {
    throw new VaultCliError(
      'ASSISTANT_AUTOMATION_NOT_RUNNING',
      'Murph assistant automation is not currently running for this vault.',
    )
  }

  const resultBase = {
    vault: redactAssistantDisplayPath(paths.absoluteVaultRoot),
    stateRoot: redactAssistantDisplayPath(paths.assistantStateRoot),
    pid: initial.pid,
    startedAt: initial.startedAt,
    command: initial.command,
  }

  if (initial.state === 'stale') {
    await clearAssistantAutomationRunLock(paths)
    return assistantStopResultSchema.parse({
      ...resultBase,
      stopped: true,
      stopMethod: 'stale-lock-cleanup',
      stoppedAt: now().toISOString(),
      message:
        'Removed stale assistant automation lock; the recorded process was already gone.',
    })
  }

  if (typeof initial.pid !== 'number') {
    throw new VaultCliError(
      'ASSISTANT_AUTOMATION_STOP_FAILED',
      'Murph could not stop assistant automation because the active run lock did not include a PID.',
      {
        command: initial.command,
      },
    )
  }

  tryKillProcess(killProcess, initial.pid, 'SIGCONT')
  tryKillProcess(killProcess, initial.pid, 'SIGTERM')

  const afterTerminate = await waitForRunLockChange({
    paths,
    pollIntervalMs,
    sleep,
    targetPid: initial.pid,
    timeoutMs,
  })

  const terminatedResult = await maybeBuildStopResult({
    lock: afterTerminate,
    message:
      'Murph stopped the assistant automation loop.',
    now,
    paths,
    resultBase,
    stopMethod: 'signal',
    staleMessage:
      'Assistant automation stopped but left a stale run lock, so Murph cleared it.',
  })
  if (terminatedResult) {
    return terminatedResult
  }

  if (afterTerminate.state === 'active' && afterTerminate.pid !== initial.pid) {
    throw new VaultCliError(
      'ASSISTANT_AUTOMATION_RESTARTED',
      'Assistant automation restarted under a different PID while Murph was stopping the original process.',
      {
        expectedPid: initial.pid,
        pid: afterTerminate.pid,
      },
    )
  }

  tryKillProcess(killProcess, initial.pid, 'SIGKILL')

  const afterForceKill = await waitForRunLockChange({
    paths,
    pollIntervalMs,
    sleep,
    targetPid: initial.pid,
    timeoutMs: forceKillTimeoutMs,
  })
  const forcedResult = await maybeBuildStopResult({
    lock: afterForceKill,
    message:
      'Murph force-killed the assistant automation loop after it ignored SIGTERM.',
    now,
    paths,
    resultBase,
    stopMethod: 'force-kill',
    staleMessage:
      'Murph force-killed the assistant automation loop and cleared the stale run lock.',
  })
  if (forcedResult) {
    return forcedResult
  }

  throw new VaultCliError(
    'ASSISTANT_AUTOMATION_STOP_TIMEOUT',
    'Assistant automation did not stop within the expected timeout.',
    {
      pid: initial.pid,
      command: initial.command,
    },
  )
}

async function maybeBuildStopResult(input: {
  lock: Awaited<ReturnType<typeof inspectAssistantAutomationRunLock>>
  message: string
  now: () => Date
  paths: ReturnType<typeof resolveAssistantStatePaths>
  resultBase: {
    vault: string
    stateRoot: string
    pid: number | null
    startedAt: string | null
    command: string | null
  }
  staleMessage: string
  stopMethod: 'signal' | 'force-kill'
}): Promise<ReturnType<typeof assistantStopResultSchema.parse> | null> {
  if (input.lock.state === 'unlocked') {
    return assistantStopResultSchema.parse({
      ...input.resultBase,
      stopped: true,
      stopMethod: input.stopMethod,
      stoppedAt: input.now().toISOString(),
      message: input.message,
    })
  }

  if (input.lock.state === 'stale') {
    await clearAssistantAutomationRunLock(input.paths)
    return assistantStopResultSchema.parse({
      ...input.resultBase,
      stopped: true,
      stopMethod: input.stopMethod,
      stoppedAt: input.now().toISOString(),
      message: input.staleMessage,
    })
  }

  return null
}

async function waitForRunLockChange(input: {
  paths: ReturnType<typeof resolveAssistantStatePaths>
  pollIntervalMs: number
  sleep: (milliseconds: number) => Promise<void>
  targetPid: number
  timeoutMs: number
}): Promise<Awaited<ReturnType<typeof inspectAssistantAutomationRunLock>>> {
  const attempts = Math.max(
    1,
    Math.ceil(input.timeoutMs / input.pollIntervalMs),
  )

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await input.sleep(input.pollIntervalMs)
    const next = await inspectAssistantAutomationRunLock(input.paths)
    if (next.state !== 'active' || next.pid !== input.targetPid) {
      return next
    }
  }

  return inspectAssistantAutomationRunLock(input.paths)
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || typeof value !== 'number') {
    return fallback
  }

  return Math.max(1, Math.trunc(value))
}
