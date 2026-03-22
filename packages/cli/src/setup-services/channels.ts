import {
  readAssistantAutomationState,
  saveAssistantAutomationState,
} from '../assistant-state.js'
import { getAssistantChannelAdapter } from '../assistant/channel-adapters.js'
import type { InboxCliServices } from '../inbox-services.js'
import { resolveTelegramBotToken } from '../telegram-runtime.js'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  type SetupChannel,
  type SetupConfiguredChannel,
  type SetupStepResult,
} from '../setup-cli-contracts.js'
import { createStep } from './steps.js'

const IMESSAGE_SETUP_CONNECTOR_ID = 'imessage:self'
const IMESSAGE_SETUP_ACCOUNT_ID = 'self'
const TELEGRAM_SETUP_CONNECTOR_ID = 'telegram:bot'
const TELEGRAM_SETUP_ACCOUNT_ID = 'bot'

type SetupChannelInboxServices = Pick<InboxCliServices, 'bootstrap'> &
  Partial<Pick<InboxCliServices, 'doctor' | 'sourceAdd' | 'sourceList'>>

export function normalizeSetupChannels(
  value: readonly SetupChannel[] | null | undefined,
): SetupChannel[] {
  return [...new Set(value ?? [])]
}

export async function configureSetupChannels(input: {
  channels: readonly SetupChannel[]
  dryRun: boolean
  env: NodeJS.ProcessEnv
  inboxServices: SetupChannelInboxServices
  requestId: string | null
  steps: SetupStepResult[]
  vault: string
}): Promise<SetupConfiguredChannel[]> {
  const configured: SetupConfiguredChannel[] = []

  if (input.channels.includes('imessage')) {
    configured.push(
      await configureIMessageChannel({
        dryRun: input.dryRun,
        inboxServices: input.inboxServices,
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

  if (!input.dryRun) {
    await updateAssistantAutoReplyChannels({
      channels: configured
        .filter((channel) => channel.autoReply)
        .map((channel) => channel.channel),
      vault: input.vault,
    })
  }

  return configured
}

async function configureIMessageChannel(input: {
  dryRun: boolean
  inboxServices: SetupChannelInboxServices
  requestId: string | null
  steps: SetupStepResult[]
  vault: string
}): Promise<SetupConfiguredChannel> {
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
    }
  }

  const sourceList = input.inboxServices.sourceList
  const sourceAdd = input.inboxServices.sourceAdd
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
  const doctor = input.inboxServices.doctor
  const sourceList = input.inboxServices.sourceList
  const sourceAdd = input.inboxServices.sourceAdd

  if (input.dryRun) {
    input.steps.push(
      createStep({
        detail: token
          ? 'Would verify the Telegram bot token, add or reuse the telegram:bot inbox connector, and enable assistant auto-reply for Telegram direct chats.'
          : 'Would configure Telegram once HEALTHYBOB_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN is set in the shell environment.',
        id: 'channel-telegram',
        kind: 'configure',
        status: 'planned',
        title: 'Telegram channel',
      }),
    )

    return {
      autoReply: readyForSetup,
      channel: 'telegram',
      configured: false,
      connectorId: TELEGRAM_SETUP_CONNECTOR_ID,
      detail: token
        ? 'Would configure the Telegram bot connector and enable assistant auto-reply for Telegram direct chats.'
        : 'Telegram needs HEALTHYBOB_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN before setup can enable the channel.',
      enabled: true,
    }
  }

  if (!sourceList || !sourceAdd) {
    throw new VaultCliError(
      'runtime_unavailable',
      'Healthy Bob setup cannot configure Telegram because the inbox source management services are unavailable in this build.',
    )
  }

  const listed = await sourceList({
    vault: input.vault,
    requestId: input.requestId,
  })
  const existingConnector =
    listed.connectors.find((connector) => connector.id === TELEGRAM_SETUP_CONNECTOR_ID) ??
    listed.connectors.find(
      (connector) =>
        connector.source === 'telegram' && connector.accountId === TELEGRAM_SETUP_ACCOUNT_ID,
    ) ??
    null

  if (!readyForSetup) {
    input.steps.push(
      createStep({
        detail: existingConnector
          ? `Reused the Telegram inbox connector "${existingConnector.id}", but did not enable assistant auto-reply because HEALTHYBOB_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN is not set.`
          : 'Telegram was selected, but setup did not add the connector because HEALTHYBOB_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN is not set.',
        id: 'channel-telegram',
        kind: 'configure',
        status: existingConnector ? 'reused' : 'skipped',
        title: 'Telegram channel',
      }),
    )

    return {
      autoReply: false,
      channel: 'telegram',
      configured: existingConnector !== null,
      connectorId: existingConnector?.id ?? null,
      detail: existingConnector
        ? `Reused the Telegram connector "${existingConnector.id}", but skipped assistant auto-reply until a bot token is exported in the environment.`
        : 'Telegram needs HEALTHYBOB_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN before setup can add the connector and enable assistant auto-reply.',
      enabled: true,
    }
  }

  if (existingConnector) {
    const readiness = await probeTelegramSetupReadiness({
      connectorId: existingConnector.id,
      doctor,
      requestId: input.requestId,
      vault: input.vault,
    })

    input.steps.push(
      createStep({
        detail: readiness.ready
          ? `Reusing the Telegram inbox connector "${existingConnector.id}" and enabling assistant auto-reply for Telegram direct chats.`
          : `Reused the Telegram inbox connector "${existingConnector.id}", but did not enable assistant auto-reply because the bot token could not authenticate${readiness.reason ? ` (${readiness.reason})` : ''}.`,
        id: 'channel-telegram',
        kind: 'configure',
        status: 'reused',
        title: 'Telegram channel',
      }),
    )

    return {
      autoReply: readiness.ready,
      channel: 'telegram',
      configured: readiness.ready,
      connectorId: existingConnector.id,
      detail: readiness.ready
        ? `Reused the Telegram connector "${existingConnector.id}" and enabled assistant auto-reply for Telegram direct chats.`
        : `Reused the Telegram connector "${existingConnector.id}", but skipped assistant auto-reply until the bot token authenticates successfully with Telegram${readiness.reason ? ` (${readiness.reason})` : ''}.`,
      enabled: true,
    }
  }

  const added = await sourceAdd({
    account: TELEGRAM_SETUP_ACCOUNT_ID,
    id: TELEGRAM_SETUP_CONNECTOR_ID,
    requestId: input.requestId,
    source: 'telegram',
    vault: input.vault,
  })

  const readiness = await probeTelegramSetupReadiness({
    connectorId: added.connector.id,
    doctor,
    requestId: input.requestId,
    vault: input.vault,
  })

  input.steps.push(
    createStep({
      detail: readiness.ready
        ? `Added the Telegram inbox connector "${added.connector.id}" and enabled assistant auto-reply for Telegram direct chats.`
        : `Added the Telegram inbox connector "${added.connector.id}", but did not enable assistant auto-reply because the bot token could not authenticate${readiness.reason ? ` (${readiness.reason})` : ''}.`,
      id: 'channel-telegram',
      kind: 'configure',
      status: 'completed',
      title: 'Telegram channel',
    }),
  )

  return {
    autoReply: readiness.ready,
    channel: 'telegram',
    configured: readiness.ready,
    connectorId: added.connector.id,
    detail: readiness.ready
      ? `Configured the Telegram connector "${added.connector.id}" and enabled assistant auto-reply for Telegram direct chats.`
      : `Configured the Telegram connector "${added.connector.id}", but skipped assistant auto-reply until the bot token authenticates successfully with Telegram${readiness.reason ? ` (${readiness.reason})` : ''}.`,
    enabled: true,
  }
}

async function probeTelegramSetupReadiness(input: {
  connectorId: string
  doctor?: InboxCliServices['doctor']
  requestId: string | null
  vault: string
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
  const ready =
    probeCheck?.status === 'pass' &&
    (driverImportCheck === null || driverImportCheck.status === 'pass')

  return {
    ready,
    reason:
      ready
        ? null
        : probeCheck?.message ?? driverImportCheck?.message ?? 'Telegram readiness probe failed',
  }
}

async function updateAssistantAutoReplyChannels(input: {
  channels: readonly SetupChannel[]
  vault: string
}): Promise<void> {
  const state = await readAssistantAutomationState(input.vault)
  const channels = normalizeSetupChannels(input.channels)
  const changed =
    channels.length !== state.autoReplyChannels.length ||
    channels.some((channel, index) => state.autoReplyChannels[index] !== channel)

  await saveAssistantAutomationState(input.vault, {
    version: 2,
    inboxScanCursor: state.inboxScanCursor,
    autoReplyScanCursor:
      channels.length === 0 ? null : changed ? null : state.autoReplyScanCursor,
    autoReplyChannels: channels,
    autoReplyPrimed: channels.length === 0 ? true : changed ? false : state.autoReplyPrimed,
    updatedAt: new Date().toISOString(),
  })
}
