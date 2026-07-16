import {
  ensureManagedDeviceSyncControlPlane,
  getManagedDeviceSyncDaemonStatus,
  resolveExistingManagedDeviceSyncControlPlane,
  startManagedDeviceSyncDaemon,
  stopManagedDeviceSyncDaemon,
} from '@murphai/operator-config/device-daemon'
import {
  createDeviceSyncClient,
  DEVICE_SYNC_BASE_URL_ENV,
} from '@murphai/operator-config/device-sync-client'
import {
  HostedCliBridgeRequestError,
  isHostedRuntimeProcessEnv,
  readHostedCliBridgeEnv,
  requestHostedCliDeviceAccountList,
  requestHostedCliDeviceAccountReconcile,
  requestHostedCliDeviceConnectLink,
} from '@murphai/hosted-execution/cli-runtime-bridge'
import {
  VaultCliError,
} from '@murphai/operator-config/vault-cli-errors'
import type {
  DeviceAccountDisconnectResult,
  DeviceAccountListResult,
  DeviceAccountReconcileResult,
  DeviceAccountShowResult,
  DeviceConnectResult,
  DeviceDaemonStartResult,
  DeviceDaemonStatusResult,
  DeviceDaemonStopResult,
  DeviceProviderListResult,
} from '@murphai/operator-config/device-cli-contracts'
import {
  listConfiguredDeviceSyncProviderNames,
  listDeviceSyncProviderCatalog,
  readConfiguredDeviceSyncProviderConfigs,
  resolveConfiguredDeviceSyncConnectTarget,
} from '@murphai/device-syncd/config'
import {
  createUnwiredMethod,
} from '@murphai/vault-usecases/runtime'
import {
  createUnwiredVaultServices,
  type VaultServices,
} from '@murphai/vault-usecases'

export interface DeviceSyncServices {
  listProviders(input: {
    vault?: string
    baseUrl?: string
  }): Promise<DeviceProviderListResult>
  connect(input: {
    vault?: string
    provider: string
    baseUrl?: string
    returnTo?: string
    open?: boolean
  }): Promise<DeviceConnectResult>
  listAccounts(input: {
    vault?: string
    baseUrl?: string
    provider?: string
    sourceProvider?: string
  }): Promise<DeviceAccountListResult>
  showAccount(input: {
    vault?: string
    baseUrl?: string
    accountId: string
  }): Promise<DeviceAccountShowResult>
  reconcileAccount(input: {
    vault?: string
    baseUrl?: string
    accountId: string
  }): Promise<DeviceAccountReconcileResult>
  disconnectAccount(input: {
    vault?: string
    baseUrl?: string
    accountId: string
  }): Promise<DeviceAccountDisconnectResult>
  daemonStatus(input: {
    vault: string
    baseUrl?: string
  }): Promise<DeviceDaemonStatusResult>
  daemonStart(input: {
    vault: string
    baseUrl?: string
  }): Promise<DeviceDaemonStartResult>
  daemonStop(input: {
    vault: string
    baseUrl?: string
  }): Promise<DeviceDaemonStopResult>
}

export interface CliVaultServices extends VaultServices {
  devices: DeviceSyncServices
}

interface DeviceConnectAuthority {
  createConnectLink(input: {
    vault?: string
    provider: string
    baseUrl?: string
    returnTo?: string
    open?: boolean
  }): Promise<DeviceConnectResult>
}

