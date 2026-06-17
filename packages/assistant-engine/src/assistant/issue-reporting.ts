import {
  createAssistantRuntimeIssueFingerprint,
  createAssistantRuntimeIssueId,
  writePendingAssistantRuntimeIssueRecord,
  type AssistantRuntimeIssueKind,
  type AssistantRuntimeIssuePhase,
  type AssistantRuntimeIssueRecord,
  type AssistantRuntimeIssueSeverity,
} from '@murphai/runtime-state/node'

import type { AssistantExecutionContext } from './execution-context.js'
import { normalizeAssistantExecutionContext } from './execution-context.js'
import {
  redactAssistantStateString,
  redactAssistantStateStructuredValue,
} from './redaction.js'
import { normalizeNullableString } from './shared.js'

export interface AssistantDiagnosticsPolicy {
  environment: 'hosted' | 'local'
  privateIssueCaptureEnabled: boolean
  surface: string | null
}

export interface AssistantRuntimeIssueInput {
  component: string
  details?: Record<string, unknown> | null
  errorCode?: string | null
  issueKind: AssistantRuntimeIssueKind
  operation?: string | null
  phase: AssistantRuntimeIssuePhase
  severity: AssistantRuntimeIssueSeverity
  summary: string
}

const ISSUE_CAPTURE_ENV = 'MURPH_ASSISTANT_PRIVATE_ISSUES'
const STRING_MAX_LENGTH = 180
const SUMMARY_MAX_LENGTH = 240
const FIELD_MAX_LENGTH = 96
const DETAIL_MAX_KEYS = 24
const DETAIL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/u
const pendingIssueWritePromises = new Set<Promise<void>>()

export function resolveAssistantDiagnosticsPolicy(input: {
  channel: string | null
  env?: NodeJS.ProcessEnv
  executionContext?: AssistantExecutionContext | null
}): AssistantDiagnosticsPolicy {
  const env = input.env ?? process.env
  const executionContext = normalizeAssistantExecutionContext(input.executionContext)
  const environment = executionContext?.hosted ? 'hosted' : 'local'
  const explicitIssueCapture = readBooleanEnv(env[ISSUE_CAPTURE_ENV])
  const surface = normalizeAssistantIssueSurface(input.channel)

  return {
    environment,
    privateIssueCaptureEnabled: explicitIssueCapture ?? true,
    surface,
  }
}

export async function recordAssistantRuntimeIssue(input: {
  issue: AssistantRuntimeIssueInput
  policy: AssistantDiagnosticsPolicy
  vault: string
}): Promise<void> {
  const record = createAssistantRuntimeIssueRecord({
    issue: input.issue,
    policy: input.policy,
  })

  if (!record) {
    return
  }

  await writePendingAssistantRuntimeIssueRecord({
    record,
    vault: input.vault,
  })
}

export async function recordAssistantToolFailureRuntimeIssues(input: {
  policy: AssistantDiagnosticsPolicy
  rawToolEvents: readonly unknown[]
  vault: string
}): Promise<void> {
  if (!input.policy.privateIssueCaptureEnabled) {
    return
  }

  const issues = extractAssistantToolFailureRuntimeIssues(input.rawToolEvents)
  for (const issue of issues) {
    await recordAssistantRuntimeIssue({
      issue,
      policy: input.policy,
      vault: input.vault,
    })
  }
}

export function recordAssistantRuntimeIssueInputsBestEffort(input: {
  issues: readonly AssistantRuntimeIssueInput[]
  policy: AssistantDiagnosticsPolicy
  vault: string
}): void {
  if (!input.policy.privateIssueCaptureEnabled || input.issues.length === 0) {
    return
  }

  for (const issue of input.issues.slice(0, 8)) {
    const write = recordAssistantRuntimeIssue({
      issue,
      policy: input.policy,
      vault: input.vault,
    }).catch(() => undefined)
    pendingIssueWritePromises.add(write)
    void write.finally(() => {
      pendingIssueWritePromises.delete(write)
    })
  }
}

export async function flushPendingAssistantRuntimeIssueWrites(): Promise<void> {
  while (pendingIssueWritePromises.size > 0) {
    await Promise.allSettled([...pendingIssueWritePromises])
  }
}

function createAssistantRuntimeIssueRecord(input: {
  issue: AssistantRuntimeIssueInput
  policy: AssistantDiagnosticsPolicy
}): AssistantRuntimeIssueRecord | null {
  if (!input.policy.privateIssueCaptureEnabled) {
    return null
  }

  const component = sanitizeIssueField(input.issue.component) || 'assistant-runtime'
  const operation = sanitizeNullableIssueField(input.issue.operation)
  const errorCode = sanitizeNullableIssueField(input.issue.errorCode)
  const summary = sanitizeIssueString(input.issue.summary, SUMMARY_MAX_LENGTH)
  const occurredAt = new Date().toISOString()
  const fingerprint = createAssistantRuntimeIssueFingerprint({
    component,
    errorCode,
    issueKind: input.issue.issueKind,
    operation,
    phase: input.issue.phase,
    summary,
  })

  return {
    schema: 'murph.assistant-runtime-issue.v1',
    component,
    details: sanitizeIssueDetails(input.issue.details ?? null),
    environment: input.policy.environment,
    errorCode,
    fingerprint,
    issueId: createAssistantRuntimeIssueId({ fingerprint, occurredAt }),
    issueKind: input.issue.issueKind,
    occurredAt,
    operation,
    phase: input.issue.phase,
    severity: input.issue.severity,
    summary,
    surface: input.policy.surface,
  }
}

