import {
  hasLocalStatePath,
  matchProcessIdentity,
  readVersionedJsonStateFile,
  type ProcessIdentity,
  type ProcessIdentityMatch,
  writeVersionedJsonStateFile,
} from '@murphai/runtime-state/node'
import { inboxDaemonStateSchema, type InboxDaemonState } from '@murphai/operator-config/inbox-cli-contracts'
import type { InboxPaths } from '../inbox-app/types.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  errorMessage,
  relativeToVault,
} from './shared.js'

const INBOX_DAEMON_STATE_SCHEMA = 'murph.inbox-daemon-state.v1'
const INBOX_DAEMON_STATE_SCHEMA_VERSION = 1

type PersistedInboxDaemonState = InboxDaemonState & {
  processIdentity: ProcessIdentity | null
}

export type InboxDaemonControlTarget =
  | { verified: true; state: InboxDaemonState }
  | {
      verified: false
      state: InboxDaemonState
      reason:
        | 'not-running'
        | 'pid-not-running'
        | 'owner-changed'
        | 'identity-missing'
        | 'identity-mismatched'
        | 'identity-unverifiable'
    }

export async function normalizeDaemonState(
  paths: InboxPaths,
  input: {
    clock: () => Date
    getPid: () => number
    killProcess?: (pid: number, signal?: NodeJS.Signals | number) => void
  },
): Promise<InboxDaemonState> {
  if (!(await hasLocalStatePath({ currentPath: paths.inboxStatePath }))) {
    return idleState(paths)
  }

  const state = await readDaemonState(paths)
  const publicState = toPublicDaemonState(state)

  if (!publicState.running || !publicState.pid) {
    return publicState
  }

  if (!isProcessAlive(publicState.pid, input.killProcess)) {
    const staleState = buildStaleDaemonState(paths, publicState, {
      clock: input.clock,
      message: 'Stale daemon state found; recorded PID is no longer running.',
    })
    await writeDaemonState(paths, staleState)
    return staleState
  }

  return publicState
}

export async function verifyDaemonStateForExpectedOwner(
  paths: InboxPaths,
  expected: InboxDaemonState,
  input: {
    clock: () => Date
    getPid: () => number
    killProcess?: (pid: number, signal?: NodeJS.Signals | number) => void
    matchProcessIdentity?: (
      pid: number,
      expected: ProcessIdentity | null | undefined,
    ) => Promise<ProcessIdentityMatch>
  },
): Promise<InboxDaemonControlTarget> {
  if (!(await hasLocalStatePath({ currentPath: paths.inboxStatePath }))) {
    return { verified: false, state: idleState(paths), reason: 'not-running' }
  }

  const state = await readDaemonState(paths)
  const current = toPublicDaemonState(state)
  if (!current.running || !current.pid) {
    return { verified: false, state: current, reason: 'not-running' }
  }

  if (!isProcessAlive(current.pid, input.killProcess)) {
    const staleState = buildStaleDaemonState(paths, current, {
      clock: input.clock,
      message: 'Stale daemon state found; recorded PID is no longer running.',
    })
    await writeDaemonState(paths, staleState)
    return { verified: false, state: staleState, reason: 'pid-not-running' }
  }

  if (
    current.pid !== expected.pid ||
    current.startedAt !== expected.startedAt ||
    current.status !== expected.status
  ) {
    return { verified: false, state: current, reason: 'owner-changed' }
  }

  const identityMatch = await (input.matchProcessIdentity ?? matchProcessIdentity)(
    current.pid,
    state.processIdentity,
  )
  if (!identityMatch.matches) {
    return {
      verified: false,
      state: current,
      reason: mapIdentityFailureReason(identityMatch.reason),
    }
  }

  return { verified: true, state: current }
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
  options: {
    processIdentity?: ProcessIdentity | null
  } = {},
): Promise<void> {
  const publicState = inboxDaemonStateSchema.parse(state)
  const persistedState: PersistedInboxDaemonState = {
    ...publicState,
    processIdentity:
      publicState.running && publicState.pid
        ? options.processIdentity ?? null
        : null,
  }

  await writeVersionedJsonStateFile({
    filePath: paths.inboxStatePath,
    schema: INBOX_DAEMON_STATE_SCHEMA,
    schemaVersion: INBOX_DAEMON_STATE_SCHEMA_VERSION,
    value: persistedState,
  })
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

async function readDaemonState(paths: InboxPaths): Promise<PersistedInboxDaemonState> {
  try {
    const { value } = await readVersionedJsonStateFile({
      currentPath: paths.inboxStatePath,
      label: 'Inbox daemon state',
      parseValue(value) {
        return parsePersistedDaemonState(value)
      },
      schema: INBOX_DAEMON_STATE_SCHEMA,
      schemaVersion: INBOX_DAEMON_STATE_SCHEMA_VERSION,
    })
    return value
  } catch (error) {
    throw new VaultCliError(
      'INBOX_STATE_INVALID',
      'Inbox daemon state is invalid.',
      { error: errorMessage(error) },
    )
  }
}

function parsePersistedDaemonState(value: unknown): PersistedInboxDaemonState {
  const publicState = inboxDaemonStateSchema.parse(value)
  const processIdentity =
    value && typeof value === 'object' && !Array.isArray(value)
      ? parseProcessIdentity((value as { processIdentity?: unknown }).processIdentity)
      : null

  return {
    ...publicState,
    processIdentity: publicState.running && publicState.pid ? processIdentity : null,
  }
}

function parseProcessIdentity(value: unknown): ProcessIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  if (
    typeof record.pid !== 'number' ||
    !Number.isInteger(record.pid) ||
    record.pid <= 0 ||
    typeof record.platform !== 'string' ||
    record.platform.length === 0 ||
    typeof record.startToken !== 'string' ||
    record.startToken.length === 0
  ) {
    return null
  }

  return {
    pid: record.pid,
    platform: record.platform as NodeJS.Platform,
    startToken: record.startToken,
  }
}

function toPublicDaemonState(state: PersistedInboxDaemonState): InboxDaemonState {
  const { processIdentity: _processIdentity, ...publicState } = state
  return publicState
}

function buildStaleDaemonState(
  paths: InboxPaths,
  state: InboxDaemonState,
  input: {
    clock: () => Date
    message: string
  },
): InboxDaemonState {
  return buildDaemonState(paths, {
    ...state,
    running: false,
    stale: true,
    status: 'stale',
    stoppedAt: state.stoppedAt ?? input.clock().toISOString(),
    message: input.message,
  })
}

function mapIdentityFailureReason(
  reason: Exclude<ProcessIdentityMatch, { matches: true }>['reason'],
): Exclude<InboxDaemonControlTarget, { verified: true }>['reason'] {
  if (reason === 'missing') {
    return 'identity-missing'
  }

  if (reason === 'mismatched') {
    return 'identity-mismatched'
  }

  return 'identity-unverifiable'
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
