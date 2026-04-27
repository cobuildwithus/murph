import type {
  HostedAssistantWorkspaceRuntimeJobInput,
  HostedAssistantWorkspaceRuntimeJobResult,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedAssistantWorkspaceRuntimeJobInput,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedWorkspaceRunResult,
} from "@murphai/hosted-execution";

export const HOSTED_EXECUTION_WORKSPACE_RUN_JOB_KIND = "workspace-run";

const HOSTED_RUNTIME_CHILD_RESULT_PREFIX = "__HB_ASSISTANT_RUNTIME_RESULT__";

export interface HostedExecutionWorkspaceRunJobInput
  extends HostedAssistantWorkspaceRuntimeJobInput {
  kind: typeof HOSTED_EXECUTION_WORKSPACE_RUN_JOB_KIND;
}

export type HostedExecutionRunnerJobInput = HostedExecutionWorkspaceRunJobInput;

export type HostedExecutionRunnerJobResult = HostedAssistantWorkspaceRuntimeJobResult;

export interface HostedExecutionRunnerJobParsers {
  parseWorkspaceJobInput(value: unknown): HostedAssistantWorkspaceRuntimeJobInput;
}

export interface HostedExecutionRunnerChildResult {
  ok: boolean;
  error?: {
    code?: string | null;
    details?: Record<string, unknown> | null;
    message: string;
    name?: string | null;
    stack?: string | null;
  };
  result?: HostedExecutionRunnerJobResult;
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

export function isHostedExecutionWorkspaceRunJob(
  job: HostedExecutionRunnerJobInput,
): job is HostedExecutionWorkspaceRunJobInput {
  return job.kind === HOSTED_EXECUTION_WORKSPACE_RUN_JOB_KIND;
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
  return parseHostedWorkspaceRunResult(value);
}

export function formatHostedExecutionRunnerChildResult(
  payload: HostedExecutionRunnerChildResult,
): string {
  return `${HOSTED_RUNTIME_CHILD_RESULT_PREFIX}${Buffer.from(
    JSON.stringify(payload),
    "utf8",
  ).toString("base64")}`;
}

export function parseHostedExecutionRunnerChildResult(
  output: string,
): HostedExecutionRunnerChildResult {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const encoded = [...lines]
    .reverse()
    .find((line) => line.startsWith(HOSTED_RUNTIME_CHILD_RESULT_PREFIX));

  if (!encoded) {
    throw new Error("Hosted assistant runtime child did not emit a result payload.");
  }

  return JSON.parse(
    Buffer.from(
      encoded.slice(HOSTED_RUNTIME_CHILD_RESULT_PREFIX.length),
      "base64",
    ).toString("utf8"),
  ) as HostedExecutionRunnerChildResult;
}

function requireHostedExecutionWorkspaceJobKind(
  value: unknown,
): typeof HOSTED_EXECUTION_WORKSPACE_RUN_JOB_KIND {
  if (value === HOSTED_EXECUTION_WORKSPACE_RUN_JOB_KIND) {
    return HOSTED_EXECUTION_WORKSPACE_RUN_JOB_KIND;
  }

  throw new TypeError("Hosted execution runner job input.kind must be workspace-run.");
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}