export function createIntegratedDeviceSyncServices(): DeviceSyncServices {
  async function createControlPlaneClient(input: {
    vault?: string
    baseUrl?: string
  }) {
    const controlPlane = await ensureManagedDeviceSyncControlPlane({
      vault: input.vault,
      baseUrl: input.baseUrl,
    })

    return createDeviceSyncClient({
      baseUrl: controlPlane.baseUrl,
      controlToken: controlPlane.controlToken,
    })
  }

  function hasExplicitControlPlaneTarget(input: {
    baseUrl?: string
  }): boolean {
    const envBaseUrl = process.env[DEVICE_SYNC_BASE_URL_ENV]
    return (
      (typeof input.baseUrl === 'string' && input.baseUrl.trim().length > 0) ||
      (typeof envBaseUrl === 'string' && envBaseUrl.trim().length > 0)
    )
  }

  function hasExplicitInputControlPlaneTarget(input: {
    baseUrl?: string
  }): boolean {
    return typeof input.baseUrl === 'string' && input.baseUrl.trim().length > 0
  }

  function readLocalProviderConfig() {
    try {
      const configs = readConfiguredDeviceSyncProviderConfigs(process.env)
      const configuredProviders = listConfiguredDeviceSyncProviderNames(configs)

      return {
        configuredProviderSet: new Set<string>(configuredProviders),
        configuredProviders,
        configs,
        errorMessage: null,
      }
    } catch (error) {
      return {
        configuredProviderSet: new Set<string>(),
        configuredProviders: [],
        configs: null,
        errorMessage: error instanceof Error
          ? error.message
          : 'Local provider configuration could not be inspected.',
      }
    }
  }

  async function readLocalAvailability(input: {
    vault: string
    baseUrl?: string
  }) {
    const { configuredProviders, errorMessage } = readLocalProviderConfig()
    const status = await getManagedDeviceSyncDaemonStatus({
      vault: input.vault,
      baseUrl: input.baseUrl,
    })
    const localStatus = summarizeLocalAvailabilityStatus(
      status,
      configuredProviders,
    )

    return {
      baseUrl: status.baseUrl,
      status: localStatus,
      configuredProviders,
      message:
        localStatus === 'not_configured'
          ? errorMessage ?? status.message
          : status.message,
    } as const
  }

  return {
    async listProviders(input) {
      assertHostedRuntimeDoesNotUseExplicitControlPlaneTarget(input, 'provider list')
      if (hasExplicitControlPlaneTarget(input)) {
        const client = await createControlPlaneClient(input)
        const result = await client.listProviders()

        return {
          baseUrl: client.baseUrl,
          providers: result.providers,
        }
      }

      const vault = requireDeviceVault(input.vault)
      const { configuredProviderSet } = readLocalProviderConfig()
      const local = await readLocalAvailability({
        vault,
        baseUrl: input.baseUrl,
      })
      const controlPlane = local.status === 'healthy'
        ? await resolveExistingManagedDeviceSyncControlPlane({
            vault,
            baseUrl: input.baseUrl,
          })
        : null

      if (controlPlane) {
        const client = createDeviceSyncClient({
          baseUrl: controlPlane.baseUrl,
          controlToken: controlPlane.controlToken,
        })
        const result = await client.listProviders()

        return {
          baseUrl: client.baseUrl,
          local,
          providers: result.providers.map((provider) => ({
            ...provider,
            source: 'local_control_plane' as const,
            localConfigured: true,
          })),
        }
      }

      return {
        local,
        providers: listDeviceSyncProviderCatalog().map((provider) => ({
          ...provider,
          source: 'catalog' as const,
          callbackUrl: null,
          webhookUrl: null,
          localConfigured: configuredProviderSet.has(provider.provider),
        })),
      }
    },
    async connect(input) {
      assertHostedRuntimeDoesNotUseExplicitControlPlaneTarget(input, 'connect')
      return resolveDeviceConnectAuthority(input).createConnectLink(input)
    },
    async listAccounts(input) {
      if (isHostedRuntimeProcessEnv(process.env)) {
        assertHostedRuntimeDoesNotUseExplicitControlPlaneTarget(input, 'account list')
        return listAccountsViaHostedBridge(input)
      }

      if (hasExplicitInputControlPlaneTarget(input)) {
        const client = await createControlPlaneClient(input)
        const result = await client.listAccounts({
          provider: input.provider,
          sourceProvider: input.sourceProvider,
        })

        return {
          baseUrl: client.baseUrl,
          provider: input.provider ?? null,
          sourceProvider: input.sourceProvider ?? null,
          accounts: result.accounts,
        }
      }

      if (hasExplicitControlPlaneTarget(input)) {
        const client = await createControlPlaneClient(input)
        const result = await client.listAccounts({
          provider: input.provider,
          sourceProvider: input.sourceProvider,
        })

        return {
          baseUrl: client.baseUrl,
          provider: input.provider ?? null,
          sourceProvider: input.sourceProvider ?? null,
          accounts: result.accounts,
        }
      }

      const vault = requireDeviceVault(input.vault)
      const local = await readLocalAvailability({
        vault,
        baseUrl: input.baseUrl,
      })
      const controlPlane = local.status === 'healthy'
        ? await resolveExistingManagedDeviceSyncControlPlane({
            vault,
            baseUrl: input.baseUrl,
          })
        : null

      if (!controlPlane) {
        return {
          local,
          provider: input.provider ?? null,
          sourceProvider: input.sourceProvider ?? null,
          accounts: [],
        }
      }

      const client = createDeviceSyncClient({
        baseUrl: controlPlane.baseUrl,
        controlToken: controlPlane.controlToken,
      })
      const result = await client.listAccounts({
        provider: input.provider,
        sourceProvider: input.sourceProvider,
      })

      return {
        baseUrl: client.baseUrl,
        local,
        provider: input.provider ?? null,
        sourceProvider: input.sourceProvider ?? null,
        accounts: result.accounts,
      }
    },
    async showAccount(input) {
      assertHostedRuntimeDoesNotUseExplicitControlPlaneTarget(input, 'account show')
      const client = await createControlPlaneClient(input)
      const result = await client.showAccount(input.accountId)

      return {
        baseUrl: client.baseUrl,
        account: result.account,
      }
    },
    async reconcileAccount(input) {
      if (isHostedRuntimeProcessEnv(process.env)) {
        assertHostedRuntimeDoesNotUseExplicitControlPlaneTarget(input, 'account reconcile')
        const bridge = readRequiredHostedBridge('account reconcile')
        const result = await requestHostedCliDeviceAccountReconcile({
          accountId: input.accountId,
          bridge,
        }).catch((error) => {
          const bridgeCode = error instanceof HostedCliBridgeRequestError
            ? error.code
            : null
          throw new VaultCliError(
            bridgeCode === 'HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT'
              ? 'HOSTED_DEVICE_ACCOUNT_RECONCILE_BRIDGE_REQUEST_TIMEOUT'
              : bridgeCode ?? 'HOSTED_DEVICE_ACCOUNT_RECONCILE_BRIDGE_REQUEST_FAILED',
            error instanceof Error
              ? error.message
              : 'Hosted device account reconcile bridge request failed.',
          )
        })

        return {
          accountId: result.connectionId,
          backend: 'hosted',
          occurredAt: result.occurredAt,
          status: result.status,
        }
      }

      assertHostedRuntimeDoesNotUseExplicitControlPlaneTarget(input, 'account reconcile')
      const client = await createControlPlaneClient(input)
      const result = await client.reconcileAccount(input.accountId)

      return {
        baseUrl: client.baseUrl,
        account: result.account,
        job: result.job,
      }
    },
    async disconnectAccount(input) {
      assertHostedRuntimeDoesNotUseExplicitControlPlaneTarget(input, 'account disconnect')
      const client = await createControlPlaneClient(input)
      const current = await client.showAccount(input.accountId)
      const result = await client.disconnectAccount(
        input.accountId,
        current.account.connectedAt,
      )

      return {
        baseUrl: client.baseUrl,
        account: result.account,
      }
    },
    async daemonStatus(input) {
      assertHostedRuntimeDoesNotUseExplicitControlPlaneTarget(input, 'daemon status')
      return await getManagedDeviceSyncDaemonStatus({
        vault: input.vault,
        baseUrl: input.baseUrl,
      })
    },
    async daemonStart(input) {
      assertHostedRuntimeDoesNotUseExplicitControlPlaneTarget(input, 'daemon start')
      return await startManagedDeviceSyncDaemon({
        vault: input.vault,
        baseUrl: input.baseUrl,
      })
    },
    async daemonStop(input) {
      assertHostedRuntimeDoesNotUseExplicitControlPlaneTarget(input, 'daemon stop')
      return await stopManagedDeviceSyncDaemon({
        vault: input.vault,
        baseUrl: input.baseUrl,
      })
    },
  } satisfies DeviceSyncServices

  async function listAccountsViaHostedBridge(input: {
    provider?: string
    sourceProvider?: string
  }): Promise<DeviceAccountListResult> {
    const bridge = readRequiredHostedBridge('account list')
    const result = await requestHostedCliDeviceAccountList({
      bridge,
      provider: input.provider,
      sourceProvider: input.sourceProvider,
    }).catch((error) => {
      const bridgeCode = error instanceof HostedCliBridgeRequestError
        ? error.code
        : null
      const cliCode = bridgeCode === 'HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT'
        ? 'HOSTED_DEVICE_ACCOUNT_LIST_BRIDGE_REQUEST_TIMEOUT'
        : 'HOSTED_DEVICE_ACCOUNT_LIST_BRIDGE_REQUEST_FAILED'
      throw new VaultCliError(
        cliCode,
        error instanceof Error
          ? error.message
          : 'Hosted device account list bridge request failed.',
      )
    })

    return {
      provider: result.provider,
      sourceProvider: result.sourceProvider,
      accounts: result.accounts,
    }
  }

  function resolveDeviceConnectAuthority(input: {
    baseUrl?: string
  }): DeviceConnectAuthority {
    if (!isHostedRuntimeProcessEnv(process.env)) {
      return {
        createConnectLink: connectViaLocalDaemon,
      }
    }

    const bridge = readRequiredHostedBridge('connect')

    return {
      async createConnectLink(connectInput) {
        return connectViaHostedBridge({
          ...connectInput,
          bridge,
        })
      },
    }
  }

  function assertHostedRuntimeDoesNotUseExplicitControlPlaneTarget(input: {
    baseUrl?: string
  }, command: string): void {
    if (
      !isHostedRuntimeProcessEnv(process.env)
      || !hasExplicitControlPlaneTarget(input)
    ) {
      return
    }

    throw new VaultCliError(
      'HOSTED_DEVICE_BASE_URL_UNSUPPORTED',
      `Hosted device ${command} must use the hosted bridge and does not support --base-url or DEVICE_SYNC_BASE_URL.`,
    )
  }

  async function connectViaHostedBridge(input: {
    bridge: NonNullable<ReturnType<typeof readHostedCliBridgeEnv>>
    provider: string
    returnTo?: string
  }): Promise<DeviceConnectResult> {
    assertPublicConnectTarget(input.provider)

    if (input.returnTo) {
      throw new VaultCliError(
        'HOSTED_DEVICE_CONNECT_RETURN_TO_UNSUPPORTED',
        'Hosted device connect does not support --return-to yet.',
      )
    }

    const result = await requestHostedCliDeviceConnectLink({
      bridge: input.bridge,
      connectTarget: input.provider,
    }).catch((error) => {
      const bridgeCode = error instanceof HostedCliBridgeRequestError
        ? error.code
        : null
      const cliCode = bridgeCode === 'HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT'
        ? 'HOSTED_DEVICE_CONNECT_BRIDGE_REQUEST_TIMEOUT'
        : 'HOSTED_DEVICE_CONNECT_BRIDGE_REQUEST_FAILED'
      throw new VaultCliError(
        cliCode,
        error instanceof Error
          ? error.message
          : 'Hosted device-connect bridge request failed.',
      )
    })

    const connectUrl = result.connectUrl ?? result.authorizationUrl

    return {
      status: 'ok',
      kind: 'device_connect_link',
      backend: 'hosted',
      provider: result.provider,
      providerLabel: result.providerLabel,
      expiresAt: result.expiresAt,
      authorizationUrl: connectUrl,
      connectUrl,
    }
  }

  async function connectViaLocalDaemon(input: {
    vault?: string
    provider: string
    baseUrl?: string
    returnTo?: string
    open?: boolean
  }): Promise<DeviceConnectResult> {
    assertPublicConnectTarget(input.provider)

    const localTarget = resolveLocalConnectTarget(input.provider)
    const client = await createControlPlaneClient(input)
    const result = await client.beginConnection({
      provider: localTarget.provider,
      returnTo: input.returnTo,
      open: input.open,
      sourceProviderSlug: localTarget.sourceProviderSlug,
    })

    return {
      status: 'ok',
      kind: 'device_connect_link',
      backend: 'local-daemon',
      baseUrl: client.baseUrl,
      provider: input.provider,
      state: result.state,
      expiresAt: result.expiresAt,
      authorizationUrl: result.authorizationUrl,
      openedBrowser: result.openedBrowser,
    }
  }

  function assertPublicConnectTarget(connectTarget: string): void {
    if (connectTarget !== 'junction') {
      return
    }

    throw new VaultCliError(
      'device_connect_target_unsupported',
      'Expected a device connect target such as garmin, whoop, oura, or fitbit.',
    )
  }

  function resolveLocalConnectTarget(connectTarget: string): {
    provider: string
    sourceProviderSlug?: string | null
  } {
    const { configs } = readLocalProviderConfig()
    if (!configs) {
      return { provider: connectTarget }
    }

    const target = resolveConfiguredDeviceSyncConnectTarget(configs, connectTarget)
    return target
      ? {
          provider: target.provider,
          sourceProviderSlug: target.sourceProviderSlug ?? null,
        }
      : { provider: connectTarget }
  }

  function readRequiredHostedBridge(
    operation: 'account list' | 'account reconcile' | 'connect',
  ): NonNullable<ReturnType<typeof readHostedCliBridgeEnv>> {
    const errorPrefix = operation === 'connect'
      ? 'HOSTED_DEVICE_CONNECT'
      : operation === 'account list'
        ? 'HOSTED_DEVICE_ACCOUNT_LIST'
        : 'HOSTED_DEVICE_ACCOUNT_RECONCILE'
    let bridge
    try {
      bridge = readHostedCliBridgeEnv(process.env)
    } catch (error) {
      throw new VaultCliError(
        `${errorPrefix}_BRIDGE_INVALID`,
        error instanceof Error
          ? error.message
          : `Hosted device ${operation} bridge configuration is invalid.`,
      )
    }

    if (!bridge) {
      throw new VaultCliError(
        `${errorPrefix}_BRIDGE_UNAVAILABLE`,
        `Hosted device ${operation} is unavailable in this runtime.`,
      )
    }

    return bridge
  }
}

