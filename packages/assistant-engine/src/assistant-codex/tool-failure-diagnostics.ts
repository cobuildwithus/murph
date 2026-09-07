import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { AssistantRuntimeIssueInput } from '../assistant/issue-reporting.js'
import type {
  MurphDynamicToolExecutionResult,
  MurphDynamicToolRequest,
} from './dynamic-tools.js'

/** Private metadata only. Never serialize this alongside model/RPC content. */
export interface ToolFailureDiagnostic {
  failureStage: 'admission' | 'execution' | 'result' | 'validation' | 'delivery'
  failureReason: ToolFailureReason
  errorCategory?: ToolErrorCategory
}

export type ToolFailureReason =
  | 'unknown'
  | 'unavailable'
  | 'authority_rejected'
  | 'invalid_input'
  | 'unsupported_request'
  | 'not_found'
  | 'conflict'
  | 'limit_reached'
  | 'action_result_mismatch'
  | 'invalid_result'
  | 'oversized_result'
  | 'result_serialization_failed'
  | 'empty_result'
  | 'handler_exception'
  | 'reported_failure'
  | 'nonzero_exit'

export type ToolErrorCategory =
  | 'unknown'
  | 'invalid_input'
  | 'not_found'
  | 'conflict'
  | 'unavailable'
  | 'authority_rejected'
  | 'invalid_result'
  | 'rate_limited'
  | 'timeout'

const FAILURE_STAGES: Record<ToolFailureReason, ToolFailureDiagnostic['failureStage']> = {
  unknown: 'result',
  unavailable: 'execution',
  authority_rejected: 'admission',
  invalid_input: 'validation',
  unsupported_request: 'admission',
  not_found: 'execution',
  conflict: 'execution',
  limit_reached: 'admission',
  action_result_mismatch: 'result',
  invalid_result: 'result',
  oversized_result: 'result',
  result_serialization_failed: 'result',
  empty_result: 'result',
  handler_exception: 'execution',
  reported_failure: 'result',
  nonzero_exit: 'execution',
}

// Current CLI projection and typed local/control-plane contracts, not a provider
// error catalogue. Unknown codes stay unknown; no code or exception prose exits.
const ERROR_CATEGORIES = new Map<string, ToolErrorCategory>([
  ['VALIDATION_ERROR', 'invalid_input'],
  ['VAULT_INVALID_INPUT', 'invalid_input'],
  ['invalid_option', 'invalid_input'],
  ['invalid_payload', 'invalid_input'],
  ['invalid_path', 'invalid_input'],
  ['not_found', 'not_found'],
  ['automation_not_found', 'not_found'],
  ['ENOENT', 'not_found'],
  ['conflict', 'conflict'],
  ['VAULT_AUTOMATION_CONFLICT', 'conflict'],
  ['HOSTED_BILLING_PLAN_QUOTE_STALE', 'conflict'],
  ['permission_denied', 'authority_rejected'],
  ['EACCES', 'authority_rejected'],
  ['EPERM', 'authority_rejected'],
  ['storage_unavailable', 'unavailable'],
  ['ENOSPC', 'unavailable'],
  ['device_connect_provider_unavailable', 'unavailable'],
  ['device_reconcile_unavailable', 'unavailable'],
  ['CONNECTION_NOT_FOUND', 'not_found'],
  ['RECONCILE_WAKE_NOT_ACCEPTED', 'unavailable'],
  ['HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE', 'unavailable'],
  ['HOSTED_DEVICE_CONNECT_PERSONAL_MEMBER_REQUIRED', 'authority_rejected'],
  ['HOSTED_DEVICE_CONNECT_TARGET_NOT_CONFIGURED', 'unavailable'],
  ['HOSTED_DEVICE_CONNECT_LINK_INVALID_MESSAGING_RETURN_TARGET', 'invalid_input'],
  ['INVALID_REQUEST', 'invalid_input'],
  ['CONNECTED_APPS_ACCOUNT_AMBIGUOUS', 'conflict'],
  ['CONNECTED_APPS_ACCOUNT_NOT_FOUND', 'not_found'],
  ['CONNECTED_APPS_ACCOUNT_REQUIRED', 'invalid_input'],
  ['CONNECTED_APPS_AGENT_APPROVAL_REQUIRED', 'authority_rejected'],
  ['CONNECTED_APPS_CONFIGURATION_UNAVAILABLE', 'unavailable'],
  ['CONNECTED_APPS_MEMBER_INACTIVE', 'authority_rejected'],
  ['CONNECTED_APPS_PERSONAL_MEMBER_REQUIRED', 'authority_rejected'],
  ['CONNECTED_APPS_REQUEST_INVALID', 'invalid_input'],
  ['CONNECTED_APPS_TOOLKIT_MISMATCH', 'invalid_input'],
  ['CONNECTED_APPS_TOOLKIT_NOT_CONFIGURED', 'unavailable'],
  ['CONNECTED_APPS_WRITE_ARGUMENT_NOT_ALLOWED', 'invalid_input'],
  ['CONNECTED_APPS_WRITE_ARGUMENT_REQUIRED', 'invalid_input'],
  ['CONNECTED_APPS_WRITE_PREFLIGHT_UNAVAILABLE', 'unavailable'],
  ['HOSTED_GROUP_TOOL_RESPONSE_SCHEMA_INVALID', 'invalid_result'],
  ['ASSISTANT_RESPONSE_MEDIA_AFTER_NO_REPLY', 'conflict'],
  ['ASSISTANT_RESPONSE_MEDIA_CONTEXT_ADVANCED', 'conflict'],
  ['ASSISTANT_RESPONSE_MEDIA_LIMIT_EXCEEDED', 'invalid_result'],
  ['ACCOUNT_DISCONNECTED', 'authority_rejected'],
  ['ACCOUNT_REAUTHORIZATION_REQUIRED', 'authority_rejected'],
  ['query_source_invalid', 'invalid_result'],
  ['unsupported_format', 'invalid_result'],
  ['commons_protocol_artifact_invalid', 'invalid_result'],
  ['commons_protocol_artifact_unavailable', 'unavailable'],
])

