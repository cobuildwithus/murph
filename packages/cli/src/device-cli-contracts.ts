import { z } from 'incur'
import { isoTimestampSchema } from './vault-cli-contracts.js'

export const deviceSyncBaseUrlSchema = z
  .string()
  .url()
  .describe('Reachable base URL for the local device sync control plane.')

export const deviceSyncAccountStatusSchema = z.enum([
  'active',
  'reauthorization_required',
  'disconnected',
])

export const deviceSyncProviderSchema = z.object({
  provider: z.string().min(1),
  callbackPath: z.string().min(1),
  callbackUrl: z.string().url(),
  webhookPath: z.string().min(1).nullable(),
  webhookUrl: z.string().url().nullable(),
  supportsWebhooks: z.boolean(),
  defaultScopes: z.array(z.string().min(1)),
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
  baseUrl: deviceSyncBaseUrlSchema,
  providers: z.array(deviceSyncProviderSchema),
})

export const deviceConnectResultSchema = z.object({
  baseUrl: deviceSyncBaseUrlSchema,
  provider: z.string().min(1),
  state: z.string().min(1),
  expiresAt: isoTimestampSchema,
  authorizationUrl: z.string().url(),
  openedBrowser: z.boolean(),
})

export const deviceAccountListResultSchema = z.object({
  baseUrl: deviceSyncBaseUrlSchema,
  provider: z.string().min(1).nullable(),
  accounts: z.array(deviceSyncAccountSchema),
})

export const deviceAccountShowResultSchema = z.object({
  baseUrl: deviceSyncBaseUrlSchema,
  account: deviceSyncAccountSchema,
})

export const deviceAccountReconcileResultSchema = z.object({
  baseUrl: deviceSyncBaseUrlSchema,
  account: deviceSyncAccountSchema,
  job: deviceSyncJobSchema,
})

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
