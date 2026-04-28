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
