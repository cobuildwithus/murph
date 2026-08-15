import { createHash } from 'node:crypto'

import { stableJsonStringify } from '../stable-json-stringify.js'

interface AssistantAutomationSemanticRevisionInput {
  activeUntil: string | null
  assistantTargetOverride: unknown
  automationId: string
  continuityPolicy: string
  createdAt: string
  instructions: string
  relativePath: string
  route: unknown
  schedule: unknown
  scheduleAnchorAt?: string
  slug: string
  summary: string | null
  supportKind: string | null
  tags: readonly string[]
  title: string
}

export function computeAssistantAutomationSemanticRevision(
  automation: AssistantAutomationSemanticRevisionInput,
): string {
  const semanticRecord = {
    activeUntil: automation.activeUntil,
    assistantTargetOverride: automation.assistantTargetOverride,
    automationId: automation.automationId,
    continuityPolicy: automation.continuityPolicy,
    createdAt: automation.createdAt,
    instructions: automation.instructions,
    relativePath: automation.relativePath,
    route: automation.route,
    schedule: automation.schedule,
    scheduleAnchorAt: automation.scheduleAnchorAt ?? automation.createdAt,
    slug: automation.slug,
    summary: automation.summary,
    supportKind: automation.supportKind,
    tags: automation.tags.slice().sort(),
    title: automation.title,
  }

  return createHash('sha256')
    .update(stableJsonStringify(semanticRecord))
    .digest('hex')
}
