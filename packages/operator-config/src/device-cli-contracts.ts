import * as z from '@murphai/contracts/zod-runtime'
import {
  configuredDeviceSyncProviderKeys,
  type ConfiguredDeviceSyncProviderKey,
  normalizeDeviceSyncConnectTargetKey as normalizeConfiguredDeviceSyncConnectTargetKey,
} from '@murphai/device-syncd/config'
import { httpBaseUrlSchema, httpUrlSchema } from './command-helpers.js'
import { isoTimestampSchema } from './vault-cli-contracts.js'

export const deviceSyncBaseUrlSchema = httpBaseUrlSchema
  .describe('Reachable base URL for the local device sync control plane.')

export const deviceSyncProviderKeyValues = configuredDeviceSyncProviderKeys
const deviceSyncProviderKeySet = new Set<string>(deviceSyncProviderKeyValues)

export function formatDeviceSyncProviderKeyList(): string {
  return deviceSyncProviderKeyValues.join(', ')
}

export function normalizeDeviceSyncProviderKey(
  value: string,
): ConfiguredDeviceSyncProviderKey | null {
  const normalized = value.trim().toLowerCase()

  return deviceSyncProviderKeySet.has(normalized)
    ? (normalized as ConfiguredDeviceSyncProviderKey)
    : null
}

export function normalizeDeviceSyncConnectTargetKey(
  value: string,
): string | null {
  return normalizeConfiguredDeviceSyncConnectTargetKey(value)
}

export const deviceSyncProviderKeySchema = z
  .string()
  .min(1)
  .refine((value) => normalizeDeviceSyncProviderKey(value) !== null, {
    message: `Unsupported device-sync provider. Supported providers: ${formatDeviceSyncProviderKeyList()}.`,
  })

export const deviceSyncConnectTargetSchema = z
  .string()
  .min(1)
  .refine((value) => {
    const normalized = normalizeDeviceSyncConnectTargetKey(value)

    return normalized !== null && normalized !== 'junction'
  }, {
    message:
      'Expected a device connect target such as garmin, whoop, oura, or fitbit.',
  })

export const deviceSyncAccountStatusSchema = z.enum([
  'active',
  'reauthorization_required',
  'disconnected',
])

export const deviceSyncAccountSourceSchema = z.object({
  sourceProviderSlug: z.string().min(1),
  displayName: z.string().min(1).nullable(),
  status: z.enum([
    'connected',
    'unavailable',
    'error',
    'disconnected',
  ]),
  resourceCount: z.number().int().nonnegative(),
  lastErrorCode: z.string().min(1).nullable(),
  lastErrorMessage: z.string().min(1).nullable(),
  firstSeenAt: isoTimestampSchema,
  lastSeenAt: isoTimestampSchema,
})

export const deviceSyncProviderSchema = z.object({
  provider: z.string().min(1),
  source: z.literal('catalog').optional(),
  displayName: z.string().min(1).optional(),
  callbackPath: z.string().min(1).nullable(),
  callbackUrl: z.string().url().nullable(),
  webhookPath: z.string().min(1).nullable(),
  webhookUrl: z.string().url().nullable(),
  supportsWebhooks: z.boolean(),
  defaultScopes: z.array(z.string().min(1)),
  localConfigured: z.boolean().optional(),
})

export const deviceSyncAccountSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  externalAccountId: z.string().min(1),
  displayName: z.string().min(1).nullable(),
  status: deviceSyncAccountStatusSchema,
  scopes: z.array(z.string().min(1)),
  accessTokenExpiresAt: isoTimestampSchema.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()),
  connectedAt: isoTimestampSchema,
  lastWebhookAt: isoTimestampSchema.nullable(),
  lastSyncStartedAt: isoTimestampSchema.nullable(),
  lastSyncCompletedAt: isoTimestampSchema.nullable(),
  lastSyncErrorAt: isoTimestampSchema.nullable(),
  lastErrorCode: z.string().min(1).nullable(),
  lastErrorMessage: z.string().min(1).nullable(),
  nextReconcileAt: isoTimestampSchema.nullable(),
  sources: z.array(deviceSyncAccountSourceSchema).optional(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
})

export const deviceSyncJobSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  accountId: z.string().min(1),
  kind: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  priority: z.number().int(),
  availableAt: isoTimestampSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  dedupeKey: z.string().min(1).nullable(),
  status: z.enum(['queued', 'running', 'succeeded', 'dead']),
  leaseOwner: z.string().min(1).nullable(),
  leaseExpiresAt: isoTimestampSchema.nullable(),
  lastErrorCode: z.string().min(1).nullable(),
  lastErrorMessage: z.string().min(1).nullable(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  startedAt: isoTimestampSchema.nullable(),
  finishedAt: isoTimestampSchema.nullable(),
})

export const deviceProviderListResultSchema = z.object({
  baseUrl: deviceSyncBaseUrlSchema.optional(),
  providers: z.array(deviceSyncProviderSchema),
})

const deviceConnectResultBaseSchema = z.object({
  status: z.literal('ok'),
  kind: z.literal('device_connect_link'),
  provider: z.string().min(1),
  providerLabel: z.string().min(1).optional(),
  expiresAt: isoTimestampSchema,
})

const hostedDeviceConnectResultSchema = deviceConnectResultBaseSchema.extend({
  backend: z.literal('hosted'),
  authorizationUrl: httpUrlSchema.optional(),
  connectUrl: httpUrlSchema,
}).strict()

export const deviceConnectResultSchema = hostedDeviceConnectResultSchema

export const deviceAccountListResultSchema = z.object({
  baseUrl: deviceSyncBaseUrlSchema.optional(),
  provider: z.string().min(1).nullable(),
  sourceProvider: z.string().min(1).nullable().optional(),
  accounts: z.array(deviceSyncAccountSchema),
})

export const deviceAccountShowResultSchema = z.object({
  baseUrl: deviceSyncBaseUrlSchema,
  account: deviceSyncAccountSchema,
})

const localDeviceAccountReconcileResultSchema = z.object({
  baseUrl: deviceSyncBaseUrlSchema,
  account: deviceSyncAccountSchema,
  job: deviceSyncJobSchema,
})

const hostedDeviceAccountReconcileResultSchema = z.object({
  accountId: z.string().min(1),
  backend: z.literal('hosted'),
  occurredAt: isoTimestampSchema,
  status: z.literal('queued'),
}).strict()

export const deviceAccountReconcileResultSchema = z.union([
  localDeviceAccountReconcileResultSchema,
  hostedDeviceAccountReconcileResultSchema,
])

export const deviceAccountDisconnectResultSchema = z.object({
  baseUrl: deviceSyncBaseUrlSchema,
  account: deviceSyncAccountSchema,
})

export type DeviceProviderListResult = z.infer<typeof deviceProviderListResultSchema>
export type DeviceConnectResult = z.infer<typeof deviceConnectResultSchema>
export type DeviceAccountListResult = z.infer<typeof deviceAccountListResultSchema>
export type DeviceAccountShowResult = z.infer<typeof deviceAccountShowResultSchema>
export type DeviceAccountReconcileResult = z.infer<typeof deviceAccountReconcileResultSchema>
export type DeviceAccountDisconnectResult = z.infer<typeof deviceAccountDisconnectResultSchema>
