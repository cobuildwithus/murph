import { inboxDaemonStateSchema, type InboxDaemonState } from '../inbox-cli-contracts.js'
import type { InboxPaths } from '../inbox-services.js'
import {
  fileExists,
  readJsonWithSchema,
  relativeToVault,
  writeJsonFile,
} from './shared.js'

export async function normalizeDaemonState(
  paths: InboxPaths,
  input: {
    clock: () => Date
    getPid: () => number
    killProcess?: (pid: number, signal?: NodeJS.Signals | number) => void
  },
): Promise<InboxDaemonState> {
  if (!(await fileExists(paths.inboxStatePath))) {
    return idleState(paths)
  }

  const state = await readJsonWithSchema(
    paths.inboxStatePath,
    inboxDaemonStateSchema,
    'INBOX_STATE_INVALID',
    'Inbox daemon state is invalid.',
  )

  if (!state.running || !state.pid) {
    return state
  }

  if (state.pid === input.getPid()) {
    return state
  }

  if (isProcessAlive(state.pid, input.killProcess)) {
    return state
  }

  const staleState = buildDaemonState(paths, {
    ...state,
    running: false,
    stale: true,
    status: 'stale',
    stoppedAt: state.stoppedAt ?? input.clock().toISOString(),
    message: 'Stale daemon state found; recorded PID is no longer running.',
  })
  await writeDaemonState(paths, staleState)
  return staleState
}

export function idleState(paths: InboxPaths): InboxDaemonState {
  return buildDaemonState(paths, { status: 'idle' })
}

export function buildDaemonState(
  paths: InboxPaths,
  overrides: Partial<InboxDaemonState> & Pick<InboxDaemonState, 'status'>,
): InboxDaemonState {
  const { status, ...rest } = overrides

  return {
    running: false,
    stale: false,
    pid: null,
    startedAt: null,
    stoppedAt: null,
    status,
    connectorIds: [],
    message: null,
    ...rest,
    statePath: relativeToVault(paths.absoluteVaultRoot, paths.inboxStatePath),
    configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
    databasePath: relativeToVault(paths.absoluteVaultRoot, paths.inboxDbPath),
  }
}

export async function writeDaemonState(
  paths: InboxPaths,
  state: InboxDaemonState,
): Promise<void> {
  await writeJsonFile(paths.inboxStatePath, inboxDaemonStateSchema.parse(state))
}

export function createProcessSignalBridge(): {
  cleanup(): void
  signal: AbortSignal
} {
  const controller = new AbortController()
  const abort = () => {
    controller.abort()
    cleanup()
  }
  const cleanup = () => {
    process.off('SIGINT', abort)
    process.off('SIGTERM', abort)
  }

  process.on('SIGINT', abort)
  process.on('SIGTERM', abort)
  return {
    cleanup,
    signal: controller.signal,
  }
}

function isProcessAlive(
  pid: number,
  killProcess: ((pid: number, signal?: NodeJS.Signals | number) => void) | undefined,
): boolean {
  try {
    if (!killProcess) {
      process.kill(pid, 0)
    } else {
      killProcess(pid, 0)
    }
    return true
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: string }).code ?? '')
        : ''
    return code !== 'ESRCH'
  }
}
