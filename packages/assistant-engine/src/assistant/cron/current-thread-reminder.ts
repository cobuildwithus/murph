import {
  type AssistantCronJob,
  type AssistantCronScheduleInput,
  type AssistantSessionBinding,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { getAssistantChannelAdapter } from '../channel-adapters.js'
import { normalizeNullableString } from '../shared.js'
import { addAssistantCronJob } from './authoring.js'

export interface CreateCurrentThreadReminderInput {
  enabled?: boolean
  instructions: string
  now?: Date
  schedule: AssistantCronScheduleInput
  sessionBinding?: AssistantSessionBinding | null
  sessionId?: string | null
  title: string
  userOptedIn: boolean
  vault: string
}

export interface CurrentThreadReminderResult {
  job: Pick<AssistantCronJob, 'enabled' | 'jobId' | 'name' | 'schedule' | 'state'>
  route: {
    channel: string
    userFacingChannel: string
    identityBound: boolean
    routeKind: 'current-thread'
    threadBound: true
  }
}

export async function createCurrentThreadReminder(
  input: CreateCurrentThreadReminderInput,
): Promise<CurrentThreadReminderResult> {
  if (input.userOptedIn !== true) {
    throw new VaultCliError(
      'ASSISTANT_CURRENT_THREAD_REMINDER_OPT_IN_REQUIRED',
      'Create a current-thread reminder only after the user explicitly asks for it or agrees to it.',
    )
  }

  const route = resolveCurrentThreadReminderRoute(input.sessionBinding)
  const job = await addAssistantCronJob({
    vault: input.vault,
    name: input.title,
    prompt: input.instructions,
    schedule: input.schedule,
    enabled: input.enabled,
    now: input.now,
    sessionId: normalizeNullableString(input.sessionId) ?? undefined,
    channel: route.channel,
    identityId: route.identityId ?? undefined,
    participantId: undefined,
    threadId: route.threadId,
    deliveryTarget: undefined,
    resolveTargetDefaults: false,
  })

  return {
    job: {
      enabled: job.enabled,
      jobId: job.jobId,
      name: job.name,
      schedule: job.schedule,
      state: job.state,
    },
    route: {
      channel: route.channel,
      userFacingChannel: renderUserFacingChannel(route.channel),
      identityBound: route.identityId !== null,
      routeKind: 'current-thread',
      threadBound: true,
    },
  }
}

function resolveCurrentThreadReminderRoute(
  binding: AssistantSessionBinding | null | undefined,
): {
  channel: string
  identityId: string | null
  threadId: string
} {
  const channel = normalizeNullableString(binding?.channel)
  const threadId = normalizeNullableString(binding?.threadId)

  if (!binding || !channel || !threadId) {
    throw new VaultCliError(
      'ASSISTANT_CURRENT_THREAD_ROUTE_UNAVAILABLE',
      'This assistant turn is not bound to a thread that can receive a current-thread reminder.',
    )
  }

  if (binding.threadIsDirect !== true) {
    throw new VaultCliError(
      'ASSISTANT_CURRENT_THREAD_ROUTE_NOT_DIRECT',
      'Current-thread reminders require a direct conversation thread.',
    )
  }

  if (!getAssistantChannelAdapter(channel)) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_UNSUPPORTED',
      `Outbound delivery for channel "${renderUserFacingChannel(channel)}" is not supported in this build.`,
    )
  }

  return {
    channel,
    identityId: normalizeNullableString(binding.identityId),
    threadId,
  }
}

function renderUserFacingChannel(channel: string): string {
  return channel === 'linq' ? 'iMessage' : channel
}
