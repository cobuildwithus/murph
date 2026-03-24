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
} from '../setup-cli-contracts.js'
import { createStep } from './steps.js'

const IMESSAGE_SETUP_CONNECTOR_ID = 'imessage:self'
const IMESSAGE_SETUP_ACCOUNT_ID = 'self'
const TELEGRAM_SETUP_CONNECTOR_ID = 'telegram:bot'
const TELEGRAM_SETUP_ACCOUNT_ID = 'bot'
const EMAIL_SETUP_CONNECTOR_ID = 'email:agentmail'
const EMAIL_SETUP_DISPLAY_NAME = 'Healthy Bob'

type SetupChannelInboxServices = Pick<InboxCliServices, 'bootstrap'> &
  Partial<
    Pick<InboxCliServices, 'doctor' | 'sourceAdd' | 'sourceList' | 'sourceSetEnabled'>
  >

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
  requestId: string | null
  resolveAgentmailInboxSelection?: SetupAgentmailSelectionResolver
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
      requestId: input.requestId,
      vault: input.vault,
    })
    await updateAssistantChannelState({
      autoReplyChannels: configured
        .filter((channel) => channel.autoReply)
        .map((channel) => channel.channel),
      preferredChannels: input.channels,
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
  const doctor = input.inboxServices.doctor
  const sourceList = input.inboxServices.sourceList
  const sourceAdd = input.inboxServices.sourceAdd
  const sourceSetEnabled = input.inboxServices.sourceSetEnabled
  const missingEnv = resolveSetupChannelMissingEnv('telegram', input.env)

  if (input.dryRun) {
    input.steps.push(
      createStep({
        detail: token
          ? 'Would verify the Telegram bot token, add or reuse the telegram:bot inbox connector, and enable assistant auto-reply for Telegram direct chats.'
          : 'Would configure Telegram once HEALTHYBOB_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN is available in the shell or local `.env`.',
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
        : `Telegram needs HEALTHYBOB_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN in the current environment before setup can enable the channel. ${SETUP_RUNTIME_ENV_NOTICE}`,
      enabled: true,
      missingEnv,
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
          ? `Reused the Telegram inbox connector "${existingConnector.id}", but did not enable assistant auto-reply because HEALTHYBOB_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN was not available in the shell or local \`.env\`.`
          : 'Telegram was selected, but setup did not add the connector because HEALTHYBOB_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN was not available in the shell or local `.env`.',
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
        : `Telegram needs HEALTHYBOB_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN in the current environment before setup can add the connector and enable assistant auto-reply. ${SETUP_RUNTIME_ENV_NOTICE}`,
      enabled: true,
      missingEnv,
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
      vault: input.vault,
      fallbackReason: 'Telegram readiness probe failed',
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
    requestId: input.requestId,
    vault: input.vault,
    fallbackReason: 'Telegram readiness probe failed',
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
  const doctor = input.inboxServices.doctor
  const sourceList = input.inboxServices.sourceList
  const sourceAdd = input.inboxServices.sourceAdd
  const sourceSetEnabled = input.inboxServices.sourceSetEnabled
  const missingEnv = resolveSetupChannelMissingEnv('email', input.env)

  if (input.dryRun) {
    input.steps.push(
      createStep({
        detail: apiKey
          ? 'Would provision or reuse an AgentMail inbox, verify email polling, and enable assistant auto-reply for direct email threads.'
          : 'Would configure email once HEALTHYBOB_AGENTMAIL_API_KEY or AGENTMAIL_API_KEY is available in the shell or local `.env`.',
        id: 'channel-email',
        kind: 'configure',
        status: 'planned',
        title: 'Email channel',
      }),
    )

    return {
      autoReply: Boolean(apiKey),
      channel: 'email',
      configured: false,
      connectorId: EMAIL_SETUP_CONNECTOR_ID,
      detail: apiKey
        ? 'Would reuse an existing AgentMail inbox when possible, or provision a new inbox connector and enable assistant auto-reply for direct email threads.'
        : `Email needs HEALTHYBOB_AGENTMAIL_API_KEY or AGENTMAIL_API_KEY in the current environment before setup can enable the channel. ${SETUP_RUNTIME_ENV_NOTICE}`,
      enabled: true,
      missingEnv,
    }
  }

  if (!sourceList || !sourceAdd) {
    throw new VaultCliError(
      'runtime_unavailable',
      'Healthy Bob setup cannot configure email because the inbox source management services are unavailable in this build.',
    )
  }

  const listed = await sourceList({
    vault: input.vault,
    requestId: input.requestId,
  })
  const existingConnector =
    listed.connectors.find((connector) => connector.id === EMAIL_SETUP_CONNECTOR_ID) ??
    listed.connectors.find((connector) => connector.source === 'email') ??
    null

  if (!apiKey) {
    input.steps.push(
      createStep({
        detail: existingConnector
          ? `Reused the email inbox connector "${existingConnector.id}", but did not enable assistant auto-reply because HEALTHYBOB_AGENTMAIL_API_KEY or AGENTMAIL_API_KEY was not available in the shell or local \`.env\`.`
          : 'Email was selected, but setup did not add the connector because HEALTHYBOB_AGENTMAIL_API_KEY or AGENTMAIL_API_KEY was not available in the shell or local `.env`.',
        id: 'channel-email',
        kind: 'configure',
        status: existingConnector ? 'reused' : 'skipped',
        title: 'Email channel',
      }),
    )

    return {
      autoReply: false,
      channel: 'email',
      configured: existingConnector !== null,
      connectorId: existingConnector?.id ?? null,
      detail: existingConnector
        ? `Reused the email connector "${existingConnector.id}", but skipped assistant auto-reply until an AgentMail API key is available in the current environment. ${SETUP_RUNTIME_ENV_NOTICE}`
        : `Email needs HEALTHYBOB_AGENTMAIL_API_KEY or AGENTMAIL_API_KEY in the current environment before setup can reuse or provision the connector and enable assistant auto-reply. ${SETUP_RUNTIME_ENV_NOTICE}`,
      enabled: true,
      missingEnv,
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
      treatProbeWarnAsReady: true,
      vault: input.vault,
      fallbackReason: 'Email readiness probe failed',
    })

    input.steps.push(
      createStep({
        detail: readiness.ready
          ? `Reusing the email inbox connector "${existingConnector.id}" and enabling assistant auto-reply for direct email threads.`
          : `Reused the email inbox connector "${existingConnector.id}", but did not enable assistant auto-reply because AgentMail readiness checks failed${readiness.reason ? ` (${readiness.reason})` : ''}.`,
        id: 'channel-email',
        kind: 'configure',
        status: 'reused',
        title: 'Email channel',
      }),
    )

    return {
      autoReply: readiness.ready,
      channel: 'email',
      configured: readiness.ready,
      connectorId: existingConnector.id,
      detail: readiness.ready
        ? `Reused the email connector "${existingConnector.id}" and enabled assistant auto-reply for direct email threads.`
        : `Reused the email connector "${existingConnector.id}", but skipped assistant auto-reply until AgentMail readiness checks succeed${readiness.reason ? ` (${readiness.reason})` : ''}.`,
      enabled: true,
      missingEnv: [],
    }
  }

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

  const readiness = await probeSetupReadiness({
    connectorId: added.connector.id,
    doctor,
    requestId: input.requestId,
    treatProbeWarnAsReady: true,
    vault: input.vault,
    fallbackReason: 'Email readiness probe failed',
  })

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
  input.steps.push(
    createStep({
      detail: readiness.ready
        ? `${actionVerb} the AgentMail inbox connector "${added.connector.id}"${configuredAddress ? ` at ${configuredAddress}` : ''} and enabled assistant auto-reply for direct email threads.`
        : `${actionVerb} the AgentMail inbox connector "${added.connector.id}"${configuredAddress ? ` at ${configuredAddress}` : ''}, but did not enable assistant auto-reply because AgentMail readiness checks failed${readiness.reason ? ` (${readiness.reason})` : ''}.`,
      id: 'channel-email',
      kind: 'configure',
      status: 'completed',
      title: 'Email channel',
    }),
  )

  return {
    autoReply: readiness.ready,
    channel: 'email',
    configured: readiness.ready,
    connectorId: added.connector.id,
    detail: readiness.ready
      ? `Configured the email connector "${added.connector.id}"${configuredAddress ? ` at ${configuredAddress}` : ''} and enabled assistant auto-reply for direct email threads.`
      : `Configured the email connector "${added.connector.id}"${configuredAddress ? ` at ${configuredAddress}` : ''}, but skipped assistant auto-reply until AgentMail readiness checks succeed${readiness.reason ? ` (${readiness.reason})` : ''}.`,
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
  preferredChannels: readonly SetupChannel[]
  vault: string
}): Promise<void> {
  const state = await readAssistantAutomationState(input.vault)
  const autoReplyChannels = normalizeSetupChannels(input.autoReplyChannels)
  const preferredChannels = normalizeSetupChannels(input.preferredChannels)
  const autoReplyChanged =
    autoReplyChannels.length !== state.autoReplyChannels.length ||
    autoReplyChannels.some((channel, index) => state.autoReplyChannels[index] !== channel)
  const preferredChanged =
    preferredChannels.length !== state.preferredChannels.length ||
    preferredChannels.some((channel, index) => state.preferredChannels[index] !== channel)

  if (!autoReplyChanged && !preferredChanged) {
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
    if (!setupChannel || selectedChannels.has(setupChannel)) {
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

  if (connector.id === EMAIL_SETUP_CONNECTOR_ID || connector.source === 'email') {
    return 'email'
  }

  return null
}
