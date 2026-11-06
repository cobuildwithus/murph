import { Buffer } from 'node:buffer'
import { open } from 'node:fs/promises'
import { parseFrontmatterDocument } from '@murphai/core'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'
import * as z from '@murphai/contracts/zod-runtime'
import { buildKnowledgePageRelativePath, normalizeKnowledgeBody } from '../knowledge/documents.js'
import { getKnowledgePage, upsertKnowledgePage } from '../knowledge/service.js'

export const CONNECTED_CONTEXT_LEDGER_SLUG = 'journal-connected-context'
const POLICY_MAX_BYTES = 64 * 1024

const policySchema = z.object({
  version: z.literal(1),
  optOuts: z.object({
    global: z.boolean(), accounts: z.array(z.string()),
    providers: z.array(z.string()), categories: z.array(z.string()),
  }).passthrough(),
  activeAccounts: z.array(z.object({ id: z.string(), provider: z.string() })),
}).passthrough()
export type ConnectedContextPolicy = z.infer<typeof policySchema>

// Controls are the first JSON line; source mappings follow in the same page.
// A compact legacy JSON object remains readable, including its source mappings.
function parseLedgerBody(body: string) {
  const newline = body.indexOf('\n')
  const prefix = newline < 0 ? body : body.slice(0, newline)
  try {
    return { policy: policySchema.parse(JSON.parse(prefix)), suffix: newline < 0 ? '' : body.slice(newline) }
  } catch {
    return { policy: policySchema.parse(JSON.parse(body)), suffix: '' }
  }
}

export async function readConnectedContextPolicy(vaultRoot: string): Promise<ConnectedContextPolicy | null> {
  try {
    const filePath = await resolveAssistantVaultPath(vaultRoot, buildKnowledgePageRelativePath(CONNECTED_CONTEXT_LEDGER_SLUG), 'file path')
    const file = await open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(POLICY_MAX_BYTES)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      const document = parseFrontmatterDocument(buffer.subarray(0, bytesRead).toString('utf8'))
      if (document.attributes.slug !== CONNECTED_CONTEXT_LEDGER_SLUG || document.attributes.status !== 'active') return null
      return parseLedgerBody(normalizeKnowledgeBody(document.body)).policy
    } finally { await file.close() }
  } catch { return null }
}

export async function removeConnectedContextAccount(vaultRoot: string, accountId: string): Promise<void> {
  // Unknown/missing policy already excludes connected plans. Do not replace it
  // with default permissions or discard legacy opt-outs and source mappings.
  if (!await readConnectedContextPolicy(vaultRoot)) return
  const { page } = await getKnowledgePage({ vault: vaultRoot, slug: CONNECTED_CONTEXT_LEDGER_SLUG })
  const { policy, suffix } = parseLedgerBody(normalizeKnowledgeBody(page.body))
  if (!policy.activeAccounts.some(account => account.id === accountId)) return
  policy.activeAccounts = policy.activeAccounts.filter(account => account.id !== accountId)
  await upsertKnowledgePage({
    vault: vaultRoot, slug: CONNECTED_CONTEXT_LEDGER_SLUG,
    body: JSON.stringify(policy) + suffix, expectedMarkdown: page.markdown,
  })
}
