import {
  HOSTED_EXECUTION_ASSISTANT_ASK_ANSWER_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
  type HostedExecutionAssistantAskCompletedPayload,
  type HostedExecutionAssistantAskRequestedPayload,
  type HostedExecutionAssistantAskResult,
} from "./contracts.ts";
import {
  requireObject,
  requireString,
} from "./parsers/assertions.ts";

const HOSTED_EXECUTION_ASSISTANT_INPUT_ID_PATTERN = /^ain_[0-9a-f]{32}$/u;
const HOSTED_EXECUTION_ASSISTANT_ASK_OPAQUE_ID_MAX_CODE_POINTS = 256;

export function parseHostedExecutionAssistantAskRequestedPayload(
  value: unknown,
  label = "Hosted execution assistant.ask.requested payload",
): HostedExecutionAssistantAskRequestedPayload {
  const record = requireObject(value, label);
  assertExactHostedExecutionAssistantAskKeys(record, [
    "expiresAt",
    "originAssistantInputId",
    "originSessionId",
    "question",
    "target",
  ], label);
  const targetLabel = `${label}.target`;
  const target = requireObject(record.target, targetLabel);
  assertExactHostedExecutionAssistantAskKeys(
    target,
    ["kind", "membershipId", "requestedLabel"],
    targetLabel,
  );
  if (target.kind !== "joined_group") {
    throw new TypeError(`${targetLabel}.kind is invalid.`);
  }

  return {
    expiresAt: parseHostedExecutionAssistantAskTimestamp(
      record.expiresAt,
      `${label}.expiresAt`,
    ),
    originAssistantInputId: parseHostedExecutionAssistantAskOriginInputId(
      record.originAssistantInputId,
      `${label}.originAssistantInputId`,
    ),
    originSessionId: parseHostedExecutionAssistantAskOpaqueId(
      record.originSessionId,
      `${label}.originSessionId`,
    ),
    question: parseHostedExecutionAssistantAskBoundedText({
      label: `${label}.question`,
      maxCodePoints: HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
      value: record.question,
    }),
    target: {
      kind: "joined_group",
      membershipId: parseHostedExecutionAssistantAskOpaqueId(
        target.membershipId,
        `${targetLabel}.membershipId`,
      ),
      requestedLabel: target.requestedLabel === null
        ? null
        : parseHostedExecutionAssistantAskBoundedText({
            label: `${targetLabel}.requestedLabel`,
            maxCodePoints: HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
            value: target.requestedLabel,
          }),
    },
  };
}

export function parseHostedExecutionAssistantAskCompletedPayload(
  value: unknown,
  label = "Hosted execution assistant.ask.completed payload",
): HostedExecutionAssistantAskCompletedPayload {
  const record = requireObject(value, label);
  assertExactHostedExecutionAssistantAskKeys(record, [
    "expiresAt",
    "originAssistantInputId",
    "originSessionId",
    "question",
    "requestId",
    "result",
    "targetLabel",
  ], label);

  return {
    expiresAt: parseHostedExecutionAssistantAskTimestamp(
      record.expiresAt,
      `${label}.expiresAt`,
    ),
    originAssistantInputId: parseHostedExecutionAssistantAskOriginInputId(
      record.originAssistantInputId,
      `${label}.originAssistantInputId`,
    ),
    originSessionId: parseHostedExecutionAssistantAskOpaqueId(
      record.originSessionId,
      `${label}.originSessionId`,
    ),
    question: parseHostedExecutionAssistantAskBoundedText({
      label: `${label}.question`,
      maxCodePoints: HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
      value: record.question,
    }),
    requestId: parseHostedExecutionAssistantAskOpaqueId(
      record.requestId,
      `${label}.requestId`,
    ),
    result: parseHostedExecutionAssistantAskResult(record.result, `${label}.result`),
    targetLabel: record.targetLabel === null
      ? null
      : parseHostedExecutionAssistantAskBoundedText({
          label: `${label}.targetLabel`,
          maxCodePoints: HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
          value: record.targetLabel,
        }),
  };
}

export function parseHostedExecutionAssistantAskResult(
  value: unknown,
  label: string,
): HostedExecutionAssistantAskResult {
  const record = requireObject(value, label);
  assertExactHostedExecutionAssistantAskKeys(record, ["answer", "outcome"], label);
  const outcome = requireString(record.outcome, `${label}.outcome`);
  if (outcome === "answered") {
    return {
      answer: parseHostedExecutionAssistantAskBoundedText({
        label: `${label}.answer`,
        maxCodePoints: HOSTED_EXECUTION_ASSISTANT_ASK_ANSWER_MAX_CODE_POINTS,
        value: record.answer,
      }),
      outcome,
    };
  }
  if (outcome === "cannot_answer") {
    return {
      answer: record.answer === null
        ? null
        : parseHostedExecutionAssistantAskBoundedText({
            label: `${label}.answer`,
            maxCodePoints: HOSTED_EXECUTION_ASSISTANT_ASK_ANSWER_MAX_CODE_POINTS,
            value: record.answer,
          }),
      outcome,
    };
  }
  throw new TypeError(`${label}.outcome is invalid.`);
}

export function parseHostedExecutionAssistantAskOriginInputId(
  value: unknown,
  label: string,
): string {
  const originAssistantInputId = requireString(value, label);
  if (!HOSTED_EXECUTION_ASSISTANT_INPUT_ID_PATTERN.test(originAssistantInputId)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return originAssistantInputId;
}

export function parseHostedExecutionAssistantAskBoundedText(input: {
  label: string;
  maxCodePoints: number;
  value: unknown;
}): string {
  const normalized = requireString(input.value, input.label).trim();
  const codePoints = [...normalized].length;
  if (codePoints === 0 || codePoints > input.maxCodePoints) {
    throw new TypeError(
      `${input.label} must contain between 1 and ${input.maxCodePoints} Unicode code points.`,
    );
  }
  return normalized;
}

export function parseHostedExecutionAssistantAskTimestamp(
  value: unknown,
  label: string,
): string {
  const timestamp = requireString(value, label);
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs) || new Date(timestampMs).toISOString() !== timestamp) {
    throw new TypeError(`${label} must be a canonical ISO timestamp.`);
  }
  return timestamp;
}

function parseHostedExecutionAssistantAskOpaqueId(
  value: unknown,
  label: string,
): string {
  return parseHostedExecutionAssistantAskBoundedText({
    label,
    maxCodePoints: HOSTED_EXECUTION_ASSISTANT_ASK_OPAQUE_ID_MAX_CODE_POINTS,
    value,
  });
}

function assertExactHostedExecutionAssistantAskKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} contains unsupported field ${JSON.stringify(key)}.`);
    }
  }
}
