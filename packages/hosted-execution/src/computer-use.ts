import * as z from "@murphai/contracts/zod-runtime";

import {
  HOSTED_RETURN_CONTACT_KINDS,
  type HostedReturnContactKind,
} from "./return-contact.ts";

export const HOSTED_COMPUTER_RUNS_PATH = "/api/internal/computer/runs";
export const HOSTED_COMPUTER_RUN_OPERATION_PATH_PATTERN =
  /^\/api\/internal\/computer\/runs\/(?<runId>[^/]+)\/(?<operation>act|os-control|pause-for-user|finish)$/u;

export const HOSTED_COMPUTER_ACT_TIMEOUT_MAX_MS = 25_000;
export const HOSTED_COMPUTER_ACT_CODE_MAX_LENGTH = 12_000;
export const HOSTED_COMPUTER_OS_CONTROL_TEXT_MAX_LENGTH = 500;
export const HOSTED_COMPUTER_OS_CONTROL_COORDINATE_MAX = 10_000;

export const HOSTED_COMPUTER_RUN_STATUSES = [
  "running",
  "awaiting_user",
  "cleanup_pending",
  "completed",
  "failed",
  "expired",
  "canceled",
] as const;
export type HostedComputerRunStatus = (typeof HOSTED_COMPUTER_RUN_STATUSES)[number];

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
  "managed_login",
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
  "checkpointing",
  "completed",
  "expired",
] as const;
export type HostedComputerHandoffStatus =
  (typeof HOSTED_COMPUTER_HANDOFF_STATUSES)[number];

export const HOSTED_COMPUTER_RETURN_CONTACT_KINDS = HOSTED_RETURN_CONTACT_KINDS;

export type HostedComputerReturnContactKind =
  HostedReturnContactKind;

export const HOSTED_COMPUTER_OS_CONTROL_ACTIONS = [
  "clickMouse",
  "moveMouse",
  "typeText",
  "pressKey",
  "scroll",
  "dragMouse",
] as const;
export type HostedComputerOsControlAction =
  (typeof HOSTED_COMPUTER_OS_CONTROL_ACTIONS)[number];

export const HOSTED_COMPUTER_OS_CONTROL_HOLD_KEYS = [
  "Alt",
  "Ctrl",
  "Shift",
  "Super",
] as const;
export type HostedComputerOsControlHoldKey =
  (typeof HOSTED_COMPUTER_OS_CONTROL_HOLD_KEYS)[number];

export const HOSTED_COMPUTER_OS_CONTROL_KEYS = [
  "Return",
  "Tab",
  "Shift+Tab",
  "Escape",
  "Up",
  "Down",
  "Left",
  "Right",
  "BackSpace",
  "Delete",
  "Home",
  "End",
  "Page_Up",
  "Page_Down",
  "space",
  "Ctrl+a",
] as const;
export type HostedComputerOsControlKey =
  (typeof HOSTED_COMPUTER_OS_CONTROL_KEYS)[number];

export const HOSTED_COMPUTER_FINISH_OUTCOMES = [
  "completed",
  "failed",
  "canceled",
] as const;
export type HostedComputerFinishOutcome =
  (typeof HOSTED_COMPUTER_FINISH_OUTCOMES)[number];

const hostedComputerStartUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_000);

export const hostedComputerDeliveryContextSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(1_000).nullable().default(null),
    recipientKey: z.string().trim().min(1).max(1_000).nullable().default(null),
    returnContactKind:
      z.enum(HOSTED_COMPUTER_RETURN_CONTACT_KINDS).nullable().default(null),
  })
  .strict();

export const hostedComputerOpenRunRequestSchema = z
  .object({
    goal: z.string().trim().min(1).max(2_000).optional(),
    runId: z.string().trim().min(1).max(200).nullable().default(null),
    resumeAfterMailboxItemId: z.string().trim().min(1).max(200).nullable().default(null),
    resumeDeliveryContext: hostedComputerDeliveryContextSchema.nullable().default(null),
    startUrl: hostedComputerStartUrlSchema.nullable().default(null),
  })
  .strict()
  .transform(({ goal: _goal, ...request }) => request);

const hostedComputerActTimeoutSchema = z
  .number()
  .int()
  .min(1_000)
  .max(HOSTED_COMPUTER_ACT_TIMEOUT_MAX_MS)
  .default(15_000);

