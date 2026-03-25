import {
  readAssistantAutomationState,
  saveAssistantAutomationState,
} from '../assistant-state.js'
import { resolveAgentmailApiKey } from '../agentmail-runtime.js'
import { getAssistantChannelAdapter } from '../assistant/channel-adapters.js'
import type { InboxCliServices } from '../inbox-services.js'
import type {
  SetupAgentmailInboxSelection,
  SetupAgentmailSelectionResolver,
} from '../setup-agentmail.js'
import { resolveTelegramBotToken } from '../telegram-runtime.js'
import {
  resolveSetupChannelMissingEnv,
  SETUP_RUNTIME_ENV_NOTICE,
} from '../setup-runtime-env.js'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  type SetupChannel,
  type SetupConfiguredChannel,
  type SetupStepResult,
  setupChannelValues,
} from '../setup-cli-contracts.js'
import { createStep } from './steps.js'

const IMESSAGE_SETUP_CONNECTOR_ID = 'imessage:self'
const IMESSAGE_SETUP_ACCOUNT_ID = 'self'
const TELEGRAM_SETUP_CONNECTOR_ID = 'telegram:bot'
const TELEGRAM_SETUP_ACCOUNT_ID = 'bot'
const LINQ_SETUP_CONNECTOR_ID = 'linq:default'
const LINQ_SETUP_ACCOUNT_ID = 'default'
const EMAIL_SETUP_CONNECTOR_ID = 'email:agentmail'
const EMAIL_SETUP_DISPLAY_NAME = 'Healthy Bob'

function isSetupChannelSupportedOnPlatform(
  channel: SetupChannel,
  platform: NodeJS.Platform,
): boolean {
  return channel !== 'imessage' || platform === 'darwin'
}

type SetupChannelInboxServices = Pick<InboxCliServices, 'bootstrap'> &
  Partial<
    Pick<InboxCliServices, 'doctor' | 'sourceAdd' | 'sourceList' | 'sourceSetEnabled'>
  >

type SetupListedConnector =
  Awaited<ReturnType<NonNullable<SetupChannelInboxServices['sourceList']>>>['connectors'][number]
type SetupAddedConnectorResult = Awaited<
  ReturnType<NonNullable<SetupChannelInboxServices['sourceAdd']>>
>
type SetupAddedEmailConnectorResult = SetupAddedConnectorResult & {
  selectedInbox: SetupAgentmailInboxSelection | null
}
type ManagedSetupChannel = Exclude<SetupChannel, 'imessage'>
type SetupReadiness = Awaited<ReturnType<typeof probeSetupReadiness>>

type ManagedSetupChannelMessages = {
  stepDetail: string
  detail: string
}

type ManagedSetupChannelDefinition<
  TAdded extends SetupAddedConnectorResult = SetupAddedConnectorResult,
> = {
  channel: ManagedSetupChannel
  connectorId: string
  title: string
  stepId: string
  readyForSetup: boolean
  missingEnv: string[]
  dryRunStepDetail: string
  dryRunDetail: string
  runtimeUnavailableMessage: string
  fallbackReason: string
  treatProbeWarnAsReady?: boolean
  findExistingConnector(connectors: readonly SetupListedConnector[]): SetupListedConnector | null
  addConnector(
    sourceAdd: NonNullable<SetupChannelInboxServices['sourceAdd']>,
  ): Promise<TAdded>
  describeMissingEnv(
    existingConnector: SetupListedConnector | null,
  ): ManagedSetupChannelMessages
  describeReused(input: {
    connector: SetupListedConnector
    readiness: SetupReadiness
  }): ManagedSetupChannelMessages
  describeAdded(input: {
    added: TAdded
    readiness: SetupReadiness
  }): ManagedSetupChannelMessages
}

function isSetupChannel(value: string): value is SetupChannel {
  return setupChannelValues.includes(value as SetupChannel)
}

export function normalizeSetupChannels(
  value: readonly SetupChannel[] | null | undefined,
): SetupChannel[] {
  return [...new Set(value ?? [])]
}