function requireDeviceVault(vault: string | null | undefined): string {
  if (typeof vault === 'string' && vault.trim().length > 0) {
    return vault.trim()
  }

  throw new Error('Device commands require a vault path.')
}

function summarizeLocalAvailabilityStatus(
  status: DeviceDaemonStatusResult,
  configuredProviders: readonly string[],
): 'healthy' | 'not_configured' | 'not_running' | 'unhealthy' | 'conflict' {
  if (status.healthy && status.running) {
    return 'healthy'
  }

  if (
    status.message?.includes('not managed by this Murph vault') ||
    status.message?.includes('already listening')
  ) {
    return 'conflict'
  }

  if (status.managed || status.pid !== null) {
    return 'unhealthy'
  }

  if (configuredProviders.length === 0) {
    return 'not_configured'
  }

  return 'not_running'
}

function createUnwiredServiceGroup<TServiceGroup extends object>(
  groupName: string,
  integratedServices: TServiceGroup,
): TServiceGroup {
  const unwiredServices = {} as {
    [TKey in keyof TServiceGroup]: TServiceGroup[TKey]
  }

  for (const methodName of Object.keys(integratedServices) as Array<
    keyof TServiceGroup & string
  >) {
    unwiredServices[methodName] = createUnwiredMethod(
      `${groupName}.${methodName}`,
    ) as TServiceGroup[typeof methodName]
  }

  return unwiredServices
}

export function createUnwiredDeviceSyncServices(): DeviceSyncServices {
  const integratedServices = createIntegratedDeviceSyncServices()
  return createUnwiredServiceGroup('devices', integratedServices)
}

export function isCliVaultServices(
  services: VaultServices | CliVaultServices,
): services is CliVaultServices {
  return (
    'devices' in services &&
    typeof services.devices === 'object' &&
    services.devices !== null
  )
}

export function ensureCliVaultServices(
  services: VaultServices | CliVaultServices,
  options: {
    devices?: DeviceSyncServices
  } = {},
): CliVaultServices {
  if (isCliVaultServices(services)) {
    return services
  }

  return {
    ...services,
    devices: options.devices ?? createIntegratedDeviceSyncServices(),
  }
}

export function createUnwiredCliVaultServices(
  services: VaultServices = createUnwiredVaultServices(),
): CliVaultServices {
  return ensureCliVaultServices(services, {
    devices: createUnwiredDeviceSyncServices(),
  })
}
