import { describe, expect, it } from 'vitest'

import { eventSourceSchema } from '@murphai/contracts'

import { createCanonicalVaultWriteToolDefinitions } from '../src/assistant-cli-tools/capability-definitions.ts'

describe('createCanonicalVaultWriteToolDefinitions', () => {
  it('reuses the shared event source schema for document imports', () => {
    const definitions = createCanonicalVaultWriteToolDefinitions({
      vault: '/tmp/murph-test-vault',
      vaultServices: {} as never,
    })
    const documentImportTool = definitions.find(
      (definition) => definition.name === 'vault.document.import',
    )

    expect(documentImportTool).toBeDefined()

    const sourceSchema = (
      documentImportTool!.inputSchema as {
        shape: {
          source: {
            unwrap(): unknown
          }
        }
      }
    ).shape.source.unwrap()

    expect(sourceSchema).toBe(eventSourceSchema)
  })
})
