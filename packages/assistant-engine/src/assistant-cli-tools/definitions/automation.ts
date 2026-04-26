import { z } from 'zod'
import { assistantCronScheduleInputSchema } from '@murphai/operator-config/assistant-cli-contracts'
import { createCurrentThreadReminder } from '../../assistant/cron/current-thread-reminder.js'
import { defineHandAuthoredHelperTool } from '../definition-factory.js'
import type { AssistantToolContext } from '../shared.js'

export function createAssistantAutomationToolDefinitions(
  input: AssistantToolContext,
) {
  return [
    defineHandAuthoredHelperTool({
      name: 'assistant.automation.createReminderForCurrentThread',
      description:
        'Create an assistant reminder for this exact current direct conversation thread. Use this when the user asks to be reminded, texted here, or notified in this iMessage/current chat. The route is derived from the active session binding; do not ask for or copy thread IDs, deliveryTarget values, or saved self-targets for this case.',
      inputSchema: z.object({
        title: z.string().trim().min(1),
        instructions: z.string().trim().min(1),
        schedule: assistantCronScheduleInputSchema,
        enabled: z.boolean().optional(),
        userOptedIn: z.literal(true),
      }),
      inputExample: {
        title: 'End-of-day check-in',
        instructions:
          'At the scheduled time, ask whether the user finished the end-of-day task.',
        schedule: {
          kind: 'at',
          at: '2026-04-26T17:00:00.000Z',
        },
        userOptedIn: true,
      },
      execute: ({ title, instructions, schedule, enabled, userOptedIn }) =>
        createCurrentThreadReminder({
          vault: input.vault,
          sessionId: input.sessionId,
          sessionBinding: input.sessionBinding,
          title,
          instructions,
          schedule,
          enabled,
          userOptedIn,
        }),
    }),
  ]
}
