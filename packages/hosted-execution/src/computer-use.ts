import { z } from "zod";

export const HOSTED_COMPUTER_RUNS_PATH = "/api/internal/computer/runs";
export const HOSTED_COMPUTER_RUN_OPERATION_PATH_PATTERN =
  /^\/api\/internal\/computer\/runs\/(?<runId>[^/]+)\/(?<operation>observe|act|os-control|pause-for-user|finish)$/u;

export const HOSTED_COMPUTER_ACT_TIMEOUT_MAX_MS = 25_000;
export const HOSTED_COMPUTER_ACT_TEXT_MAX_LENGTH = 2_000;
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

export const HOSTED_COMPUTER_ACT_STEP_ACTIONS = [
  "goto",
  "click",
  "fill",
  "type",
  "select",
  "check",
  "uncheck",
  "press",
  "scroll",
  "wait",
  "waitFor",
] as const;
export type HostedComputerActStepAction =
  (typeof HOSTED_COMPUTER_ACT_STEP_ACTIONS)[number];

export const HOSTED_COMPUTER_LOCATOR_KINDS = [
  "role",
  "label",
  "placeholder",
  "text",
  "altText",
  "title",
  "testId",
] as const;
export type HostedComputerLocatorKind =
  (typeof HOSTED_COMPUTER_LOCATOR_KINDS)[number];

export const HOSTED_COMPUTER_PRESS_KEYS = [
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
  "Control+A",
  "Meta+A",
] as const;
export type HostedComputerPressKey =
  (typeof HOSTED_COMPUTER_PRESS_KEYS)[number];

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

export function isHostedComputerNavigationUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      isHostedComputerPublicNavigationHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function isHostedComputerPublicNavigationHost(value: string): boolean {
  const hostname = normalizeComputerNavigationHostname(value);
  if (!hostname) {
    return false;
  }

  if (isHostedComputerIpLiteral(hostname)) {
    return isHostedComputerPublicIpAddress(hostname);
  }

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return false;
  }

  return hostname.includes(".");
}

export function isHostedComputerIpLiteral(value: string): boolean {
  const hostname = normalizeComputerNavigationHostname(value);
  return Boolean(readComputerNavigationIpv4(hostname)) || hostname.includes(":");
}

export function isHostedComputerPublicIpAddress(value: string): boolean {
  const hostname = normalizeComputerNavigationHostname(value);
  const mappedIpv4 = hostname.match(/(?:::ffff:|:)(\d{1,3}(?:\.\d{1,3}){3})$/iu)?.[1] ?? null;
  const ipv4 = readComputerNavigationIpv4(mappedIpv4 ?? hostname);
  if (ipv4) {
    return isPublicComputerNavigationIpv4(ipv4);
  }

  if (!hostname.includes(":")) {
    return false;
  }

  return isPublicComputerNavigationIpv6(hostname);
}

function normalizeComputerNavigationHostname(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\[/u, "")
    .replace(/\]$/u, "")
    .replace(/\.$/u, "");
}

function readComputerNavigationIpv4(value: string): [number, number, number, number] | null {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets: [number, number, number, number] = [0, 0, 0, 0];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? "";
    if (!/^\d{1,3}$/u.test(part)) {
      return null;
    }
    const parsed = Number(part);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
      return null;
    }
    octets[index] = parsed;
  }
  return octets;
}

function isPublicComputerNavigationIpv4([a, b]: [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127 || a >= 224) {
    return false;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return false;
  }
  if (a === 169 && b === 254) {
    return false;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return false;
  }
  if (a === 192 && (b === 0 || b === 168)) {
    return false;
  }
  if (a === 198 && (b === 18 || b === 19 || b === 51)) {
    return false;
  }
  if (a === 203 && b === 0) {
    return false;
  }
  return true;
}

function isPublicComputerNavigationIpv6(value: string): boolean {
  const normalized = value.toLowerCase();
  if (
    normalized.startsWith("::") ||
    normalized.startsWith("64:ff9b:") ||
    normalized.startsWith("100:") ||
    normalized.startsWith("2001:0:") ||
    normalized.startsWith("2001:2:") ||
    normalized.startsWith("2002:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab][0-9a-f]?:/u.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  ) {
    return false;
  }

  return /^[0-9a-f:.]+$/u.test(normalized);
}

const hostedComputerNavigationUrlSchema = z
  .string()
  .url()
  .refine(isHostedComputerNavigationUrl, {
    message: "Hosted computer navigation URLs must use public http or https hosts.",
  });

export const hostedComputerDeliveryContextSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(1_000).nullable().default(null),
    recipientKey: z.string().trim().min(1).max(1_000).nullable().default(null),
  })
  .strict();

