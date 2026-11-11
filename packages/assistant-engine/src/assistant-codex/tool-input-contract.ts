import type { AssistantProviderDynamicTool } from '../assistant/providers/types.js'

/**
 * Codex's schema normalization and code-mode renderer are not lossless JSON
 * Schema transports. Keep the canonical document outside that schema object.
 * This is model-visible guidance, not a second validator or execution authority.
 *
 * Measured against the pinned App Server on 2026-11-10: the native parameters
 * matched the canonical schema for 8 of 71 registrations. Codex drops string
 * and number bounds, patterns, defaults, formats and maxItems, rewrites const
 * as a string enum, and strips parameter descriptions from large schemas. So
 * this copy has to stay until Codex forwards declarations unchanged; only the
 * sentence that introduces it is kept short, because every tool pays for it.
 */
export function withCodexToolInputContract(
  tool: AssistantProviderDynamicTool,
): AssistantProviderDynamicTool {
  const schemaJson = JSON.stringify(tool.inputSchema, (_key, value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return value
    }
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, record[key]]),
    )
  }).replaceAll('*/', '*\\/')
  const supplement = [
    '',
    '',
    'Complete input schema. Where the generated signature differs, follow this schema.',
    `MURPH_INPUT_SCHEMA_JSON: ${schemaJson}`,
  ].join('\n')
  // Idempotent for repeated boundary composition; never mutate the catalog or
  // replace inputSchema, tool identity, loading policy, or handler dispatch.
  return tool.description.endsWith(supplement)
    ? tool
    : { ...tool, description: tool.description + supplement }
}
