import { Cli, z } from 'incur'
import { emptyArgsSchema, withBaseOptions } from '@murphai/operator-config/command-helpers'
import {
  deviceAccountDisconnectResultSchema,
  deviceAccountListResultSchema,
  deviceAccountReconcileResultSchema,
  deviceAccountShowResultSchema,
  deviceConnectResultSchema,
  deviceDaemonStartResultSchema,
  deviceDaemonStatusResultSchema,
  deviceDaemonStopResultSchema,
  deviceProviderListResultSchema,
  deviceSyncBaseUrlSchema,
} from '@murphai/operator-config/device-cli-contracts'
import type { VaultServices } from '@murphai/vault-usecases'

const providerNameSchema = z
  .string()
  .min(1)
  .describe('Live device-sync provider key such as garmin, whoop, or oura.')

const accountIdSchema = z
  .string()
  .min(1)
  .describe('Device sync account id returned by the control plane.')

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
      'Override the reachable device sync control-plane URL. When omitted, Murph manages the local daemon for the selected vault. When set, Murph talks to the explicit control-plane target instead.',
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
  services: VaultServices,
) {
  const device = Cli.create('device', {
    description:
      'Device sync commands for provider auth, account inspection, and the Murph-managed local device daemon.',
  })

  const provider = Cli.create('provider', {
    description:
      'List the provider connectors currently registered in the local device sync control plane.',
  })

  provider.command('list', {
    description:
      'List device sync providers and their callback/webhook descriptors.',
    args: emptyArgsSchema,
    options: deviceControlOptionsSchema,
    output: deviceProviderListResultSchema,
    async run({ options }) {
      return services.devices.listProviders({
        vault: options.vault,
        baseUrl: options.baseUrl,
      })
    },
  })

  device.command('connect', {
    description:
      'Start a browser-based OAuth connection for one device provider through the Murph-managed device daemon.',
    args: z.object({
      provider: providerNameSchema,
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
      return services.devices.connect({
        vault: options.vault,
        provider: args.provider,
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
      'List known device sync accounts, optionally filtered to one provider.',
    args: emptyArgsSchema,
    options: deviceControlOptionsSchema.extend({
      provider: providerNameSchema.optional(),
    }),
    output: deviceAccountListResultSchema,
    async run({ options }) {
      return services.devices.listAccounts({
        vault: options.vault,
        baseUrl: options.baseUrl,
        provider: options.provider,
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
      return services.devices.showAccount({
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
      return services.devices.reconcileAccount({
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
      return services.devices.disconnectAccount({
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
      return await services.devices.daemonStatus({
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
      return await services.devices.daemonStart({
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
      return await services.devices.daemonStop({
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
