import { describe, expect, it, vi } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { executeDeviceDynamicTool } from '../src/assistant-codex/dynamic-tools/device.js'

function readToolError(result: Awaited<ReturnType<typeof executeDeviceDynamicTool>>) {
  const text = result.rpcResult.contentItems[0]?.text ?? ''
  return {
    parsed: JSON.parse(text) as {
      error: {
        code: string
        hint: string
        message: string
        retryable: boolean
        stage: string
      }
    },
    text,
  }
}

const PRIVATE_HOSTED_DEVICE_SENTINEL = 'private-hosted-device-response'

function createHostedWebControlPlaneResponseError(input: {
  code: string
  contextStatus?: number
  retryable?: boolean
  status: number
  statusCode?: number
}) {
  return {
    body: { private: PRIVATE_HOSTED_DEVICE_SENTINEL },
    code: input.code,
    context: {
      requestId: PRIVATE_HOSTED_DEVICE_SENTINEL,
      ...(input.retryable === undefined ? {} : { retryable: input.retryable }),
      status: input.contextStatus ?? input.status,
      statusCode: input.contextStatus ?? input.status,
    },
    detail: PRIVATE_HOSTED_DEVICE_SENTINEL,
    forwardedFromWeb: true,
    message: PRIVATE_HOSTED_DEVICE_SENTINEL,
    name: 'HostedWebControlPlaneResponseError',
    requestId: PRIVATE_HOSTED_DEVICE_SENTINEL,
    retryable: input.retryable,
    status: input.status,
    statusCode: input.statusCode ?? input.status,
  }
}

async function executeDeviceFailure(
  error: unknown,
  action: 'connect' | 'list_accounts' | 'reconcile',
) {
  const request = action === 'connect'
    ? { action: 'connect' as const, provider: 'synthetic-provider' }
    : action === 'reconcile'
      ? { accountId: 'synthetic-account', action: 'reconcile' as const }
      : { action: 'list_accounts' as const }

  return await executeDeviceDynamicTool({
    deviceTool: {
      request: vi.fn(async () => {
        throw error
      }),
    },
    request: { kind: 'device', request },
  })
}

