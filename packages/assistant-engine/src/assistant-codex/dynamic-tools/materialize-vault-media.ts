import * as z from '@murphai/contracts/zod-runtime'
import { assistantVaultFileMaxBytes } from '@murphai/operator-config/assistant-cli-contracts'
import { readHostedMediaReferenceCatalogueValue } from '@murphai/runtime-state/node'
import { resolveVaultPathOnDisk } from '@murphai/core'
import { lstat } from 'node:fs/promises'
import type { SafeToolCallValidationDigest } from '../../assistant/tool-validation-digest.js'
import type { AssistantWorkspaceArtifactMaterializer } from '../../assistant/execution-context.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

// Reject root selectors before handing paths to the broader workspace port.
const vaultRelativePathPattern = '^(?!/)(?![A-Za-z]:|(?:vault|operator-home):)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*[\\\\\\u0000-\\u001F\\u007F])[^/]+(?:/[^/]+)*$'
const vaultRelativePath = z.string().min(1).max(4096).regex(new RegExp(vaultRelativePathPattern, 'u'))
const argumentsSchema = z.object({
  paths: z.array(vaultRelativePath).min(1).max(100).optional(),
  all: z.literal(true).optional(),
}).strict().refine(value => (value.paths !== undefined) !== (value.all === true), 'Supply paths or all: true, not both.')

export const VAULT_MEDIA_EXPORT_GUIDANCE = 'call materialize_vault_media with all: true before archiving, and tell the member about any path it reports as unavailable.'

export const MURPH_MATERIALIZE_VAULT_MEDIA_TOOL = {
  namespace: 'murph',
  name: 'materialize_vault_media',
  deferLoading: true,
  description: 'Restore retained vault media when a saved photo or file is missing locally, or before an export. Supply exact vault-relative paths, or all: true for the full hosted catalogue including cold history. Returns counts and unavailable paths/reasons, never bytes. Unavailable files were not verified; disclose them rather than claiming a complete export. `removed` counts media already gone through retention or deletion, which is expected.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      paths: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 4096, pattern: vaultRelativePathPattern } },
      all: { type: 'boolean', const: true },
    },
    oneOf: [{ required: ['paths'] }, { required: ['all'] }],
  },
} as const

export function parseMaterializeVaultMediaArguments(value: unknown) {
  return parseDynamicToolArguments({ schema: argumentsSchema, schemaRootKeys: ['paths', 'all'], toolName: 'murph.materialize_vault_media', value })
}

export function readMaterializeVaultMediaToolRequest(request: { tool: string | null; arguments: unknown }):
  | { kind: 'materialize-vault-media'; args: z.infer<typeof argumentsSchema> }
  | { kind: 'invalid-materialize-vault-media-arguments'; validationDigest: SafeToolCallValidationDigest }
  | null {
  if (request.tool !== MURPH_MATERIALIZE_VAULT_MEDIA_TOOL.name) return null
  const parsed = parseMaterializeVaultMediaArguments(request.arguments)
  return parsed.ok
    ? { kind: 'materialize-vault-media', args: parsed.args }
    : { kind: 'invalid-materialize-vault-media-arguments', validationDigest: parsed.validationDigest }
}

export async function materializeVaultMedia(input: {
  args: z.infer<typeof argumentsSchema>
  vaultRoot: string
  materialize: AssistantWorkspaceArtifactMaterializer
  signal?: AbortSignal | null
}) {
  input.signal?.throwIfAborted()
  const paths = await selectVaultMediaPaths(input)
  const unavailable: { path: string; reason: string }[] = []
  let available = 0
  let removed = 0
  // The port already processes media sequentially and reads the catalogue once.
  // Keep a bulk request together rather than re-reading it for every batch.
  const result = await input.materialize(paths.map(ref => `vault:${ref}`), {
    maxFileBytes: assistantVaultFileMaxBytes, maxTotalDownloadBytes: assistantVaultFileMaxBytes, signal: input.signal,
  })
  for (const ref of paths) {
    const key = `vault:${ref}`
    const reason = result.missingArtifactPaths.get(key)
    if (!reason && result.materializedArtifactPaths.has(key)) available += 1
    else if (input.args.all && await wasVaultMediaRemoved(input.vaultRoot, ref, reason)) removed += 1
    else unavailable.push({ path: ref, reason: reason ?? 'missing' })
  }
  input.signal?.throwIfAborted()
  return { requested: paths.length, available, removed, unavailable }
}

async function selectVaultMediaPaths(input: { args: z.infer<typeof argumentsSchema>; vaultRoot: string }) {
  if (!input.args.all) return [...new Set(input.args.paths)]
  const catalogue = await readHostedMediaReferenceCatalogueValue(input.vaultRoot)
  // The catalogue reader owns descriptor interpretation; only vault scope is
  // checked here. Do not silently skip an invalid catalogue path.
  return [...new Set(catalogue.entries.map(entry => z.object({ relativePath: vaultRelativePath }).parse(entry).relativePath))]
}

async function wasVaultMediaRemoved(vaultRoot: string, relativePath: string, reason: string | undefined) {
  if (reason === 'obsolete') return true
  if (reason !== 'expired') return false
  try {
    const resolved = await resolveVaultPathOnDisk(vaultRoot, relativePath)
    return !(await lstat(resolved.absolutePath)).isFile()
  } catch (error) {
    // Only proven absence may hide an expired path from the export's gaps.
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
  }
}