export async function configureSetupChannels(input: {
  allowPrompt?: boolean
  channels: readonly SetupChannel[]
  dryRun: boolean
  env: NodeJS.ProcessEnv
  inboxServices: SetupChannelInboxServices
  platform?: NodeJS.Platform
  requestId: string | null
  resolveAgentmailInboxSelection?: SetupAgentmailSelectionResolver
  steps: SetupStepResult[]
  vault: string
}): Promise<SetupConfiguredChannel[]> {
  const configured: SetupConfiguredChannel[] = []
  const platform = input.platform ?? process.platform

  if (input.channels.includes('imessage')) {
    configured.push(
      await configureIMessageChannel({
        dryRun: input.dryRun,
        inboxServices: input.inboxServices,
        platform,
        requestId: input.requestId,
        steps: input.steps,
        vault: input.vault,
      }),
    )
  }

  if (input.channels.includes('telegram')) {
    configured.push(
      await configureTelegramChannel({
        dryRun: input.dryRun,
        env: input.env,
        inboxServices: input.inboxServices,
        requestId: input.requestId,
        steps: input.steps,
        vault: input.vault,
      }),
    )
  }

  if (input.channels.includes('linq')) {
    configured.push(
      await configureLinqChannel({
        dryRun: input.dryRun,
        env: input.env,
        inboxServices: input.inboxServices,
        requestId: input.requestId,
        steps: input.steps,
        vault: input.vault,
      }),
    )
  }

  if (input.channels.includes('email')) {
    configured.push(
      await configureEmailChannel({
        allowPrompt: input.allowPrompt ?? false,
        dryRun: input.dryRun,
        env: input.env,
        inboxServices: input.inboxServices,
        requestId: input.requestId,
        resolveAgentmailInboxSelection: input.resolveAgentmailInboxSelection,
        steps: input.steps,
        vault: input.vault,
      }),
    )
  }

  if (!input.dryRun) {
    await reconcileDeselectedSetupChannels({
      channels: input.channels,
      inboxServices: input.inboxServices,
      platform,
      requestId: input.requestId,
      vault: input.vault,
    })
    await updateAssistantChannelState({
      autoReplyChannels: configured
        .filter((channel) => channel.autoReply)
        .map((channel) => channel.channel),
      platform,
      preferredChannels: filterPersistedSetupChannels(input.channels, platform),
      vault: input.vault,
    })
  }

  return configured
}

function filterPersistedSetupChannels(
  channels: readonly SetupChannel[],
  platform: NodeJS.Platform,
): SetupChannel[] {
  return normalizeSetupChannels(channels).filter((channel) =>
    isSetupChannelSupportedOnPlatform(channel, platform),
  )
}

async function configureIMessageChannel(input: {
  dryRun: boolean
  inboxServices: SetupChannelInboxServices
  platform: NodeJS.Platform
  requestId: string | null
  steps: SetupStepResult[]
  vault: string
}): Promise<SetupConfiguredChannel> {
  if (input.platform !== 'darwin') {
    input.steps.push(
      createStep({
        detail:
          'Skipped iMessage because it requires Messages.app and the local Messages database on macOS.',
        id: 'channel-imessage',
        kind: 'configure',
        status: 'skipped',
        title: 'iMessage channel',
      }),
    )

    return {
      autoReply: false,
      channel: 'imessage',
      configured: false,
      connectorId: null,
      detail:
        'Skipped iMessage because it requires macOS. Use Telegram, Linq, or email on Linux, or run iMessage from a Mac host.',
      enabled: true,
      missingEnv: [],
    }
  }

  if (input.dryRun) {
    input.steps.push(
      createStep({
        detail:
          'Would add the imessage:self inbox connector and enable assistant auto-reply for new iMessage conversations.',
        id: 'channel-imessage',
        kind: 'configure',
        status: 'planned',
        title: 'iMessage channel',
      }),
    )

    return {
      autoReply: true,
      channel: 'imessage',
      configured: false,
      connectorId: IMESSAGE_SETUP_CONNECTOR_ID,
      detail:
        'Would configure the local iMessage inbox connector and enable assistant auto-reply for new conversations.',
      enabled: true,
      missingEnv: [],
    }
  }

  const sourceList = input.inboxServices.sourceList
  const sourceAdd = input.inboxServices.sourceAdd
  const sourceSetEnabled = input.inboxServices.sourceSetEnabled
  if (!sourceList || !sourceAdd) {
    throw new VaultCliError(
      'runtime_unavailable',
      'Healthy Bob setup cannot configure iMessage because the inbox source management services are unavailable in this build.',
    )
  }

  const listed = await sourceList({
    vault: input.vault,
    requestId: input.requestId,
  })
  const existingConnector =
    listed.connectors.find((connector) => connector.id === IMESSAGE_SETUP_CONNECTOR_ID) ??
    listed.connectors.find(
      (connector) =>
        connector.source === 'imessage' && connector.accountId === IMESSAGE_SETUP_ACCOUNT_ID,
    ) ??
    null

  if (existingConnector) {
    await ensureSetupConnectorEnabled({
      connectorId: existingConnector.id,
      enabled: existingConnector.enabled,
      requestId: input.requestId,
      sourceSetEnabled,
      vault: input.vault,
    })
    input.steps.push(
      createStep({
        detail:
          `Reusing the iMessage inbox connector "${existingConnector.id}" and enabling assistant auto-reply for new iMessage conversations.`,
        id: 'channel-imessage',
        kind: 'configure',
        status: 'reused',
        title: 'iMessage channel',
      }),
    )

    return {
      autoReply: true,
      channel: 'imessage',
      configured: true,
      connectorId: existingConnector.id,
      detail:
        `Reused the iMessage connector "${existingConnector.id}" and enabled assistant auto-reply for new iMessage conversations.`,
      enabled: true,
      missingEnv: [],
    }
  }

  const added = await sourceAdd({
    account: IMESSAGE_SETUP_ACCOUNT_ID,
    id: IMESSAGE_SETUP_CONNECTOR_ID,
    includeOwn: true,
    requestId: input.requestId,
    source: 'imessage',
    vault: input.vault,
  })

  input.steps.push(
    createStep({
      detail:
        `Added the iMessage inbox connector "${added.connector.id}" and enabled assistant auto-reply for new iMessage conversations.`,
      id: 'channel-imessage',
      kind: 'configure',
      status: 'completed',
      title: 'iMessage channel',
    }),
  )

  return {
    autoReply: true,
    channel: 'imessage',
    configured: true,
    connectorId: added.connector.id,
    detail:
      `Configured the iMessage connector "${added.connector.id}" and enabled assistant auto-reply for new iMessage conversations.`,
    enabled: true,
    missingEnv: [],
  }
}

