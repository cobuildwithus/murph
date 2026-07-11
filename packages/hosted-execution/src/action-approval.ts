import {
  requireObject,
  requireString,
} from "./parsers/assertions.ts";
import {
  HOSTED_RETURN_CONTACT_KINDS,
  parseHostedReturnContactKind,
  type HostedReturnContactKind,
} from "./return-contact.ts";

export const HOSTED_ACTION_APPROVAL_ID_PREFIX = "haa_";

export const HOSTED_ACTION_APPROVAL_RETURN_CONTACT_KINDS =
  HOSTED_RETURN_CONTACT_KINDS;

export type HostedActionApprovalReturnContactKind =
  HostedReturnContactKind;

const ACTION_ID_MAX_LENGTH = 200;
const ACTION_KIND_MAX_LENGTH = 120;
const ACTION_APPROVAL_CYCLE_OWNER_PREFIX = "assistant-vault-file:";
const ACTION_APPROVAL_OUTCOME_GENERATION_MARKER = ":approval-generation:";
const APPROVAL_ID_PATTERN = /^haa_[A-Za-z0-9_-]{32}$/u;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const PRESENTATION_TITLE_MAX_LENGTH = 120;
const PRESENTATION_BODY_MAX_LENGTH = 1_000;

export interface HostedActionApprovalPresentation {
  title: string;
  body: string;
}

/**
 * Trusted domain code owns the action identity and exact-action fingerprint.
 * Presentation is part of the immutable request identity, so the runtime cannot
 * later present one action and execute another under the same action id.
 *
 * `returnContactKind` biases the post-decision Return-to-Murph link toward
 * the conversation channel the action came from. It is part of the immutable
 * identity so the runtime cannot present one channel and execute another.
 */
export interface HostedActionApprovalRequest {
  actionId: string;
  actionKind: string;
  actionFingerprint: string;
  presentation: HostedActionApprovalPresentation;
  returnContactKind: HostedActionApprovalReturnContactKind | null;
}

export type HostedActionApprovalResult =
  | {
      approvalId: string;
      approvalUrl: string;
      expiresAt: string;
      status: "pending";
    }
  | {
      approvalGeneration: string;
      approvalId: string;
      status: "approved";
    }
  | {
      approvalId: string;
      status: "denied" | "expired";
    };

export interface HostedActionApprovalConsumeRequest {
  approvalGeneration: string;
  consumerId: string;
  request: HostedActionApprovalRequest;
}

export function isHostedActionApprovalId(value: unknown): value is string {
  return typeof value === "string" && APPROVAL_ID_PATTERN.test(value);
}

export function buildHostedActionApprovalCycleOwnerKey(input: {
  approvalId: string;
  expiresAt: string;
}): string {
  const approvalId = requireApprovalId(input.approvalId);
  requireIsoDateTime(input.expiresAt);
  return `${ACTION_APPROVAL_CYCLE_OWNER_PREFIX}${approvalId}:${input.expiresAt}`;
}

export function buildHostedActionApprovalOutcomeEffectId(input: {
  approvalGeneration: string;
  approvalId: string;
  expiresAt: string;
}): string {
  const ownerKey = buildHostedActionApprovalCycleOwnerKey(input);
  const approvalGeneration = requireSha256Hex(
    input.approvalGeneration,
    "Hosted action approval outcome generation",
  );
  return `${ownerKey}${ACTION_APPROVAL_OUTCOME_GENERATION_MARKER}${approvalGeneration}`;
}

export function parseHostedActionApprovalOutcomeEffectId(value: unknown): {
  approvalGeneration: string;
  approvalId: string;
  expiresAt: string;
  ownerKey: string;
} | null {
  if (typeof value !== "string") {
    return null;
  }
  const generationMarkerIndex = value.lastIndexOf(
    ACTION_APPROVAL_OUTCOME_GENERATION_MARKER,
  );
  if (generationMarkerIndex <= ACTION_APPROVAL_CYCLE_OWNER_PREFIX.length) {
    return null;
  }
  const ownerKey = value.slice(0, generationMarkerIndex);
  const approvalGeneration = value.slice(
    generationMarkerIndex + ACTION_APPROVAL_OUTCOME_GENERATION_MARKER.length,
  );
  if (!SHA256_HEX_PATTERN.test(approvalGeneration)) {
    return null;
  }
  if (!ownerKey.startsWith(ACTION_APPROVAL_CYCLE_OWNER_PREFIX)) {
    return null;
  }
  const approvalIdStart = ACTION_APPROVAL_CYCLE_OWNER_PREFIX.length;
  const approvalIdEnd = ownerKey.indexOf(":", approvalIdStart);
  if (approvalIdEnd < 0) {
    return null;
  }
  const approvalId = ownerKey.slice(approvalIdStart, approvalIdEnd);
  const expiresAt = ownerKey.slice(approvalIdEnd + 1);
  if (!isHostedActionApprovalId(approvalId)) {
    return null;
  }
  try {
    requireIsoDateTime(expiresAt);
  } catch {
    return null;
  }
  if (buildHostedActionApprovalCycleOwnerKey({ approvalId, expiresAt }) !== ownerKey) {
    return null;
  }
  return {
    approvalGeneration,
    approvalId,
    expiresAt,
    ownerKey,
  };
}

