import { describe, expect, it } from 'vitest'

import { normalizeCodexEvent } from '../src/assistant-codex-events.js'
import {
  createCodexWorkoutDeliveryContextTracker,
} from '../src/assistant-codex/workout-delivery-context.js'
import {
  VAULT_CLI_BATCH_RESULT_SCHEMA,
} from '@murphai/operator-config/vault-cli-contracts'

const currentWorkoutId = 'evt_current_workout'
const olderWorkoutId = 'evt_older_workout'

describe('Codex workout delivery context', () => {
  it('attributes a live-workout start to the ordinal captured when the command began', () => {
    const tracker = createCodexWorkoutDeliveryContextTracker({})
    observeCommand(tracker, {
      command: 'vault-cli workout start Current --format json',
      completionOrdinal: 1,
      id: 'start-current',
      output: workoutStartResult(currentWorkoutId),
      startOrdinal: 0,
    })

    expect(tracker.readReferences(0)).toEqual([{
      entityId: currentWorkoutId,
      entityKind: 'activity_session',
    }])
    expect(tracker.readReferences(1)).toBeUndefined()
  })

  it('carries an incoming exact workout only through a matching mutation result', () => {
    const tracker = createCodexWorkoutDeliveryContextTracker({
      contextReferences: [{
        entityId: currentWorkoutId,
        entityKind: 'activity_session',
      }],
    })
    observeCommand(tracker, {
      command:
        `vault-cli workout set log --workout-id ${currentWorkoutId} --set-order 2`,
      id: 'log-current',
      output: workoutShowResult(currentWorkoutId),
    })

    expect(tracker.readReferences(0)).toEqual([{
      entityId: currentWorkoutId,
      entityKind: 'activity_session',
    }])
  })

  it('carries an incoming exact workout through a matching exact read', () => {
    const tracker = createCodexWorkoutDeliveryContextTracker({
      contextReferences: [{
        entityId: currentWorkoutId,
        entityKind: 'activity_session',
      }],
    })
    observeCommand(tracker, {
      command: `vault-cli workout show ${currentWorkoutId} --format json`,
      id: 'show-current',
      output: workoutShowResult(currentWorkoutId),
    })

    expect(tracker.readReferences(0)).toEqual([{
      entityId: currentWorkoutId,
      entityKind: 'activity_session',
    }])
  })

  it('carries an incoming exact workout through a matching edit', () => {
    const tracker = createCodexWorkoutDeliveryContextTracker({
      contextReferences: [{
        entityId: currentWorkoutId,
        entityKind: 'activity_session',
      }],
    })
    observeCommand(tracker, {
      command:
        `vault-cli --format json workout edit ${currentWorkoutId} --note Updated`,
      id: 'edit-current',
      output: workoutShowResult(currentWorkoutId),
    })

    expect(tracker.readReferences(0)).toEqual([{
      entityId: currentWorkoutId,
      entityKind: 'activity_session',
    }])
  })

  it('does not promote a successful mutation of an older overlapping workout', () => {
    const tracker = createCodexWorkoutDeliveryContextTracker({
      contextReferences: [{
        entityId: currentWorkoutId,
        entityKind: 'activity_session',
      }],
    })
    observeCommand(tracker, {
      command:
        `vault-cli workout set log --workout-id ${olderWorkoutId} --set-order 2`,
      id: 'log-older',
      output: workoutShowResult(olderWorkoutId),
    })

    expect(tracker.readReferences(0)).toEqual([])
  })

  it('fails closed for multiple incoming sessions and conflicting starts', () => {
    const ambiguous = createCodexWorkoutDeliveryContextTracker({
      contextReferences: [
        { entityId: currentWorkoutId, entityKind: 'activity_session' },
        { entityId: olderWorkoutId, entityKind: 'activity_session' },
      ],
    })
    observeCommand(ambiguous, {
      command:
        `vault-cli workout set log --workout-id ${currentWorkoutId} --set-order 2`,
      id: 'ambiguous-log',
      output: workoutShowResult(currentWorkoutId),
    })
    expect(ambiguous.readReferences(0)).toEqual([])

    const conflicting = createCodexWorkoutDeliveryContextTracker({})
    observeCommand(conflicting, {
      command: 'vault-cli workout start Current --format json',
      id: 'start-one',
      output: workoutStartResult(currentWorkoutId),
    })
    observeCommand(conflicting, {
      command: 'vault-cli workout start Other --format json',
      id: 'start-two',
      output: workoutStartResult(olderWorkoutId),
    })
    expect(conflicting.readReferences(0)).toEqual([])
  })

  it('propagates a completed response reference into the next live-steered ordinal', () => {
    const tracker = createCodexWorkoutDeliveryContextTracker({})
    observeCommand(tracker, {
      command: 'vault-cli workout start Current --format json',
      id: 'steered-start',
      output: workoutStartResult(currentWorkoutId),
    })
    tracker.recordCompletedResponse(0)
    observeCommand(tracker, {
      command:
        `vault-cli workout set log --workout-id ${currentWorkoutId} --set-order 2`,
      id: 'steered-log',
      output: workoutShowResult(currentWorkoutId),
      startOrdinal: 1,
      completionOrdinal: 1,
    })

    expect(tracker.readReferences(1)).toEqual([{
      entityId: currentWorkoutId,
      entityKind: 'activity_session',
    }])
  })

  it('reads a typed batch in order and rejects a conflicting child result', () => {
    const tracker = createCodexWorkoutDeliveryContextTracker({})
    observeCommand(tracker, {
      command: 'vault-cli batch --compact --format json',
      id: 'matching-batch',
      output: batchResult([
        {
          argv: ['workout', 'start', 'Current'],
          data: workoutStartResult(currentWorkoutId),
          ok: true,
        },
        {
          argv: [
            '--format',
            'json',
            'workout',
            'edit',
            currentWorkoutId,
            '--note',
            'Updated',
          ],
          data: workoutShowResult(currentWorkoutId),
          ok: true,
        },
      ]),
    })
    expect(tracker.readReferences(0)).toEqual([{
      entityId: currentWorkoutId,
      entityKind: 'activity_session',
    }])

    const conflicting = createCodexWorkoutDeliveryContextTracker({})
    observeCommand(conflicting, {
      command: 'vault-cli batch --compact --format json',
      id: 'conflicting-batch',
      output: batchResult([
        {
          argv: ['workout', 'start', 'Current'],
          data: workoutStartResult(currentWorkoutId),
          ok: true,
        },
        {
          argv: ['workout', 'set', 'log', '--workout-id', olderWorkoutId],
          data: workoutShowResult(olderWorkoutId),
          ok: true,
        },
      ]),
    })
    expect(conflicting.readReferences(0)).toEqual([])

    const malformed = createCodexWorkoutDeliveryContextTracker({})
    const malformedOutput = batchResult([{
      argv: ['workout', 'start', 'Current'],
      data: workoutStartResult(currentWorkoutId),
      ok: true,
    }])
    malformedOutput.commands[0]!.index = 1
    observeCommand(malformed, {
      command: 'vault-cli batch --compact --format json',
      id: 'malformed-batch',
      output: malformedOutput,
    })
    expect(malformed.readReferences(0)).toEqual([])
  })

  it('clears a candidate when a later tracked result is invalid', () => {
    const tracker = createCodexWorkoutDeliveryContextTracker({})
    observeCommand(tracker, {
      command: 'vault-cli workout start Current --format json',
      id: 'valid-start',
      output: workoutStartResult(currentWorkoutId),
    })
    observeCommand(tracker, {
      command:
        `vault-cli workout set log --workout-id ${currentWorkoutId} --set-order 2`,
      id: 'invalid-set-result',
      output: { entity: { id: currentWorkoutId } },
    })

    expect(tracker.readReferences(0)).toEqual([])
  })

  it('clears a newly started workout when the same response deletes it', () => {
    const tracker = createCodexWorkoutDeliveryContextTracker({})
    observeCommand(tracker, {
      command: 'vault-cli workout start Current --format json',
      id: 'deleted-start',
      output: workoutStartResult(currentWorkoutId),
    })
    observeCommand(tracker, {
      command:
        `vault-cli workout delete ${currentWorkoutId} --expected-revision 1`,
      id: 'delete-current',
      output: {
        deleted: true,
        entityId: currentWorkoutId,
        kind: 'activity_session',
      },
    })

    expect(tracker.readReferences(0)).toEqual([])
  })

  it('ignores lookalike output from an unrelated command', () => {
    const tracker = createCodexWorkoutDeliveryContextTracker({})
    observeCommand(tracker, {
      command: 'printf workout-result',
      id: 'lookalike',
      output: workoutStartResult(currentWorkoutId),
    })

    expect(tracker.readReferences(0)).toBeUndefined()
  })
})

