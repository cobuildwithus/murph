import {
  HOSTED_EXECUTION_ASSISTANT_ASK_ANSWER_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
  type HostedExecutionAssistantAskCompletedPayload,
  type HostedExecutionAssistantAskConsentedMemberTarget,
  type HostedExecutionAssistantAskGroupSenderTarget,
  type HostedExecutionAssistantAskJoinedGroupTarget,
  type HostedExecutionAssistantAskOrigin,
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
  const target = parseHostedExecutionAssistantAskTarget(
    record.target,
    `${label}.target`,
  );
  const expiresAt = parseHostedExecutionAssistantAskTimestamp(
    record.expiresAt,
    `${label}.expiresAt`,
  );
  const question = parseHostedExecutionAssistantAskQuestion(
    record.question,
    `${label}.question`,
  );

  if (target.kind === "joined_group") {
    assertExactHostedExecutionAssistantAskKeys(record, [
      "expiresAt",
      "originAssistantInputId",
      "originSessionId",
      "question",
      "target",
    ], label);
    return {
      expiresAt,
      originAssistantInputId: parseHostedExecutionAssistantAskOriginInputId(
        record.originAssistantInputId,
        `${label}.originAssistantInputId`,
      ),
      originSessionId: parseHostedExecutionAssistantAskOpaqueId(
        record.originSessionId,
        `${label}.originSessionId`,
      ),
      question,
      target,
    };
  }

  assertExactHostedExecutionAssistantAskKeys(record, [
    "expiresAt",
    "origin",
    "question",
    "target",
  ], label);
  const origin = parseHostedExecutionAssistantAskOrigin(
    record.origin,
    `${label}.origin`,
  );
  if (
    target.kind === "group_sender"
    || target.kind === "group_sender_private"
  ) {
    if (origin.kind !== "accepted_input") {
      throw new TypeError(
        `${label}.origin must be an accepted input for the group sender.`,
      );
    }
    return { expiresAt, origin, question, target };
  }
  return { expiresAt, origin, question, target };
}

export function parseHostedExecutionAssistantAskCompletedPayload(
  value: unknown,
  label = "Hosted execution assistant.ask.completed payload",
): HostedExecutionAssistantAskCompletedPayload {
  const record = requireObject(value, label);
  const expiresAt = parseHostedExecutionAssistantAskTimestamp(
    record.expiresAt,
    `${label}.expiresAt`,
  );
  const question = parseHostedExecutionAssistantAskQuestion(
    record.question,
    `${label}.question`,
  );
  const requestId = parseHostedExecutionAssistantAskOpaqueId(
    record.requestId,
    `${label}.requestId`,
  );
  const result = parseHostedExecutionAssistantAskResult(
    record.result,
    `${label}.result`,
  );

  if (record.origin === undefined) {
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
      expiresAt,
      originAssistantInputId: parseHostedExecutionAssistantAskOriginInputId(
        record.originAssistantInputId,
        `${label}.originAssistantInputId`,
      ),
      originSessionId: parseHostedExecutionAssistantAskOpaqueId(
        record.originSessionId,
        `${label}.originSessionId`,
      ),
      question,
      requestId,
      result,
      targetLabel: record.targetLabel === null
        ? null
        : parseHostedExecutionAssistantAskBoundedText({
            label: `${label}.targetLabel`,
            maxCodePoints: HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
            value: record.targetLabel,
          }),
    };
  }

  const origin = parseHostedExecutionAssistantAskOrigin(
    record.origin,
    `${label}.origin`,
  );
  assertHostedExecutionAssistantAskNullTargetLabel(record.targetLabel, label);
  assertExactHostedExecutionAssistantAskKeys(record, [
    "expiresAt",
    "origin",
    "question",
    "requestId",
    "result",
    "targetLabel",
  ], label);
  return {
    expiresAt,
    origin,
    question,
    requestId,
    result,
    targetLabel: null,
  };
}

