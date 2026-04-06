import {
  createVersionedJsonStateEnvelope,
  hasLocalStatePath,
  parseVersionedJsonStateEnvelope,
  promoteLegacyLocalStateDirectory,
  readLocalStateTextFileWithFallback,
} from '@murphai/runtime-state/node'
import { inboxDaemonStateSchema, type InboxDaemonState } from '../inbox-cli-contracts.js'
import type { InboxPaths } from '../inbox-app/types.js'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  errorMessage,
  relativeToVault,
  writeJsonFile,
} from './shared.js'

const INBOX_DAEMON_STATE_SCHEMA = 'murph.inbox-daemon-state.v1'
const INBOX_DAEMON_STATE_SCHEMA_VERSION = 1

export async function normalizeDaemonState(
  paths: InboxPaths,
  input: {
    clock: () => Date
    getPid: () => number
    killProcess?: (pid: number, signal?: NodeJS.Signals | number) => void
  },
): Promise<InboxDaemonState> {
  if (!(await hasLocalStatePath({
    currentPath: paths.inboxStatePath,
    legacyPath: paths.inboxStateLegacyPath,
  }))) {
    return idleState(paths)
  }

  const state = await readDaemonState(paths)

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
  await promoteLegacyLocalStateDirectory({
    currentPath: paths.inboxRuntimeRoot,
    legacyPath: paths.inboxRuntimeLegacyRoot,
  })
  await writeJsonFile(
    paths.inboxStatePath,
    createVersionedJsonStateEnvelope({
      schema: INBOX_DAEMON_STATE_SCHEMA,
      schemaVersion: INBOX_DAEMON_STATE_SCHEMA_VERSION,
      value: inboxDaemonStateSchema.parse(state),
    }),
  )
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

async function readDaemonState(paths: InboxPaths): Promise<InboxDaemonState> {
  try {
    const raw = await readLocalStateTextFileWithFallback({
      currentPath: paths.inboxStatePath,
      legacyPath: paths.inboxStateLegacyPath,
    })

    return parseVersionedJsonStateEnvelope(JSON.parse(raw.text) as unknown, {
      label: 'Inbox daemon state',
      legacyParseValue(value) {
        return inboxDaemonStateSchema.parse(value)
      },
      parseValue(value) {
        return inboxDaemonStateSchema.parse(value)
      },
      schema: INBOX_DAEMON_STATE_SCHEMA,
      schemaVersion: INBOX_DAEMON_STATE_SCHEMA_VERSION,
    })
  } catch (error) {
    throw new VaultCliError(
      'INBOX_STATE_INVALID',
      'Inbox daemon state is invalid.',
      { error: errorMessage(error) },
    )
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