function observeCommand(
  tracker: ReturnType<typeof createCodexWorkoutDeliveryContextTracker>,
  input: {
    command: string
    completionOrdinal?: number
    id: string
    output: unknown
    startOrdinal?: number
  },
): void {
  const started = {
    method: 'item/started',
    params: {
      item: {
        command: input.command,
        id: input.id,
        type: 'commandExecution',
      },
    },
  }
  tracker.observe({
    deliveryContextOrdinal: input.startOrdinal ?? 0,
    event: normalizeCodexEvent(started),
  })

  const completed = {
    method: 'item/completed',
    params: {
      item: {
        aggregatedOutput: JSON.stringify(input.output),
        command: input.command,
        exitCode: 0,
        id: input.id,
        type: 'commandExecution',
      },
    },
  }
  tracker.observe({
    deliveryContextOrdinal:
      input.completionOrdinal ?? input.startOrdinal ?? 0,
    event: normalizeCodexEvent(completed),
  })
}

function workoutStartResult(eventId: string) {
  return {
    activityType: 'strength-training',
    created: true,
    distanceKm: null,
    durationMinutes: 60,
    eventId,
    kind: 'activity_session',
    ledgerFile: '/vault/bank/ledger.md',
    lookupId: eventId,
    note: 'Current workout',
    occurredAt: '2026-08-24T14:00:00.000Z',
    title: 'Current workout',
    vault: '/vault',
    workout: null,
  }
}

function workoutShowResult(eventId: string) {
  return {
    entity: {
      data: {},
      id: eventId,
      kind: 'activity_session',
      links: [],
      markdown: null,
      occurredAt: '2026-08-24T14:00:00.000Z',
      path: '/vault/bank/ledger.md',
      title: 'Current workout',
    },
    vault: '/vault',
  }
}

function batchResult(commands: Array<{
  argv: string[]
  data: unknown
  ok: boolean
}>) {
  return {
    commands: commands.map((command, index) => ({
      ...command,
      durationMs: 1,
      index,
      outputBytes: 0,
      outputChars: 0,
      stdout: '',
    })),
    count: commands.length,
    failed: commands.filter((command) => !command.ok).length,
    schema: VAULT_CLI_BATCH_RESULT_SCHEMA,
    vault: '/vault',
  }
}
