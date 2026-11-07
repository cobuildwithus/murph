import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type {
  DeviceAccountDisconnectResult, DeviceAccountListResult, DeviceAccountReconcileResult,
  DeviceAccountShowResult, DeviceConnectResult, DeviceProviderListResult,
} from '@murphai/operator-config/device-cli-contracts'
import { listDeviceSyncProviderCatalog } from '@murphai/device-syncd/config'
import { createUnwiredMethod } from '@murphai/vault-usecases/runtime'
import { createUnwiredVaultServices, type VaultServices } from '@murphai/vault-usecases'

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

}

export interface CliVaultServices extends VaultServices {
  devices: DeviceSyncServices
}

function requireHostedDeviceTool(operation: string): never {
  throw new VaultCliError(
    'invalid_option',
    `Hosted device ${operation} is available only through Murph's root hosted device tool.`,
  )
}

export function createIntegratedDeviceSyncServices(): DeviceSyncServices {
  return {
    async listProviders(input) {
      if (input.baseUrl?.trim() || process.env.DEVICE_SYNC_BASE_URL?.trim()) {
        requireHostedDeviceTool('provider list')
      }
      return {
        providers: listDeviceSyncProviderCatalog().map((provider) => ({
          ...provider,
          source: 'catalog' as const,
          callbackUrl: null,
          webhookUrl: null,
          localConfigured: false,
        })),
      }
    },
    async connect() { return requireHostedDeviceTool('connect') },
    async listAccounts() { return requireHostedDeviceTool('account list') },
    async showAccount() { return requireHostedDeviceTool('account show') },
    async reconcileAccount() { return requireHostedDeviceTool('account reconcile') },
    async disconnectAccount() { return requireHostedDeviceTool('account disconnect') },
  }
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