export function classifyToolFailureCode(code: unknown, stage?: unknown): ToolErrorCategory {
  if (code === 'contract_invalid') {
    return stage === 'validation' ? 'invalid_input' : 'unknown'
  }
  return typeof code === 'string' && code.length <= 96
    ? ERROR_CATEGORIES.get(code) ?? 'unknown'
    : 'unknown'
}

/** HTTP status is structural evidence, not a provider's arbitrary error label. */
export function classifyToolFailureStatus(status: unknown): ToolErrorCategory {
  if (status === 401 || status === 403) return 'authority_rejected'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate_limited'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 400 || status === 422) return 'invalid_input'
  return typeof status === 'number' && Number.isInteger(status) && status >= 500 && status <= 599
    ? 'unavailable' : 'unknown'
}

export function classifyToolFailureError(error: unknown): ToolErrorCategory {
  // Inspect only fixed scalar data properties. Getters/proxies cannot replace a
  // handler result/throw. Provider detail, causes, names and prose are not read.
  try {
    if (typeof error !== 'object' || error === null) return 'unknown'
    const context = error instanceof VaultCliError ? ownDataProperty(error, 'context') : null
    const codeCategory = classifyToolFailureCode(
      ownDataProperty(error, 'code'), ownDataProperty(context, 'stage'),
    )
    if (codeCategory !== 'unknown') return codeCategory
    if (ownDataProperty(context, 'timedOut') === true) return 'timeout'
    return classifyToolFailureStatus(
      ownDataProperty(error, 'status') ?? ownDataProperty(error, 'statusCode')
      ?? ownDataProperty(context, 'status'),
    )
  } catch {
    return 'unknown'
  }
}

function ownDataProperty(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined
}

export function toolFailureDiagnostic(
  failureReason: ToolFailureReason,
  error?: unknown,
): ToolFailureDiagnostic {
  return {
    failureStage: FAILURE_STAGES[failureReason],
    failureReason,
    ...(failureReason === 'handler_exception' || error !== undefined
      ? { errorCategory: classifyToolFailureError(error) } : {}),
  }
}