async function configureTelegramChannel(input: {
  dryRun: boolean
  env: NodeJS.ProcessEnv
  inboxServices: SetupChannelInboxServices
  requestId: string | null
  steps: SetupStepResult[]
  vault: string
}): Promise<SetupConfiguredChannel> {
  const telegramAdapter = getAssistantChannelAdapter('telegram')
  const token = resolveTelegramBotToken(input.env)
  const readyForSetup = telegramAdapter?.isReadyForSetup(input.env) ?? Boolean(token)
  const missingEnv = resolveSetupChannelMissingEnv('telegram', input.env)

  return configureManagedSetupChannel({
    definition: {
      channel: 'telegram',
      connectorId: TELEGRAM_SETUP_CONNECTOR_ID,
      title: 'Telegram channel',
      stepId: 'channel-telegram',
      readyForSetup,
      missingEnv,
      dryRunStepDetail: token
        ? 'Would verify the Telegram bot token, add or reuse the telegram:bot inbox connector, and enable assistant auto-reply for Telegram direct chats.'
        : 'Would configure Telegram once TELEGRAM_BOT_TOKEN is available in the shell or local `.env`.',
      dryRunDetail: token
        ? 'Would configure the Telegram bot connector and enable assistant auto-reply for Telegram direct chats.'
        : `Telegram needs TELEGRAM_BOT_TOKEN in the current environment before setup can enable the channel. ${SETUP_RUNTIME_ENV_NOTICE}`,
      runtimeUnavailableMessage:
        'Healthy Bob setup cannot configure Telegram because the inbox source management services are unavailable in this build.',
      fallbackReason: 'Telegram readiness probe failed',
      findExistingConnector(connectors) {
        return (
          connectors.find((connector) => connector.id === TELEGRAM_SETUP_CONNECTOR_ID) ??
          connectors.find(
            (connector) =>
              connector.source === 'telegram' &&
              connector.accountId === TELEGRAM_SETUP_ACCOUNT_ID,
          ) ??
          null
        )
      },
      async addConnector(sourceAdd) {
        return sourceAdd({
          account: TELEGRAM_SETUP_ACCOUNT_ID,
          id: TELEGRAM_SETUP_CONNECTOR_ID,
          requestId: input.requestId,
          source: 'telegram',
          vault: input.vault,
        })
      },
      describeMissingEnv(existingConnector) {
        return {
          stepDetail: existingConnector
            ? `Reused the Telegram inbox connector "${existingConnector.id}", but did not enable assistant auto-reply because TELEGRAM_BOT_TOKEN was not available in the shell or local \`.env\`.`
            : 'Telegram was selected, but setup did not add the connector because TELEGRAM_BOT_TOKEN was not available in the shell or local `.env`.',
          detail: existingConnector
            ? `Reused the Telegram connector "${existingConnector.id}", but skipped assistant auto-reply until a bot token is available in the current environment. ${SETUP_RUNTIME_ENV_NOTICE}`
            : `Telegram needs TELEGRAM_BOT_TOKEN in the current environment before setup can add the connector and enable assistant auto-reply. ${SETUP_RUNTIME_ENV_NOTICE}`,
        }
      },
      describeReused({ connector, readiness }) {
        return {
          stepDetail: readiness.ready
            ? `Reusing the Telegram inbox connector "${connector.id}" and enabling assistant auto-reply for Telegram direct chats.`
            : `Reused the Telegram inbox connector "${connector.id}", but did not enable assistant auto-reply because the bot token could not authenticate${readiness.reason ? ` (${readiness.reason})` : ''}.`,
          detail: readiness.ready
            ? `Reused the Telegram connector "${connector.id}" and enabled assistant auto-reply for Telegram direct chats.`
            : `Reused the Telegram connector "${connector.id}", but skipped assistant auto-reply until the bot token authenticates successfully with Telegram${readiness.reason ? ` (${readiness.reason})` : ''}.`,
        }
      },
      describeAdded({ added, readiness }) {
        return {
          stepDetail: readiness.ready
            ? `Added the Telegram inbox connector "${added.connector.id}" and enabled assistant auto-reply for Telegram direct chats.`
            : `Added the Telegram inbox connector "${added.connector.id}", but did not enable assistant auto-reply because the bot token could not authenticate${readiness.reason ? ` (${readiness.reason})` : ''}.`,
          detail: readiness.ready
            ? `Configured the Telegram connector "${added.connector.id}" and enabled assistant auto-reply for Telegram direct chats.`
            : `Configured the Telegram connector "${added.connector.id}", but skipped assistant auto-reply until the bot token authenticates successfully with Telegram${readiness.reason ? ` (${readiness.reason})` : ''}.`,
        }
      },
    },
    dryRun: input.dryRun,
    inboxServices: input.inboxServices,
    requestId: input.requestId,
    steps: input.steps,
    vault: input.vault,
  })
}

