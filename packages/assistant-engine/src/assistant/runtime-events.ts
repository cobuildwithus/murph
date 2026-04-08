import { readFile } from 'node:fs/promises'
import {
  assistantRuntimeEventSchema,
  type AssistantRuntimeEvent,
  type AssistantRuntimeEventKind,
} from '@murphai/operator-config/assistant-cli-contracts'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import {
  appendTextFile,
  ensureAssistantStateDirectory,
  parseAssistantJsonLinesWithTailSalvage,
  isMissingFileError,
} from './shared.js'
import type { AssistantStatePaths } from './store/paths.js'
import { resolveAssistantStatePaths } from './store/paths.js'
import {
  redactAssistantStateString,
  redactAssistantStateStructuredValue,
} from './redaction.js'

const ASSISTANT_RUNTIME_EVENT_SCHEMA = 'murph.assistant-runtime-event.v1'

export async function appendAssistantRuntimeEvent(input: {
  at?: string
  component: string
  data?: Record<string, unknown> | null
  entityId?: string | null
  entityType?: string | null
  kind: AssistantRuntimeEventKind
  level?: AssistantRuntimeEvent['level']
  message: string
  vault: string
}): Promise<AssistantRuntimeEvent> {
  return await withAssistantRuntimeWriteLock(input.vault, async (paths) =>
    appendAssistantRuntimeEventAtPaths(paths, input),
  )
}

export async function appendAssistantRuntimeEventAtPaths(
  paths: AssistantStatePaths,
  input: {
    at?: string
    component: string
    data?: Record<string, unknown> | null
    entityId?: string | null
    entityType?: string | null
    kind: AssistantRuntimeEventKind
    level?: AssistantRuntimeEvent['level']
    message: string
  },
): Promise<AssistantRuntimeEvent> {
  await ensureAssistantStateDirectory(paths.journalsDirectory)
  const event = assistantRuntimeEventSchema.parse({
    schema: ASSISTANT_RUNTIME_EVENT_SCHEMA,
    at: input.at ?? new Date().toISOString(),
    level: input.level ?? 'info',
    kind: input.kind,
    component: input.component,
    entityId: input.entityId ?? null,
    entityType: input.entityType ?? null,
    message: redactAssistantStateString(input.message),
    dataJson:
      input.data ? JSON.stringify(redactAssistantStateStructuredValue(input.data)) : null,
  })

  await appendTextFile(paths.runtimeEventsPath, `${JSON.stringify(event)}\n`)
  return event
}

export async function listAssistantRuntimeEvents(input: {
  limit?: number
  vault: string
}): Promise<AssistantRuntimeEvent[]> {
  return await listAssistantRuntimeEventsAtPath(
    resolveAssistantStatePaths(input.vault).runtimeEventsPath,
    input.limit,
  )
}

export async function listAssistantRuntimeEventsAtPath(
  runtimeEventsPath: string,
  limit = 50,
): Promise<AssistantRuntimeEvent[]> {
  try {
    const raw = await readFile(runtimeEventsPath, 'utf8')
    const parsed = parseAssistantJsonLinesWithTailSalvage(raw, (value) =>
      assistantRuntimeEventSchema.parse(value),
    )
    return parsed.values.slice(-normalizeLimit(limit)).reverse()
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }
    throw error
  }
}

function normalizeLimit(value?: number): number {
  if (!Number.isFinite(value) || typeof value !== 'number') {
    return 50
  }
  return Math.min(Math.max(Math.trunc(value), 1), 250)
}