const hostedComputerControlTextSchema = z.string().trim().min(1).max(2_000);
const safeSelectorFragment = String.raw`(?:#[A-Za-z_][A-Za-z0-9_-]*|\.[A-Za-z_][A-Za-z0-9_-]*|\[(?:id|name|data-[A-Za-z0-9_-]+|aria-label|role|type)(?:=(?:"[^"\\\r\n]{1,160}"|'[^'\\\r\n]{1,160}'|[A-Za-z_][A-Za-z0-9_-]*))?\])`;
const safeSelectorPattern = new RegExp(
  String.raw`^(?:(?:\*|[A-Za-z][A-Za-z0-9-]*)(?:${safeSelectorFragment})*|(?:${safeSelectorFragment})+)$`,
  "u",
);

export const hostedComputerSafeSelectorSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(safeSelectorPattern);

export const hostedComputerControlTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    exact: z.boolean().default(true),
    kind: z.literal("label"),
    value: hostedComputerControlTextSchema,
  }).strict(),
  z.object({
    exact: z.boolean().default(true),
    kind: z.literal("role"),
    name: hostedComputerControlTextSchema.nullable().default(null),
    role: z.string().trim().min(1).max(80),
  }).strict(),
  z.object({
    kind: z.literal("selector"),
    value: hostedComputerSafeSelectorSchema,
  }).strict(),
  z.object({
    exact: z.boolean().default(true),
    kind: z.literal("text"),
    value: hostedComputerControlTextSchema,
  }).strict(),
]);

const hostedComputerControlActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("goto"),
    url: hostedComputerStartUrlSchema,
  }).strict(),
  z.object({
    action: z.literal("click"),
    target: hostedComputerControlTargetSchema,
  }).strict(),
  z.object({
    action: z.literal("fill"),
    target: hostedComputerControlTargetSchema,
    value: z.string().max(2_000),
  }).strict().refine(
    (step) => !/^Murph Private Sync [a-f0-9]{12}$/u.test(step.value.trim()),
    { message: "Provider ownership markers are reserved for trusted capture." },
  ),
  z.object({
    action: z.literal("select"),
    option: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("label"), value: hostedComputerControlTextSchema }).strict(),
      z.object({ kind: z.literal("value"), value: hostedComputerControlTextSchema }).strict(),
    ]),
    target: hostedComputerControlTargetSchema,
  }).strict(),
  z.object({
    action: z.literal("set_checked"),
    checked: z.boolean(),
    target: hostedComputerControlTargetSchema,
  }).strict(),
  z.object({
    action: z.literal("wait"),
    state: z.enum(["visible", "hidden"]).default("visible"),
    target: hostedComputerControlTargetSchema,
  }).strict(),
]);

const hostedComputerScriptActRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(HOSTED_COMPUTER_ACT_CODE_MAX_LENGTH),
  timeoutMs: hostedComputerActTimeoutSchema,
}).strict();

export const hostedComputerControlActRequestSchema = z.object({
  steps: z.array(hostedComputerControlActionSchema).min(1).max(12),
  timeoutMs: hostedComputerActTimeoutSchema,
}).strict();

export const hostedComputerActRequestSchema = z.union([
  hostedComputerScriptActRequestSchema,
  hostedComputerControlActRequestSchema,
]);

const hostedComputerOsControlCoordinateSchema = z
  .number()
  .int()
  .min(0)
  .max(HOSTED_COMPUTER_OS_CONTROL_COORDINATE_MAX);

const hostedComputerOsControlHoldKeysSchema = z
  .array(z.enum(HOSTED_COMPUTER_OS_CONTROL_HOLD_KEYS))
  .max(HOSTED_COMPUTER_OS_CONTROL_HOLD_KEYS.length)
  .default([]);

const hostedComputerOsControlMouseButtonSchema = z
  .enum(["left", "middle", "right"])
  .default("left");

const hostedComputerOsControlDurationSchema = z
  .number()
  .int()
  .min(0)
  .max(5_000);

const hostedComputerOsControlDelaySchema = z
  .number()
  .int()
  .min(0)
  .max(1_000);

const hostedComputerOsControlPointSchema = z.tuple([
  hostedComputerOsControlCoordinateSchema,
  hostedComputerOsControlCoordinateSchema,
]);

