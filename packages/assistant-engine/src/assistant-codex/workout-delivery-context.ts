import type { AutomationContextReference } from '@murphai/contracts'
import { resolveVaultCliCommandPath } from '@murphai/operator-config/command-helpers'
import {
  showResultSchema,
  vaultCliBatchResultSchema,
  workoutAddResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'

import type { CodexNormalizedEvent } from '../assistant-codex-events.js'
import {
  readCodexRecord,
  readCodexServerNotification,
} from './app-server-protocol.js'
import { isCodexActionStructurallyFailed } from './action-outcome.js'
import { resolveCodexVaultCliCommandArgv } from './command-family.js'

const ACTIVITY_SESSION_KIND = 'activity_session'

type WorkoutCommandKind = 'continue' | 'delete' | 'start'

interface PendingWorkoutCommand {
  commandKind: 'batch' | WorkoutCommandKind
  deliveryContextOrdinal: number
}

interface WorkoutDeliveryState {
  conflicted: boolean
  sessionId: string | null
}

export interface CodexWorkoutDeliveryContextTracker {
  observe(input: {
    deliveryContextOrdinal: number
    event: CodexNormalizedEvent
  }): void
  readReferences(
    deliveryContextOrdinal: number,
  ): readonly AutomationContextReference[] | undefined
  recordCompletedResponse(deliveryContextOrdinal: number): void
}

/**
 * Derives one response-scoped workout identity from trusted command results.
 * It never selects a workout: starts establish identity, while later mutations
 * may only preserve an already trusted exact identity.
 */
export function createCodexWorkoutDeliveryContextTracker(input: {
  contextReferences?: readonly AutomationContextReference[] | null
}): CodexWorkoutDeliveryContextTracker {
  const pending = new Map<string, PendingWorkoutCommand>()
  const states = new Map<number, WorkoutDeliveryState>()
  const completedResponseSessionIds = new Map<number, string>()
  const initialSessionId = readUniqueActivitySessionId(
    input.contextReferences ?? [],
  )

  const readState = (deliveryContextOrdinal: number): WorkoutDeliveryState => {
    const existing = states.get(deliveryContextOrdinal)
    if (existing) {
      return existing
    }
    const created = {
      conflicted: false,
      sessionId: null,
    }
    states.set(deliveryContextOrdinal, created)
    return created
  }

  const readTrustedSessionId = (deliveryContextOrdinal: number): string | null =>
    deliveryContextOrdinal === 0
      ? initialSessionId
      : completedResponseSessionIds.get(deliveryContextOrdinal - 1) ?? null

  const acceptResult = (
    deliveryContextOrdinal: number,
    commandKind: WorkoutCommandKind,
    sessionId: string | null,
  ): void => {
    const state = readState(deliveryContextOrdinal)
    if (state.conflicted || sessionId === null) {
      state.conflicted = true
      state.sessionId = null
      return
    }

    if (commandKind === 'start') {
      if (state.sessionId !== null && state.sessionId !== sessionId) {
        state.conflicted = true
        state.sessionId = null
        return
      }
      state.sessionId = sessionId
      return
    }

    const trustedSessionId = state.sessionId ??
      readTrustedSessionId(deliveryContextOrdinal)
    if (trustedSessionId === null || trustedSessionId !== sessionId) {
      state.conflicted = true
      state.sessionId = null
      return
    }
    state.sessionId = sessionId
  }

  const observe = ({
    deliveryContextOrdinal,
    event,
  }: {
    deliveryContextOrdinal: number
    event: CodexNormalizedEvent
  }): void => {
    if (
      event.kind !== 'status_item' ||
      event.itemType !== 'commandExecution' ||
      event.itemId === null
    ) {
      return
    }

    if (event.itemState === 'running') {
      const argv = resolveCodexVaultCliCommandArgv({
        allowKnownShellWrapper: true,
        commandLabel: event.commandLabel,
      })
      const commandKind = readTrackedOuterCommandKind(argv)
      if (commandKind !== null) {
        pending.set(event.itemId, {
          commandKind,
          deliveryContextOrdinal,
        })
      }
      return
    }

    const started = pending.get(event.itemId)
    pending.delete(event.itemId)
    if (started === undefined) {
      return
    }

    const notification = readCodexServerNotification(event.rawEvent)
    const item = readCodexRecord(notification?.params.item)
    if (
      item === null ||
      isCodexActionStructurallyFailed({
        item,
        normalizedExitCode: event.exitCode,
      })
    ) {
      readState(started.deliveryContextOrdinal).conflicted = true
      return
    }
    const output = typeof item.aggregatedOutput === 'string'
      ? item.aggregatedOutput
      : null
    if (output === null) {
      readState(started.deliveryContextOrdinal).conflicted = true
      return
    }

    if (started.commandKind !== 'batch') {
      acceptResult(
        started.deliveryContextOrdinal,
        started.commandKind,
        readWorkoutResultSessionId(output, started.commandKind),
      )
      return
    }

    const commands = readBatchCommands(output)
    if (commands === null) {
      readState(started.deliveryContextOrdinal).conflicted = true
      return
    }
    for (const command of commands) {
      const commandKind = readWorkoutCommandKind(command.argv)
      if (commandKind === null) {
        continue
      }
      acceptResult(
        started.deliveryContextOrdinal,
        commandKind,
        command.ok
          ? readWorkoutResultSessionId(command.data, commandKind)
          : null,
      )
    }
  }

  const readReferences = (
    deliveryContextOrdinal: number,
  ): readonly AutomationContextReference[] | undefined => {
    const state = states.get(deliveryContextOrdinal)
    if (!state) {
      return undefined
    }
    return state.conflicted || state.sessionId === null
      ? []
      : [{ entityKind: ACTIVITY_SESSION_KIND, entityId: state.sessionId }]
  }

  return {
    observe,
    readReferences,
    recordCompletedResponse(deliveryContextOrdinal) {
      const references = readReferences(deliveryContextOrdinal)
      if (references?.length === 1) {
        completedResponseSessionIds.set(
          deliveryContextOrdinal,
          references[0]!.entityId,
        )
      }
    },
  }
}

function readTrackedOuterCommandKind(
  argv: readonly string[] | null,
): PendingWorkoutCommand['commandKind'] | null {
  if (argv === null) {
    return null
  }
  const commandArgs = argv.slice(1)
  if (resolveVaultCliCommandPath(commandArgs)[0] === 'batch') {
    return 'batch'
  }
  return readWorkoutCommandKind(commandArgs)
}

function readWorkoutCommandKind(
  argv: readonly string[],
): WorkoutCommandKind | null {
  const [root, command] = resolveVaultCliCommandPath(argv)
  if (root !== 'workout') {
    return null
  }
  if (command === 'start') {
    return 'start'
  }
  if (command === 'delete') {
    return 'delete'
  }
  return command === 'edit' || command === 'finish' || command === 'exercise' ||
      command === 'set' || command === 'show'
    ? 'continue'
    : null
}

function readWorkoutResultSessionId(
  value: unknown,
  commandKind: WorkoutCommandKind,
): string | null {
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (commandKind === 'delete') {
    return null
  }
  if (commandKind === 'start') {
    const result = workoutAddResultSchema.safeParse(parsed)
    return result.success ? result.data.eventId : null
  }
  const result = showResultSchema.safeParse(parsed)
  return result.success && result.data.entity.kind === ACTIVITY_SESSION_KIND
    ? result.data.entity.id
    : null
}

function readUniqueActivitySessionId(
  references: readonly AutomationContextReference[],
): string | null {
  const ids = [...new Set(references.flatMap((reference) =>
    reference.entityKind === ACTIVITY_SESSION_KIND
      ? [reference.entityId]
      : [],
  ))]
  return ids.length === 1 ? ids[0]! : null
}

function readBatchCommands(value: string): Array<{
  argv: readonly string[]
  data?: unknown
  ok: boolean
}> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  const result = vaultCliBatchResultSchema.safeParse(parsed)
  return result.success ? result.data.commands : null
}
