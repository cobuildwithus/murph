import { describe, expect, it } from 'vitest'

import {
  MURPH_SEND_VAULT_FILE_TOOL,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
  isAssistantGeneratedDeliveryRef,
  resolveSupportedAssistantVaultFileContentType,
} from '../src/assistant/generated-delivery-files.ts'

describe('assistant generated delivery files', () => {
  it('keeps the owned prefix exact and resolves supported content types', () => {
    expect(ASSISTANT_GENERATED_DELIVERY_DIRECTORY).toBe(
      'exports/assistant-deliveries',
    )
    expect(isAssistantGeneratedDeliveryRef(
      'exports/assistant-deliveries/report.zip',
    )).toBe(true)
    expect(isAssistantGeneratedDeliveryRef(
      'exports/assistant-deliveries-backup/report.zip',
    )).toBe(false)
    expect(resolveSupportedAssistantVaultFileContentType('REPORT.ZIP')).toBe(
      'application/zip',
    )
    expect(resolveSupportedAssistantVaultFileContentType('.zip')).toBeNull()
    expect(resolveSupportedAssistantVaultFileContentType('report.bin')).toBeNull()
  })

  it('routes only newly generated one-time files into transient staging', () => {
    expect(MURPH_SEND_VAULT_FILE_TOOL.description).toContain(
      'Create files intended solely for one-time delivery under exports/assistant-deliveries/',
    )
    expect(MURPH_SEND_VAULT_FILE_TOOL.description).toContain(
      'never move or copy canonical, durable, or existing user files there',
    )
  })
})
