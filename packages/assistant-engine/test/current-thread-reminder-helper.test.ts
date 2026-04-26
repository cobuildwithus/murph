import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AssistantCronJob,
  AssistantCronScheduleInput,
  AssistantSessionBinding,
} from '@murphai/operator-config/assistant-cli-contracts'
import { createCurrentThreadReminder } from '../src/assistant/cron/current-thread-reminder.ts'
import { createAssistantAutomationToolDefinitions } from '../src/assistant-cli-tools/definitions/automation.ts'

const helperMocks = vi.hoisted(() => ({
  addAssistantCronJob: vi.fn(),
}))

vi.mock('../src/assistant/cron/authoring.js', () => ({
  addAssistantCronJob: helperMocks.addAssistantCronJob,
}))

describe('current-thread reminder helper', () => {
  beforeEach(() => {
    helperMocks.addAssistantCronJob.mockReset()
  })

  it('creates reminders with an explicit current-thread route and no saved-target fallback', async () => {
    const schedule = createAtSchedule()
    helperMocks.addAssistantCronJob.mockResolvedValue(createCronJob(schedule))

    const result = await createCurrentThreadReminder({
      vault: '/tmp/murph-vault',
      sessionId: 'asst_sess_current_thread',
      sessionBinding: createDirectLinqBinding(),
      title: 'End-of-day check-in',
      instructions: 'Ask whether the user finished the end-of-day task.',
      schedule,
      userOptedIn: true,
    })

    expect(helperMocks.addAssistantCronJob).toHaveBeenCalledWith({
      vault: '/tmp/murph-vault',
      name: 'End-of-day check-in',
      prompt: 'Ask whether the user finished the end-of-day task.',
      schedule,
      enabled: undefined,
      now: undefined,
      sessionId: 'asst_sess_current_thread',
      channel: 'linq',
      identityId: 'linq_identity_1',
      participantId: undefined,
      threadId: 'linq_thread_1',
      deliveryTarget: undefined,
      resolveTargetDefaults: false,
    })
    expect(result.route).toEqual({
      channel: 'linq',
      userFacingChannel: 'iMessage',
      identityBound: true,
      routeKind: 'current-thread',
      threadBound: true,
    })
    expect(result.job).toMatchObject({
      enabled: true,
      jobId: 'auto_current_thread',
      name: 'End-of-day check-in',
    })
  })

  it('rejects non-direct thread bindings before writing an automation', async () => {
    await expect(
      createCurrentThreadReminder({
        vault: '/tmp/murph-vault',
        sessionId: 'asst_sess_group_thread',
        sessionBinding: {
          ...createDirectLinqBinding(),
          threadIsDirect: false,
        },
        title: 'Group reminder',
        instructions: 'Ask the group about the task.',
        schedule: createAtSchedule(),
        userOptedIn: true,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CURRENT_THREAD_ROUTE_NOT_DIRECT',
    })

    expect(helperMocks.addAssistantCronJob).not.toHaveBeenCalled()
  })

  it('exposes the same primitive through the provider-turn automation tool', async () => {
    const schedule = createAtSchedule()
    helperMocks.addAssistantCronJob.mockResolvedValue(createCronJob(schedule))
    const [tool] = createAssistantAutomationToolDefinitions({
      vault: '/tmp/murph-vault',
      sessionId: 'asst_sess_tool_thread',
      sessionBinding: createDirectLinqBinding(),
    })
    const executor = tool.executionBindings['native-local']
    if (!executor) {
      throw new Error('missing native-local executor')
    }

    const result = await executor({
      title: 'Follow up',
      instructions: 'Follow up in this chat.',
      schedule,
      userOptedIn: true,
    })

    expect(helperMocks.addAssistantCronJob).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'linq',
        threadId: 'linq_thread_1',
        deliveryTarget: undefined,
        resolveTargetDefaults: false,
        sessionId: 'asst_sess_tool_thread',
      }),
    )
    expect(result).toMatchObject({
      route: {
        userFacingChannel: 'iMessage',
        routeKind: 'current-thread',
      },
    })
  })
})

function createDirectLinqBinding(): AssistantSessionBinding {
  return {
    conversationKey: 'linq:linq_thread_1',
    channel: 'linq',
    identityId: 'linq_identity_1',
    actorId: 'linq_actor_1',
    threadId: 'linq_thread_1',
    threadIsDirect: true,
    delivery: {
      kind: 'thread',
      target: 'linq_thread_1',
    },
  }
}

function createAtSchedule(): AssistantCronScheduleInput {
  return {
    kind: 'at',
    at: '2026-04-26T17:00:00.000Z',
  }
}

function createCronJob(schedule: AssistantCronScheduleInput): AssistantCronJob {
  return {
    schema: 'murph.assistant-cron-job.v1',
    jobId: 'auto_current_thread',
    name: 'End-of-day check-in',
    enabled: true,
    keepAfterRun: false,
    prompt: 'Ask whether the user finished the end-of-day task.',
    schedule,
    target: {
      sessionId: 'asst_sess_current_thread',
      alias: null,
      channel: 'linq',
      identityId: 'linq_identity_1',
      participantId: null,
      threadId: 'linq_thread_1',
      deliveryTarget: null,
    },
    createdAt: '2026-04-26T00:00:00.000Z',
    updatedAt: '2026-04-26T00:00:00.000Z',
    state: {
      nextRunAt: '2026-04-26T17:00:00.000Z',
      lastRunAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      consecutiveFailures: 0,
      lastError: null,
      runningAt: null,
      runningPid: null,
    },
  }
}
