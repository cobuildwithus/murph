import { buildSharePackFromVault } from '@murphai/core'
import { z } from 'zod'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { AssistantCapabilityDefinition } from '../../model-harness.js'
import type { AssistantToolContext } from '../shared.js'
import { defineHostedApiBackedTool } from '../definition-factory.js'
import {
  formatAssistantHostedDeviceConnectProviderList,
  normalizeAssistantHostedDeviceConnectProviderKey,
  normalizeAssistantHostedDeviceConnectProviders,
} from '../../assistant/execution-context.js'

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
  const hosted = input.executionContext?.hosted ?? null
  const deviceConnectProviders = normalizeAssistantHostedDeviceConnectProviders(
    hosted?.deviceConnectProviders,
  )

  if (hosted?.issueDeviceConnectLink && deviceConnectProviders.length > 0) {
    const supportedProviders = new Set(
      deviceConnectProviders.map((entry) => entry.provider),
    )
    const providerList = formatAssistantHostedDeviceConnectProviderList(
      deviceConnectProviders,
    )
    tools.push(
      defineHostedApiBackedTool({
        name: 'murph.device.connect',
        description: [
          `Create a hosted wearable connection link and return a clickable authorization URL for one of the currently supported providers: ${providerList}.`,
          'Use this instead of `vault.cli.run` for supported hosted wearable connection requests.',
          'Do not call this tool for any other provider; explain that automatic connection is not available and offer manual logging, screenshots, or a supported provider instead.',
        ].join(' '),
        inputSchema: z.object({
          provider: z.string().trim().min(1).transform((value) => value.toLowerCase()),
        }),
        inputExample: {
          provider: deviceConnectProviders[0]!.provider,
        },
        execute: ({ provider }) =>
          issueHostedDeviceConnectLink({
            issueDeviceConnectLink: hosted.issueDeviceConnectLink!,
            provider,
            providerList,
            supportedProviders,
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

async function issueHostedDeviceConnectLink(input: {
  issueDeviceConnectLink: NonNullable<
    NonNullable<
      NonNullable<AssistantToolContext['executionContext']>['hosted']
    >['issueDeviceConnectLink']
  >
  provider: string
  providerList: string
  supportedProviders: ReadonlySet<string>
}) {
  const provider = normalizeAssistantHostedDeviceConnectProviderKey(input.provider)
  if (!provider || !input.supportedProviders.has(provider)) {
    throw new VaultCliError(
      'ASSISTANT_UNSUPPORTED_HOSTED_DEVICE_PROVIDER',
      [
        `Hosted device connection is currently supported only for ${input.providerList}.`,
        'Do not call `murph.device.connect` for unsupported providers; tell the user automatic connection is not available and offer manual logging, screenshots, or a supported provider.',
      ].join(' '),
    )
  }

  return input.issueDeviceConnectLink({
    provider,
  })
}
