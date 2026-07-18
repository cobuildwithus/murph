import { z } from 'zod'

import { toLocalDayKey } from '@murphai/contracts'
import { loadVault } from '@murphai/core'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { appendKnowledgePageSection } from '../../knowledge/service.js'
import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import {
  resolveAssistantScheduledTaskAuthority,
  type AssistantScheduledTaskAuthority,
  type AssistantScheduledTaskSourceCurrentAssertion,
} from '../../assistant/scheduled-task-authority.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const boundedTextSchema = z.string().trim().min(1).max(50_000)
const scheduledKnowledgeArgumentsSchema = z.object({
  body: boundedTextSchema,
}).strict()

export const MURPH_SCHEDULED_KNOWLEDGE_TOOL = {
  namespace: 'murph',
  name: 'scheduled_knowledge',
  description:
    'Persist one body in the exact knowledge ledger and scheduled occurrence bound by the trusted cron parent. The parent derives the occurrence-local date heading and always prepends it, so retries reuse the exact existing section. This tool accepts no action, date, timezone, heading, position, slug, title, path, command, or credential.',
  inputSchema: z.toJSONSchema(scheduledKnowledgeArgumentsSchema, { io: 'input' }),
} as const

type ScheduledKnowledgeArguments = z.infer<typeof scheduledKnowledgeArgumentsSchema>

export type ScheduledKnowledgeDynamicToolRequest =
  | {
      kind: 'scheduled-knowledge'
      request: ScheduledKnowledgeArguments
    }
  | {
      kind: 'invalid-scheduled-knowledge-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readScheduledKnowledgeDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): ScheduledKnowledgeDynamicToolRequest | null {
  if (input.tool !== MURPH_SCHEDULED_KNOWLEDGE_TOOL.name) {
    return null
  }

  const parsed = parseDynamicToolArguments({
    schema: scheduledKnowledgeArgumentsSchema,
    schemaRootKeys: ['body'],
    toolName: 'murph.scheduled_knowledge',
    value: input.arguments,
  })

  return parsed.ok
    ? { kind: 'scheduled-knowledge', request: parsed.args }
    : {
        kind: 'invalid-scheduled-knowledge-arguments',
        validationDigest: parsed.validationDigest,
      }
}

export async function executeScheduledKnowledgeDynamicTool(input: {
  assertSourceCurrent: AssistantScheduledTaskSourceCurrentAssertion
  authority: AssistantScheduledTaskAuthority | null
  request: Extract<ScheduledKnowledgeDynamicToolRequest, { kind: 'scheduled-knowledge' }>
  scheduledOccurrenceAt: string | null
  vaultRoot: string | null
}): Promise<{
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
}> {
  if (!input.vaultRoot || !input.scheduledOccurrenceAt) {
    return knowledgeTextResult(false, 'scheduled knowledge is unavailable')
  }

  const authority = resolveAssistantScheduledTaskAuthority(input.authority)
  if (
    authority.kind !== 'managed_knowledge_ledger' &&
    authority.kind !== 'research_ledger' &&
    authority.kind !== 'product_notes'
  ) {
    return knowledgeTextResult(false, JSON.stringify({
      code: 'scheduled_knowledge_unauthorized',
    }))
  }

  const occurrence = new Date(input.scheduledOccurrenceAt)
  if (
    Number.isNaN(occurrence.getTime()) ||
    occurrence.toISOString() !== input.scheduledOccurrenceAt
  ) {
    return knowledgeTextResult(false, JSON.stringify({
      code: 'scheduled_knowledge_occurrence_invalid',
    }))
  }

  try {
    const { metadata } = await loadVault({ vaultRoot: input.vaultRoot })
    const heading = toLocalDayKey(occurrence, metadata.timezone)
    await input.assertSourceCurrent(input.authority)
    try {
      const result = await appendKnowledgePageSection({
        body: input.request.request.body,
        heading,
        position: 'prepend',
        slug: authority.slug,
        title: authority.title,
        vault: input.vaultRoot,
      })

      return knowledgeTextResult(true, JSON.stringify({
        heading,
        pagePath: result.page.pagePath,
        savedAt: result.savedAt,
        slug: result.page.slug,
        status: 'recorded',
        title: result.page.title,
      }))
    } catch (error) {
      if (
        error instanceof VaultCliError &&
        error.code === 'knowledge_section_already_exists'
      ) {
        const pagePath = error.context?.pagePath
        return knowledgeTextResult(true, JSON.stringify({
          heading,
          ...(typeof pagePath === 'string' ? { pagePath } : {}),
          slug: authority.slug,
          status: 'reused',
          title: authority.title,
        }))
      }
      throw error
    }
  } catch (error) {
    return knowledgeTextResult(
      false,
      JSON.stringify({
        code: error instanceof VaultCliError
          ? error.code
          : 'scheduled_knowledge_unavailable',
      }),
    )
  }
}

function knowledgeTextResult(success: boolean, text: string): {
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
} {
  return {
    rpcResult: {
      contentItems: [{ text, type: 'inputText' }],
      success,
    },
  }
}
