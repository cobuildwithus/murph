import { Cli, z } from 'incur'
import { emptyArgsSchema, withBaseOptions } from '@murphai/operator-config/command-helpers'
import {
  deviceAccountDisconnectResultSchema,
  deviceAccountListResultSchema,
  deviceAccountReconcileResultSchema,
  deviceAccountShowResultSchema,
  deviceConnectResultSchema,
  deviceSyncConnectTargetSchema,
  deviceDaemonStartResultSchema,
  deviceDaemonStatusResultSchema,
  deviceDaemonStopResultSchema,
  deviceProviderListResultSchema,
  deviceSyncBaseUrlSchema,
  deviceSyncProviderKeySchema,
  normalizeDeviceSyncConnectTargetKey,
  normalizeDeviceSyncProviderKey,
} from '@murphai/operator-config/device-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { isScheduledNotificationTurnProcessEnv } from '@murphai/hosted-execution/env'
import type { DeviceSyncServices } from '../device-services.js'

function assertDeviceCliMutationAllowed(): void {
  if (isScheduledNotificationTurnProcessEnv(process.env)) {
    throw new VaultCliError(
      'invalid_option',
      'Scheduled notification turns cannot mutate device connections. Only an authenticated interactive turn may connect, disconnect, reconcile, or control the device sync daemon.',
    )
  }
}

const providerNameSchema = deviceSyncProviderKeySchema
  .describe('Live device-sync provider key such as junction, whoop, or oura.')

const connectTargetNameSchema = deviceSyncConnectTargetSchema
  .describe('Device connect target returned by device provider list, such as fitbit, garmin, whoop, or oura.')

const sourceProviderNameSchema = deviceSyncConnectTargetSchema
  .describe('Upstream device source provider such as fitbit, garmin, whoop, or oura.')

const accountIdSchema = z
  .string()
  .min(1)
  .describe('Device sync account id returned by the control plane.')

function normalizeProviderName(value: string): string {
  return normalizeDeviceSyncProviderKey(value) ?? value.trim().toLowerCase()
}

function normalizeConnectTargetName(value: string): string {
  const normalized = normalizeDeviceSyncConnectTargetKey(value)
  if (normalized === 'junction') {
    throw new Error(
      'Expected a device connect target such as garmin, whoop, oura, or fitbit.',
    )
  }

  return normalized ?? normalizeProviderName(value)
}

const invalidReturnToCharacterPattern = /[\u0000-\u001F\u007F]/u

function isDeviceConnectReturnTo(value: string): boolean {
  if (invalidReturnToCharacterPattern.test(value)) {
    return false
  }

  if (
    value.startsWith('/')
    && !value.startsWith('//')
    && !value.includes('\\')
  ) {
    return true
  }

  try {
    const parsed = new URL(value)
    return parsed.username.length === 0 && parsed.password.length === 0
  } catch {
    return false
  }
}

const deviceControlOptionsSchema = withBaseOptions({
  baseUrl: deviceSyncBaseUrlSchema
    .optional()
    .describe(
      'Override the local device sync control-plane URL. Read-only list commands use an explicit target when set; daemon-backed commands may manage the selected vault daemon when omitted.',
    ),
})

const deviceDaemonOptionsSchema = withBaseOptions({
  baseUrl: deviceSyncBaseUrlSchema
    .optional()
    .describe(
      'Override the loopback control-plane URL that Murph should manage for this vault.',
    ),
}).partial({
  requestId: true,
})