export function parseHostedExecutionAssistantAskOrigin(
  value: unknown,
  label: string,
): HostedExecutionAssistantAskOrigin {
  const record = requireObject(value, label);
  const kind = requireString(record.kind, `${label}.kind`);
  if (kind === "accepted_input") {
    assertExactHostedExecutionAssistantAskKeys(
      record,
      ["assistantInputId", "kind", "sessionId"],
      label,
    );
    return {
      assistantInputId: parseHostedExecutionAssistantAskOriginInputId(
        record.assistantInputId,
        `${label}.assistantInputId`,
      ),
      kind,
      sessionId: parseHostedExecutionAssistantAskOpaqueId(
        record.sessionId,
        `${label}.sessionId`,
      ),
    };
  }
  if (kind === "automation_occurrence") {
    assertExactHostedExecutionAssistantAskKeys(
      record,
      ["automationId", "kind", "occurrenceAt"],
      label,
    );
    return {
      automationId: parseHostedExecutionAssistantAskOpaqueId(
        record.automationId,
        `${label}.automationId`,
      ),
      kind,
      occurrenceAt: parseHostedExecutionAssistantAskTimestamp(
        record.occurrenceAt,
        `${label}.occurrenceAt`,
      ),
    };
  }
  throw new TypeError(`${label}.kind is invalid.`);
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

function parseHostedExecutionAssistantAskTarget(
  value: unknown,
  label: string,
): HostedExecutionAssistantAskJoinedGroupTarget
  | HostedExecutionAssistantAskConsentedMemberTarget
  | HostedExecutionAssistantAskGroupSenderTarget {
  const target = requireObject(value, label);
  const kind = requireString(target.kind, `${label}.kind`);
  if (kind === "joined_group") {
    assertExactHostedExecutionAssistantAskKeys(
      target,
      ["kind", "membershipId", "requestedLabel"],
      label,
    );
    return {
      kind,
      membershipId: parseHostedExecutionAssistantAskOpaqueId(
        target.membershipId,
        `${label}.membershipId`,
      ),
      requestedLabel: target.requestedLabel === null
        ? null
        : parseHostedExecutionAssistantAskBoundedText({
            label: `${label}.requestedLabel`,
            maxCodePoints: HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
            value: target.requestedLabel,
          }),
    };
  }
  if (kind === "consented_member") {
    assertExactHostedExecutionAssistantAskKeys(
      target,
      ["grantId", "kind", "membershipId", "permissionDigest"],
      label,
    );
    return {
      grantId: parseHostedExecutionAssistantAskOpaqueId(
        target.grantId,
        `${label}.grantId`,
      ),
      kind,
      membershipId: parseHostedExecutionAssistantAskOpaqueId(
        target.membershipId,
        `${label}.membershipId`,
      ),
      permissionDigest: parseHostedExecutionAssistantAskOpaqueId(
        target.permissionDigest,
        `${label}.permissionDigest`,
      ),
    };
  }
  if (kind === "group_sender" || kind === "group_sender_private") {
    assertExactHostedExecutionAssistantAskKeys(
      target,
      ["groupRuntimeMemberId", "kind", "permissionDigest"],
      label,
    );
    return {
      groupRuntimeMemberId: parseHostedExecutionAssistantAskOpaqueId(
        target.groupRuntimeMemberId,
        `${label}.groupRuntimeMemberId`,
      ),
      kind,
      permissionDigest: parseHostedExecutionAssistantAskOpaqueId(
        target.permissionDigest,
        `${label}.permissionDigest`,
      ),
    };
  }
  throw new TypeError(`${label}.kind is invalid.`);
}

function parseHostedExecutionAssistantAskQuestion(
  value: unknown,
  label: string,
): string {
  return parseHostedExecutionAssistantAskBoundedText({
    label,
    maxCodePoints: HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
    value,
  });
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

function assertHostedExecutionAssistantAskNullTargetLabel(
  value: unknown,
  label: string,
): void {
  if (value !== null) {
    throw new TypeError(`${label}.targetLabel must be null.`);
  }
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
