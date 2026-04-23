import {
  ensureManagedDeviceSyncControlPlane,
  getManagedDeviceSyncDaemonStatus,
  startManagedDeviceSyncDaemon,
  stopManagedDeviceSyncDaemon,
} from '@murphai/operator-config/device-daemon'
import {
  createDeviceSyncClient,
} from '@murphai/operator-config/device-sync-client'
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

  return {
    async listProviders(input) {
      const client = await createControlPlaneClient(input)
      const result = await client.listProviders()

      return {
        baseUrl: client.baseUrl,
        providers: result.providers,
      }
    },
    async connect(input) {
      const client = await createControlPlaneClient(input)
      const result = await client.beginConnection({
        provider: input.provider,
        returnTo: input.returnTo,
        open: input.open,
      })

      return {
        baseUrl: client.baseUrl,
        provider: result.provider,
        state: result.state,
        expiresAt: result.expiresAt,
        authorizationUrl: result.authorizationUrl,
        openedBrowser: result.openedBrowser,
      }
    },
    async listAccounts(input) {
      const client = await createControlPlaneClient(input)
      const result = await client.listAccounts({
        provider: input.provider,
      })

      return {
        baseUrl: client.baseUrl,
        provider: input.provider ?? null,
        accounts: result.accounts,
      }
    },
    async showAccount(input) {
      const client = await createControlPlaneClient(input)
      const result = await client.showAccount(input.accountId)

      return {
        baseUrl: client.baseUrl,
        account: result.account,
      }
    },
    async reconcileAccount(input) {
      const client = await createControlPlaneClient(input)
      const result = await client.reconcileAccount(input.accountId)

      return {
        baseUrl: client.baseUrl,
        account: result.account,
        job: result.job,
      }
    },
    async disconnectAccount(input) {
      const client = await createControlPlaneClient(input)
      const result = await client.disconnectAccount(input.accountId)

      return {
        baseUrl: client.baseUrl,
        account: result.account,
      }
    },
    async daemonStatus(input) {
      return await getManagedDeviceSyncDaemonStatus({
        vault: input.vault,
        baseUrl: input.baseUrl,
      })
    },
    async daemonStart(input) {
      return await startManagedDeviceSyncDaemon({
        vault: input.vault,
        baseUrl: input.baseUrl,
      })
    },
    async daemonStop(input) {
      return await stopManagedDeviceSyncDaemon({
        vault: input.vault,
        baseUrl: input.baseUrl,
      })
    },
  } satisfies DeviceSyncServices
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
