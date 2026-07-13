import { Cli, z } from 'incur'
import {
  assistantTonePreferenceValues,
  assistantVoiceOptionIdValues,
  assistantVoiceOptions,
} from '@murphai/contracts'
import {
  HOSTED_ASSISTANT_PRODUCT_MODELS,
} from '@murphai/hosted-execution/assistant-model'
import {
  hostedRuntimeAssistantPersonalizationToolResponseSchema,
} from '@murphai/hosted-execution/assistant-personalization'
import {
  HostedCliBridgeRequestError,
  readHostedCliBridgeEnv,
  requestHostedCliAssistantPersonalization,
} from '@murphai/hosted-execution/cli-runtime-bridge'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

const emptyArgsSchema = z.object({})
const emptyOptionsSchema = z.object({})
const voiceMapping = assistantVoiceOptions
  .map((option) => `${option.label}=${option.id}`)
  .join(', ')

export function registerPersonalizationCommands(cli: Cli.Cli) {
  const personalization = Cli.create('personalization', {
    description:
      'Read or update the current private hosted member\'s effective Murph tone, voice, and Terra/Sol model preference.',
  })

  personalization.command('show', {
    description: 'Show the current effective hosted assistant personalization.',
    args: emptyArgsSchema,
    options: emptyOptionsSchema,
    output: hostedRuntimeAssistantPersonalizationToolResponseSchema,
    async run() {
      return await requestPersonalization({ action: 'read' })
    },
  })

  personalization.command('set', {
    description:
      'Save one or more explicit hosted assistant personalization fields atomically.',
    args: emptyArgsSchema,
    options: z.object({
      model: z.enum(HOSTED_ASSISTANT_PRODUCT_MODELS)
        .optional()
        .describe('Hosted model id: gpt-5.6-terra or gpt-5.6-sol.'),
      tone: z.enum(assistantTonePreferenceValues)
        .optional()
        .describe('Saved assistant writing tone.'),
      voice: z.enum(assistantVoiceOptionIdValues)
        .optional()
        .describe(`Saved voice id. Display-label mapping: ${voiceMapping}.`),
    }),
    output: hostedRuntimeAssistantPersonalizationToolResponseSchema,
    async run({ options }) {
      if (
        options.model === undefined
        && options.tone === undefined
        && options.voice === undefined
      ) {
        throw new VaultCliError(
          'ASSISTANT_PERSONALIZATION_UPDATE_EMPTY',
          'Pass --model, --tone, or --voice.',
        )
      }

      return await requestPersonalization({
        action: 'update',
        ...(options.model === undefined ? {} : { model: options.model }),
        ...(options.tone === undefined ? {} : { tone: options.tone }),
        ...(options.voice === undefined ? {} : { voice: options.voice }),
      })
    },
  })

  cli.command(personalization)
}

async function requestPersonalization(
  request: Parameters<typeof requestHostedCliAssistantPersonalization>[0]['request'],
) {
  let bridge
  try {
    bridge = readHostedCliBridgeEnv(process.env)
  } catch (error) {
    throw new VaultCliError(
      'HOSTED_ASSISTANT_PERSONALIZATION_BRIDGE_INVALID',
      error instanceof Error
        ? error.message
        : 'Hosted assistant personalization bridge configuration is invalid.',
    )
  }

  if (!bridge) {
    throw new VaultCliError(
      'HOSTED_ASSISTANT_PERSONALIZATION_UNAVAILABLE',
      'Assistant personalization is available only in a private hosted conversation.',
    )
  }

  return await requestHostedCliAssistantPersonalization({
    bridge,
    request,
  }).catch((error) => {
    const timeout = error instanceof HostedCliBridgeRequestError
      && error.code === 'HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT'
    throw new VaultCliError(
      timeout
        ? 'HOSTED_ASSISTANT_PERSONALIZATION_BRIDGE_REQUEST_TIMEOUT'
        : 'HOSTED_ASSISTANT_PERSONALIZATION_BRIDGE_REQUEST_FAILED',
      error instanceof Error
        ? error.message
        : 'Hosted assistant personalization bridge request failed.',
    )
  })
}
