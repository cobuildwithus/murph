import { z } from "zod";

export const HOSTED_COMPUTER_RUNS_PATH = "/api/internal/computer/runs";
export const HOSTED_COMPUTER_RUN_OPERATION_PATH_PATTERN =
  /^\/api\/internal\/computer\/runs\/(?<runId>[^/]+)\/(?<operation>observe|act|eval|pause-for-user|finish)$/u;

export const HOSTED_COMPUTER_RUN_STATUSES = [
  "running",
  "awaiting_user",
  "completed",
  "failed",
  "expired",
  "canceled",
] as const;
export type HostedComputerRunStatus = (typeof HOSTED_COMPUTER_RUN_STATUSES)[number];

export const HOSTED_COMPUTER_TASK_KINDS = [
  "purchase",
  "appointment",
  "auth",
  "generic",
] as const;
export type HostedComputerTaskKind = (typeof HOSTED_COMPUTER_TASK_KINDS)[number];

export const HOSTED_COMPUTER_PROFILE_KEYS = [
  "commerce",
  "appointments",
  "default",
] as const;
export type HostedComputerProfileKey = (typeof HOSTED_COMPUTER_PROFILE_KEYS)[number];

export const HOSTED_COMPUTER_AWAITING_REASONS = [
  "login_needed",
  "payment_needed",
  "final_confirmation",
  "stuck",
  "other",
] as const;
export type HostedComputerAwaitingReason =
  (typeof HOSTED_COMPUTER_AWAITING_REASONS)[number];

export const HOSTED_COMPUTER_HANDOFF_PURPOSES = [
  "login",
  "payment",
  "card",
  "captcha",
  "manual_browser_help",
] as const;
export type HostedComputerHandoffPurpose =
  (typeof HOSTED_COMPUTER_HANDOFF_PURPOSES)[number];

export const HOSTED_COMPUTER_HANDOFF_STATUSES = [
  "open",
  "completed",
  "expired",
  "revoked",
] as const;
export type HostedComputerHandoffStatus =
  (typeof HOSTED_COMPUTER_HANDOFF_STATUSES)[number];

export const HOSTED_COMPUTER_ACT_ACTIONS = [
  "goto",
  "click",
  "fill",
  "press",
  "select",
  "check",
  "uncheck",
] as const;
export type HostedComputerActAction = (typeof HOSTED_COMPUTER_ACT_ACTIONS)[number];

export const HOSTED_COMPUTER_FINISH_OUTCOMES = [
  "completed",
  "failed",
  "canceled",
] as const;
export type HostedComputerFinishOutcome =
  (typeof HOSTED_COMPUTER_FINISH_OUTCOMES)[number];

export const hostedComputerStartRunRequestSchema = z
  .object({
    goal: z.string().trim().min(1).max(2_000),
    profileKey: z.enum(HOSTED_COMPUTER_PROFILE_KEYS).default("default"),
    startUrl: z.string().url().nullable().default(null),
    taskKind: z.enum(HOSTED_COMPUTER_TASK_KINDS).default("generic"),
  })
  .strict();

export const hostedComputerObserveRequestSchema = z.object({}).strict();

export const hostedComputerActRequestSchema = z
  .object({
    action: z.enum(HOSTED_COMPUTER_ACT_ACTIONS),
    selector: z.string().trim().min(1).max(1_000).nullable().default(null),
    timeoutMs: z.number().int().min(1_000).max(60_000).default(30_000),
    url: z.string().url().nullable().default(null),
    value: z.string().max(4_000).nullable().default(null),
  })
  .strict();

export const hostedComputerEvalRequestSchema = z
  .object({
    code: z.string().trim().min(1).max(20_000),
    timeoutMs: z.number().int().min(1_000).max(60_000).default(30_000),
  })
  .strict();

export const hostedComputerPauseForUserRequestSchema = z
  .object({
    handoffPurpose: z.enum(HOSTED_COMPUTER_HANDOFF_PURPOSES).nullable().default(null),
    message: z.string().trim().min(1).max(1_000),
    reason: z.enum(HOSTED_COMPUTER_AWAITING_REASONS),
    suggestedReply: z.string().trim().min(1).max(200).nullable().default(null),
  })
  .strict();

