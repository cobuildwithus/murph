import { reconcileManagedAssistantAutoReplyChannelsLocal } from '@murphai/assistant-engine/assistant-state'
import type { InboxServices } from '@murphai/inbox-services'
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

const TELEGRAM_SETUP_CONNECTOR_ID = 'telegram:bot'
const TELEGRAM_SETUP_ACCOUNT_ID = 'bot'
const SETUP_CHANNEL_ORDER = ['telegram'] as const satisfies readonly SetupChannel[]

function isSetupChannelSupportedOnPlatform(
  channel: SetupChannel,
  platform: NodeJS.Platform,
): boolean {
  void channel
  void platform
  return true
}

type SetupChannelInboxServices = Pick<InboxServices, 'bootstrap'> &
  Partial<
    Pick<
      InboxServices,
      'doctor' | 'sourceAdd' | 'sourceList' | 'sourceSetEnabled'
    >
  >

type SetupListedConnector =
  Awaited<ReturnType<NonNullable<SetupChannelInboxServices['sourceList']>>>['connectors'][number]
type SetupAddedConnectorResult = Awaited<
  ReturnType<NonNullable<SetupChannelInboxServices['sourceAdd']>>
>
type SetupReadiness = Awaited<ReturnType<typeof probeSetupReadiness>>

type SetupChannelMessages = {
  stepDetail: string
  detail: string
}

type SetupChannelContext = {
  dryRun: boolean
  env: NodeJS.ProcessEnv
  inboxServices: SetupChannelInboxServices
  platform: NodeJS.Platform
  requestId: string | null
  steps: SetupStepResult[]
  vault: string
}

type SetupChannelPlan = {
  connectorId: string
  dryRunDetail: string
  dryRunStepDetail: string
  missingEnv: string[]
  readyForSetup: boolean
}

type SetupChannelOutcome = 'dry-run' | 'missing-env' | 'reused' | 'added'