export function toolTextResult(
  success: boolean,
  text: string,
  failureReason: ToolFailureReason = 'unknown',
  error?: unknown,
): MurphDynamicToolExecutionResult {
  return {
    rpcResult: { success, contentItems: [{ type: 'inputText', text }] },
    ...(!success ? { failureDiagnostic: toolFailureDiagnostic(failureReason, error) } : {}),
  }
}

/** One returned-failure boundary, including handlers without annotations. */
export function completeDynamicToolFailureDiagnostics(
  request: MurphDynamicToolRequest,
  result: MurphDynamicToolExecutionResult,
): MurphDynamicToolExecutionResult {
  if (result.rpcResult.success) return result
  const diagnostic = result.failureDiagnostic ?? toolFailureDiagnostic('unknown')
  const classified = { ...result, failureDiagnostic: diagnostic }
  // assistant-codex owns these intake issues and outer thrown exceptions. Do not
  // create another branch row for them; do not catch or replace handler throws.
  if ('validationDigest' in request || request.kind === 'unsupported-dynamic-tool') return classified
  const issues = result.runtimeIssueInputs ?? []
  const details = { ...diagnostic, diagnosticRole: 'classification' }
  if (issues.length > 0) {
    return {
      ...classified,
      runtimeIssueInputs: issues.map((issue) => ({
        ...issue, details: { ...issue.details, ...details },
      })),
    }
  }
  return {
    ...classified,
    runtimeIssueInputs: [createDynamicToolFailureIssue(request, diagnostic)],
  }
}

/** Shared failure row for returned results and caller-owned admission refusals. */
export function createDynamicToolFailureIssue(
  request: MurphDynamicToolRequest,
  diagnostic: ToolFailureDiagnostic,
): AssistantRuntimeIssueInput {
  return {
    component: 'assistant.codex-dynamic-tool',
    operation: request.kind,
    phase: 'tool_call',
    issueKind: 'tool_error',
    severity: 'warning',
    errorCode: 'ASSISTANT_DYNAMIC_TOOL_FAILED',
    summary: 'Murph dynamic tool execution failed.',
    details: { requestKind: request.kind, ...diagnostic, diagnosticRole: 'classification' },
  }
}

/** Propagate private metadata through media adapters without changing successes. */
export function toolFailureMetadata(result: { failureDiagnostic?: ToolFailureDiagnostic }): {
  failureDiagnostic?: ToolFailureDiagnostic
} {
  return result.failureDiagnostic ? { failureDiagnostic: result.failureDiagnostic } : {}
}

export function createDynamicToolRuntimeIssueInput(input: {
  request: MurphDynamicToolRequest
  reason: 'execution_failed' | 'invalid_arguments' | 'unsupported'
  error?: unknown
}): AssistantRuntimeIssueInput {
  if (input.reason === 'unsupported') {
    return {
      component: 'assistant.codex-dynamic-tool',
      operation: 'unsupported-dynamic-tool',
      phase: 'tool_call',
      issueKind: 'schema_rejection',
      severity: 'warning',
      errorCode: 'ASSISTANT_DYNAMIC_TOOL_UNSUPPORTED',
      summary: 'Codex requested an unsupported Murph dynamic tool.',
      details: {
        requestKind: 'unsupported-dynamic-tool',
        ...toolFailureDiagnostic('unsupported_request'),
        diagnosticRole: 'classification',
        namespacePresent:
          input.request.kind === 'unsupported-dynamic-tool'
            ? input.request.namespace !== null
            : false,
        toolPresent:
          input.request.kind === 'unsupported-dynamic-tool'
            ? input.request.tool !== null
            : false,
      },
    }
  }

  if (input.reason === 'invalid_arguments' && 'validationDigest' in input.request) {
    const validationDigest = input.request.validationDigest
    return {
      component: 'assistant.tool-validation',
      operation: validationDigest.toolName ?? input.request.kind,
      phase: 'tool_call',
      issueKind: 'schema_rejection',
      severity: 'warning',
      errorCode: 'TOOL_INPUT_SCHEMA_REJECTION',
      summary: 'Tool input failed schema validation.',
      details: {
        ...validationDigest,
        ...toolFailureDiagnostic('invalid_input'),
        diagnosticRole: 'classification',
      },
    }
  }

  return createDynamicToolFailureIssue(
    input.request,
    toolFailureDiagnostic('handler_exception', input.error),
  )
}