export const hostedComputerFinishRunRequestSchema = z
  .object({
    outcome: z.enum(HOSTED_COMPUTER_FINISH_OUTCOMES),
    summary: z.string().trim().max(2_000).nullable().default(null),
  })
  .strict();

export type HostedComputerStartRunRequest =
  z.infer<typeof hostedComputerStartRunRequestSchema>;
export type HostedComputerObserveRequest =
  z.infer<typeof hostedComputerObserveRequestSchema>;
export type HostedComputerActRequest =
  z.infer<typeof hostedComputerActRequestSchema>;
export type HostedComputerEvalRequest =
  z.infer<typeof hostedComputerEvalRequestSchema>;
export type HostedComputerPauseForUserRequest =
  z.infer<typeof hostedComputerPauseForUserRequestSchema>;
export type HostedComputerFinishRunRequest =
  z.infer<typeof hostedComputerFinishRunRequestSchema>;

export type HostedComputerRunOperation =
  | "observe"
  | "act"
  | "eval"
  | "pause-for-user"
  | "finish";

export interface HostedComputerRunOperationRoute {
  operation: HostedComputerRunOperation;
  runId: string;
}

export function buildHostedComputerRunOperationPath(input: {
  operation: HostedComputerRunOperation;
  runId: string;
}): string {
  return `${HOSTED_COMPUTER_RUNS_PATH}/${encodeURIComponent(input.runId)}/${input.operation}`;
}

export function readHostedComputerRunOperationRoute(
  path: string,
): HostedComputerRunOperationRoute | null {
  const match = HOSTED_COMPUTER_RUN_OPERATION_PATH_PATTERN.exec(path);
  const runId = match?.groups?.runId;
  const operation = readHostedComputerRunOperation(match?.groups?.operation);

  if (!runId || !operation) {
    return null;
  }

  return {
    operation,
    runId,
  };
}

export function isHostedComputerWebControlRequest(input: {
  method: string;
  path: string;
}): boolean {
  if (input.method !== "POST") {
    return false;
  }

  return input.path === HOSTED_COMPUTER_RUNS_PATH
    || readHostedComputerRunOperationRoute(input.path) !== null;
}

export function parseHostedComputerStartRunRequest(
  value: unknown,
): HostedComputerStartRunRequest {
  return parseHostedComputerRequest(
    hostedComputerStartRunRequestSchema,
    value,
    "Hosted computer start-run request",
  );
}

export function parseHostedComputerObserveRequest(
  value: unknown,
): HostedComputerObserveRequest {
  return parseHostedComputerRequest(
    hostedComputerObserveRequestSchema,
    value,
    "Hosted computer observe request",
  );
}

export function parseHostedComputerActRequest(value: unknown): HostedComputerActRequest {
  return parseHostedComputerRequest(
    hostedComputerActRequestSchema,
    value,
    "Hosted computer act request",
  );
}

export function parseHostedComputerEvalRequest(
  value: unknown,
): HostedComputerEvalRequest {
  return parseHostedComputerRequest(
    hostedComputerEvalRequestSchema,
    value,
    "Hosted computer eval request",
  );
}

export function parseHostedComputerPauseForUserRequest(
  value: unknown,
): HostedComputerPauseForUserRequest {
  return parseHostedComputerRequest(
    hostedComputerPauseForUserRequestSchema,
    value,
    "Hosted computer pause-for-user request",
  );
}

export function parseHostedComputerFinishRunRequest(
  value: unknown,
): HostedComputerFinishRunRequest {
  return parseHostedComputerRequest(
    hostedComputerFinishRunRequestSchema,
    value,
    "Hosted computer finish-run request",
  );
}

function readHostedComputerRunOperation(
  value: string | undefined,
): HostedComputerRunOperation | null {
  switch (value) {
    case "observe":
    case "act":
    case "eval":
    case "pause-for-user":
    case "finish":
      return value;
    default:
      return null;
  }
}

function parseHostedComputerRequest<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): T {
  const parsed = schema.safeParse(value);

  if (parsed.success) {
    return parsed.data;
  }

  throw new TypeError(`${label} is invalid.`);
}