function describeLinqConnectorEndpoint(input: {
  options: {
    linqWebhookHost?: string | null
    linqWebhookPath?: string | null
    linqWebhookPort?: number | null
  }
}): string {
  const host = input.options.linqWebhookHost ?? '0.0.0.0'
  const path = input.options.linqWebhookPath ?? '/linq-webhook'
  const port = input.options.linqWebhookPort ?? 8789
  return `${host}:${port}${path}`
}

async function configureLinqChannel(input: {
  dryRun: boolean
  env: NodeJS.ProcessEnv
  inboxServices: SetupChannelInboxServices
  requestId: string | null
  steps: SetupStepResult[]
  vault: string
}): Promise<SetupConfiguredChannel> {
  const linqAdapter = getAssistantChannelAdapter('linq')
  const readyForSetup = linqAdapter?.isReadyForSetup(input.env) ?? false
  const missingEnv = resolveSetupChannelMissingEnv('linq', input.env)

  return configureManagedSetupChannel({
    definition: {
      channel: 'linq',
      connectorId: LINQ_SETUP_CONNECTOR_ID,
      title: 'Linq channel',
      stepId: 'channel-linq',
      readyForSetup,
      missingEnv,
      dryRunStepDetail: readyForSetup
        ? 'Would verify the Linq API token, add or reuse the linq:default inbox connector, and enable assistant auto-reply for Linq direct chats.'
        : 'Would configure Linq once LINQ_API_TOKEN or HEALTHYBOB_LINQ_API_TOKEN is available in the shell or local `.env`.',
      dryRunDetail: readyForSetup
        ? 'Would configure the Linq webhook connector and enable assistant auto-reply for Linq direct chats.'
        : `Linq needs LINQ_API_TOKEN or HEALTHYBOB_LINQ_API_TOKEN in the current environment before setup can enable the channel. ${SETUP_RUNTIME_ENV_NOTICE}`,
      runtimeUnavailableMessage:
        'Healthy Bob setup cannot configure Linq because the inbox source management services are unavailable in this build.',
      fallbackReason: 'Linq readiness probe failed',
      findExistingConnector(connectors) {
        return (
          connectors.find((connector) => connector.id === LINQ_SETUP_CONNECTOR_ID) ??
          connectors.find(
            (connector) =>
              connector.source === 'linq' && connector.accountId === LINQ_SETUP_ACCOUNT_ID,
          ) ??
          connectors.find((connector) => connector.source === 'linq') ??
          null
        )
      },
      async addConnector(sourceAdd) {
        return sourceAdd({
          account: LINQ_SETUP_ACCOUNT_ID,
          id: LINQ_SETUP_CONNECTOR_ID,
          requestId: input.requestId,
          source: 'linq',
          vault: input.vault,
        })
      },
      describeMissingEnv(existingConnector) {
        return {
          stepDetail: existingConnector
            ? `Reused the Linq inbox connector "${existingConnector.id}", but did not enable assistant auto-reply because LINQ_API_TOKEN or HEALTHYBOB_LINQ_API_TOKEN was not available in the shell or local \`.env\`.`
            : 'Linq was selected, but setup did not add the connector because LINQ_API_TOKEN or HEALTHYBOB_LINQ_API_TOKEN was not available in the shell or local `.env`.',
          detail: existingConnector
            ? `Reused the Linq connector "${existingConnector.id}", but skipped assistant auto-reply until a Linq API token is available in the current environment. ${SETUP_RUNTIME_ENV_NOTICE}`
            : `Linq needs LINQ_API_TOKEN or HEALTHYBOB_LINQ_API_TOKEN in the current environment before setup can add the connector and enable assistant auto-reply. ${SETUP_RUNTIME_ENV_NOTICE}`,
        }
      },
      describeReused({ connector, readiness }) {
        const endpoint = describeLinqConnectorEndpoint(connector)
        return {
          stepDetail: readiness.ready
            ? `Reusing the Linq inbox connector "${connector.id}" at ${endpoint} and enabling assistant auto-reply for Linq direct chats.`
            : `Reused the Linq inbox connector "${connector.id}" at ${endpoint}, but did not enable assistant auto-reply because the API token could not authenticate${readiness.reason ? ` (${readiness.reason})` : ''}.`,
          detail: readiness.ready
            ? `Reused the Linq connector "${connector.id}" at ${endpoint} and enabled assistant auto-reply for Linq direct chats.`
            : `Reused the Linq connector "${connector.id}" at ${endpoint}, but skipped assistant auto-reply until the Linq API token authenticates successfully${readiness.reason ? ` (${readiness.reason})` : ''}.`,
        }
      },
      describeAdded({ added, readiness }) {
        const endpoint = describeLinqConnectorEndpoint(added.connector)
        return {
          stepDetail: readiness.ready
            ? `Added the Linq inbox connector "${added.connector.id}" at ${endpoint} and enabled assistant auto-reply for Linq direct chats.`
            : `Added the Linq inbox connector "${added.connector.id}" at ${endpoint}, but did not enable assistant auto-reply because the API token could not authenticate${readiness.reason ? ` (${readiness.reason})` : ''}.`,
          detail: readiness.ready
            ? `Configured the Linq connector "${added.connector.id}" at ${endpoint} and enabled assistant auto-reply for Linq direct chats.`
            : `Configured the Linq connector "${added.connector.id}" at ${endpoint}, but skipped assistant auto-reply until the Linq API token authenticates successfully${readiness.reason ? ` (${readiness.reason})` : ''}.`,
        }
      },
    },
    dryRun: input.dryRun,
    inboxServices: input.inboxServices,
    requestId: input.requestId,
    steps: input.steps,
    vault: input.vault,
  })
}

