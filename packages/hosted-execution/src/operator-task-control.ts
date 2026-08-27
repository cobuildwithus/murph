export const HOSTED_OPERATOR_TASK_CONTROL_ACTIONS = [
  "authorize",
  "complete",
  "fail",
] as const;

export type HostedOperatorTaskControlAction =
  (typeof HOSTED_OPERATOR_TASK_CONTROL_ACTIONS)[number];

export interface HostedOperatorTaskControlRequest {
  action: HostedOperatorTaskControlAction;
  expiresAt: string;
  requestId: string;
  taskId: string;
}

export type HostedOperatorTaskControlStatus =
  | "already_completed"
  | "authorized"
  | "completed"
  | "expired"
  | "failed";

export interface HostedOperatorTaskControlResponse {
  status: HostedOperatorTaskControlStatus;
}

export function parseHostedOperatorTaskControlRequest(
  value: unknown,
): HostedOperatorTaskControlRequest {
  const record = requireExactRecord(value, [
    "action",
    "expiresAt",
    "requestId",
    "taskId",
  ]);
  const action = requireString(record.action, "action");
  if (!HOSTED_OPERATOR_TASK_CONTROL_ACTIONS.includes(
    action as HostedOperatorTaskControlAction,
  )) {
    throw new TypeError("Hosted operator task control action is invalid.");
  }
  const expiresAt = requireCanonicalTimestamp(record.expiresAt, "expiresAt");
  return {
    action: action as HostedOperatorTaskControlAction,
    expiresAt,
    requestId: requireString(record.requestId, "requestId"),
    taskId: requireString(record.taskId, "taskId"),
  };
}

export function parseHostedOperatorTaskControlResponse(
  value: unknown,
): HostedOperatorTaskControlResponse {
  const record = requireExactRecord(value, ["status"]);
  const status = requireString(record.status, "status");
  if (
    status !== "already_completed"
    && status !== "authorized"
    && status !== "completed"
    && status !== "expired"
    && status !== "failed"
  ) {
    throw new TypeError("Hosted operator task control status is invalid.");
  }
  return { status };
}

function requireExactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted operator task control payload must be an object.");
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError("Hosted operator task control payload shape is invalid.");
  }
  return record;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError(`Hosted operator task control ${label} is invalid.`);
  }
  return value;
}

function requireCanonicalTimestamp(value: unknown, label: string): string {
  const timestamp = requireString(value, label);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new TypeError(`Hosted operator task control ${label} is invalid.`);
  }
  return timestamp;
}
