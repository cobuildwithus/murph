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
      code: 'device_sync_invalid_response',
      message: 'The device service returned an invalid response.',
      retryable: true,
    },
    {
      code: 'device_sync_request_failed',
      message: 'The device service is temporarily unavailable.',
      retryable: false,
    },
    {
      code: 'device_sync_unavailable',
      message: 'The device service is temporarily unavailable.',
      retryable: true,
    },
  ] as const) {
    it(`safely projects ${testCase.code}`, async () => {
      const privateDetail = 'private-device-body in /private/workspace/device.json'
      const result = await executeDeviceDynamicTool({
        deviceTool: {
          request: vi.fn(async () => {
            throw new VaultCliError(
              testCase.code,
              privateDetail,
              { providerBody: privateDetail, retryable: testCase.retryable },
            )
          }),
        },
        request: {
          kind: 'device',
          request: { action: 'list_accounts' },
        },
      })

      const { parsed, text } = readToolError(result)
      expect(parsed.error).toMatchObject({
        code: testCase.code,
        message: testCase.message,
        retryable: testCase.retryable,
        stage: 'device-list-accounts',
      })
      expect(text).not.toContain(privateDetail)
    })
  }

  it('keeps unknown failures generic and non-echoing', async () => {
    const privateDetail = 'Authorization: Bearer private-device-token'
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
      hint: 'Retry the device operation later.',
      message: 'The device operation is unavailable.',
      retryable: true,
      stage: 'device-list-accounts',
    })
    expect(text).not.toContain(privateDetail)
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
