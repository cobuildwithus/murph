import * as z from '@murphai/contracts/zod-runtime'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { logScheduledLiveWorkoutSet } from '@murphai/vault-usecases/workouts'

import type {
  AssistantHostedInvocationScope,
} from '../../assistant/hosted-tool-context.js'
import type {
  AssistantScheduledWorkoutDirectReplyAuthority,
} from '../../assistant/service-contracts.js'
import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const scheduledWorkoutRolloverArgumentsSchema = z.object({
  previousWorkoutId: z.string().regex(/^evt_[0-9A-Za-z]+$/u),
  routineId: z.string().regex(/^wfmt_[0-9A-Za-z]+$/u),
  exerciseName: z.string().trim().min(1).max(160),
  exerciseOrder: z.number().int().positive(),
  setOrder: z.number().int().positive(),
  type: z.enum(['normal', 'warmup', 'dropset', 'failure']).optional(),
  note: z.string().trim().min(1).max(400).optional(),
  reps: z.number().int().nonnegative().optional(),
  weight: z.number().nonnegative().optional(),
  weightUnit: z.enum(['lb', 'kg']).optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  distanceMeters: z.number().nonnegative().optional(),
  rpe: z.number().min(0).max(10).optional(),
  bodyweightKg: z.number().nonnegative().optional(),
  assistanceKg: z.number().nonnegative().optional(),
  addedWeightKg: z.number().nonnegative().optional(),
}).strict()

export const MURPH_SCHEDULED_WORKOUT_ROLLOVER_TOOL = {
  namespace: 'murph',
  name: 'log_scheduled_workout_set',
  description:
    'Close one fully logged prior live workout, start the exact saved routine occurrence identified by the current direct reminder reply, and log one member-stated set result. This tool is offered only for the exact host-authorized root reply. Provide semantic workout coordinates and actuals only; timestamps, reply identity, and retry identity are bound by the host.',
  inputSchema: z.toJSONSchema(scheduledWorkoutRolloverArgumentsSchema, {
    io: 'input',
  }),
} as const

export type ScheduledWorkoutRolloverDynamicToolRequest =
  | {
      kind: 'scheduled-workout-rollover'
      request: z.infer<typeof scheduledWorkoutRolloverArgumentsSchema>
    }
  | {
      kind: 'invalid-scheduled-workout-rollover-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readScheduledWorkoutRolloverDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): ScheduledWorkoutRolloverDynamicToolRequest | null {
  if (input.tool !== MURPH_SCHEDULED_WORKOUT_ROLLOVER_TOOL.name) {
    return null
  }

  const parsed = parseDynamicToolArguments({
    schema: scheduledWorkoutRolloverArgumentsSchema,
    schemaRootKeys: [
      'previousWorkoutId',
      'routineId',
      'exerciseName',
      'exerciseOrder',
      'setOrder',
      'type',
      'note',
      'reps',
      'weight',
      'weightUnit',
      'durationSeconds',
      'distanceMeters',
      'rpe',
      'bodyweightKg',
      'assistanceKg',
      'addedWeightKg',
    ],
    toolName: 'murph.log_scheduled_workout_set',
    value: input.arguments,
  })

  return parsed.ok
    ? { kind: 'scheduled-workout-rollover', request: parsed.args }
    : {
        kind: 'invalid-scheduled-workout-rollover-arguments',
        validationDigest: parsed.validationDigest,
      }
}

export async function executeScheduledWorkoutRolloverDynamicTool(input: {
  authority: AssistantScheduledWorkoutDirectReplyAuthority | null
  invocationScope: AssistantHostedInvocationScope | null
  request: Extract<
    ScheduledWorkoutRolloverDynamicToolRequest,
    { kind: 'scheduled-workout-rollover' }
  >
  vaultRoot: string | null
}): Promise<{
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
}> {
  if (!input.vaultRoot) {
    return scheduledWorkoutRolloverTextResult(
      false,
      'scheduled workout rollover is unavailable without a vault',
    )
  }
  if (
    input.authority === null ||
    input.invocationScope?.conversationScope !== 'direct' ||
    input.invocationScope.origin.kind !== 'accepted_input' ||
    input.invocationScope.origin.assistantInputId !==
      input.authority.authorizedAssistantInputId
  ) {
    return scheduledWorkoutRolloverTextResult(
      false,
      'scheduled workout rollover requires the exact current direct reminder reply',
    )
  }

  try {
    const shown = await logScheduledLiveWorkoutSet({
      vault: input.vaultRoot,
      ...input.request.request,
      acceptedAt: input.authority.acceptedAt,
      operationId: input.authority.operationId,
      reminderSentAt: input.authority.reminderSentAt,
      scheduledOccurrenceAt: input.authority.scheduledOccurrenceAt,
    })
    return scheduledWorkoutRolloverTextResult(
      true,
      JSON.stringify({
        status: 'logged',
        workout: shown.entity,
      }),
    )
  } catch (error) {
    return scheduledWorkoutRolloverTextResult(
      false,
      error instanceof VaultCliError
        ? error.message
        : 'scheduled workout rollover could not be completed',
    )
  }
}

function scheduledWorkoutRolloverTextResult(
  success: boolean,
  text: string,
): {
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
} {
  return {
    rpcResult: {
      contentItems: [{ text, type: 'inputText' }],
      success,
    },
  }
}