async function configureEmailChannel(input: {
  allowPrompt: boolean
  dryRun: boolean
  env: NodeJS.ProcessEnv
  inboxServices: SetupChannelInboxServices
  requestId: string | null
  resolveAgentmailInboxSelection?: SetupAgentmailSelectionResolver
  steps: SetupStepResult[]
  vault: string
}): Promise<SetupConfiguredChannel> {
  const apiKey = resolveAgentmailApiKey(input.env)
  const missingEnv = resolveSetupChannelMissingEnv('email', input.env)

  return configureManagedSetupChannel<SetupAddedEmailConnectorResult>({
    definition: {
      channel: 'email',
      connectorId: EMAIL_SETUP_CONNECTOR_ID,
      title: 'Email channel',
      stepId: 'channel-email',
      readyForSetup: Boolean(apiKey),
      missingEnv,
      dryRunStepDetail: apiKey
        ? 'Would provision or reuse an AgentMail inbox, verify email polling, and enable assistant auto-reply for direct email threads.'
        : 'Would configure email once AGENTMAIL_API_KEY is available in the shell or local `.env`.',
      dryRunDetail: apiKey
        ? 'Would reuse an existing AgentMail inbox when possible, or provision a new inbox connector and enable assistant auto-reply for direct email threads.'
        : `Email needs AGENTMAIL_API_KEY in the current environment before setup can enable the channel. ${SETUP_RUNTIME_ENV_NOTICE}`,
      runtimeUnavailableMessage:
        'Healthy Bob setup cannot configure email because the inbox source management services are unavailable in this build.',
      fallbackReason: 'Email readiness probe failed',
      treatProbeWarnAsReady: true,
      findExistingConnector(connectors) {
        return (
          connectors.find((connector) => connector.id === EMAIL_SETUP_CONNECTOR_ID) ??
          connectors.find((connector) => connector.source === 'email') ??
          null
        )
      },
      async addConnector(sourceAdd): Promise<SetupAddedEmailConnectorResult> {
        const selectedInbox =
          input.resolveAgentmailInboxSelection && apiKey
            ? await input.resolveAgentmailInboxSelection({
                allowPrompt: input.allowPrompt,
                env: input.env,
              })
            : null

        const added = await sourceAdd({
          account: selectedInbox?.accountId,
          address: selectedInbox?.emailAddress ?? undefined,
          id: EMAIL_SETUP_CONNECTOR_ID,
          provision: selectedInbox === null,
          emailDisplayName: EMAIL_SETUP_DISPLAY_NAME,
          requestId: input.requestId,
          source: 'email',
          vault: input.vault,
        })

        return { ...added, selectedInbox }
      },
      describeMissingEnv(existingConnector) {
        return {
          stepDetail: existingConnector
            ? `Reused the email inbox connector "${existingConnector.id}", but did not enable assistant auto-reply because AGENTMAIL_API_KEY was not available in the shell or local \`.env\`.`
            : 'Email was selected, but setup did not add the connector because AGENTMAIL_API_KEY was not available in the shell or local `.env`.',
          detail: existingConnector
            ? `Reused the email connector "${existingConnector.id}", but skipped assistant auto-reply until an AgentMail API key is available in the current environment. ${SETUP_RUNTIME_ENV_NOTICE}`
            : `Email needs AGENTMAIL_API_KEY in the current environment before setup can reuse or provision the connector and enable assistant auto-reply. ${SETUP_RUNTIME_ENV_NOTICE}`,
        }
      },
      describeReused({ connector, readiness }) {
        return {
          stepDetail: readiness.ready
            ? `Reusing the email inbox connector "${connector.id}" and enabling assistant auto-reply for direct email threads.`
            : `Reused the email inbox connector "${connector.id}", but did not enable assistant auto-reply because AgentMail readiness checks failed${readiness.reason ? ` (${readiness.reason})` : ''}.`,
          detail: readiness.ready
            ? `Reused the email connector "${connector.id}" and enabled assistant auto-reply for direct email threads.`
            : `Reused the email connector "${connector.id}", but skipped assistant auto-reply until AgentMail readiness checks succeed${readiness.reason ? ` (${readiness.reason})` : ''}.`,
        }
      },
      describeAdded({ added, readiness }) {
        const configuredAddress =
          added.provisionedMailbox?.emailAddress ??
          added.reusedMailbox?.emailAddress ??
          added.selectedInbox?.emailAddress ??
          added.connector.options.emailAddress ??
          null
        const actionVerb = describeConfiguredEmailAction({
          added,
          selectedInbox: added.selectedInbox ?? null,
        })

        return {
          stepDetail: readiness.ready
            ? `${actionVerb} the AgentMail inbox connector "${added.connector.id}"${configuredAddress ? ` at ${configuredAddress}` : ''} and enabled assistant auto-reply for direct email threads.`
            : `${actionVerb} the AgentMail inbox connector "${added.connector.id}"${configuredAddress ? ` at ${configuredAddress}` : ''}, but did not enable assistant auto-reply because AgentMail readiness checks failed${readiness.reason ? ` (${readiness.reason})` : ''}.`,
          detail: readiness.ready
            ? `Configured the email connector "${added.connector.id}"${configuredAddress ? ` at ${configuredAddress}` : ''} and enabled assistant auto-reply for direct email threads.`
            : `Configured the email connector "${added.connector.id}"${configuredAddress ? ` at ${configuredAddress}` : ''}, but skipped assistant auto-reply until AgentMail readiness checks succeed${readiness.reason ? ` (${readiness.reason})` : ''}.`,
        }
      },
    },
    dryRun: input.dryRun,
    inboxServices: input.inboxServices,
    requestId: input.requestId,
    steps: input.steps,
    vault: input.vault,
  })
}

