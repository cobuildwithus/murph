import { describe, expect, it } from 'vitest'

import { createHealthCommonsToolDefinitions } from '../src/assistant-cli-tools/capability-definitions.ts'

const FINNISH_DRY_SAUNA_KEY =
  'protocol_variant:dry-sauna/murph-finnish-standard-3x-week'

type ExecutableToolDefinition = {
  executionBindings: object
  name: string
  preferredHostKind?: string
}

describe('Health Commons bound assistant tools', () => {
  it('can find Finnish Dry Sauna through search and protocol listing', async () => {
    const tools = createHealthCommonsToolDefinitions()

    const search = tools.find((tool) => tool.name === 'healthCommons.search')
    const listProtocols = tools.find(
      (tool) => tool.name === 'healthCommons.listProtocols',
    )

    expect(search).toBeTruthy()
    expect(listProtocols).toBeTruthy()

    const searchResult = await executeBoundTool(search!, {
      query: 'sauna',
      entityTypes: ['protocol_variant'],
    })
    expect(JSON.stringify(searchResult)).toContain(FINNISH_DRY_SAUNA_KEY)
    expect(searchResult).toMatchObject({
      diagnostics: {
        finnishDrySaunaPresent: 'Finnish Dry Sauna',
        protocolVariantCount: expect.any(Number),
        sourceArtifactCount: expect.any(Number),
      },
    })

    const protocolResult = await executeBoundTool(listProtocols!, {
      query: 'sauna',
    })
    expect(JSON.stringify(protocolResult)).toContain(FINNISH_DRY_SAUNA_KEY)
    expect(protocolResult).toMatchObject({
      diagnostics: {
        finnishDrySaunaPresent: 'Finnish Dry Sauna',
        protocolVariantCount: expect.any(Number),
        sourceArtifactCount: expect.any(Number),
      },
    })
  })

  it('returns Health Commons diagnostics on all bound tool result shapes', async () => {
    const tools = createHealthCommonsToolDefinitions()

    expectHealthCommonsDiagnostics(
      await executeTool(tools, 'healthCommons.search', {
        query: 'sauna',
        entityTypes: ['protocol_variant'],
      }),
    )
    expectHealthCommonsDiagnostics(
      await executeTool(tools, 'healthCommons.get', {
        keyOrSlug: FINNISH_DRY_SAUNA_KEY,
      }),
    )
    expectHealthCommonsDiagnostics(
      await executeTool(tools, 'healthCommons.listProtocols', {
        query: 'sauna',
      }),
    )
    expectHealthCommonsDiagnostics(
      await executeTool(tools, 'healthCommons.listSources', {
        protocolKeyOrSlug: FINNISH_DRY_SAUNA_KEY,
        limit: 3,
      }),
    )
    expectHealthCommonsDiagnostics(
      await executeTool(tools, 'healthCommons.get', {
        keyOrSlug: 'not-a-health-commons-record',
      }),
    )
    expectHealthCommonsDiagnostics(
      await executeTool(tools, 'healthCommons.listSources', {
        protocolKeyOrSlug: 'source_artifact:aasm-scoring-manual-v3',
      }),
    )
  })
})

async function executeTool(
  tools: readonly ExecutableToolDefinition[],
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<unknown> {
  const tool = tools.find((candidate) => candidate.name === toolName)
  if (!tool) {
    throw new Error(`Missing tool ${toolName}`)
  }

  return await executeBoundTool(tool, toolInput)
}

function expectHealthCommonsDiagnostics(result: unknown): void {
  expect(result).toMatchObject({
    diagnostics: {
      catalogHash: expect.stringMatching(/^sha256:/u),
      finnishDrySaunaPresent: 'Finnish Dry Sauna',
      protocolVariantCount: expect.any(Number),
      sourceArtifactCount: expect.any(Number),
    },
  })
}

async function executeBoundTool<T extends ExecutableToolDefinition>(
  tool: T,
  toolInput: Record<string, unknown>,
): Promise<unknown> {
  const preferredHostKind = tool.preferredHostKind
  if (!preferredHostKind) {
    throw new Error(`Missing preferred host for ${tool.name}`)
  }

  const executor = (
    tool.executionBindings as Partial<
      Record<string, (input: Record<string, unknown>) => Promise<unknown>>
    >
  )[preferredHostKind]
  if (!executor) {
    throw new Error(`Missing executor for ${preferredHostKind}`)
  }

  return await executor(toolInput)
}
