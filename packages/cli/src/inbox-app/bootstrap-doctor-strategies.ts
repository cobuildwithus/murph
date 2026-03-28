import {
  probeLinqApi,
  resolveLinqApiToken,
  resolveLinqWebhookSecret,
} from '../linq-runtime.js'
import { SETUP_RUNTIME_ENV_NOTICE } from '../setup-runtime-env.js'
import { resolveTelegramBotToken } from '../telegram-runtime.js'
import { resolveAgentmailApiKey } from '../agentmail-runtime.js'
import type {
  InboxConnectorConfig,
  InboxDoctorCheck,
} from '../inbox-cli-contracts.js'
import type {
  DoctorContext,
  InboxAppEnvironment,
} from './types.js'
import { describeLinqConnectorEndpoint } from './linq-endpoint.js'
import {
  errorMessage,
  failCheck,
  passCheck,
  warnCheck,
} from '../inbox-services/shared.js'
import { IMESSAGE_MESSAGES_DB_RELATIVE_PATH } from './environment.js'

type DoctorCheckResult = InboxDoctorCheck | InboxDoctorCheck[]
type DoctorSource = InboxConnectorConfig['source']

export interface DoctorCheckRunner {
  <TResult>(
    context: DoctorContext,
    input: {
      run: () => Promise<TResult>
      onSuccess: (result: TResult) => DoctorCheckResult
      onError: (error: unknown) => DoctorCheckResult
    },
  ): Promise<TResult | null>
}

export interface DoctorStrategyDeps {
  env: InboxAppEnvironment
  runDoctorCheck: DoctorCheckRunner
}

export type DoctorStrategy = (
  context: DoctorContext,
  connector: InboxConnectorConfig,
  deps: DoctorStrategyDeps,
) => Promise<void>

const runImessageDoctorChecks: DoctorStrategy = async (
  context,
  connector,
  { env, runDoctorCheck },
) => {
  if (env.getPlatform() !== 'darwin') {
    context.checks.push(
      failCheck(
        'platform',
        'The iMessage connector requires macOS.',
        { platform: env.getPlatform() },
      ),
    )
  } else {
    context.checks.push(passCheck('platform', 'Running on macOS.'))
  }

  const driver = await runDoctorCheck(context, {
    run: () => env.loadConfiguredImessageDriver(connector),
    onSuccess: () =>
      passCheck('driver-import', 'The iMessage driver imported successfully.'),
    onError: (error) =>
      failCheck(
        'driver-import',
        'The iMessage driver could not be imported.',
        { error: errorMessage(error) },
      ),
  })

  await runDoctorCheck(context, {
    run: () => env.ensureConfiguredImessageReady(),
    onSuccess: () =>
      passCheck('messages-db', 'The local Messages database is readable.', {
        path: IMESSAGE_MESSAGES_DB_RELATIVE_PATH.replace(/\\/g, '/'),
      }),
    onError: (error) =>
      failCheck(
        'messages-db',
        'The local Messages database could not be accessed.',
        { error: errorMessage(error) },
      ),
  })

  if (!driver) {
    return
  }

  await runDoctorCheck(context, {
    run: async () => {
      const chats = (await driver.listChats?.()) ?? []
      const messages = await driver.getMessages({
        limit: 1,
        cursor: null,
        includeOwnMessages: connector.options.includeOwnMessages ?? true,
      })

      return {
        chats,
        messages,
      }
    },
    onSuccess: ({ chats, messages }) =>
      chats.length > 0 || messages.length > 0
        ? passCheck(
            'probe',
            'The connector can list chats or fetch messages.',
            {
              chats: chats.length,
              messages: messages.length,
            },
          )
        : warnCheck(
            'probe',
            'The connector responded but returned no chats or messages.',
          ),
    onError: (error) =>
      failCheck(
        'probe',
        'The connector could not fetch chats or messages.',
        { error: errorMessage(error) },
      ),
  })
}

const runTelegramDoctorChecks: DoctorStrategy = async (
  context,
  connector,
  { env, runDoctorCheck },
) => {
  context.checks.push(
    passCheck('platform', 'Telegram long polling is platform-agnostic.'),
  )

  const envVars = env.getEnvironment()
  const token = resolveTelegramBotToken(envVars)
  const usesInjectedTelegramDriver = env.usesInjectedTelegramDriver
  if (!token && !usesInjectedTelegramDriver) {
    context.checks.push(
      failCheck(
        'token',
        `Telegram bot token is missing from TELEGRAM_BOT_TOKEN. ${SETUP_RUNTIME_ENV_NOTICE}`,
      ),
    )
  } else if (usesInjectedTelegramDriver) {
    context.checks.push(
      passCheck(
        'token',
        'Telegram driver configuration is delegated to the integrating workspace.',
      ),
    )
  } else {
    context.checks.push(
      passCheck(
        'token',
        'Telegram bot token was found in the local environment.',
      ),
    )
  }

  const driver =
    token || usesInjectedTelegramDriver
      ? await runDoctorCheck(context, {
          run: () => env.loadConfiguredTelegramDriver(connector),
          onSuccess: () =>
            passCheck(
              'driver-import',
              'The Telegram poll driver initialized successfully.',
            ),
          onError: (error) =>
            failCheck(
              'driver-import',
              'The Telegram poll driver could not be initialized.',
              { error: errorMessage(error) },
            ),
        })
      : null

  if (!driver) {
    return
  }

  await runDoctorCheck(context, {
    run: () => driver.getMe(),
    onSuccess: (bot) =>
      passCheck('probe', 'The Telegram bot token authenticated successfully.', {
        bot:
          typeof bot === 'object' && bot !== null && 'username' in bot
            ? (bot as { username?: unknown }).username ?? null
            : null,
      }),
    onError: (error) =>
      failCheck(
        'probe',
        'The Telegram bot token could not authenticate with getMe.',
        { error: errorMessage(error) },
      ),
  })

  if (!driver.getWebhookInfo) {
    return
  }

  await runDoctorCheck(context, {
    run: () => driver.getWebhookInfo!(),
    onSuccess: (webhook) => {
      const url = typeof webhook?.url === 'string' ? webhook.url.trim() : null

      return url
        ? warnCheck(
            'webhook',
            'Telegram currently has an active webhook; the local poll connector will delete it on start.',
            { url },
          )
        : passCheck(
            'webhook',
            'No Telegram webhook is configured; local polling can run safely.',
          )
    },
    onError: (error) =>
      warnCheck(
        'webhook',
        'Telegram webhook status could not be read.',
        { error: errorMessage(error) },
      ),
  })
}