async function configureManagedSetupChannel<
  TAdded extends SetupAddedConnectorResult = SetupAddedConnectorResult,
>(input: {
  definition: ManagedSetupChannelDefinition<TAdded>
  dryRun: boolean
  inboxServices: SetupChannelInboxServices
  requestId: string | null
  steps: SetupStepResult[]
  vault: string
}): Promise<SetupConfiguredChannel> {
  const { definition } = input

  if (input.dryRun) {
    input.steps.push(
      createStep({
        detail: definition.dryRunStepDetail,
        id: definition.stepId,
        kind: 'configure',
        status: 'planned',
        title: definition.title,
      }),
    )

    return {
      autoReply: definition.readyForSetup,
      channel: definition.channel,
      configured: false,
      connectorId: definition.connectorId,
      detail: definition.dryRunDetail,
      enabled: true,
      missingEnv: definition.missingEnv,
    }
  }

  const doctor = input.inboxServices.doctor
  const sourceList = input.inboxServices.sourceList
  const sourceAdd = input.inboxServices.sourceAdd
  const sourceSetEnabled = input.inboxServices.sourceSetEnabled
  if (!sourceList || !sourceAdd) {
    throw new VaultCliError('runtime_unavailable', definition.runtimeUnavailableMessage)
  }

  const listed = await sourceList({
    vault: input.vault,
    requestId: input.requestId,
  })
  const existingConnector = definition.findExistingConnector(listed.connectors)

  if (!definition.readyForSetup) {
    const messages = definition.describeMissingEnv(existingConnector)
    input.steps.push(
      createStep({
        detail: messages.stepDetail,
        id: definition.stepId,
        kind: 'configure',
        status: existingConnector ? 'reused' : 'skipped',
        title: definition.title,
      }),
    )

    return {
      autoReply: false,
      channel: definition.channel,
      configured: existingConnector !== null,
      connectorId: existingConnector?.id ?? null,
      detail: messages.detail,
      enabled: true,
      missingEnv: definition.missingEnv,
    }
  }

  if (existingConnector) {
    await ensureSetupConnectorEnabled({
      connectorId: existingConnector.id,
      enabled: existingConnector.enabled,
      requestId: input.requestId,
      sourceSetEnabled,
      vault: input.vault,
    })
    const readiness = await probeSetupReadiness({
      connectorId: existingConnector.id,
      doctor,
      requestId: input.requestId,
      treatProbeWarnAsReady: definition.treatProbeWarnAsReady,
      vault: input.vault,
      fallbackReason: definition.fallbackReason,
    })
    const messages = definition.describeReused({
      connector: existingConnector,
      readiness,
    })

    input.steps.push(
      createStep({
        detail: messages.stepDetail,
        id: definition.stepId,
        kind: 'configure',
        status: 'reused',
        title: definition.title,
      }),
    )

    return {
      autoReply: readiness.ready,
      channel: definition.channel,
      configured: readiness.ready,
      connectorId: existingConnector.id,
      detail: messages.detail,
      enabled: true,
      missingEnv: [],
    }
  }

  const added = await definition.addConnector(sourceAdd)
  const readiness = await probeSetupReadiness({
    connectorId: added.connector.id,
    doctor,
    requestId: input.requestId,
    treatProbeWarnAsReady: definition.treatProbeWarnAsReady,
    vault: input.vault,
    fallbackReason: definition.fallbackReason,
  })
  const messages = definition.describeAdded({
    added,
    readiness,
  })

  input.steps.push(
    createStep({
      detail: messages.stepDetail,
      id: definition.stepId,
      kind: 'configure',
      status: 'completed',
      title: definition.title,
    }),
  )

  return {
    autoReply: readiness.ready,
    channel: definition.channel,
    configured: readiness.ready,
    connectorId: added.connector.id,
    detail: messages.detail,
    enabled: true,
    missingEnv: [],
  }
}

