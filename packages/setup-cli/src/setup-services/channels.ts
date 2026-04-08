import {
  readAssistantAutomationState,
  saveAssistantAutomationState,
} from '@murphai/assistant-engine/assistant-state'
import { resolveAgentmailApiKey } from '@murphai/operator-config/agentmail-runtime'
import { getAssistantChannelAdapter } from '@murphai/assistant-engine/assistant-runtime'
import { describeLinqConnectorEndpoint as describeLinqEndpoint } from '@murphai/inbox-services/linq-endpoint'
import type { InboxServices } from '@murphai/inbox-services'
import type {
  SetupAgentmailInboxSelection,
  SetupAgentmailSelectionResolver,
} from '../setup-agentmail.js'
import {
  resolveSetupChannelMissingEnv,
  SETUP_RUNTIME_ENV_NOTICE,
} from '@murphai/operator-config/setup-runtime-env'
import {
  type SetupChannel,
  type SetupConfiguredChannel,
  type SetupStepResult,
  setupChannelValues,
} from '@murphai/operator-config/setup-cli-contracts'
import { resolveTelegramBotToken } from '@murphai/operator-config/telegram-runtime'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { createStep } from './steps.js'

const IMESSAGE_SETUP_CONNECTOR_ID = 'imessage:self'
const IMESSAGE_SETUP_ACCOUNT_ID = 'self'
const TELEGRAM_SETUP_CONNECTOR_ID = 'telegram:bot'
const TELEGRAM_SETUP_ACCOUNT_ID = 'bot'
const LINQ_SETUP_CONNECTOR_ID = 'linq:default'
const LINQ_SETUP_ACCOUNT_ID = 'default'
const EMAIL_SETUP_CONNECTOR_ID = 'email:agentmail'
const EMAIL_SETUP_DISPLAY_NAME = 'Murph'
const SETUP_CHANNEL_ORDER = [
  'imessage',
  'telegram',
  'linq',
  'email',
] as const satisfies readonly SetupChannel[]

function isSetupChannelSupportedOnPlatform(
  channel: SetupChannel,
  platform: NodeJS.Platform,
): boolean {
  return channel !== 'imessage' || platform === 'darwin'
}

type SetupChannelInboxServices = Pick<InboxServices, 'bootstrap'> &
  Partial<
    Pick<InboxServices, 'doctor' | 'sourceAdd' | 'sourceList' | 'sourceSetEnabled'>
  >

type SetupListedConnector =
  Awaited<ReturnType<NonNullable<SetupChannelInboxServices['sourceList']>>>['connectors'][number]
type SetupAddedConnectorResult = Awaited<
  ReturnType<NonNullable<SetupChannelInboxServices['sourceAdd']>>
>
type SetupAddedEmailConnectorResult = SetupAddedConnectorResult & {
  selectedInbox: SetupAgentmailInboxSelection | null
}
type SetupChannelAddedResult =
  | SetupAddedConnectorResult
  | SetupAddedEmailConnectorResult
type SetupReadiness = Awaited<ReturnType<typeof probeSetupReadiness>>

type SetupChannelMessages = {
  stepDetail: string
  detail: string
}

type SetupChannelContext = {
  allowPrompt: boolean
  dryRun: boolean
  env: NodeJS.ProcessEnv
  inboxServices: SetupChannelInboxServices
  platform: NodeJS.Platform
  requestId: string | null
  resolveAgentmailInboxSelection?: SetupAgentmailSelectionResolver
  steps: SetupStepResult[]
  vault: string
}

type SetupChannelPlan =
  | {
      supported: false
      connectorId: null
      detail: string
      missingEnv: string[]
      stepDetail: string
    }
  | {
      supported: true
      connectorId: string
      dryRunDetail: string
      dryRunStepDetail: string
      missingEnv: string[]
      readyForSetup: boolean
    }

type UnsupportedSetupChannelPlan = Extract<SetupChannelPlan, { supported: false }>

