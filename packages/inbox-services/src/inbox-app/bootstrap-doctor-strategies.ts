import {
  probeLinqApi,
  resolveLinqApiToken,
  resolveLinqWebhookSecret,
} from '@murphai/operator-config/linq-runtime'
import { SETUP_RUNTIME_ENV_NOTICE } from '@murphai/operator-config/setup-runtime-env'
import { resolveTelegramBotToken } from '@murphai/operator-config/telegram-runtime'
import { resolveAgentmailApiKey } from '@murphai/operator-config/agentmail-runtime'
import type {
  InboxConnectorConfig,
  InboxDoctorCheck,
} from '@murphai/operator-config/inbox-cli-contracts'
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

type DoctorCheckResult = InboxDoctorCheck | InboxDoctorCheck[]
type DoctorSource = InboxConnectorConfig['source']
type SupportedDoctorSource = 'telegram' | 'email' | 'linq'

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
    webhookSecret
      ? passCheck(
          'webhook-listener',
          'The Linq webhook listener is configured for local watch mode.',
          describeLinqConnectorEndpoint(connector),
        )
      : failCheck(
          'webhook-listener',
          'The Linq webhook listener cannot start until LINQ_WEBHOOK_SECRET is configured.',
          describeLinqConnectorEndpoint(connector),
        ),
  )

  if (!token || !webhookSecret) {
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
        'The Linq API token could not authenticate with /phone_numbers.',
        { error: errorMessage(error) },
      ),
  })
}

export const DOCTOR_STRATEGIES: Record<SupportedDoctorSource, DoctorStrategy> = {
  telegram: runTelegramDoctorChecks,
  email: runEmailDoctorChecks,
  linq: runLinqDoctorChecks,
}
