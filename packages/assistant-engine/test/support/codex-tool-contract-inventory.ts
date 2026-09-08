/// <reference types="vite/client" />
import assert from 'node:assert/strict'

import * as catalog from '../../src/assistant-codex/dynamic-tool-catalog.ts'
import type { AssistantProviderDynamicTool } from '../../src/assistant/providers/types.ts'

const modules = import.meta.glob<Record<string, unknown>>(
  '../../src/assistant-codex/dynamic-tools/**/*.ts',
  { eager: true },
)

/** Exported canonical registrations, plus the actual resolver's route variants. */
export function collectCanonicalToolInventory(): readonly AssistantProviderDynamicTool[] {
  const tools = new Set<AssistantProviderDynamicTool>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
    } else if (value && typeof value === 'object') {
      const tool = value as Partial<AssistantProviderDynamicTool>
      if (typeof tool.name === 'string' && typeof tool.namespace === 'string'
        && typeof tool.description === 'string' && tool.inputSchema
        && typeof tool.inputSchema === 'object') {
        tools.add(tool as AssistantProviderDynamicTool)
      }
    }
  }
  for (const module of [catalog, ...Object.values(modules)]) Object.values(module).forEach(visit)

  // Discover boolean capability gates from the owner instead of maintaining a
  // tool-name list. Both defaults and each single-gate inversion exercise the
  // resolver's replacements (including private/group variants of one name).
  // progressUpdateMode is the non-boolean route discriminator, not a schema.
  const gates = new Set<string>()
  const probe = (enabled: boolean, flipped?: string): void => {
    for (const mode of ['direct', 'group'] as const) {
      visit(catalog.resolveMurphDynamicTools(new Proxy({}, {
        get: (_target, key) => {
          if (key === 'progressUpdateMode') return mode
          assert.equal(typeof key, 'string')
          gates.add(key as string)
          return key === flipped ? !enabled : enabled
        },
      })))
    }
  }
  probe(false)
  probe(true)
  const visited = new Set<string>()
  for (const key of gates) {
    if (visited.has(key)) continue
    visited.add(key)
    probe(false, key)
    probe(true, key)
  }
  assert.ok(catalog.MURPH_DYNAMIC_TOOLS.every((tool) => tools.has(tool)))
  return [...tools]
}

/** No two route alternatives for the same RPC identity may be registered together. */
export function partitionToolInventory(
  tools: readonly AssistantProviderDynamicTool[],
): AssistantProviderDynamicTool[][] {
  const batches: AssistantProviderDynamicTool[][] = []
  for (const tool of tools) {
    let batch = batches.find((candidate) => candidate.every((other) =>
      other.name !== tool.name || other.namespace !== tool.namespace))
    if (!batch) batches.push(batch = [])
    batch.push(tool)
  }
  return batches
}
