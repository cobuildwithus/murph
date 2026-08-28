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
const CONNECT_FRESH_REQUEST_SUFFIX =
  'Do not call connect again for this member request. Wait for a fresh member request before another connect attempt.'
const CONNECT_SUCCESS_HINT =
  'Send connectUrl unchanged on the final line. Its short-lived browser claim is authorized for delivery to this current private member; it is not a provider credential. Do not repeat this connect effect for the same accepted input and provider.'
const NO_DATA_OUTREACH_EFFECT_ONCE_HINT =
  'Do not retry this request. Wait for a fresh private member instruction before another no-data outreach change.'

function connectFreshRequestHint(recovery: string): string {
  return `${recovery} ${CONNECT_FRESH_REQUEST_SUFFIX}`
}
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
    'Work with the current authenticated member’s wearable and health-device accounts. For capability questions, use the current projected provider context and read-only deferred catalog; never call list_accounts or another device action to test support. list_accounts returns matching accountId, provider, status, last sync, and safe error context for an actual account-state request. connect returns a short-lived first-party connectUrl for a supported provider. For one accepted member input, call connect at most once per requested provider; after success, send the returned connectUrl unchanged on the final line. Do not repeat that connect effect, but honor a later accepted member input or a different requested device action. Its short-lived browser claim is authorized for delivery to the current private member; it is not a provider credential. reconcile queues a refresh for one returned accountId; queued does not mean completed. configure_no_data_outreach changes Garmin check-in timing while Garmin is the supported no-data-outreach source: use after_days with 5–30 days, off, or default only when the current private member message states that preference. Call configure_no_data_outreach at most once for that message; after any result, do not retry. Never call it from a group or scheduled turn or for another provider. No data is not proof of disconnection; reserve reconnect guidance for explicit authentication failure. Never ask for or pass provider credentials, provider access tokens, delivery routes, or generic commands.',
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

export interface DeviceDynamicToolExecutionResult {
  requiredFinalResponseReplacement?: string
  requiredFinalResponseSuffix?: string
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
}

export interface DeviceTurnState {
  connectAttemptsByInputId: Map<
    string,
    Map<string, Promise<DeviceDynamicToolExecutionResult>>
  >
}

export function createDeviceTurnState(): DeviceTurnState {
  return { connectAttemptsByInputId: new Map() }
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

interface ExecuteDeviceDynamicToolInput {
  acceptedInputAuthority?: { assistantInputId: string } | null
  abortSignal?: AbortSignal | null
  deviceTool: AssistantHostedDeviceTool
  request: Extract<DeviceDynamicToolRequest, { kind: 'device' }>
  turnState?: DeviceTurnState | null
}

export async function executeDeviceDynamicTool(
  input: ExecuteDeviceDynamicToolInput,
): Promise<DeviceDynamicToolExecutionResult> {
  const request = input.request.request
  const inputId = input.acceptedInputAuthority?.assistantInputId ?? null
  if (request.action === 'connect' && input.turnState && inputId) {
    let attemptsByProvider =
      input.turnState.connectAttemptsByInputId.get(inputId)
    if (!attemptsByProvider) {
      attemptsByProvider = new Map()
      input.turnState.connectAttemptsByInputId.set(inputId, attemptsByProvider)
    }
    const previousAttempt = attemptsByProvider.get(request.provider)
    if (previousAttempt) {
      return await previousAttempt
    }
    const attempt = executeDeviceDynamicToolOnce(input)
    attemptsByProvider.set(request.provider, attempt)
    return await attempt
  }

  return await executeDeviceDynamicToolOnce(input)
}

async function executeDeviceDynamicToolOnce(
  input: ExecuteDeviceDynamicToolInput,
): Promise<DeviceDynamicToolExecutionResult> {
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
      return deviceToolErrorResult(
        projectDeviceResponseMismatch(input.request.request.action),
      )
    }

    const text = serializeDeviceToolResponse(response)
    return text
      ? {
          ...deviceTextResult(true, text),
          ...(response.action === 'connect'
            ? { requiredFinalResponseSuffix: response.link.connectUrl }
            : {}),
        }
      : deviceToolErrorResult(
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
        )
  } catch (error) {
    return deviceToolErrorResult(
      projectDeviceToolError(
        error,
        input.request.request.action,
        input.abortSignal?.aborted === true,
      ),
    )
  }
}

