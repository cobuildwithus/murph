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
} from '@murphai/operator-config/setup-cli-contracts'
import { resolveTelegramBotToken } from '@murphai/operator-config/telegram-runtime'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { createStep } from './steps.js'

const TELEGRAM_SETUP_CONNECTOR_ID = 'telegram:bot'
const TELEGRAM_SETUP_ACCOUNT_ID = 'bot'

type SetupChannelInboxServices = Pick<InboxServices, 'bootstrap'> &
  Partial<
    Pick<
      InboxServices,
      'doctor' | 'sourceAdd' | 'sourceList' | 'sourceSetEnabled'
    >
  >

type SetupListedConnector =
  Awaited<ReturnType<NonNullable<SetupChannelInboxServices['sourceList']>>>['connectors'][number]

export function normalizeSetupChannels(
  value: readonly SetupChannel[] | null | undefined,
): SetupChannel[] {
  return [...new Set(value ?? [])]
}

function isTelegramSetupConnector(connector: SetupListedConnector): boolean {
  return (
    connector.id === TELEGRAM_SETUP_CONNECTOR_ID ||
    (connector.source === 'telegram' &&
      connector.accountId === TELEGRAM_SETUP_ACCOUNT_ID)
  )
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
  const selectedChannels = new Set(normalizeSetupChannels(input.channels))

  if (selectedChannels.has('telegram')) {
    configured.push(await configureTelegramSetupChannel(input))
  }

  if (!input.dryRun) {
    await reconcileDeselectedTelegramChannel({
      selected: selectedChannels.has('telegram'),
      inboxServices: input.inboxServices,
      requestId: input.requestId,
      vault: input.vault,
    })
    await reconcileManagedAssistantAutoReplyChannelsLocal({
      desiredChannels: configured
        .filter((channel) => channel.autoReply)
        .map((channel) => channel.channel),
      isManagedChannel: (channel) => channel === 'telegram',
      vault: input.vault,
    })
  }

  return configured
}

async function configureTelegramSetupChannel(input: {
  dryRun: boolean
  env: NodeJS.ProcessEnv
  inboxServices: SetupChannelInboxServices
  requestId: string | null
  steps: SetupStepResult[]
  vault: string
}): Promise<SetupConfiguredChannel> {
  const token = resolveTelegramBotToken(input.env)
  const missingEnv = resolveSetupChannelMissingEnv('telegram', input.env)

  if (input.dryRun) {
    input.steps.push(
      createStep({
        detail: token
          ? 'Would verify the Telegram bot token, add or reuse the telegram:bot inbox connector, and enable assistant auto-reply for Telegram direct chats.'
          : 'Would configure Telegram once TELEGRAM_BOT_TOKEN is available in the shell or local `.env`.',
        id: 'channel-telegram',
        kind: 'configure',
        status: 'planned',
        title: 'Telegram channel',
      }),
    )
    return {
      autoReply: Boolean(token),
      channel: 'telegram',
      configured: false,
      connectorId: TELEGRAM_SETUP_CONNECTOR_ID,
      detail: token
        ? 'Would configure the Telegram bot connector and enable assistant auto-reply for Telegram direct chats.'
        : `Telegram needs TELEGRAM_BOT_TOKEN in the current environment before setup can enable the channel. ${SETUP_RUNTIME_ENV_NOTICE}`,
      enabled: true,
      missingEnv,
    }
  }

  const doctor = input.inboxServices.doctor
  const sourceAdd = input.inboxServices.sourceAdd
  const sourceList = input.inboxServices.sourceList
  const sourceSetEnabled = input.inboxServices.sourceSetEnabled
  if (!sourceList || !sourceAdd) {
    throw new VaultCliError(
      'runtime_unavailable',
      'Murph setup cannot configure Telegram because the inbox source management services are unavailable in this build.',
    )
  }

  const listed = await sourceList({
    requestId: input.requestId,
    vault: input.vault,
  })
  const existingConnector =
    listed.connectors.find(isTelegramSetupConnector) ?? null

  if (!token) {
    input.steps.push(
      createStep({
        detail: existingConnector
          ? `Reused the Telegram inbox connector "${existingConnector.id}", but did not enable assistant auto-reply because TELEGRAM_BOT_TOKEN was not available in the shell or local \`.env\`.`
          : 'Telegram was selected, but setup did not add the connector because TELEGRAM_BOT_TOKEN was not available in the shell or local `.env`.',
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
        ? `Reused the Telegram connector "${existingConnector.id}", but skipped assistant auto-reply until a bot token is available in the current environment. ${SETUP_RUNTIME_ENV_NOTICE}`
        : `Telegram needs TELEGRAM_BOT_TOKEN in the current environment before setup can add the connector and enable assistant auto-reply. ${SETUP_RUNTIME_ENV_NOTICE}`,
      enabled: true,
      missingEnv,
    }
  }

  if (existingConnector) {
    if (!existingConnector.enabled && sourceSetEnabled) {
      await sourceSetEnabled({
        connectorId: existingConnector.id,
        enabled: true,
        requestId: input.requestId,
        vault: input.vault,
      })
    }
    const readiness = await probeSetupReadiness({
      connectorId: existingConnector.id,
      doctor,
      fallbackReason: 'Telegram readiness probe failed',
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
      missingEnv: [],
    }
  }

  const added = await sourceAdd({
    account: TELEGRAM_SETUP_ACCOUNT_ID,
    id: TELEGRAM_SETUP_CONNECTOR_ID,
    requestId: input.requestId,
    source: 'telegram',
    vault: input.vault,
  })
  const readiness = await probeSetupReadiness({
    connectorId: added.connector.id,
    doctor,
    fallbackReason: 'Telegram readiness probe failed',
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
    missingEnv: [],
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
    reason: ready
      ? null
      : probeCheck?.message ??
        driverImportCheck?.message ??
        input.fallbackReason,
  }
}

async function reconcileDeselectedTelegramChannel(input: {
  selected: boolean
  inboxServices: SetupChannelInboxServices
  requestId: string | null
  vault: string
}): Promise<void> {
  if (input.selected) {
    return
  }

  const sourceList = input.inboxServices.sourceList
  const sourceSetEnabled = input.inboxServices.sourceSetEnabled
  if (!sourceList || !sourceSetEnabled) {
    return
  }

  const listed = await sourceList({
    requestId: input.requestId,
    vault: input.vault,
  })
  for (const connector of listed.connectors) {
    if (!connector.enabled || !isTelegramSetupConnector(connector)) {
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
