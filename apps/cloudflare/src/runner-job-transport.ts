import type {
  HostedAssistantWorkspaceRuntimeJobInput,
  HostedAssistantWorkspaceRuntimeJobResult,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";
import {
  parseHostedAssistantWorkspaceRuntimeJobInput,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";
import {
  parseHostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/parsers";

export const HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND = "workspace-invocation";

export interface HostedExecutionWorkspaceInvocationJobInput
  extends HostedAssistantWorkspaceRuntimeJobInput {
  kind: typeof HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND;
}

export type HostedExecutionRunnerJobInput = HostedExecutionWorkspaceInvocationJobInput;

export type HostedExecutionRunnerJobResult = HostedAssistantWorkspaceRuntimeJobResult;

export interface HostedExecutionRunnerJobParsers {
  parseWorkspaceJobInput(value: unknown): HostedAssistantWorkspaceRuntimeJobInput;
}

export type HostedExecutionRunnerChildResult =
  | {
      error?: never;
      ok: true;
      result: HostedExecutionRunnerJobResult;
    }
  | {
      error: {
        code?: string | null;
        details?: Record<string, unknown> | null;
        message: string;
        name?: string | null;
        stack?: string | null;
      };
      ok: false;
      result?: never;
    };

export const HOSTED_EXECUTION_RUNNER_CHILD_RESULT_MESSAGE_TYPE =
  "murph.hosted-execution.runner-child-result.v1";

export interface HostedExecutionRunnerChildResultMessage {
  result: HostedExecutionRunnerChildResult;
  type: typeof HOSTED_EXECUTION_RUNNER_CHILD_RESULT_MESSAGE_TYPE;
}

export function parseHostedExecutionRunnerJobInput(
  value: unknown,
  parsers: HostedExecutionRunnerJobParsers = {
    parseWorkspaceJobInput: parseHostedAssistantWorkspaceRuntimeJobInput,
  },
): HostedExecutionRunnerJobInput {
  const record = requireRecord(value, "Hosted execution runner job input");
  const kind = requireHostedExecutionWorkspaceJobKind(record.kind);

  return {
    ...parsers.parseWorkspaceJobInput(record),
    kind,
  };
}

export function isHostedExecutionWorkspaceInvocationJob(
  job: HostedExecutionRunnerJobInput,
): job is HostedExecutionWorkspaceInvocationJobInput {
  return job.kind === HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND;
}

export function readHostedExecutionRunnerJobUserId(
  job: HostedExecutionRunnerJobInput,
): string {
  return job.request.userId;
}

export function assertHostedExecutionRunnerJobResult(
  value: unknown,
  _job: HostedExecutionRunnerJobInput,
): HostedExecutionRunnerJobResult {
  return parseHostedWorkspaceInvocationResult(value);
}

export function createHostedExecutionRunnerChildResultMessage(
  payload: HostedExecutionRunnerChildResult,
): HostedExecutionRunnerChildResultMessage {
  return {
    result: payload,
    type: HOSTED_EXECUTION_RUNNER_CHILD_RESULT_MESSAGE_TYPE,
  };
}

export function parseHostedExecutionRunnerChildResultMessage(
  value: unknown,
): HostedExecutionRunnerChildResult {
  const record = requireRecord(value, "Hosted execution runner child IPC message");
  if (record.type !== HOSTED_EXECUTION_RUNNER_CHILD_RESULT_MESSAGE_TYPE) {
    throw new TypeError(
      `Hosted execution runner child IPC message.type must be ${HOSTED_EXECUTION_RUNNER_CHILD_RESULT_MESSAGE_TYPE}.`,
    );
  }

  return parseHostedExecutionRunnerChildResultPayload(record.result);
}

function requireHostedExecutionWorkspaceJobKind(
  value: unknown,
): typeof HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND {
  if (value === HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND) {
    return HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND;
  }

  throw new TypeError("Hosted execution runner job input.kind must be workspace-invocation.");
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function parseHostedExecutionRunnerChildResultPayload(
  value: unknown,
): HostedExecutionRunnerChildResult {
  const record = requireRecord(value, "Hosted execution runner child result");
  if (typeof record.ok !== "boolean") {
    throw new TypeError("Hosted execution runner child result.ok must be a boolean.");
  }

  if (record.ok) {
    return {
      ok: true,
      result: record.result as HostedExecutionRunnerJobResult,
    };
  }

  return {
    ok: false,
    error: parseHostedExecutionRunnerChildError(record.error),
  };
}

function parseHostedExecutionRunnerChildError(
  value: unknown,
): Extract<HostedExecutionRunnerChildResult, { ok: false }>["error"] {
  const record = requireRecord(value, "Hosted execution runner child error");
  if (typeof record.message !== "string" || record.message.length === 0) {
    throw new TypeError("Hosted execution runner child error.message must be a non-empty string.");
  }

  return {
    ...(record.code === undefined ? {} : { code: requireOptionalString(record.code, "code") }),
    ...(record.details === undefined
      ? {}
      : { details: requireOptionalRecord(record.details, "details") }),
    message: record.message,
    ...(record.name === undefined ? {} : { name: requireOptionalString(record.name, "name") }),
    ...(record.stack === undefined ? {} : { stack: requireOptionalString(record.stack, "stack") }),
  };
}

function requireOptionalRecord(value: unknown, field: string): Record<string, unknown> | null {
  if (value === null) {
    return null;
  }

  return requireRecord(value, `Hosted execution runner child error.${field}`);
}

function requireOptionalString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`Hosted execution runner child error.${field} must be a string or null.`);
  }

  return value;
}