interface DeviceToolErrorProjection {
  code: string
  hint: string
  memberReply?: string
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
  if (action === 'connect') {
    return {
      code: 'device_response_mismatch',
      message: 'The device response action did not match the requested action.',
      retryable: false,
      stage: deviceToolStage(action),
      hint: connectFreshRequestHint(
        'Say only that link creation could not be confirmed; do not describe it as success or failure.',
      ),
      memberReply: 'I could not confirm whether the device connection link was created. Please ask me again in a new message.',
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
          hint: connectFreshRequestHint(
            'Tell the member to choose an available provider when they ask again.',
          ),
          memberReply: 'That device provider is not available to connect. Please choose an available provider in a new message.',
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
            retryHint: connectFreshRequestHint(
              'Tell the member connection links are temporarily unavailable and they can ask again later.',
            ),
            memberReply: 'Device connection links are temporarily unavailable. Please ask me again later.',
            stage,
          })
        case 'HOSTED_DEVICE_CONNECT_PERSONAL_MEMBER_REQUIRED':
          return {
            code: hostedError.code,
            message: 'Device connections require a private member conversation.',
            retryable: false,
            stage,
            hint: connectFreshRequestHint(
              'Tell the member to continue in their private Murph conversation and ask again there.',
            ),
            memberReply: 'Device connections require a private Murph conversation. Please continue there and ask me again.',
          }
        case 'HOSTED_DEVICE_CONNECT_TARGET_NOT_CONFIGURED':
          return {
            code: hostedError.code,
            message: 'That device provider is not configured for connection.',
            retryable: false,
            stage,
            hint: connectFreshRequestHint(
              'Tell the member that provider is not configured and they can ask again after it becomes available.',
            ),
            memberReply: 'That device provider is not configured for connection. Please ask me again after it becomes available.',
          }
        case 'INVALID_REQUEST':
          return {
            code: hostedError.code,
            message: 'The device connection request was invalid.',
            retryable: false,
            stage,
            hint: connectFreshRequestHint(
              'Say the request was invalid and wait for a corrected request using one exposed provider and no extra fields.',
            ),
            memberReply: 'The device connection request was invalid. Please ask again with one supported provider.',
          }
        case 'HOSTED_DEVICE_CONNECT_LINK_INVALID_MESSAGING_RETURN_TARGET':
          return {
            code: hostedError.code,
            message: 'The device connection return target is invalid.',
            retryable: false,
            stage,
            hint: connectFreshRequestHint(
              'Tell the member to continue in a supported private iMessage or Telegram conversation and ask again there.',
            ),
            memberReply: 'The device connection return target is unsupported. Please continue in a private iMessage or Telegram conversation and ask me again.',
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
  memberReply?: string
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
    ...(input.memberReply ? { memberReply: input.memberReply } : {}),
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
  if (action === 'connect') {
    return {
      code: callerSignalAborted
        ? 'device_operation_cancelled'
        : 'device_operation_outcome_unknown',
      message: callerSignalAborted
        ? 'The device operation was cancelled.'
        : 'The device operation completion could not be confirmed.',
      retryable: false,
      stage,
      hint: connectFreshRequestHint(
        callerSignalAborted
          ? 'Say the connect attempt was cancelled.'
          : 'Say only that link creation could not be confirmed; do not describe it as success or failure.',
      ),
      memberReply: callerSignalAborted
        ? 'The device connection request was cancelled.'
        : 'I could not confirm whether the device connection link was created. Please ask me again in a new message.',
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
    outcome: 'not_completed',
    message: projection.message,
    ...(projection.memberReply ? { memberReply: projection.memberReply } : {}),
    requiredRecovery: projection.hint,
    code: projection.code,
    retryable: projection.retryable,
    stage: projection.stage,
  })
}

function deviceToolErrorResult(
  projection: DeviceToolErrorProjection,
): DeviceDynamicToolExecutionResult {
  return {
    ...deviceTextResult(false, serializeDeviceToolError(projection)),
    ...(projection.memberReply
      ? { requiredFinalResponseReplacement: projection.memberReply }
      : {}),
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
          connectUrl: response.link.connectUrl,
          hint: CONNECT_SUCCESS_HINT,
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
