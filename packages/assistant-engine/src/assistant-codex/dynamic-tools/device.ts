import type { MurphDynamicToolExecutionResult } from '../dynamic-tools.js'
import { toolTextResult as deviceTextResult } from '../tool-failure-diagnostics.js'
import * as z from '@murphai/contracts/zod-runtime'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

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
const NO_DATA_OUTREACH_EFFECT_ONCE_HINT =
  'Do not retry this request. Wait for a fresh private member instruction before another no-data outreach change.'
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
    'Work with the current authenticated member’s wearable and health-device accounts. list_accounts returns matching accountId, provider, status, last sync, and safe error context. connect returns a short-lived connectUrl for a supported provider. reconcile queues a refresh for one returned accountId; queued does not mean completed. configure_no_data_outreach changes Garmin (sourceProvider garmin), Apple Health (sourceProvider apple_health_kit), or WHOOP (sourceProvider whoop_v2) check-in timing: use after_days with 5–30 days, off, or default only when the current private member message states that preference. Call configure_no_data_outreach at most once for that message; after any result, do not retry. A saved result confirms the check-in preference: acknowledge it once and finish. Off stops only these check-ins; connection and syncing stay unchanged. Never call it from a group or scheduled turn or for another provider. No data is not proof of disconnection or app closure; reserve reconnect guidance for explicit authentication failure. Never ask for or pass provider credentials, tokens, delivery routes, or generic commands.',
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
}): Promise<MurphDynamicToolExecutionResult> {
  try {
    if (
      input.request.request.action === 'configure_no_data_outreach'
      && !input.acceptedInputAuthority
    ) {
      return deviceTextResult(
        false,
        'no-data outreach can only be changed from current private member input',
        'authority_rejected',
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
      return deviceTextResult(
        false,
        serializeDeviceToolError(
          projectDeviceResponseMismatch(input.request.request.action),
        ),
        'action_result_mismatch',
      )
    }

    const text = serializeDeviceToolResponse(response)
    return typeof text === 'string'
      ? deviceTextResult(true, text)
      : deviceTextResult(
          false,
          serializeDeviceToolError(
            input.request.request.action === 'configure_no_data_outreach'
              ? projectUnclassifiedDeviceToolFailure(
                  input.request.request.action,
                  false,
                )
              : {
                  code: 'device_result_too_large',
                  message: 'The device result is too large.',
                  retryable: false,
                  stage: deviceToolStage(input.request.request.action),
                  hint: input.request.request.action === 'list_accounts'
                    ? 'Retry list_accounts with a provider or sourceProvider filter.'
                    : 'Narrow the device request before retrying.',
                },
          ),
          text.failureReason,
        )
  } catch (error) {
    return deviceTextResult(
      false,
      serializeDeviceToolError(
        projectDeviceToolError(
          error,
          input.request.request.action,
          input.abortSignal?.aborted === true,
        ),
      ),
      'handler_exception', error,
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

function projectDeviceResponseMismatch(
  action: AssistantHostedDeviceToolRequest['action'],
): DeviceToolErrorProjection {
  if (action === 'configure_no_data_outreach') {
    return {
      code: 'device_response_mismatch',
      message: 'The no-data outreach response was invalid, so completion could not be confirmed.',
      retryable: false,
      stage: deviceToolStage(action),
      hint: NO_DATA_OUTREACH_EFFECT_ONCE_HINT,
    }
  }

  return {
    code: 'device_response_mismatch',
    message: 'The device response action did not match the requested action.',
    retryable: action === 'list_accounts',
    stage: deviceToolStage(action),
    hint: action === 'list_accounts'
      ? 'Retry list_accounts. If it repeats, treat device management as temporarily unavailable.'
      : `Run list_accounts and inspect the current account state before deciding whether to retry ${action}.`,
  }
}

function projectDeviceToolError(
  error: unknown,
  action: AssistantHostedDeviceToolRequest['action'],
  callerSignalAborted: boolean,
): DeviceToolErrorProjection {
  if (callerSignalAborted) {
    return projectUnclassifiedDeviceToolFailure(action, true)
  }

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
    }
  }

  const hostedError = readHostedWebControlPlaneResponseError(error)
  if (hostedError) {
    if (action === 'reconcile') {
      switch (hostedError.code) {
        case 'ACCOUNT_DISCONNECTED':
        case 'ACCOUNT_REAUTHORIZATION_REQUIRED':
          return {
            code: hostedError.code,
            message: 'This device account must be reconnected before reconciliation.',
            retryable: false,
            stage,
            hint: 'Run list_accounts again, then connect its provider before retrying reconcile.',
          }
        case 'CONNECTION_NOT_FOUND':
          return {
            code: hostedError.code,
            message: 'That device account is no longer available.',
            retryable: false,
            stage,
            hint: 'Run list_accounts and retry reconcile with a current accountId.',
          }
        case 'RECONCILE_WAKE_NOT_ACCEPTED':
          return projectKnownHostedRetryableDeviceError({
            action,
            code: hostedError.code,
            message: 'Device reconciliation could not be queued right now.',
            retryable: hostedError.retryable,
            retryHint: 'Retry reconcile later for the same account.',
            stage,
          })
      }
    }

    if (action === 'connect') {
      switch (hostedError.code) {
        case 'HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE':
          return projectKnownHostedRetryableDeviceError({
            action,
            code: hostedError.code,
            message: 'Device connection links are temporarily unavailable.',
            retryable: hostedError.retryable,
            retryHint: 'Retry connect later for the same provider.',
            stage,
          })
        case 'HOSTED_DEVICE_CONNECT_PERSONAL_MEMBER_REQUIRED':
          return {
            code: hostedError.code,
            message: 'Device connections require a private member conversation.',
            retryable: false,
            stage,
            hint: 'Continue in the member\'s private Murph conversation before retrying connect.',
          }
        case 'HOSTED_DEVICE_CONNECT_TARGET_NOT_CONFIGURED':
          return {
            code: hostedError.code,
            message: 'That device provider is not configured for connection.',
            retryable: false,
            stage,
            hint: 'Retry connect with a provider exposed in the current device context.',
          }
        case 'INVALID_REQUEST':
          return {
            code: hostedError.code,
            message: 'The device connection request was invalid.',
            retryable: false,
            stage,
            hint: 'Retry connect with one provider from the current device context and no extra fields.',
          }
        case 'HOSTED_DEVICE_CONNECT_LINK_INVALID_MESSAGING_RETURN_TARGET':
          return {
            code: hostedError.code,
            message: 'The device connection return target is invalid.',
            retryable: false,
            stage,
            hint: 'Continue in a supported private iMessage or Telegram conversation before retrying connect.',
          }
      }
    }
  }

  return projectUnclassifiedDeviceToolFailure(action, false)
}

function projectKnownHostedRetryableDeviceError(input: {
  action: AssistantHostedDeviceToolRequest['action']
  code: string
  message: string
  retryable: boolean
  retryHint: string
  stage: string
}): DeviceToolErrorProjection {
  if (!input.retryable) {
    return projectUnclassifiedDeviceToolFailure(input.action, false)
  }

  return {
    code: input.code,
    message: input.message,
    retryable: true,
    stage: input.stage,
    hint: input.retryHint,
  }
}

function projectUnclassifiedDeviceToolFailure(
  action: AssistantHostedDeviceToolRequest['action'],
  callerSignalAborted: boolean,
): DeviceToolErrorProjection {
  const stage = deviceToolStage(action)
  if (action === 'configure_no_data_outreach') {
    return {
      code: 'device_operation_outcome_unknown',
      message: 'The no-data outreach change completion could not be confirmed.',
      retryable: false,
      stage,
      hint: NO_DATA_OUTREACH_EFFECT_ONCE_HINT,
    }
  }
  if (callerSignalAborted) {
    return {
      code: 'device_operation_cancelled',
      message: 'The device operation was cancelled.',
      retryable: false,
      stage,
      hint: 'Do not retry unless the member asks to continue.',
    }
  }
  if (action === 'list_accounts') {
    return {
      code: 'device_operation_unavailable',
      message: 'The device operation could not be completed.',
      retryable: true,
      stage,
      hint: 'Retry list_accounts. If it repeats, treat device management as temporarily unavailable.',
    }
  }
  return {
    code: 'device_operation_outcome_unknown',
    message: 'The device operation completion could not be confirmed.',
    retryable: false,
    stage,
    hint: `Run list_accounts and inspect the current account state before deciding whether to retry ${action}.`,
  }
}

function readHostedWebControlPlaneResponseError(error: unknown): {
  code: string | null
  retryable: boolean
} | null {
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    return null
  }

  const record = error as Record<string, unknown>
  const context = record.context
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return null
  }

  const contextRecord = context as Record<string, unknown>
  const status = record.status
  const retryable = record.retryable
  const code = record.code
  if (
    record.name !== 'HostedWebControlPlaneResponseError' ||
    typeof status !== 'number' ||
    !Number.isSafeInteger(status) ||
    status < 400 ||
    status > 599 ||
    record.statusCode !== status ||
    contextRecord.status !== status ||
    contextRecord.statusCode !== status ||
    typeof record.forwardedFromWeb !== 'boolean' ||
    (retryable !== undefined && typeof retryable !== 'boolean') ||
    contextRecord.retryable !== retryable ||
    (code !== undefined && typeof code !== 'string')
  ) {
    return null
  }

  return {
    code: typeof code === 'string' ? code : null,
    retryable: retryable === true,
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
  return JSON.stringify({
    error: {
      code: projection.code,
      hint: projection.hint,
      message: projection.message,
      retryable: projection.retryable,
      stage: projection.stage,
    },
  })
}

function serializeDeviceToolResponse(
  response: AssistantHostedDeviceToolResponse,
): string | { failureReason: 'oversized_result' | 'result_serialization_failed' } {
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
      : { failureReason: 'oversized_result' }
  } catch {
    return { failureReason: 'result_serialization_failed' }
  }
}
