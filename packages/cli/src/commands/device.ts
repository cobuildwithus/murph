import { Cli, z } from 'incur'
import { emptyArgsSchema } from '../command-helpers.js'
import {
  deviceAccountDisconnectResultSchema,
  deviceAccountListResultSchema,
  deviceAccountReconcileResultSchema,
  deviceAccountShowResultSchema,
  deviceConnectResultSchema,
  deviceProviderListResultSchema,
  deviceSyncBaseUrlSchema,
} from '../device-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

const providerNameSchema = z
  .string()
  .min(1)
  .describe('Provider key such as whoop, garmin, or oura.')

const accountIdSchema = z
  .string()
  .min(1)
  .describe('Device sync account id returned by the control plane.')

const deviceOptionsSchema = z.object({
  baseUrl: deviceSyncBaseUrlSchema
    .optional()
    .describe(
      'Override the reachable device sync control-plane URL. Defaults to HEALTHYBOB_DEVICE_SYNC_BASE_URL or the local daemon default; authenticate with HEALTHYBOB_DEVICE_SYNC_CONTROL_TOKEN.',
    ),
})

export function registerDeviceCommands(
  cli: Cli.Cli,
  services: VaultCliServices,
) {
  const device = Cli.create('device', {
    description:
      'Device sync commands for local authenticated provider OAuth, account inspection, and reconcile control.',
  })

  const provider = Cli.create('provider', {
    description:
      'List the provider connectors currently registered in device-syncd.',
  })

  provider.command('list', {
    description:
      'List device sync providers and their callback/webhook descriptors.',
    args: emptyArgsSchema,
    options: deviceOptionsSchema,
    output: deviceProviderListResultSchema,
    async run({ options }) {
      return services.devices.listProviders({
        baseUrl: options.baseUrl,
      })
    },
  })

  device.command('connect', {
    description:
      'Start a browser-based OAuth connection for one device provider through device-syncd.',
    args: z.object({
      provider: providerNameSchema,
    }),
    options: deviceOptionsSchema.extend({
      returnTo: z
        .string()
        .url()
        .optional()
        .describe(
          'Optional post-connect redirect. device-syncd accepts relative paths or configured allowed origins.',
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
    options: deviceOptionsSchema.extend({
      provider: providerNameSchema.optional(),
    }),
    output: deviceAccountListResultSchema,
    async run({ options }) {
      return services.devices.listAccounts({
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
    options: deviceOptionsSchema,
    output: deviceAccountShowResultSchema,
    async run({ args, options }) {
      return services.devices.showAccount({
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
    options: deviceOptionsSchema,
    output: deviceAccountReconcileResultSchema,
    async run({ args, options }) {
      return services.devices.reconcileAccount({
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
    options: deviceOptionsSchema,
    output: deviceAccountDisconnectResultSchema,
    async run({ args, options }) {
      return services.devices.disconnectAccount({
        baseUrl: options.baseUrl,
        accountId: args.accountId,
      })
    },
  })

  device.command(provider)
  device.command(account)
  cli.command(device)
}
