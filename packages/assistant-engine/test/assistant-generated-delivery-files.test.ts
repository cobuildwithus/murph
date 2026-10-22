import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { describe, expect, it, vi } from 'vitest'
import { uploadLinqAttachment } from '@murphai/operator-config/linq-runtime'

import {
  MURPH_SEND_VAULT_FILE_TOOL,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
  isAssistantGeneratedDeliveryRef,
  resolveSupportedAssistantVaultFileContentType,
} from '../src/assistant/generated-delivery-files.ts'

describe('assistant generated delivery files', () => {
  it.each([
    'jpg', 'jpeg', 'png', 'gif', 'heic', 'heif', 'tif', 'tiff', 'bmp',
    'svg', 'webp', 'ico', 'mp4', 'mov', 'mpeg', 'mpg', 'm2v', 'm4v',
    'avi', '3gp', 'mp3', 'm4a', 'caf', 'wav', 'aif', 'aiff', 'aac',
    'mid', 'midi', 'amr', 'epub', 'htm', 'html', 'pages', 'numbers',
    'key', 'xml', 'gz', 'gzip',
  ])('uploads the resolved %s MIME type through the Linq contract', async (extension) => {
    const filename = `attachment.${extension}`
    const contentType = resolveSupportedAssistantVaultFileContentType(filename)
    if (!contentType) throw new Error('Expected a supported attachment format')
    const bytes = new Uint8Array([1, 2, 3, 4])
    const providerFetch = vi.fn<typeof fetch>(async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        content_type: contentType, filename, size_bytes: bytes.byteLength,
      })
      return Response.json({
        attachment_id: 'synthetic-attachment',
        download_url: 'https://cdn.example.test/attachment',
        expires_at: '2030-01-01T00:00:00.000Z',
        http_method: 'PUT',
        required_headers: { 'content-type': contentType },
        upload_url: 'https://uploads.example.test/attachment',
      })
    })
    const publicFetch = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.method).toBe('PUT')
      if (!(init?.body instanceof Blob)) throw new Error('Expected attachment bytes')
      expect(new Uint8Array(await init.body.arrayBuffer())).toEqual(bytes)
      return new Response(null, { status: 204 })
    })
    await expect(uploadLinqAttachment({ bytes, contentType, filename }, {
      env: { LINQ_API_TOKEN: 'synthetic-token', LINQ_API_BASE_URL: 'https://linq.example.test' },
      fetchImplementation: providerFetch,
      publicFetchImplementation: publicFetch,
    })).resolves.toEqual({ attachmentId: 'synthetic-attachment' })
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(publicFetch).toHaveBeenCalledTimes(1)
  })

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
      'Creating a new ZIP from requested vault files is allowed; read the originals in place and stage only the new archive.',
    )
    for (const boundary of [
      "member's authenticated private conversation",
      "archive all files under that member's workspace root as-is",
      'including dotfiles, runtime/history, configuration/instruction files',
      'any credential-bearing records present',
      'without content-based exclusion, redaction, or sanitization',
      'Archive symlinks as links without following them or reading outside the workspace',
      "submit only the new ZIP's generated-delivery ref",
    ]) expect(MURPH_SEND_VAULT_FILE_TOOL.description).toContain(boundary)
    expect(MURPH_SEND_VAULT_FILE_TOOL.description).not.toContain('Exclude credentials')
    expect(MURPH_SEND_VAULT_FILE_TOOL.description).not.toContain('omission notice')
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
