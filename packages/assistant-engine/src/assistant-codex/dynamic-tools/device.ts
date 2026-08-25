import * as z from '@murphai/contracts/zod-runtime'

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

const deviceArgumentsSchema = z.union([
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
  z.object({
    action: z.literal('configure_no_data_outreach'),
    afterDays: z.number().int().min(5).max(30),
    mode: z.literal('after_days'),
    sourceProvider: deviceProviderSchema,
  }).strict(),
  z.object({
    action: z.literal('configure_no_data_outreach'),
    mode: z.enum(['default', 'off']),
    sourceProvider: deviceProviderSchema,
  }).strict(),
])

export const MURPH_DEVICE_TOOL = {
  namespace: 'murph',
  name: 'device',
  description:
    'Work with the current authenticated member’s wearable and health-device accounts. list_accounts returns matching accountId, provider, status, last sync, and safe error context. connect returns a short-lived connectUrl for a supported provider. reconcile queues a refresh for one returned accountId; queued does not mean completed. configure_no_data_outreach changes when Murph checks in after a connected source stops providing new data: use after_days with 5–30 days, off, or default, and only when the member states that preference. No data is not proof of disconnection; reserve reconnect guidance for explicit authentication failure. Never ask for or pass provider credentials, tokens, delivery routes, or generic commands.',
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
    schemaRootKeys: [
      'accountId',
      'action',
      'afterDays',
      'mode',
      'provider',
      'sourceProvider',
    ],
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
  acceptedInputAuthority?: { assistantInputId: string } | null
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
    if (
      input.request.request.action === 'configure_no_data_outreach'
      && !input.acceptedInputAuthority
    ) {
      return deviceTextResult(
        false,
        'no-data outreach can only be changed from current private member input',
      )
    }
    const response = await input.deviceTool.request(input.request.request, {
      ...(input.request.request.action === 'configure_no_data_outreach'
        && input.acceptedInputAuthority
        ? { acceptedInputAuthority: input.acceptedInputAuthority }
        : {}),
      signal: input.abortSignal ?? null,
    })
    if (response.action !== input.request.request.action) {
      return deviceTextResult(false, 'device operation returned an unexpected result')
    }

    const text = serializeDeviceToolResponse(response)
    return text
      ? deviceTextResult(true, text)
      : deviceTextResult(false, 'device result is too large')
  } catch {
    return deviceTextResult(false, 'device operation is unavailable')
  }
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
      : response.action === 'reconcile'
        ? {
          accountId: response.accountId,
          action: response.action,
          occurredAt: response.occurredAt,
          status: response.status,
        }
        : {
            action: response.action,
            effectiveAfterDays: response.effectiveAfterDays,
            setting: response.setting,
            sourceProvider: response.sourceProvider,
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