describe('hosted device dynamic tool recovery', () => {
  it('projects an allowlisted provider failure without echoing raw error context', async () => {
    const privateDetail = 'private-provider-response in /private/workspace/device.json'
    const result = await executeDeviceDynamicTool({
      deviceTool: {
        request: vi.fn(async () => {
          throw new VaultCliError(
            'device_connect_provider_unavailable',
            privateDetail,
            { providerBody: privateDetail },
          )
        }),
      },
      request: {
        kind: 'device',
        request: { action: 'connect', provider: 'synthetic-provider' },
      },
    })

    const { parsed, text } = readToolError(result)
    expect(result.rpcResult.success).toBe(false)
    expect(parsed.error).toEqual({
      code: 'device_connect_provider_unavailable',
      hint: 'Retry connect with a provider exposed in the current device context.',
      message: 'That device provider is not available to connect.',
      retryable: false,
      stage: 'device-connect',
    })
    expect(text).not.toContain(privateDetail)
    expect(text).not.toContain('synthetic-provider')
  })

  it('gives reconciliation an explicit retry decision', async () => {
    const result = await executeDeviceDynamicTool({
      deviceTool: {
        request: vi.fn(async () => {
          throw new VaultCliError(
            'device_reconcile_unavailable',
            'Device account reconciliation is not available right now.',
          )
        }),
      },
      request: {
        kind: 'device',
        request: { accountId: 'synthetic-account', action: 'reconcile' },
      },
    })

    expect(readToolError(result).parsed.error).toMatchObject({
      code: 'device_reconcile_unavailable',
      retryable: true,
      stage: 'device-reconcile',
    })
  })

  for (const testCase of [
    {
      action: 'reconcile',
      code: 'ACCOUNT_DISCONNECTED',
      hint: 'Run list_accounts again, then connect its provider before retrying reconcile.',
      message: 'This device account must be reconnected before reconciliation.',
      retryable: false,
      status: 409,
    },
    {
      action: 'reconcile',
      code: 'ACCOUNT_REAUTHORIZATION_REQUIRED',
      hint: 'Run list_accounts again, then connect its provider before retrying reconcile.',
      message: 'This device account must be reconnected before reconciliation.',
      retryable: false,
      status: 409,
    },
    {
      action: 'reconcile',
      code: 'CONNECTION_NOT_FOUND',
      hint: 'Run list_accounts and retry reconcile with a current accountId.',
      message: 'That device account is no longer available.',
      retryable: false,
      status: 404,
    },
    {
      action: 'reconcile',
      code: 'RECONCILE_WAKE_NOT_ACCEPTED',
      hint: 'Retry reconcile later for the same account.',
      message: 'Device reconciliation could not be queued right now.',
      retryable: true,
      status: 503,
    },
    {
      action: 'connect',
      code: 'HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE',
      hint: 'Retry connect later for the same provider.',
      message: 'Device connection links are temporarily unavailable.',
      retryable: true,
      status: 503,
    },
    {
      action: 'connect',
      code: 'HOSTED_DEVICE_CONNECT_PERSONAL_MEMBER_REQUIRED',
      hint: 'Continue in the member\'s private Murph conversation before retrying connect.',
      message: 'Device connections require a private member conversation.',
      retryable: false,
      status: 403,
    },
    {
      action: 'connect',
      code: 'HOSTED_DEVICE_CONNECT_TARGET_NOT_CONFIGURED',
      hint: 'Retry connect with a provider exposed in the current device context.',
      message: 'That device provider is not configured for connection.',
      retryable: false,
      status: 404,
    },
    {
      action: 'connect',
      code: 'INVALID_REQUEST',
      hint: 'Retry connect with one provider from the current device context and no extra fields.',
      message: 'The device connection request was invalid.',
      retryable: false,
      status: 400,
    },
    {
      action: 'connect',
      code: 'HOSTED_DEVICE_CONNECT_LINK_INVALID_MESSAGING_RETURN_TARGET',
      hint: 'Continue in a supported private iMessage or Telegram conversation before retrying connect.',
      message: 'The device connection return target is invalid.',
      retryable: false,
      status: 400,
    },
  ] as const) {
    it(`projects the hosted ${testCase.code} recovery envelope`, async () => {
      const result = await executeDeviceFailure(
        createHostedWebControlPlaneResponseError(testCase),
        testCase.action,
      )

      const { parsed, text } = readToolError(result)
      expect(parsed.error).toEqual({
        code: testCase.code,
        hint: testCase.hint,
        message: testCase.message,
        retryable: testCase.retryable,
        stage: `device-${testCase.action}`,
      })
      expect(text).not.toContain(PRIVATE_HOSTED_DEVICE_SENTINEL)
    })
  }

  it('requires state inspection after an unknown reconcile outcome', async () => {
    const privateCode = 'PRIVATE_HOSTED_DEVICE_FAILURE'
    const result = await executeDeviceFailure(
      createHostedWebControlPlaneResponseError({
        code: privateCode,
        retryable: true,
        status: 503,
      }),
      'reconcile',
    )

    const { parsed, text } = readToolError(result)
    expect(parsed.error).toEqual({
      code: 'device_operation_outcome_unknown',
      hint: 'Run list_accounts and inspect the current account state before deciding whether to retry reconcile.',
      message: 'The device operation completion could not be confirmed.',
      retryable: false,
      stage: 'device-reconcile',
    })
    expect(text).not.toContain(privateCode)
    expect(text).not.toContain(PRIVATE_HOSTED_DEVICE_SENTINEL)
  })

  it('requires state inspection after a malformed reconcile failure', async () => {
    const result = await executeDeviceFailure(
      createHostedWebControlPlaneResponseError({
        code: 'RECONCILE_WAKE_NOT_ACCEPTED',
        contextStatus: 409,
        retryable: true,
        status: 503,
      }),
      'reconcile',
    )

    const { parsed, text } = readToolError(result)
    expect(parsed.error).toEqual({
      code: 'device_operation_outcome_unknown',
      hint: 'Run list_accounts and inspect the current account state before deciding whether to retry reconcile.',
      message: 'The device operation completion could not be confirmed.',
      retryable: false,
      stage: 'device-reconcile',
    })
    expect(text).not.toContain(PRIVATE_HOSTED_DEVICE_SENTINEL)
  })

  it('does not invent retryability when a known hosted failure omits it', async () => {
    const result = await executeDeviceFailure(
      createHostedWebControlPlaneResponseError({
        code: 'RECONCILE_WAKE_NOT_ACCEPTED',
        status: 503,
      }),
      'reconcile',
    )

    expect(readToolError(result).parsed.error).toEqual({
      code: 'device_operation_outcome_unknown',
      hint: 'Run list_accounts and inspect the current account state before deciding whether to retry reconcile.',
      message: 'The device operation completion could not be confirmed.',
      retryable: false,
      stage: 'device-reconcile',
    })
  })

  it('does not project an allowlisted hosted code onto the wrong device action', async () => {
    const result = await executeDeviceFailure(
      createHostedWebControlPlaneResponseError({
        code: 'RECONCILE_WAKE_NOT_ACCEPTED',
        retryable: true,
        status: 503,
      }),
      'connect',
    )

    expect(readToolError(result).parsed.error).toEqual({
      code: 'device_operation_outcome_unknown',
      hint: 'Run list_accounts and inspect the current account state before deciding whether to retry connect.',
      message: 'The device operation completion could not be confirmed.',
      retryable: false,
      stage: 'device-connect',
    })
  })

  it('allows an unknown non-cancellation list failure to be retried safely', async () => {
    const privateDetail = 'access_token=<REDACTED>'
    const result = await executeDeviceDynamicTool({
      deviceTool: {
        request: vi.fn(async () => {
          throw new Error(privateDetail)
        }),
      },
      request: {
        kind: 'device',
        request: { action: 'list_accounts' },
      },
    })

    const { parsed, text } = readToolError(result)
    expect(parsed.error).toEqual({
      code: 'device_operation_unavailable',
      hint: 'Retry list_accounts. If it repeats, treat device management as temporarily unavailable.',
      message: 'The device operation could not be completed.',
      retryable: true,
      stage: 'device-list-accounts',
    })
    expect(text).not.toContain(privateDetail)
  })

  it('keeps caller cancellation distinct from a recoverable list failure', async () => {
    const abortController = new AbortController()
    const privateDetail = 'private caller cancellation reason'
    const result = await executeDeviceDynamicTool({
      abortSignal: abortController.signal,
      deviceTool: {
        request: vi.fn(async () => {
          abortController.abort(new DOMException(privateDetail, 'AbortError'))
          throw abortController.signal.reason
        }),
      },
      request: {
        kind: 'device',
        request: { action: 'list_accounts' },
      },
    })

    const { parsed, text } = readToolError(result)
    expect(parsed.error).toEqual({
      code: 'device_operation_cancelled',
      hint: 'Do not retry unless the member asks to continue.',
      message: 'The device operation was cancelled.',
      retryable: false,
      stage: 'device-list-accounts',
    })
    expect(text).not.toContain(privateDetail)
  })

  it('requires state inspection after an unexpected reconcile response', async () => {
    const result = await executeDeviceDynamicTool({
      deviceTool: {
        request: vi.fn(async () => ({
          accounts: [],
          action: 'list_accounts' as const,
          provider: null,
          sourceProvider: null,
        })),
      },
      request: {
        kind: 'device',
        request: { accountId: 'synthetic-account', action: 'reconcile' },
      },
    })

    expect(readToolError(result).parsed.error).toEqual({
      code: 'device_operation_outcome_unknown',
      hint: 'Run list_accounts and inspect the current account state before deciding whether to retry reconcile.',
      message: 'The device operation completion could not be confirmed.',
      retryable: false,
      stage: 'device-reconcile',
    })
  })

  it('tells the model how to narrow an oversized account list', async () => {
    const result = await executeDeviceDynamicTool({
      deviceTool: {
        request: vi.fn(async () => ({
          accounts: Array.from({ length: 1_000 }, (_, index) => ({
            accountId: `synthetic-account-${index}-${'x'.repeat(80)}`,
            displayName: null,
            lastErrorCode: null,
            lastSyncCompletedAt: null,
            provider: 'synthetic-provider',
            status: 'active' as const,
          })),
          action: 'list_accounts' as const,
          provider: null,
          sourceProvider: null,
        })),
      },
      request: {
        kind: 'device',
        request: { action: 'list_accounts' },
      },
    })

    expect(readToolError(result).parsed.error).toEqual({
      code: 'device_result_too_large',
      hint: 'Retry list_accounts with a provider or sourceProvider filter.',
      message: 'The device result is too large.',
      retryable: false,
      stage: 'device-list-accounts',
    })
  })
})
