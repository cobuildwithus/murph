import { SETUP_RUNTIME_ENV_NOTICE } from '@murphai/operator-config/setup-runtime-env'
import { resolveTelegramBotToken } from '@murphai/operator-config/telegram-runtime'
import type {
  InboxConnectorConfig,
  InboxDoctorCheck,
} from '@murphai/operator-config/inbox-cli-contracts'
import type {
  DoctorContext,
  InboxAppEnvironment,
} from './types.js'
import {
  errorMessage,
  failCheck,
  passCheck,
  warnCheck,
} from '../inbox-services/shared.js'

type DoctorCheckResult = InboxDoctorCheck | InboxDoctorCheck[]
type DoctorSource = InboxConnectorConfig['source']
type SupportedDoctorSource = 'telegram'

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

export const DOCTOR_STRATEGIES: Record<SupportedDoctorSource, DoctorStrategy> = {
  telegram: runTelegramDoctorChecks,
}