export function registerDeviceCommands(
  cli: Cli.Cli,
  services: DeviceSyncServices,
) {
  const device = Cli.create('device', {
    description:
      'Device sync commands for provider auth, account inspection, and the Murph-managed local device daemon.',
  })

  const provider = Cli.create('provider', {
    description:
      'List supported device providers plus local daemon availability.',
  })

  provider.command('list', {
    description:
      'List the provider catalog without starting the local daemon; include live local descriptors when a daemon is already available.',
    args: emptyArgsSchema,
    options: deviceControlOptionsSchema,
    output: deviceProviderListResultSchema,
    async run({ options }) {
      return services.listProviders({
        vault: options.vault,
        baseUrl: options.baseUrl,
      })
    },
  })

  device.command('connect', {
    description:
      'Create a browser-based OAuth connection link for one supported device connect target using the current runtime.',
    args: z.object({
      provider: connectTargetNameSchema,
    }),
    options: deviceControlOptionsSchema.extend({
      returnTo: z
        .string()
        .min(1)
        .refine(
          isDeviceConnectReturnTo,
          'Expected a root-relative path like /settings/devices or an absolute URL without embedded credentials.',
        )
        .optional()
        .describe(
          'Optional post-connect redirect. Accepts a root-relative path like /settings/devices or an absolute URL; device-syncd still rejects absolute URLs outside its allowed origin list.',
        ),
      open: z
        .boolean()
        .optional()
        .describe(
          'Open the authorization URL in the default browser after creating the OAuth state.',
        ),
    }),
    output: deviceConnectResultSchema,
    async run({ args, options }) {
      assertDeviceCliMutationAllowed()
      return services.connect({
        vault: options.vault,
        provider: normalizeConnectTargetName(args.provider),
        baseUrl: options.baseUrl,
        returnTo: options.returnTo,
        open: options.open,
      })
    },
  })

  const account = Cli.create('account', {
    description:
      'Inspect connected device accounts and trigger reconnect/disconnect actions.',
  })

  account.command('list', {
    description:
      'List local daemon device accounts when an explicit/local control plane is available.',
    args: emptyArgsSchema,
    options: deviceControlOptionsSchema.extend({
      provider: providerNameSchema.optional(),
      'source-provider': sourceProviderNameSchema.optional(),
    }),
    output: deviceAccountListResultSchema,
    async run({ options }) {
      const sourceProvider = options['source-provider']
      return services.listAccounts({
        vault: options.vault,
        baseUrl: options.baseUrl,
        provider: options.provider ? normalizeProviderName(options.provider) : undefined,
        ...(sourceProvider
          ? { sourceProvider: normalizeConnectTargetName(sourceProvider) }
          : {}),
      })
    },
  })

  account.command('show', {
    description: 'Show one device sync account by id.',
    args: z.object({
      accountId: accountIdSchema,
    }),
    options: deviceControlOptionsSchema,
    output: deviceAccountShowResultSchema,
    async run({ args, options }) {
      return services.showAccount({
        vault: options.vault,
        baseUrl: options.baseUrl,
        accountId: args.accountId,
      })
    },
  })

  account.command('reconcile', {
    description:
      'Queue one immediate reconcile job for an already-connected device account.',
    args: z.object({
      accountId: accountIdSchema,
    }),
    options: deviceControlOptionsSchema,
    output: deviceAccountReconcileResultSchema,
    async run({ args, options }) {
      assertDeviceCliMutationAllowed()
      return services.reconcileAccount({
        vault: options.vault,
        baseUrl: options.baseUrl,
        accountId: args.accountId,
      })
    },
  })

  account.command('disconnect', {
    description:
      'Disconnect one device account and revoke upstream access when the provider supports it.',
    args: z.object({
      accountId: accountIdSchema,
    }),
    options: deviceControlOptionsSchema,
    output: deviceAccountDisconnectResultSchema,
    async run({ args, options }) {
      assertDeviceCliMutationAllowed()
      return services.disconnectAccount({
        vault: options.vault,
        baseUrl: options.baseUrl,
        accountId: args.accountId,
      })
    },
  })

  const daemon = Cli.create('daemon', {
    description:
      'Start, inspect, and stop the Murph-managed local device sync daemon for one vault.',
  })

  daemon.command('status', {
    description:
      'Show whether Murph is managing a local device sync daemon for this vault.',
    args: emptyArgsSchema,
    options: deviceDaemonOptionsSchema,
    output: deviceDaemonStatusResultSchema,
    async run({ options }) {
      return await services.daemonStatus({
        vault: options.vault,
        baseUrl: options.baseUrl,
      })
    },
  })

  daemon.command('start', {
    description:
      'Start the local device sync daemon for this vault if Murph is not already managing one.',
    args: emptyArgsSchema,
    options: deviceDaemonOptionsSchema,
    output: deviceDaemonStartResultSchema,
    async run({ options }) {
      assertDeviceCliMutationAllowed()
      return await services.daemonStart({
        vault: options.vault,
        baseUrl: options.baseUrl,
      })
    },
  })

  daemon.command('stop', {
    description:
      'Stop the local device sync daemon that Murph is managing for this vault.',
    args: emptyArgsSchema,
    options: deviceDaemonOptionsSchema,
    output: deviceDaemonStopResultSchema,
    async run({ options }) {
      assertDeviceCliMutationAllowed()
      return await services.daemonStop({
        vault: options.vault,
        baseUrl: options.baseUrl,
      })
    },
  })

  device.command(provider)
  device.command(account)
  device.command(daemon)
  cli.command(device)
}