type SetupChannelReadinessMode =
  | {
      kind: 'always-ready'
    }
  | {
      fallbackReason: string
      kind: 'doctor-probe'
      treatProbeWarnAsReady?: boolean
    }

type SetupChannelOutcome =
  | 'unsupported'
  | 'dry-run'
  | 'missing-env'
  | 'reused'
  | 'added'

type SetupChannelResolution = {
  autoReplyReady: boolean
  connectorEnabled: boolean
  connectorId: string | null
  connectorPresent: boolean
  detail: string
  missingEnv: string[]
  outcome: SetupChannelOutcome
  stepDetail: string
  stepStatus: SetupStepResult['status']
}

type SetupChannelSpec = {
  channel: SetupChannel
  title: string
  stepId: string
  runtimeUnavailableMessage: string
  readiness: SetupChannelReadinessMode
  plan(context: SetupChannelContext): SetupChannelPlan
  findExistingConnector(connectors: readonly SetupListedConnector[]): SetupListedConnector | null
  addConnector(
    context: SetupChannelContext,
    sourceAdd: NonNullable<SetupChannelInboxServices['sourceAdd']>,
  ): Promise<SetupChannelAddedResult>
  describeMissingEnv(input: {
    existingConnector: SetupListedConnector | null
  }): SetupChannelMessages
  describeReused(input: {
    connector: SetupListedConnector
    readiness: SetupReadiness
  }): SetupChannelMessages
  describeAdded(input: {
    added: SetupChannelAddedResult
    readiness: SetupReadiness
  }): SetupChannelMessages
  matchesConfiguredConnector(connector: SetupListedConnector): boolean
}

function isSetupChannel(value: string): value is SetupChannel {
  return setupChannelValues.includes(value as SetupChannel)
}

export function normalizeSetupChannels(
  value: readonly SetupChannel[] | null | undefined,
): SetupChannel[] {
  return [...new Set(value ?? [])]
}

function isIMessageSetupConnector(connector: SetupListedConnector): boolean {
  return (
    connector.id === IMESSAGE_SETUP_CONNECTOR_ID ||
    (connector.source === 'imessage' && connector.accountId === IMESSAGE_SETUP_ACCOUNT_ID)
  )
}

function isTelegramSetupConnector(connector: SetupListedConnector): boolean {
  return (
    connector.id === TELEGRAM_SETUP_CONNECTOR_ID ||
    (connector.source === 'telegram' &&
      connector.accountId === TELEGRAM_SETUP_ACCOUNT_ID)
  )
}

function isLinqSetupConnector(connector: SetupListedConnector): boolean {
  return (
    connector.id === LINQ_SETUP_CONNECTOR_ID ||
    (connector.source === 'linq' && connector.accountId === LINQ_SETUP_ACCOUNT_ID)
  )
}

function findReusableLinqSetupConnector(
  connectors: readonly SetupListedConnector[],
): SetupListedConnector | null {
  return (
    connectors.find((connector) => connector.id === LINQ_SETUP_CONNECTOR_ID) ??
    connectors.find(
      (connector) =>
        connector.source === 'linq' && connector.accountId === LINQ_SETUP_ACCOUNT_ID,
    ) ??
    connectors.find((connector) => connector.source === 'linq') ??
    null
  )
}

function isEmailSetupConnector(connector: SetupListedConnector): boolean {
  return connector.id === EMAIL_SETUP_CONNECTOR_ID || connector.source === 'email'
}

function isSetupAddedEmailConnectorResult(
  value: SetupChannelAddedResult,
): value is SetupAddedEmailConnectorResult {
  return 'selectedInbox' in value
}

function describeLinqConnectorEndpoint(input: {
  options: {
    linqWebhookHost?: string | null
    linqWebhookPath?: string | null
    linqWebhookPort?: number | null
  }
}): string {
  const endpoint = describeLinqEndpoint({
    options: {
      linqWebhookHost: input.options.linqWebhookHost,
      linqWebhookPath: input.options.linqWebhookPath,
      linqWebhookPort: input.options.linqWebhookPort ?? undefined,
    },
  })
  return `${endpoint.host}:${endpoint.port}${endpoint.path}`
}