export function parseHostedActionApprovalRequest(
  value: unknown,
): HostedActionApprovalRequest {
  const request = requireExactObject(
    value,
    "Hosted action approval request",
    [
      "actionFingerprint",
      "actionId",
      "actionKind",
      "presentation",
    ],
    ["returnContactKind"],
  );
  const actionFingerprint = requireString(
    request.actionFingerprint,
    "Hosted action approval request actionFingerprint",
  );

  if (!SHA256_HEX_PATTERN.test(actionFingerprint)) {
    throw new TypeError(
      "Hosted action approval request actionFingerprint must be a lowercase SHA-256 hex digest.",
    );
  }

  return {
    actionFingerprint,
    actionId: requireBoundedString(
      request.actionId,
      "Hosted action approval request actionId",
      ACTION_ID_MAX_LENGTH,
    ),
    actionKind: requireBoundedString(
      request.actionKind,
      "Hosted action approval request actionKind",
      ACTION_KIND_MAX_LENGTH,
    ),
    presentation: parseHostedActionApprovalPresentation(request.presentation),
    returnContactKind: parseHostedActionApprovalReturnContactKind(
      request.returnContactKind,
    ),
  };
}

function parseHostedActionApprovalReturnContactKind(
  value: unknown,
): HostedActionApprovalReturnContactKind | null {
  return parseHostedReturnContactKind(
    value,
    "Hosted action approval request returnContactKind",
  );
}

export function parseHostedActionApprovalPresentation(
  value: unknown,
): HostedActionApprovalPresentation {
  const presentation = requireExactObject(
    value,
    "Hosted action approval presentation",
    ["body", "title"],
  );

  return {
    body: requireBoundedString(
      presentation.body,
      "Hosted action approval presentation body",
      PRESENTATION_BODY_MAX_LENGTH,
    ),
    title: requireBoundedString(
      presentation.title,
      "Hosted action approval presentation title",
      PRESENTATION_TITLE_MAX_LENGTH,
    ),
  };
}

/** Fixed-order canonical form used by the web control plane for identity checks. */
export function serializeHostedActionApprovalRequest(
  request: HostedActionApprovalRequest,
): string {
  const parsed = parseHostedActionApprovalRequest(request);

  return JSON.stringify([
    "murph.hosted-action-approval-request.v1",
    parsed.actionId,
    parsed.actionKind,
    parsed.actionFingerprint,
    parsed.presentation.title,
    parsed.presentation.body,
    parsed.returnContactKind,
  ]);
}

export function parseHostedActionApprovalResult(
  value: unknown,
): HostedActionApprovalResult {
  const result = requireObject(value, "Hosted action approval result");
  const status = requireString(
    result.status,
    "Hosted action approval result status",
  );
  const approvalId = requireApprovalId(result.approvalId);

  switch (status) {
    case "pending": {
      const exact = requireExactObject(
        value,
        "Hosted pending action approval result",
        ["approvalId", "approvalUrl", "expiresAt", "status"],
      );
      const approvalUrl = requireString(
        exact.approvalUrl,
        "Hosted action approval result approvalUrl",
      );
      const expiresAt = requireString(
        exact.expiresAt,
        "Hosted action approval result expiresAt",
      );

      requireHttpUrl(approvalUrl);
      requireIsoDateTime(expiresAt);

      return { approvalId, approvalUrl, expiresAt, status };
    }
    case "approved":
      {
        const exact = requireExactObject(
          value,
          "Hosted approved action approval result",
          ["approvalGeneration", "approvalId", "status"],
        );
        return {
          approvalGeneration: requireSha256Hex(
            exact.approvalGeneration,
            "Hosted action approval result approvalGeneration",
          ),
          approvalId,
          status,
        };
      }
    case "denied":
    case "expired":
      requireExactObject(
        value,
        "Hosted terminal action approval result",
        ["approvalId", "status"],
      );
      return { approvalId, status };
    default:
      throw new TypeError(
        "Hosted action approval result status must be pending, approved, denied, or expired.",
      );
  }
}

export function parseHostedActionApprovalConsumeRequest(
  value: unknown,
): HostedActionApprovalConsumeRequest {
  const request = requireExactObject(
    value,
    "Hosted action approval consume request",
    ["approvalGeneration", "consumerId", "request"],
  );

  return {
    approvalGeneration: requireSha256Hex(
      request.approvalGeneration,
      "Hosted action approval consume request approvalGeneration",
    ),
    consumerId: requireBoundedString(
      request.consumerId,
      "Hosted action approval consume request consumerId",
      ACTION_ID_MAX_LENGTH,
    ),
    request: parseHostedActionApprovalRequest(request.request),
  };
}

function requireApprovalId(value: unknown): string {
  if (!isHostedActionApprovalId(value)) {
    throw new TypeError("Hosted action approval result approvalId is invalid.");
  }
  return value;
}

function requireSha256Hex(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (!SHA256_HEX_PATTERN.test(text)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 hex digest.`);
  }
  return text;
}

function requireBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  const text = requireString(value, label);
  if (text.length > maxLength) {
    throw new TypeError(`${label} must be at most ${maxLength} characters.`);
  }
  if (text.trim() !== text || /[\u0000-\u001F\u007F]/u.test(text)) {
    throw new TypeError(
      `${label} must not contain surrounding whitespace or control characters.`,
    );
  }
  return text;
}

function requireExactObject(
  value: unknown,
  label: string,
  keys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  const record = requireObject(value, label);
  const allowed = new Set([...keys, ...optionalKeys]);
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));

  if (unexpected.length > 0) {
    throw new TypeError(`${label} contains unsupported fields.`);
  }

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new TypeError(`${label} must include ${key}.`);
    }
  }

  return record;
}

function requireHttpUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Hosted action approval result approvalUrl must be a URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError(
      "Hosted action approval result approvalUrl must use http or https.",
    );
  }
}

function requireIsoDateTime(value: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(
      "Hosted action approval result expiresAt must be a canonical ISO-8601 timestamp.",
    );
  }
}