export const hostedComputerOsControlRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("clickMouse"),
      button: hostedComputerOsControlMouseButtonSchema,
      clickType: z.enum(["down", "up", "click"]).default("click"),
      holdKeys: hostedComputerOsControlHoldKeysSchema,
      numClicks: z.number().int().min(1).max(3).default(1),
      x: hostedComputerOsControlCoordinateSchema,
      y: hostedComputerOsControlCoordinateSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("moveMouse"),
      durationMs: hostedComputerOsControlDurationSchema.default(0),
      holdKeys: hostedComputerOsControlHoldKeysSchema,
      smooth: z.boolean().default(true),
      x: hostedComputerOsControlCoordinateSchema,
      y: hostedComputerOsControlCoordinateSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("typeText"),
      text: z.string().min(1).max(HOSTED_COMPUTER_OS_CONTROL_TEXT_MAX_LENGTH),
    })
    .strict(),
  z
    .object({
      action: z.literal("pressKey"),
      durationMs: hostedComputerOsControlDurationSchema.default(0),
      keys: z.array(z.enum(HOSTED_COMPUTER_OS_CONTROL_KEYS)).min(1).max(3),
    })
    .strict(),
  z
    .object({
      action: z.literal("scroll"),
      deltaX: z.number().int().min(-5_000).max(5_000).default(0),
      deltaY: z.number().int().min(-5_000).max(5_000).default(800),
      holdKeys: hostedComputerOsControlHoldKeysSchema,
      x: hostedComputerOsControlCoordinateSchema,
      y: hostedComputerOsControlCoordinateSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("dragMouse"),
      button: hostedComputerOsControlMouseButtonSchema,
      delayMs: hostedComputerOsControlDelaySchema.default(0),
      durationMs: z.number().int().min(0).max(10_000).default(0),
      holdKeys: hostedComputerOsControlHoldKeysSchema,
      path: z.array(hostedComputerOsControlPointSchema).min(2).max(10),
      smooth: z.boolean().default(true),
      stepDelayMs: z.number().int().min(0).max(250).default(50),
      stepsPerSegment: z.number().int().min(1).max(50).default(10),
    })
    .strict(),
]);

export const hostedComputerPauseForUserRequestSchema = z
  .object({
    handoffPurpose: z.enum(HOSTED_COMPUTER_HANDOFF_PURPOSES).nullable().default(null),
    message: z.string().trim().min(1).max(1_000).optional(),
    pauseDeliveryContext: hostedComputerDeliveryContextSchema.nullable().default(null),
    reason: z.enum(HOSTED_COMPUTER_AWAITING_REASONS),
    suggestedReply: z.string().trim().min(1).max(200).nullable().default(null),
  })
  .strict()
  .transform(({ message: _legacyMessage, ...request }) => request);

export const hostedComputerFinishRunRequestSchema = z
  .object({
    outcome: z.enum(HOSTED_COMPUTER_FINISH_OUTCOMES),
    summary: z.string().trim().max(2_000).nullable().optional(),
  })
  .strict()
  .transform(({ summary: _summary, ...request }) => request);

export type HostedComputerOpenRunRequest =
  z.infer<typeof hostedComputerOpenRunRequestSchema>;
export type HostedComputerActRequest =
  z.infer<typeof hostedComputerActRequestSchema>;
export type HostedComputerControlActRequest =
  z.infer<typeof hostedComputerControlActRequestSchema>;
export type HostedComputerControlTarget =
  z.infer<typeof hostedComputerControlTargetSchema>;
export type HostedComputerOsControlRequest =
  z.infer<typeof hostedComputerOsControlRequestSchema>;
export type HostedComputerDeliveryContext =
  z.infer<typeof hostedComputerDeliveryContextSchema>;
export type HostedComputerPauseForUserRequest =
  z.infer<typeof hostedComputerPauseForUserRequestSchema>;
export type HostedComputerFinishRunRequest =
  z.infer<typeof hostedComputerFinishRunRequestSchema>;

export type HostedComputerRunOperation =
  | "act"
  | "os-control"
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

export function parseHostedComputerOpenRunRequest(
  value: unknown,
): HostedComputerOpenRunRequest {
  return parseHostedComputerRequest(
    hostedComputerOpenRunRequestSchema,
    value,
    "Hosted computer open-run request",
  );
}

export function parseHostedComputerActRequest(value: unknown): HostedComputerActRequest {
  return parseHostedComputerRequest(
    hostedComputerActRequestSchema,
    value,
    "Hosted computer act request",
  );
}

export function parseHostedComputerOsControlRequest(
  value: unknown,
): HostedComputerOsControlRequest {
  return parseHostedComputerRequest(
    hostedComputerOsControlRequestSchema,
    value,
    "Hosted computer OS control request",
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
    case "act":
    case "os-control":
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
