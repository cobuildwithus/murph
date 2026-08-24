import * as z from '@murphai/contracts/zod-runtime'
import {
  createVaultCliRepair,
  VaultCliError,
} from '@murphai/operator-config/vault-cli-errors'

import type {
  AssistantHostedDeviceTool,
  AssistantHostedDeviceToolRequest,
  AssistantHostedDeviceToolResponse,
} from '../../assistant/execution-context.js'
import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const DEVICE_TOOL_RESULT_MAX_BYTES = 60_000
const deviceProviderSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9_-]*$/u)

const deviceArgumentsSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('list_accounts'),
    provider: deviceProviderSchema.nullable().optional(),
    sourceProvider: deviceProviderSchema.nullable().optional(),
  }).strict(),
  z.object({
    action: z.literal('connect'),
    provider: deviceProviderSchema,
  }).strict(),
  z.object({
    accountId: z.string().trim().min(1).max(191),
    action: z.literal('reconcile'),
  }).strict(),
])

export const MURPH_DEVICE_TOOL = {
  namespace: 'murph',
  name: 'device',
  description:
    'Work with the current authenticated member’s wearable and health-device accounts. list_accounts returns matching accountId, provider, status, last sync, and safe error context. connect returns a short-lived connectUrl for a supported provider. reconcile queues a refresh for one returned accountId; queued does not mean completed. Never ask for or pass provider credentials, tokens, delivery routes, or generic commands.',
  inputSchema: z.toJSONSchema(deviceArgumentsSchema, { io: 'input' }),
} as const

export type DeviceDynamicToolRequest =
  | {
      kind: 'device'
      request: AssistantHostedDeviceToolRequest
    }
  | {
      kind: 'invalid-device-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readDeviceDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): DeviceDynamicToolRequest | null {
  if (input.tool !== MURPH_DEVICE_TOOL.name) {
    return null
  }

  const parsed = parseDynamicToolArguments({
    schema: deviceArgumentsSchema,
    schemaRootKeys: ['accountId', 'action', 'provider', 'sourceProvider'],
    toolName: 'murph.device',
    value: input.arguments,
  })

  return parsed.ok
    ? { kind: 'device', request: parsed.args }
    : {
        kind: 'invalid-device-arguments',
        validationDigest: parsed.validationDigest,
      }
}

export async function executeDeviceDynamicTool(input: {
  abortSignal?: AbortSignal | null
  deviceTool: AssistantHostedDeviceTool
  request: Extract<DeviceDynamicToolRequest, { kind: 'device' }>
}): Promise<{
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
}> {
  try {
    const response = await input.deviceTool.request(input.request.request, {
      signal: input.abortSignal ?? null,
    })
    if (response.action !== input.request.request.action) {
      return deviceTextResult(
        false,
        serializeDeviceToolError({
          code: 'device_response_invalid',
          message: 'The device operation returned an unexpected result.',
          retryable: true,
          stage: deviceToolStage(input.request.request.action),
          hint: 'Retry the device operation. If it repeats, treat device management as temporarily unavailable.',
        }),
      )
    }

    const text = serializeDeviceToolResponse(response)
    return text
      ? deviceTextResult(true, text)
      : deviceTextResult(
          false,
          serializeDeviceToolError({
            code: 'device_result_too_large',
            message: 'The device result is too large.',
            retryable: false,
            stage: deviceToolStage(input.request.request.action),
            hint: input.request.request.action === 'list_accounts'
              ? 'Retry list_accounts with a provider or sourceProvider filter.'
              : 'Narrow the device request before retrying.',
          }),
        )
  } catch (error) {
    return deviceTextResult(
      false,
      serializeDeviceToolError(
        projectDeviceToolError(error, input.request.request.action),
      ),
    )
  }
}

interface DeviceToolErrorProjection {
  code: string
  hint: string
  message: string
  retryable: boolean
  stage: string
}

function projectDeviceToolError(
  error: unknown,
  action: AssistantHostedDeviceToolRequest['action'],
): DeviceToolErrorProjection {
  const stage = deviceToolStage(action)
  if (error instanceof VaultCliError) {
    switch (error.code) {
      case 'device_connect_provider_unavailable':
        return {
          code: error.code,
          message: 'That device provider is not available to connect.',
          retryable: false,
          stage,
          hint: 'Retry connect with a provider exposed in the current device context.',
        }
      case 'device_reconcile_unavailable':
        return {
          code: error.code,
          message: 'Device account reconciliation is not available right now.',
          retryable: true,
          stage,
          hint: 'Retry reconcile later for the same account.',
        }
      case 'device_sync_invalid_response':
        return {
          code: error.code,
          message: 'The device service returned an invalid response.',
          retryable: true,
          stage,
          hint: 'Retry the device operation. If it repeats, treat device management as temporarily unavailable.',
        }
      case 'device_sync_request_failed':
      case 'device_sync_unavailable':
        return {
          code: error.code,
          message: 'The device service is temporarily unavailable.',
          retryable:
            typeof error.context?.retryable === 'boolean'
              ? error.context.retryable
              : true,
          stage,
          hint: 'Retry the device operation later.',
        }
    }
  }

  return {
    code: 'device_operation_unavailable',
    message: 'The device operation is unavailable.',
    retryable: true,
    stage,
    hint: 'Retry the device operation later.',
  }
}

function deviceToolStage(
  action: AssistantHostedDeviceToolRequest['action'],
): string {
  return `device-${action.replace(/_/gu, '-')}`
}

function serializeDeviceToolError(
  projection: DeviceToolErrorProjection,
): string {
  const repair = createVaultCliRepair({
    hint: projection.hint,
    stage: projection.stage,
  })
  return JSON.stringify({
    error: {
      code: projection.code,
      message: projection.message,
      retryable: projection.retryable,
      ...(repair.hint ? { hint: repair.hint } : {}),
      ...(repair.stage ? { stage: repair.stage } : {}),
    },
  })
}

function serializeDeviceToolResponse(
  response: AssistantHostedDeviceToolResponse,
): string | null {
  const payload = response.action === 'list_accounts'
    ? {
        accounts: response.accounts.map((account) => ({
          accountId: account.accountId,
          displayName: account.displayName,
          lastErrorCode: account.lastErrorCode,
          lastSyncCompletedAt: account.lastSyncCompletedAt,
          provider: account.provider,
          status: account.status,
        })),
        action: response.action,
        provider: response.provider,
        sourceProvider: response.sourceProvider,
      }
    : response.action === 'connect'
      ? {
          action: response.action,
          link: {
            authorizationUrl: response.link.authorizationUrl,
            connectUrl: response.link.connectUrl,
            expiresAt: response.link.expiresAt,
            provider: response.link.provider,
            providerLabel: response.link.providerLabel,
          },
        }
      : {
          accountId: response.accountId,
          action: response.action,
          occurredAt: response.occurredAt,
          status: response.status,
        }

  try {
    const text = JSON.stringify(payload) ?? 'null'
    return new TextEncoder().encode(text).byteLength <= DEVICE_TOOL_RESULT_MAX_BYTES
      ? text
      : null
  } catch {
    return null
  }
}

function deviceTextResult(success: boolean, text: string): {
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
} {
  return {
    rpcResult: {
      contentItems: [{ text, type: 'inputText' }],
      success,
    },
  }
}