function describeConfiguredEmailAction(input: {
  added: SetupAddedConnectorResult
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

const CHANNEL_SPECS = {
  imessage: {
    channel: 'imessage',
    title: 'iMessage channel',
    stepId: 'channel-imessage',
    runtimeUnavailableMessage:
      'Murph setup cannot configure iMessage because the inbox source management services are unavailable in this build.',
    readiness: {
      kind: 'always-ready',
    },
    plan(context) {
      if (context.platform !== 'darwin') {
        return {
          supported: false,
          connectorId: null,
          detail:
            'Skipped iMessage because it requires macOS. Use Telegram, Linq, or email on Linux, or run iMessage from a Mac host.',
          missingEnv: [],
          stepDetail:
            'Skipped iMessage because it requires Messages.app and the local Messages database on macOS.',
        }
      }

      return {
        supported: true,
        connectorId: IMESSAGE_SETUP_CONNECTOR_ID,
        dryRunDetail:
          'Would configure the local iMessage inbox connector and enable assistant auto-reply for new conversations.',
        dryRunStepDetail:
          'Would add the imessage:self inbox connector and enable assistant auto-reply for new iMessage conversations.',
        missingEnv: [],
        readyForSetup: true,
      }
    },
    findExistingConnector(connectors) {
      return connectors.find(isIMessageSetupConnector) ?? null
    },
    async addConnector(context, sourceAdd) {
      return sourceAdd({
        account: IMESSAGE_SETUP_ACCOUNT_ID,
        id: IMESSAGE_SETUP_CONNECTOR_ID,
        includeOwn: true,
        requestId: context.requestId,
        source: 'imessage',
        vault: context.vault,
      })
    },
    describeMissingEnv() {
      return {
        stepDetail:
          'Skipped iMessage because setup could not verify the local Messages connector state.',
        detail:
          'Skipped iMessage because setup could not verify the local Messages connector state.',
      }
    },
    describeReused({ connector }) {
      return {
        stepDetail:
          `Reusing the iMessage inbox connector "${connector.id}" and enabling assistant auto-reply for new iMessage conversations.`,
        detail:
          `Reused the iMessage connector "${connector.id}" and enabled assistant auto-reply for new iMessage conversations.`,
      }
    },
    describeAdded({ added }) {
      return {
        stepDetail:
          `Added the iMessage inbox connector "${added.connector.id}" and enabled assistant auto-reply for new iMessage conversations.`,
        detail:
          `Configured the iMessage connector "${added.connector.id}" and enabled assistant auto-reply for new iMessage conversations.`,
      }
    },
    matchesConfiguredConnector: isIMessageSetupConnector,
  },
  telegram: {
    channel: 'telegram',
    title: 'Telegram channel',
    stepId: 'channel-telegram',
    runtimeUnavailableMessage:
      'Murph setup cannot configure Telegram because the inbox source management services are unavailable in this build.',
    readiness: {
      fallbackReason: 'Telegram readiness probe failed',
      kind: 'doctor-probe',
    },
    plan(context) {
      const token = resolveTelegramBotToken(context.env)
      const readyForSetup =
        getAssistantChannelAdapter('telegram')?.isReadyForSetup(context.env) ??
        Boolean(token)
      const missingEnv = resolveSetupChannelMissingEnv('telegram', context.env)

      return {
        supported: true,
        connectorId: TELEGRAM_SETUP_CONNECTOR_ID,
        dryRunDetail: token
          ? 'Would configure the Telegram bot connector and enable assistant auto-reply for Telegram direct chats.'
          : `Telegram needs TELEGRAM_BOT_TOKEN in the current environment before setup can enable the channel. ${SETUP_RUNTIME_ENV_NOTICE}`,
        dryRunStepDetail: token
          ? 'Would verify the Telegram bot token, add or reuse the telegram:bot inbox connector, and enable assistant auto-reply for Telegram direct chats.'
          : 'Would configure Telegram once TELEGRAM_BOT_TOKEN is available in the shell or local `.env`.',
        missingEnv,
        readyForSetup,
      }
    },
    findExistingConnector(connectors) {
      return connectors.find(isTelegramSetupConnector) ?? null
    },
    async addConnector(context, sourceAdd) {
      return sourceAdd({
        account: TELEGRAM_SETUP_ACCOUNT_ID,
        id: TELEGRAM_SETUP_CONNECTOR_ID,
        requestId: context.requestId,
        source: 'telegram',
        vault: context.vault,
      })
    },
    describeMissingEnv({ existingConnector }) {
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
    matchesConfiguredConnector: isTelegramSetupConnector,
  },
  linq: {
    channel: 'linq',
    title: 'Linq channel',
    stepId: 'channel-linq',
    runtimeUnavailableMessage:
      'Murph setup cannot configure Linq because the inbox source management services are unavailable in this build.',
    readiness: {
      fallbackReason: 'Linq readiness probe failed',
      kind: 'doctor-probe',
    },
    plan(context) {
      const readyForSetup =
        getAssistantChannelAdapter('linq')?.isReadyForSetup(context.env) ?? false
      const missingEnv = resolveSetupChannelMissingEnv('linq', context.env)

      return {
        supported: true,
        connectorId: LINQ_SETUP_CONNECTOR_ID,
        dryRunDetail: readyForSetup
          ? 'Would configure the Linq webhook connector and enable assistant auto-reply for Linq direct chats.'
          : `Linq needs both LINQ_API_TOKEN and LINQ_WEBHOOK_SECRET in the current environment before setup can enable the channel. ${SETUP_RUNTIME_ENV_NOTICE}`,
        dryRunStepDetail: readyForSetup
          ? 'Would verify the Linq API token, add or reuse the linq:default inbox connector, and enable assistant auto-reply for Linq direct chats.'
          : 'Would configure Linq once LINQ_API_TOKEN and LINQ_WEBHOOK_SECRET are available in the shell or local `.env`.',
        missingEnv,
        readyForSetup,
      }
    },
    findExistingConnector(connectors) {
      return findReusableLinqSetupConnector(connectors)
    },
    async addConnector(context, sourceAdd) {
      return sourceAdd({
        account: LINQ_SETUP_ACCOUNT_ID,
        id: LINQ_SETUP_CONNECTOR_ID,
        requestId: context.requestId,
        source: 'linq',
        vault: context.vault,
      })
    },
    describeMissingEnv({ existingConnector }) {
      return {
        stepDetail: existingConnector
          ? `Reused the Linq inbox connector "${existingConnector.id}", but did not enable assistant auto-reply because LINQ_API_TOKEN and LINQ_WEBHOOK_SECRET were not both available in the shell or local \`.env\`.`
          : 'Linq was selected, but setup did not add the connector because LINQ_API_TOKEN and LINQ_WEBHOOK_SECRET were not both available in the shell or local `.env`.',
        detail: existingConnector
          ? `Reused the Linq connector "${existingConnector.id}", but skipped assistant auto-reply until both a Linq API token and webhook secret are available in the current environment. ${SETUP_RUNTIME_ENV_NOTICE}`
          : `Linq needs LINQ_API_TOKEN and LINQ_WEBHOOK_SECRET in the current environment before setup can add the connector and enable assistant auto-reply. ${SETUP_RUNTIME_ENV_NOTICE}`,
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
    matchesConfiguredConnector: isLinqSetupConnector,
  },
  email: {
    channel: 'email',
    title: 'Email channel',
    stepId: 'channel-email',
    runtimeUnavailableMessage:
      'Murph setup cannot configure email because the inbox source management services are unavailable in this build.',
    readiness: {
      fallbackReason: 'Email readiness probe failed',
      kind: 'doctor-probe',
      treatProbeWarnAsReady: true,
    },
    plan(context) {
      const apiKey = resolveAgentmailApiKey(context.env)
      const missingEnv = resolveSetupChannelMissingEnv('email', context.env)

      return {
        supported: true,
        connectorId: EMAIL_SETUP_CONNECTOR_ID,
        dryRunDetail: apiKey
          ? 'Would reuse an existing AgentMail inbox when possible, or provision a new inbox connector and enable assistant auto-reply for direct email threads.'
          : `Email needs AGENTMAIL_API_KEY in the current environment before setup can enable the channel. ${SETUP_RUNTIME_ENV_NOTICE}`,
        dryRunStepDetail: apiKey
          ? 'Would provision or reuse an AgentMail inbox, verify email polling, and enable assistant auto-reply for direct email threads.'
          : 'Would configure email once AGENTMAIL_API_KEY is available in the shell or local `.env`.',
        missingEnv,
        readyForSetup: Boolean(apiKey),
      }
    },
    findExistingConnector(connectors) {
      return connectors.find(isEmailSetupConnector) ?? null
    },
    async addConnector(context, sourceAdd) {
      const apiKey = resolveAgentmailApiKey(context.env)
      const selectedInbox =
        context.resolveAgentmailInboxSelection && apiKey
          ? await context.resolveAgentmailInboxSelection({
              allowPrompt: context.allowPrompt,
              env: context.env,
            })
          : null

      const added = await sourceAdd({
        account: selectedInbox?.accountId,
        address: selectedInbox?.emailAddress ?? undefined,
        id: EMAIL_SETUP_CONNECTOR_ID,
        provision: selectedInbox === null,
        emailDisplayName: EMAIL_SETUP_DISPLAY_NAME,
        requestId: context.requestId,
        source: 'email',
        vault: context.vault,
      })

      return { ...added, selectedInbox }
    },
    describeMissingEnv({ existingConnector }) {
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
      const selectedInbox = isSetupAddedEmailConnectorResult(added)
        ? added.selectedInbox ?? null
        : null
      const configuredAddress =
        added.provisionedMailbox?.emailAddress ??
        added.reusedMailbox?.emailAddress ??
        selectedInbox?.emailAddress ??
        added.connector.options.emailAddress ??
        null
      const actionVerb = describeConfiguredEmailAction({
        added,
        selectedInbox,
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
    matchesConfiguredConnector: isEmailSetupConnector,
  },
} satisfies Record<SetupChannel, SetupChannelSpec>

const CHANNEL_CONFIGURERS = {
  imessage: configureIMessageChannel,
  telegram: configureTelegramChannel,
  linq: configureLinqChannel,
  email: configureEmailChannel,
} satisfies Record<
  SetupChannel,
  (context: SetupChannelContext) => Promise<SetupConfiguredChannel>
>

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
  const context: SetupChannelContext = {
    allowPrompt: input.allowPrompt ?? false,
    dryRun: input.dryRun,
    env: input.env,
    inboxServices: input.inboxServices,
    platform,
    requestId: input.requestId,
    resolveAgentmailInboxSelection: input.resolveAgentmailInboxSelection,
    steps: input.steps,
    vault: input.vault,
  }
  const selectedChannels = new Set(normalizeSetupChannels(input.channels))

  for (const channel of SETUP_CHANNEL_ORDER) {
    if (!selectedChannels.has(channel)) {
      continue
    }

    configured.push(await CHANNEL_CONFIGURERS[channel](context))
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
      vault: input.vault,
    })
  }

  return configured
}

async function configureIMessageChannel(
  context: SetupChannelContext,
): Promise<SetupConfiguredChannel> {
  return configureSetupChannel(CHANNEL_SPECS.imessage, context)
}

async function configureTelegramChannel(
  context: SetupChannelContext,
): Promise<SetupConfiguredChannel> {
  return configureSetupChannel(CHANNEL_SPECS.telegram, context)
}

async function configureLinqChannel(
  context: SetupChannelContext,
): Promise<SetupConfiguredChannel> {
  return configureSetupChannel(CHANNEL_SPECS.linq, context)
}

async function configureEmailChannel(
  context: SetupChannelContext,
): Promise<SetupConfiguredChannel> {
  return configureSetupChannel(CHANNEL_SPECS.email, context)
}

async function configureSetupChannel(
  spec: SetupChannelSpec,
  context: SetupChannelContext,
): Promise<SetupConfiguredChannel> {
  const plan = spec.plan(context)

  if (isUnsupportedSetupChannelPlan(plan)) {
    return recordSetupChannelResult(spec, context, {
      autoReplyReady: false,
      connectorEnabled: false,
      connectorId: plan.connectorId,
      connectorPresent: false,
      detail: plan.detail,
      missingEnv: plan.missingEnv,
      outcome: 'unsupported',
      stepDetail: plan.stepDetail,
      stepStatus: 'skipped',
    })
  }

  if (context.dryRun) {
    return recordSetupChannelResult(spec, context, {
      autoReplyReady: plan.readyForSetup,
      connectorEnabled: plan.readyForSetup,
      connectorId: plan.connectorId,
      connectorPresent: false,
      detail: plan.dryRunDetail,
      missingEnv: plan.missingEnv,
      outcome: 'dry-run',
      stepDetail: plan.dryRunStepDetail,
      stepStatus: 'planned',
    })
  }

  const doctor = context.inboxServices.doctor
  const sourceList = context.inboxServices.sourceList
  const sourceAdd = context.inboxServices.sourceAdd
  const sourceSetEnabled = context.inboxServices.sourceSetEnabled
  if (!sourceList || !sourceAdd) {
    throw new VaultCliError('runtime_unavailable', spec.runtimeUnavailableMessage)
  }

  const listed = await sourceList({
    vault: context.vault,
    requestId: context.requestId,
  })
  const existingConnector = spec.findExistingConnector(listed.connectors)

  if (!plan.readyForSetup) {
    const messages = spec.describeMissingEnv({
      existingConnector,
    })
    const connectorPresent = existingConnector !== null
    const connectorEnabled = existingConnector?.enabled ?? false

    return recordSetupChannelResult(spec, context, {
      autoReplyReady: false,
      connectorEnabled,
      connectorId: existingConnector?.id ?? null,
      connectorPresent,
      detail: messages.detail,
      missingEnv: plan.missingEnv,
      outcome: 'missing-env',
      stepDetail: messages.stepDetail,
      stepStatus: existingConnector ? 'reused' : 'skipped',
    })
  }

  if (existingConnector) {
    const connectorEnabled = await ensureSetupConnectorEnabled({
      connectorId: existingConnector.id,
      enabled: existingConnector.enabled,
      requestId: context.requestId,
      sourceSetEnabled,
      vault: context.vault,
    })
    const readiness = await resolveSetupChannelReadiness({
      connectorId: existingConnector.id,
      doctor,
      requestId: context.requestId,
      readiness: spec.readiness,
      vault: context.vault,
    })
    const autoReplyReady = readiness.ready
    const messages = spec.describeReused({
      connector: existingConnector,
      readiness,
    })

    return recordSetupChannelResult(spec, context, {
      autoReplyReady,
      connectorEnabled,
      connectorId: existingConnector.id,
      connectorPresent: true,
      detail: messages.detail,
      missingEnv: [],
      outcome: 'reused',
      stepDetail: messages.stepDetail,
      stepStatus: 'reused',
    })
  }

  const added = await spec.addConnector(context, sourceAdd)
  const autoReplyReadiness = await resolveSetupChannelReadiness({
    connectorId: added.connector.id,
    doctor,
    requestId: context.requestId,
    readiness: spec.readiness,
    vault: context.vault,
  })
  const autoReplyReady = autoReplyReadiness.ready
  const messages = spec.describeAdded({
    added,
    readiness: autoReplyReadiness,
  })

  return recordSetupChannelResult(spec, context, {
    autoReplyReady,
    connectorEnabled: added.connector.enabled,
    connectorId: added.connector.id,
    connectorPresent: true,
    detail: messages.detail,
    missingEnv: [],
    outcome: 'added',
    stepDetail: messages.stepDetail,
    stepStatus: 'completed',
  })
}

function isUnsupportedSetupChannelPlan(
  plan: SetupChannelPlan,
): plan is UnsupportedSetupChannelPlan {
  return plan.supported === false
}

function recordSetupChannelResult(
  spec: SetupChannelSpec,
  context: SetupChannelContext,
  resolution: SetupChannelResolution,
): SetupConfiguredChannel {
  context.steps.push(
    createStep({
      detail: resolution.stepDetail,
      id: spec.stepId,
      kind: 'configure',
      status: resolution.stepStatus,
      title: spec.title,
    }),
  )

  return {
    autoReply: resolution.autoReplyReady,
    channel: spec.channel,
    configured: mapConfiguredSetupChannelResolution(resolution),
    connectorId: resolution.connectorId,
    detail: resolution.detail,
    // Preserve the historical setup result contract at the boundary while the
    // orchestration tracks connector presence/readiness separately.
    enabled: true,
    missingEnv: resolution.missingEnv,
  }
}

function mapConfiguredSetupChannelResolution(
  resolution: SetupChannelResolution,
): boolean {
  switch (resolution.outcome) {
    case 'missing-env':
      return resolution.connectorPresent
    case 'reused':
    case 'added':
      return resolution.autoReplyReady
    case 'unsupported':
    case 'dry-run':
      return false
  }
}

async function resolveSetupChannelReadiness(input: {
  connectorId: string
  doctor?: InboxServices['doctor']
  requestId: string | null
  readiness: SetupChannelReadinessMode
  vault: string
}): Promise<SetupReadiness> {
  if (input.readiness.kind === 'always-ready') {
    return {
      ready: true,
      reason: null,
    }
  }

  return probeSetupReadiness({
    connectorId: input.connectorId,
    doctor: input.doctor,
    fallbackReason: input.readiness.fallbackReason,
    requestId: input.requestId,
    treatProbeWarnAsReady: input.readiness.treatProbeWarnAsReady,
    vault: input.vault,
  })
}

async function probeSetupReadiness(input: {
  connectorId: string
  doctor?: InboxServices['doctor']
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

async function updateAssistantChannelState(input: {
  autoReplyChannels: readonly SetupChannel[]
  platform: NodeJS.Platform
  vault: string
}): Promise<void> {
  const state = await readAssistantAutomationState(input.vault)
  const preservedAutoReplyChannels = state.autoReplyChannels.filter(
    (channel): channel is SetupChannel =>
      isSetupChannel(channel) &&
      !isSetupChannelSupportedOnPlatform(channel, input.platform),
  )
  const autoReplyChannels = normalizeSetupChannels([
    ...input.autoReplyChannels,
    ...preservedAutoReplyChannels,
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
  const backlogChanged =
    nextBacklogChannels.length !== state.autoReplyBacklogChannels.length ||
    nextBacklogChannels.some((channel, index) => state.autoReplyBacklogChannels[index] !== channel)

  if (!autoReplyChanged && !backlogChanged) {
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
  sourceSetEnabled?: InboxServices['sourceSetEnabled']
  vault: string
}): Promise<boolean> {
  if (input.enabled) {
    return true
  }

  if (!input.sourceSetEnabled) {
    return false
  }

  await input.sourceSetEnabled({
    connectorId: input.connectorId,
    enabled: true,
    requestId: input.requestId,
    vault: input.vault,
  })

  return true
}

function resolveSetupChannelForConnector(
  connector: SetupListedConnector,
): SetupChannel | null {
  for (const channel of SETUP_CHANNEL_ORDER) {
    if (CHANNEL_SPECS[channel].matchesConfiguredConnector(connector)) {
      return channel
    }
  }

  return null
}