async function probeSetupReadiness(input: {
  connectorId: string
  doctor?: InboxCliServices['doctor']
  requestId: string | null
  treatProbeWarnAsReady?: boolean
  vault: string
  fallbackReason: string
}): Promise<{
  ready: boolean
  reason: string | null
}> {
  if (!input.doctor) {
    return {
      ready: true,
      reason: null,
    }
  }

  const result = await input.doctor({
    requestId: input.requestId,
    sourceId: input.connectorId,
    vault: input.vault,
  })
  const probeCheck = result.checks.find((check) => check.name === 'probe') ?? null
  const driverImportCheck =
    result.checks.find((check) => check.name === 'driver-import') ?? null
  const ready = Boolean(
    (probeCheck?.status === 'pass' ||
      (input.treatProbeWarnAsReady === true && probeCheck?.status === 'warn')) &&
      (driverImportCheck === null || driverImportCheck.status === 'pass'),
  )

  return {
    ready,
    reason:
      ready
        ? null
        : probeCheck?.message ?? driverImportCheck?.message ?? input.fallbackReason,
  }
}

function describeConfiguredEmailAction(input: {
  added: Awaited<ReturnType<NonNullable<SetupChannelInboxServices['sourceAdd']>>>
  selectedInbox: SetupAgentmailInboxSelection | null
}): 'Provisioned' | 'Reused' {
  if (input.added.provisionedMailbox) {
    return 'Provisioned'
  }

  if (input.added.reusedMailbox || input.selectedInbox) {
    return 'Reused'
  }

  return 'Provisioned'
}