type SetupChannelResolution = {
  autoReplyReady: boolean
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
  readinessFallbackReason: string
  plan(context: SetupChannelContext): SetupChannelPlan
  findExistingConnector(connectors: readonly SetupListedConnector[]): SetupListedConnector | null
  addConnector(
    context: SetupChannelContext,
    sourceAdd: NonNullable<SetupChannelInboxServices['sourceAdd']>,
  ): Promise<SetupAddedConnectorResult>
  describeMissingEnv(input: {
    existingConnector: SetupListedConnector | null
  }): SetupChannelMessages
  describeReused(input: {
    connector: SetupListedConnector
    readiness: SetupReadiness
  }): SetupChannelMessages
  describeAdded(input: {
    added: SetupAddedConnectorResult
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

function isSetupManagedAutoReplyChannel(
  channel: string,
  platform: NodeJS.Platform,
): channel is SetupChannel {
  return isSetupChannel(channel) && isSetupChannelSupportedOnPlatform(channel, platform)
}

function isTelegramSetupConnector(connector: SetupListedConnector): boolean {
  return (
    connector.id === TELEGRAM_SETUP_CONNECTOR_ID ||
    (connector.source === 'telegram' &&
      connector.accountId === TELEGRAM_SETUP_ACCOUNT_ID)
  )
}

const TELEGRAM_CHANNEL_SPEC = {
  channel: 'telegram',
  title: 'Telegram channel',
  stepId: 'channel-telegram',
  runtimeUnavailableMessage:
    'Murph setup cannot configure Telegram because the inbox source management services are unavailable in this build.',
  readinessFallbackReason: 'Telegram readiness probe failed',
  plan(context) {
    const token = resolveTelegramBotToken(context.env)
    const missingEnv = resolveSetupChannelMissingEnv('telegram', context.env)

    return {
      connectorId: TELEGRAM_SETUP_CONNECTOR_ID,
      dryRunDetail: token
        ? 'Would configure the Telegram bot connector and enable assistant auto-reply for Telegram direct chats.'
        : `Telegram needs TELEGRAM_BOT_TOKEN in the current environment before setup can enable the channel. ${SETUP_RUNTIME_ENV_NOTICE}`,
      dryRunStepDetail: token
        ? 'Would verify the Telegram bot token, add or reuse the telegram:bot inbox connector, and enable assistant auto-reply for Telegram direct chats.'
        : 'Would configure Telegram once TELEGRAM_BOT_TOKEN is available in the shell or local `.env`.',
      missingEnv,
      readyForSetup: Boolean(token),
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
} satisfies SetupChannelSpec

export async function configureSetupChannels(input: {
  channels: readonly SetupChannel[]
  dryRun: boolean
  env: NodeJS.ProcessEnv
  inboxServices: SetupChannelInboxServices
  platform?: NodeJS.Platform
  requestId: string | null
  steps: SetupStepResult[]
  vault: string
}): Promise<SetupConfiguredChannel[]> {
  const configured: SetupConfiguredChannel[] = []
  const platform = input.platform ?? process.platform
  const context: SetupChannelContext = {
    dryRun: input.dryRun,
    env: input.env,
    inboxServices: input.inboxServices,
    platform,
    requestId: input.requestId,
    steps: input.steps,
    vault: input.vault,
  }
  const selectedChannels = new Set(normalizeSetupChannels(input.channels))

  for (const channel of SETUP_CHANNEL_ORDER) {
    if (!selectedChannels.has(channel)) {
      continue
    }

    configured.push(await configureSetupChannel(TELEGRAM_CHANNEL_SPEC, context))
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

async function configureSetupChannel(
  spec: SetupChannelSpec,
  context: SetupChannelContext,
): Promise<SetupConfiguredChannel> {
  const plan = spec.plan(context)

  if (context.dryRun) {
    return recordSetupChannelResult(spec, context, {
      autoReplyReady: plan.readyForSetup,
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
    const messages = spec.describeMissingEnv({ existingConnector })

    return recordSetupChannelResult(spec, context, {
      autoReplyReady: false,
      connectorId: existingConnector?.id ?? null,
      connectorPresent: existingConnector !== null,
      detail: messages.detail,
      missingEnv: plan.missingEnv,
      outcome: 'missing-env',
      stepDetail: messages.stepDetail,
      stepStatus: existingConnector ? 'reused' : 'skipped',
    })
  }

  if (existingConnector) {
    await ensureSetupConnectorEnabled({
      connectorId: existingConnector.id,
      enabled: existingConnector.enabled,
      requestId: context.requestId,
      sourceSetEnabled,
      vault: context.vault,
    })
    const readiness = await probeSetupReadiness({
      connectorId: existingConnector.id,
      doctor,
      fallbackReason: spec.readinessFallbackReason,
      requestId: context.requestId,
      vault: context.vault,
    })
    const messages = spec.describeReused({ connector: existingConnector, readiness })

    return recordSetupChannelResult(spec, context, {
      autoReplyReady: readiness.ready,
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
  const readiness = await probeSetupReadiness({
    connectorId: added.connector.id,
    doctor,
    fallbackReason: spec.readinessFallbackReason,
    requestId: context.requestId,
    vault: context.vault,
  })
  const messages = spec.describeAdded({ added, readiness })

  return recordSetupChannelResult(spec, context, {
    autoReplyReady: readiness.ready,
    connectorId: added.connector.id,
    connectorPresent: true,
    detail: messages.detail,
    missingEnv: [],
    outcome: 'added',
    stepDetail: messages.stepDetail,
    stepStatus: 'completed',
  })
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
    case 'dry-run':
      return false
  }
}

async function probeSetupReadiness(input: {
  connectorId: string
  doctor?: InboxServices['doctor']
  requestId: string | null
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
    probeCheck?.status === 'pass' &&
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
  await reconcileManagedAssistantAutoReplyChannelsLocal({
    desiredChannels: normalizeSetupChannels(input.autoReplyChannels).filter((channel) =>
      isSetupChannelSupportedOnPlatform(channel, input.platform),
    ),
    isManagedChannel: (channel) =>
      isSetupManagedAutoReplyChannel(channel, input.platform),
    vault: input.vault,
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
  return TELEGRAM_CHANNEL_SPEC.matchesConfiguredConnector(connector)
    ? 'telegram'
    : null
}