const runEmailDoctorChecks: DoctorStrategy = async (
  context,
  connector,
  { env, runDoctorCheck },
) => {
  context.checks.push(
    passCheck('platform', 'Email polling is platform-agnostic.'),
  )

  const envVars = env.getEnvironment()
  const apiKey = resolveAgentmailApiKey(envVars)
  const usesInjectedEmailDriver = env.usesInjectedEmailDriver

  if (!connector.accountId) {
    context.checks.push(
      failCheck(
        'account',
        'Email connectors require an AgentMail inbox id as the connector account.',
      ),
    )
  } else {
    context.checks.push(
      passCheck('account', 'AgentMail inbox id is configured for the connector.', {
        inboxId: connector.accountId,
        emailAddress: connector.options.emailAddress ?? null,
      }),
    )
  }

  if (!apiKey && !usesInjectedEmailDriver) {
    context.checks.push(
      failCheck(
        'token',
        `AgentMail API key is missing from AGENTMAIL_API_KEY. ${SETUP_RUNTIME_ENV_NOTICE}`,
      ),
    )
  } else if (usesInjectedEmailDriver) {
    context.checks.push(
      passCheck(
        'token',
        'Email driver configuration is delegated to the integrating workspace.',
      ),
    )
  } else {
    context.checks.push(
      passCheck('token', 'AgentMail API key was found in the local environment.'),
    )
  }

  const driver =
    connector.accountId && (apiKey || usesInjectedEmailDriver)
      ? await runDoctorCheck(context, {
          run: () => env.loadConfiguredEmailDriver(connector),
          onSuccess: () =>
            passCheck(
              'driver-import',
              'The AgentMail poll driver initialized successfully.',
            ),
          onError: (error) =>
            failCheck(
              'driver-import',
              'The AgentMail poll driver could not be initialized.',
              { error: errorMessage(error) },
            ),
        })
      : null

  if (!driver) {
    return
  }

  await runDoctorCheck(context, {
    run: () =>
      driver.listUnreadMessages({
        limit: 1,
      }),
    onSuccess: (messages) =>
      messages.length > 0
        ? passCheck(
            'probe',
            'The AgentMail inbox responded and returned unread messages.',
            { messages: messages.length },
          )
        : warnCheck(
            'probe',
            'The AgentMail inbox responded but returned no unread messages.',
          ),
    onError: (error) =>
      failCheck(
        'probe',
        'The AgentMail inbox could not be queried for unread messages.',
        { error: errorMessage(error) },
      ),
  })
}

const runLinqDoctorChecks: DoctorStrategy = async (
  context,
  connector,
  { env, runDoctorCheck },
) => {
  context.checks.push(
    passCheck('platform', 'Linq webhook delivery is platform-agnostic.'),
  )

  const envVars = env.getEnvironment()
  const token = resolveLinqApiToken(envVars)
  if (!token) {
    context.checks.push(
      failCheck(
        'token',
        `Linq API token is missing from LINQ_API_TOKEN. ${SETUP_RUNTIME_ENV_NOTICE}`,
      ),
    )
  } else {
    context.checks.push(
      passCheck('token', 'Linq API token was found in the local environment.'),
    )
  }

  const webhookSecret = resolveLinqWebhookSecret(envVars)
  context.checks.push(
    webhookSecret
      ? passCheck(
          'webhook-secret',
          'A Linq webhook signing secret was found in the local environment.',
        )
      : failCheck(
          'webhook-secret',
          `Linq webhook delivery requires LINQ_WEBHOOK_SECRET. ${SETUP_RUNTIME_ENV_NOTICE}`,
        ),
  )

  context.checks.push(
    passCheck(
      'webhook-listener',
      'The Linq webhook listener is configured for local watch mode.',
      describeLinqConnectorEndpoint(connector),
    ),
  )

  if (!token) {
    return
  }

  await runDoctorCheck(context, {
    run: () => probeLinqApi({ env: envVars }),
    onSuccess: (probe) =>
      probe.phoneNumbers.length > 0
        ? passCheck('probe', 'The Linq API token authenticated successfully.', {
            phoneNumbers: probe.phoneNumbers,
          })
        : warnCheck(
            'probe',
            'The Linq API token authenticated, but no phone numbers were returned.',
          ),
    onError: (error) =>
      failCheck(
        'probe',
        'The Linq API token could not authenticate with /phonenumbers.',
        { error: errorMessage(error) },
      ),
  })
}

export const DOCTOR_STRATEGIES: Record<DoctorSource, DoctorStrategy> = {
  imessage: runImessageDoctorChecks,
  telegram: runTelegramDoctorChecks,
  email: runEmailDoctorChecks,
  linq: runLinqDoctorChecks,
}