async function updateAssistantChannelState(input: {
  autoReplyChannels: readonly SetupChannel[]
  platform: NodeJS.Platform
  preferredChannels: readonly SetupChannel[]
  vault: string
}): Promise<void> {
  const state = await readAssistantAutomationState(input.vault)
  const preservedAutoReplyChannels = state.autoReplyChannels.filter(
    (channel): channel is SetupChannel =>
      isSetupChannel(channel) &&
      !isSetupChannelSupportedOnPlatform(channel, input.platform),
  )
  const preservedPreferredChannels = state.preferredChannels.filter(
    (channel): channel is SetupChannel =>
      isSetupChannel(channel) &&
      !isSetupChannelSupportedOnPlatform(channel, input.platform),
  )
  const autoReplyChannels = normalizeSetupChannels([
    ...input.autoReplyChannels,
    ...preservedAutoReplyChannels,
  ])
  const preferredChannels = normalizeSetupChannels([
    ...input.preferredChannels,
    ...preservedPreferredChannels,
  ])
  const nextBacklogChannels = normalizeSetupChannels(
    state.autoReplyBacklogChannels.filter(
      (channel): channel is SetupChannel =>
        channel === 'email' && autoReplyChannels.includes(channel),
    ),
  )
  if (autoReplyChannels.includes('email') && !state.autoReplyChannels.includes('email')) {
    nextBacklogChannels.push('email')
  }
  const autoReplyChanged =
    autoReplyChannels.length !== state.autoReplyChannels.length ||
    autoReplyChannels.some((channel, index) => state.autoReplyChannels[index] !== channel)
  const preferredChanged =
    preferredChannels.length !== state.preferredChannels.length ||
    preferredChannels.some((channel, index) => state.preferredChannels[index] !== channel)
  const backlogChanged =
    nextBacklogChannels.length !== state.autoReplyBacklogChannels.length ||
    nextBacklogChannels.some((channel, index) => state.autoReplyBacklogChannels[index] !== channel)

  if (!autoReplyChanged && !preferredChanged && !backlogChanged) {
    return
  }

  await saveAssistantAutomationState(input.vault, {
    version: 2,
    inboxScanCursor: state.inboxScanCursor,
    autoReplyScanCursor:
      autoReplyChannels.length === 0
        ? null
        : autoReplyChanged
          ? null
          : state.autoReplyScanCursor,
    autoReplyChannels,
    preferredChannels,
    autoReplyBacklogChannels: nextBacklogChannels,
    autoReplyPrimed:
      autoReplyChannels.length === 0
        ? true
        : autoReplyChanged
          ? false
          : state.autoReplyPrimed,
    updatedAt: new Date().toISOString(),
  })
}

async function reconcileDeselectedSetupChannels(input: {
  channels: readonly SetupChannel[]
  inboxServices: SetupChannelInboxServices
  platform: NodeJS.Platform
  requestId: string | null
  vault: string
}): Promise<void> {
  const sourceList = input.inboxServices.sourceList
  const sourceSetEnabled = input.inboxServices.sourceSetEnabled
  if (!sourceList || !sourceSetEnabled) {
    return
  }

  const selectedChannels = new Set(normalizeSetupChannels(input.channels))
  const listed = await sourceList({
    vault: input.vault,
    requestId: input.requestId,
  })

  for (const connector of listed.connectors) {
    if (!connector.enabled) {
      continue
    }

    const setupChannel = resolveSetupChannelForConnector(connector)
    if (
      !setupChannel ||
      !isSetupChannelSupportedOnPlatform(setupChannel, input.platform) ||
      selectedChannels.has(setupChannel)
    ) {
      continue
    }

    await sourceSetEnabled({
      connectorId: connector.id,
      enabled: false,
      requestId: input.requestId,
      vault: input.vault,
    })
  }
}

async function ensureSetupConnectorEnabled(input: {
  connectorId: string
  enabled: boolean
  requestId: string | null
  sourceSetEnabled?: InboxCliServices['sourceSetEnabled']
  vault: string
}): Promise<void> {
  if (input.enabled || !input.sourceSetEnabled) {
    return
  }

  await input.sourceSetEnabled({
    connectorId: input.connectorId,
    enabled: true,
    requestId: input.requestId,
    vault: input.vault,
  })
}

function resolveSetupChannelForConnector(
  connector: Awaited<ReturnType<NonNullable<SetupChannelInboxServices['sourceList']>>>['connectors'][number],
): SetupChannel | null {
  if (
    connector.id === IMESSAGE_SETUP_CONNECTOR_ID ||
    (connector.source === 'imessage' && connector.accountId === IMESSAGE_SETUP_ACCOUNT_ID)
  ) {
    return 'imessage'
  }

  if (
    connector.id === TELEGRAM_SETUP_CONNECTOR_ID ||
    (connector.source === 'telegram' && connector.accountId === TELEGRAM_SETUP_ACCOUNT_ID)
  ) {
    return 'telegram'
  }

  if (
    connector.id === LINQ_SETUP_CONNECTOR_ID ||
    (connector.source === 'linq' && connector.accountId === LINQ_SETUP_ACCOUNT_ID)
  ) {
    return 'linq'
  }

  if (connector.id === EMAIL_SETUP_CONNECTOR_ID || connector.source === 'email') {
    return 'email'
  }

  return null
}