export const hostedComputerStartRunRequestSchema = z
  .object({
    goal: z.string().trim().min(1).max(2_000).optional(),
    resumeAfterMailboxItemId: z.string().trim().min(1).max(200).nullable().default(null),
    resumeDeliveryContext: hostedComputerDeliveryContextSchema.nullable().default(null),
    resumeRunId: z.string().trim().min(1).max(200).nullable().default(null),
    startUrl: hostedComputerNavigationUrlSchema.nullable().default(null),
  })
  .strict()
  .transform(({ goal: _goal, ...request }) => request);

export const hostedComputerObserveRequestSchema = z.object({}).strict();

const hostedComputerActTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(HOSTED_COMPUTER_ACT_TEXT_MAX_LENGTH);

const hostedComputerActLocatorSchema = z.discriminatedUnion("by", [
  z
    .object({
      by: z.literal("role"),
      exact: z.boolean().default(false),
      name: hostedComputerActTextSchema.max(300).nullable().default(null),
      role: hostedComputerActTextSchema.max(80),
    })
    .strict(),
  z
    .object({
      by: z.literal("label"),
      exact: z.boolean().default(false),
      text: hostedComputerActTextSchema.max(300),
    })
    .strict(),
  z
    .object({
      by: z.literal("placeholder"),
      exact: z.boolean().default(false),
      text: hostedComputerActTextSchema.max(300),
    })
    .strict(),
  z
    .object({
      by: z.literal("text"),
      exact: z.boolean().default(false),
      text: hostedComputerActTextSchema.max(300),
    })
    .strict(),
  z
    .object({
      by: z.literal("altText"),
      exact: z.boolean().default(false),
      text: hostedComputerActTextSchema.max(300),
    })
    .strict(),
  z
    .object({
      by: z.literal("title"),
      exact: z.boolean().default(false),
      text: hostedComputerActTextSchema.max(300),
    })
    .strict(),
  z
    .object({
      by: z.literal("testId"),
      testId: hostedComputerActTextSchema.max(300),
    })
    .strict(),
]);

const hostedComputerActTimeoutSchema = z
  .number()
  .int()
  .min(1_000)
  .max(HOSTED_COMPUTER_ACT_TIMEOUT_MAX_MS)
  .default(15_000);

export const hostedComputerActRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("goto"),
      timeoutMs: hostedComputerActTimeoutSchema,
      url: hostedComputerNavigationUrlSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("click"),
      locator: hostedComputerActLocatorSchema,
      timeoutMs: hostedComputerActTimeoutSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("fill"),
      locator: hostedComputerActLocatorSchema,
      timeoutMs: hostedComputerActTimeoutSchema,
      value: hostedComputerActTextSchema.max(HOSTED_COMPUTER_ACT_TEXT_MAX_LENGTH),
    })
    .strict(),
  z
    .object({
      action: z.literal("type"),
      delayMs: z.number().int().min(0).max(250).default(0),
      locator: hostedComputerActLocatorSchema,
      timeoutMs: hostedComputerActTimeoutSchema,
      text: hostedComputerActTextSchema.max(HOSTED_COMPUTER_ACT_TEXT_MAX_LENGTH),
    })
    .strict(),
  z
    .object({
      action: z.literal("select"),
      locator: hostedComputerActLocatorSchema,
      timeoutMs: hostedComputerActTimeoutSchema,
      value: z.union([
        hostedComputerActTextSchema.max(500),
        z.array(hostedComputerActTextSchema.max(500)).min(1).max(20),
      ]),
    })
    .strict(),
  z
    .object({
      action: z.literal("check"),
      locator: hostedComputerActLocatorSchema,
      timeoutMs: hostedComputerActTimeoutSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("uncheck"),
      locator: hostedComputerActLocatorSchema,
      timeoutMs: hostedComputerActTimeoutSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("press"),
      key: z.enum(HOSTED_COMPUTER_PRESS_KEYS),
      locator: hostedComputerActLocatorSchema.optional(),
      timeoutMs: hostedComputerActTimeoutSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("scroll"),
      deltaX: z.number().int().min(-20_000).max(20_000).default(0),
      deltaY: z.number().int().min(-20_000).max(20_000).default(800),
      locator: hostedComputerActLocatorSchema.optional(),
      timeoutMs: hostedComputerActTimeoutSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("wait"),
      ms: z.number().int().min(0).max(5_000),
    })
    .strict(),
  z
    .object({
      action: z.literal("waitFor"),
      locator: hostedComputerActLocatorSchema,
      state: z.enum(["attached", "detached", "hidden", "visible"]).default("visible"),
      timeoutMs: hostedComputerActTimeoutSchema,
    })
    .strict(),
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
      delayMs: hostedComputerOsControlDelaySchema.default(0),
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

export type HostedComputerStartRunRequest =
  z.infer<typeof hostedComputerStartRunRequestSchema>;
export type HostedComputerObserveRequest =
  z.infer<typeof hostedComputerObserveRequestSchema>;
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
  | "observe"
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
    case "observe":
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
