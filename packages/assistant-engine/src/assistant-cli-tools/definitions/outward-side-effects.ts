import { buildSharePackFromVault } from '@murphai/core'
import { z } from 'zod'
import type { AssistantCapabilityDefinition } from '../../model-harness.js'
import type { AssistantToolContext } from '../shared.js'
import { defineHostedApiBackedTool } from '../definition-factory.js'

const isoTimestampSchema = z.string().min(1)
const shareEntitySelectorSchema = z
  .object({
    id: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    group: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.id || value.slug), {
    message: 'Provide either an id or slug.',
  })

export function createOutwardSideEffectToolDefinitions(
  input: AssistantToolContext,
) {
  const tools: AssistantCapabilityDefinition[] = []

  if (input.executionContext?.hosted?.issueDeviceConnectLink) {
    tools.push(
      defineHostedApiBackedTool({
        name: 'murph.device.connect',
        description:
          'Create a hosted wearable connection link for the requested provider and return a clickable authorization URL for the user. Prefer this over `vault.cli.run` when the user wants help connecting Garmin, Oura, Strava, WHOOP, or another hosted wearable integration in hosted assistant sessions.',
        inputSchema: z.object({
          provider: z.string().min(1),
        }),
        inputExample: {
          provider: 'whoop',
        },
        execute: ({ provider }) =>
          input.executionContext!.hosted!.issueDeviceConnectLink!({
            provider,
          }),
      }),
    )
  }

  if (input.executionContext?.hosted?.issueShareLink) {
    tools.push(
      defineHostedApiBackedTool({
        name: 'vault.share.createLink',
        description:
          'Create a one-time hosted share link for remembered foods, recipes, and protocols. When a food has attached protocol ids, keep includeAttachedProtocols=true so the recipient gets the full smoothie + supplement bundle.',
        inputSchema: z.object({
          title: z.string().min(1).optional(),
          foods: z.array(shareEntitySelectorSchema).optional(),
          protocols: z.array(shareEntitySelectorSchema).optional(),
          recipes: z.array(shareEntitySelectorSchema).optional(),
          includeAttachedProtocols: z.boolean().optional(),
          logMeal: z.object({
            food: shareEntitySelectorSchema,
            note: z.string().min(1).optional(),
            occurredAt: isoTimestampSchema.optional(),
          }).optional(),
          recipientPhoneNumber: z.string().min(1).optional(),
          inviteCode: z.string().min(1).optional(),
          expiresInHours: z.number().int().positive().max(24 * 30).optional(),
        }),
        inputExample: {
          foods: [
            {
              slug: 'morning-smoothie',
            },
          ],
          includeAttachedProtocols: true,
          logMeal: {
            food: {
              slug: 'morning-smoothie',
            },
          },
        },
        execute: async ({
          expiresInHours,
          foods,
          includeAttachedProtocols,
          inviteCode,
          logMeal,
          protocols,
          recipientPhoneNumber,
          recipes,
          title,
        }) => {
          const pack = await buildSharePackFromVault({
            vaultRoot: input.vault,
            title,
            foods,
            protocols,
            recipes,
            includeAttachedProtocols,
            logMeal,
          })

          return input.executionContext!.hosted!.issueShareLink!({
            pack,
            expiresInHours,
            inviteCode,
            recipientPhoneNumber,
          })
        },
      }),
    )
  }

  return tools
}