function extractAssistantToolFailureRuntimeIssues(
  events: readonly unknown[],
): AssistantRuntimeIssueInput[] {
  return events.flatMap((event) => {
    const issue = createAssistantToolFailureRuntimeIssue(event)
    return issue ? [issue] : []
  }).slice(0, 8)
}

function createAssistantToolFailureRuntimeIssue(
  event: unknown,
): AssistantRuntimeIssueInput | null {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return null
  }

  const record = event as Record<string, unknown>
  if (record.type !== 'assistant.tool.failed') {
    return null
  }

  const tool = sanitizeNullableIssueField(record.tool) ?? 'unknown-tool'
  const errorCode = sanitizeNullableIssueField(record.errorCode)
  const issueKind = classifyToolFailureIssueKind({
    errorCode,
    errorMessage: typeof record.errorMessage === 'string' ? record.errorMessage : null,
  })

  return {
    component: 'assistant.tool',
    details: {
      inputKeys: listObjectKeys(record.input),
      mode: sanitizeNullableIssueField(record.mode),
      sequence: typeof record.sequence === 'number' ? record.sequence : null,
    },
    errorCode,
    issueKind,
    operation: tool,
    phase: 'tool_call',
    severity: 'warning',
    summary: `Assistant tool ${tool} failed during provider turn.`,
  }
}

function classifyToolFailureIssueKind(input: {
  errorCode: string | null
  errorMessage: string | null
}): AssistantRuntimeIssueKind {
  const haystack = `${input.errorCode ?? ''} ${input.errorMessage ?? ''}`.toLowerCase()
  if (/\b(?:schema|contract|validation|invalid|parse|strict|rejected|unsupported)\b/u.test(haystack)) {
    return 'schema_rejection'
  }
  if (/\b(?:timeout|timed out|deadline|abort)\b/u.test(haystack)) {
    return 'timeout'
  }
  return 'tool_error'
}

function listObjectKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return []
  }

  return Object.keys(value)
    .map((key) => sanitizeIssueField(key))
    .filter((key) => key.length > 0)
    .sort()
    .slice(0, 24)
}

function sanitizeIssueDetails(details: Record<string, unknown> | null): Record<string, unknown> {
  if (!details) {
    return {}
  }

  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(details)) {
    if (Object.keys(sanitized).length >= DETAIL_MAX_KEYS) {
      break
    }
    if (!DETAIL_KEY_PATTERN.test(key)) {
      continue
    }
    const sanitizedValue = sanitizeIssueDetailValue(value)
    if (sanitizedValue !== undefined) {
      sanitized[key] = sanitizedValue
    }
  }
  return sanitized
}

function sanitizeIssueDetailValue(value: unknown): unknown | undefined {
  if (value === null || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value === 'string') {
    return sanitizeIssueString(value, STRING_MAX_LENGTH)
  }
  if (Array.isArray(value)) {
    const sanitized = value
      .map((entry) => sanitizeIssueDetailValue(entry))
      .filter((entry) => entry !== undefined)
      .slice(0, 12)
    return sanitized.length > 0 ? sanitized : undefined
  }
  if (value && typeof value === 'object') {
    const redacted = redactAssistantStateStructuredValue(value)
    if (redacted && typeof redacted === 'object' && !Array.isArray(redacted)) {
      return sanitizeIssueDetails(redacted as Record<string, unknown>)
    }
  }
  return undefined
}

function sanitizeNullableIssueField(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const field = sanitizeIssueField(value)
  return field.length > 0 ? field : null
}

function sanitizeIssueField(value: string): string {
  return sanitizeIssueString(value, FIELD_MAX_LENGTH)
    .replaceAll(/[^A-Za-z0-9_.:-]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')
}

function sanitizeIssueString(value: string, maxLength: number): string {
  const redacted = redactAssistantStateString(value)
    .replaceAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email]')
    .replaceAll(/(?:\+?\d[\d .()\-]{6,}\d)/gu, '[number]')
    .replaceAll(/(?:https?:\/\/|file:\/\/)[^\s),;]+/giu, '[url]')
    .replaceAll(/(?:file:\/\/)?\/(?:Users|home|mnt|tmp|var)\/[^\s),;]+/giu, '[path]')
    .replaceAll(/[A-Za-z]:\\[^\s),;]+/gu, '[path]')
    .replaceAll(/\s+/gu, ' ')
    .trim()

  if (redacted.length <= maxLength) {
    return redacted
  }

  return `${redacted.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function normalizeAssistantIssueSurface(channel: string | null): string | null {
  const normalized = normalizeNullableString(channel)
  return normalized ? sanitizeIssueField(normalized) : null
}

function readBooleanEnv(value: string | undefined): boolean | null {
  const normalized = normalizeNullableString(value)?.toLowerCase()
  if (!normalized) {
    return null
  }
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false
  }
  return null
}
