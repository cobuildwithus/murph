import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
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
  it('owns only one flat assistant runtime subtree', () => {
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

  it('routes only newly generated same-turn sends into runtime staging', () => {
    expect(MURPH_SEND_VAULT_FILE_TOOL.description).toContain(
      'Only after this turn establishes an obligation to send a newly generated file now',
    )
    expect(MURPH_SEND_VAULT_FILE_TOOL.description).toContain(
      `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/<flat-filename>`,
    )
    expect(MURPH_SEND_VAULT_FILE_TOOL.description).toContain(
      'Do not stage files for possible later delivery',
    )
    expect(MURPH_SEND_VAULT_FILE_TOOL.description).toContain(
      'never move or copy existing, user-owned, canonical, or durable files there',
    )
    expect(MURPH_SEND_VAULT_FILE_TOOL.description).toContain(
      'pass those exact included ids in retire_export_pack_ids',
    )
    expect(
      MURPH_SEND_VAULT_FILE_TOOL.inputSchema.properties.retire_export_pack_ids,
    ).toMatchObject({ maxItems: 20, minItems: 1 })
    expect(
      MURPH_SEND_VAULT_FILE_TOOL.inputSchema.properties.ref.description,
    ).toContain('all other hidden paths')
  })

  it('parses exact export-pack ids from the vault-file tool boundary', () => {
    expect(readTestMurphDynamicToolRequest({
      id: 1,
      method: 'item/tool/call',
      params: {
        arguments: {
          ref: `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/vault.zip`,
          retire_export_pack_ids: ['pack-one'],
        },
        callId: 'call-export-pack',
        namespace: 'murph',
        tool: 'send_vault_file',
      },
    })).toEqual({
      kind: 'send-vault-file',
      ref: `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/vault.zip`,
      retireExportPackIds: ['pack-one'],
      toolCallId: 'call-export-pack',
    })
  })
})
