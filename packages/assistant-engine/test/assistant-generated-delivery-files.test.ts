import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
  isAssistantGeneratedDeliveryRef,
  resolveSupportedAssistantVaultFileContentType,
} from '../src/assistant/generated-delivery-files.ts'

describe('assistant generated delivery files', () => {
  it('owns only one assistant runtime subtree', () => {
    expect(ASSISTANT_GENERATED_DELIVERY_DIRECTORY).toBe(
      '.runtime/operations/assistant/generated-deliveries',
    )
    expect(isAssistantGeneratedDeliveryRef(
      '.runtime/operations/assistant/generated-deliveries/report.zip',
    )).toBe(true)
    expect(isAssistantGeneratedDeliveryRef(
      '.runtime/operations/assistant/generated-deliveries-backup/report.zip',
    )).toBe(false)
    expect(isAssistantGeneratedDeliveryRef(
      '.runtime/operations/assistant/generated-deliveries/nested/report.zip',
    )).toBe(false)
    expect(isAssistantGeneratedDeliveryRef(
      '.runtime/operations/assistant/generated-deliveries/.hidden.zip',
    )).toBe(false)
    expect(isAssistantGeneratedDeliveryRef(
      'exports/assistant-deliveries/report.zip',
    )).toBe(false)
  })

  it('preserves the vault-file content-type contract', () => {
    expect(resolveSupportedAssistantVaultFileContentType('REPORT.ZIP')).toBe(
      'application/zip',
    )
    expect(resolveSupportedAssistantVaultFileContentType('.zip')).toBeNull()
    expect(resolveSupportedAssistantVaultFileContentType('report.bin')).toBeNull()
  })
})
