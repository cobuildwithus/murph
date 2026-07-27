import { z } from "zod";

import {
  HOSTED_RETURN_CONTACT_KINDS,
  type HostedReturnContactKind,
} from "./return-contact.ts";

export const HOSTED_COMPUTER_RUNS_PATH = "/api/internal/computer/runs";
export const HOSTED_COMPUTER_RUN_OPERATION_PATH_PATTERN =
  /^\/api\/internal\/computer\/runs\/(?<runId>[^/]+)\/(?<operation>act|os-control|pause-for-user|finish)$/u;

export const HOSTED_COMPUTER_ACT_TIMEOUT_MAX_MS = 25_000;
export const HOSTED_COMPUTER_ACT_LOCATOR_TEXT_MAX_LENGTH = 1_000;
export const HOSTED_COMPUTER_ACT_INPUT_TEXT_MAX_LENGTH = 4_000;
export const HOSTED_COMPUTER_ACT_WAIT_MAX_MS = 5_000;
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

export const hostedComputerNavigationUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_000)
  .refine(isHostedComputerNavigationUrl, {
    message: "Computer navigation URL must use http, https, or about:blank.",
  });

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
    resumeAfterMailboxItemId: z.string().trim().min(1).max(200).nullable().default(null),
    resumeDeliveryContext: hostedComputerDeliveryContextSchema.nullable().default(null),
    startUrl: hostedComputerNavigationUrlSchema.nullable().default(null),
  })
  .strict()
  .transform(({ goal: _goal, ...request }) => request);

const hostedComputerActTimeoutSchema = z
  .number()
  .int()
  .min(1_000)
  .max(HOSTED_COMPUTER_ACT_TIMEOUT_MAX_MS)
  .default(15_000);

const hostedComputerActLocatorTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(HOSTED_COMPUTER_ACT_LOCATOR_TEXT_MAX_LENGTH);

const hostedComputerActOptionValueSchema = z
  .string()
  .max(HOSTED_COMPUTER_ACT_LOCATOR_TEXT_MAX_LENGTH);

const hostedComputerActLocatorPickSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("only") }).strict(),
  z.object({ kind: z.literal("first") }).strict(),
  z.object({ kind: z.literal("last") }).strict(),
  z
    .object({
      index: z.number().int().min(0).max(100),
      kind: z.literal("nth"),
    })
    .strict(),
]).default({ kind: "only" });

const hostedComputerActTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      exact: z.boolean().default(true),
      kind: z.literal("role"),
      name: hostedComputerActLocatorTextSchema.nullable().default(null),
      pick: hostedComputerActLocatorPickSchema,
      role: z.string().trim().min(1).max(100),
    })
    .strict(),
  z
    .object({
      exact: z.boolean().default(true),
      kind: z.literal("label"),
      label: hostedComputerActLocatorTextSchema,
      pick: hostedComputerActLocatorPickSchema,
    })
    .strict(),
  z
    .object({
      exact: z.boolean().default(true),
      kind: z.literal("text"),
      pick: hostedComputerActLocatorPickSchema,
      text: hostedComputerActLocatorTextSchema,
    })
    .strict(),
  z
    .object({
      exact: z.boolean().default(true),
      kind: z.literal("placeholder"),
      pick: hostedComputerActLocatorPickSchema,
      placeholder: hostedComputerActLocatorTextSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("testId"),
      pick: hostedComputerActLocatorPickSchema,
      testId: hostedComputerActLocatorTextSchema,
    })
    .strict(),
]);

export const HOSTED_COMPUTER_ACT_ACTIONS = [
  "navigate",
  "inspect",
  "click",
  "fill",
  "selectOption",
  "setChecked",
  "press",
  "waitFor",
  "wait",
] as const;
export type HostedComputerActAction =
  (typeof HOSTED_COMPUTER_ACT_ACTIONS)[number];

export const HOSTED_COMPUTER_ACT_KEYS = [
  "Enter",
  "Tab",
  "Shift+Tab",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Backspace",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Space",
] as const;
export type HostedComputerActKey = (typeof HOSTED_COMPUTER_ACT_KEYS)[number];

const hostedComputerActBaseShape = {
  timeoutMs: hostedComputerActTimeoutSchema,
};

export const hostedComputerActRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("navigate"),
      ...hostedComputerActBaseShape,
      url: hostedComputerNavigationUrlSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("inspect"),
      target: hostedComputerActTargetSchema,
      ...hostedComputerActBaseShape,
    })
    .strict(),
  z
    .object({
      action: z.literal("click"),
      target: hostedComputerActTargetSchema,
      ...hostedComputerActBaseShape,
    })
    .strict(),
  z
    .object({
      action: z.literal("fill"),
      target: hostedComputerActTargetSchema,
      text: z.string().max(HOSTED_COMPUTER_ACT_INPUT_TEXT_MAX_LENGTH),
      ...hostedComputerActBaseShape,
    })
    .strict(),
  z
    .object({
      action: z.literal("selectOption"),
      target: hostedComputerActTargetSchema,
      values: z
        .array(hostedComputerActOptionValueSchema)
        .min(1)
        .max(10),
      ...hostedComputerActBaseShape,
    })
    .strict(),
  z
    .object({
      action: z.literal("setChecked"),
      checked: z.boolean(),
      target: hostedComputerActTargetSchema,
      ...hostedComputerActBaseShape,
    })
    .strict(),
  z
    .object({
      action: z.literal("press"),
      key: z.enum(HOSTED_COMPUTER_ACT_KEYS),
      target: hostedComputerActTargetSchema,
      ...hostedComputerActBaseShape,
    })
    .strict(),
  z
    .object({
      action: z.literal("waitFor"),
      state: z.enum(["attached", "detached", "visible", "hidden"]),
      target: hostedComputerActTargetSchema,
      ...hostedComputerActBaseShape,
    })
    .strict(),
  z
    .object({
      action: z.literal("wait"),
      durationMs: z.number().int().min(50).max(HOSTED_COMPUTER_ACT_WAIT_MAX_MS),
      ...hostedComputerActBaseShape,
    })
    .strict(),
]);

function isHostedComputerNavigationUrl(value: string): boolean {
  if (value === "about:blank") {
    return true;
  }
  if (!/^https?:\/\//iu.test(value)) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname.length > 0
    );
  } catch {
    return false;
  }
}

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
