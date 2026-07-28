import "server-only";

import { createHash } from "node:crypto";

import {
  parseHostedActionApprovalRequest,
} from "@murphai/hosted-execution/action-approval";
import type {
  HostedActionApprovalRequest,
} from "@murphai/hosted-execution/action-approval";
import {
  HOSTED_CONNECTED_APPS_ACTION_ID_PREFIX,
} from "@murphai/hosted-execution/connected-apps";

import type { ComposioConnectedAccount } from "./composio";
import { formatHostedConnectedAppToolkitLabel } from "./config";

const ACTION_ID_DOMAIN = "murph-connected-app-action-id-v1";
const ACTION_FINGERPRINT_DOMAIN = "murph-connected-app-action-fingerprint-v1";
const ACCOUNT_ALIAS_MAX_LENGTH = 64;
const ACCOUNT_ID_MAX_LENGTH = 256;
const ACCOUNT_WORD_ID_MAX_LENGTH = 128;
const CALENDAR_DETAIL_MAX_LENGTH = 120;
const CALENDAR_EVENT_NAME_MAX_LENGTH = 96;
const CALENDAR_PRIMARY_VALUE_MAX_LENGTH = 72;
const MEMBER_ID_MAX_LENGTH = 256;
const PROVIDER_IDENTIFIER_MAX_LENGTH = 256;
const FACT_ROW_SEPARATOR = " · ";
const FORBIDDEN_DIRECTIONAL_CONTROLS =
  /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
const FORBIDDEN_TEXT_CONTROLS =
  /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u;

type CanonicalJsonValue =
  | boolean
  | null
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

type ConnectedAppAccountIdentity = Pick<
  ComposioConnectedAccount,
  "alias" | "id" | "toolkit" | "wordId"
>;

type HostedConnectedAppsMutationApprovalInput =
  | {
      account: ConnectedAppAccountIdentity;
      arguments: Readonly<Record<string, unknown>>;
      includeAccountIdFingerprint?: boolean;
      memberId: string;
      operation: "calendar-create";
      providerVersion: string;
      toolSlug: string;
    }
  | {
      account: ConnectedAppAccountIdentity;
      alias: string;
      includeAccountIdFingerprint?: boolean;
      memberId: string;
      operation: "rename";
    }
  | {
      account: ConnectedAppAccountIdentity;
      includeAccountIdFingerprint?: boolean;
      memberId: string;
      operation: "disconnect";
    };

type CanonicalHostedConnectedAppsMutationInput =
  | {
      account: ConnectedAppAccountIdentity;
      arguments: Record<string, CanonicalJsonValue>;
      includeAccountIdFingerprint: boolean;
      memberId: string;
      operation: "calendar-create";
      providerVersion: string;
      toolSlug: string;
    }
  | {
      account: ConnectedAppAccountIdentity;
      alias: string;
      includeAccountIdFingerprint: boolean;
      memberId: string;
      operation: "rename";
    }
  | {
      account: ConnectedAppAccountIdentity;
      includeAccountIdFingerprint: boolean;
      memberId: string;
      operation: "disconnect";
    };

type PreparedHostedConnectedAppsMutation = {
  approvalRequest: HostedActionApprovalRequest;
  execution:
    | {
        accountId: string;
        arguments: Record<string, CanonicalJsonValue>;
        operation: "calendar-create";
        providerVersion: string;
        toolSlug: string;
      }
    | {
        accountId: string;
        alias: string;
        operation: "rename";
      }
    | {
        accountId: string;
        operation: "disconnect";
      };
};

export function buildHostedConnectedAppsMutationApprovalRequest(
  input: HostedConnectedAppsMutationApprovalInput,
): HostedActionApprovalRequest {
  return prepareHostedConnectedAppsMutation(input).approvalRequest;
}

export function prepareHostedConnectedAppsMutation(
  input: HostedConnectedAppsMutationApprovalInput,
): PreparedHostedConnectedAppsMutation {
  const prepared = canonicalizeMutationInput(input);
  const exactEffect = stringifyCanonicalJson(buildExactEffect(prepared));
  const approvalRequest = parseHostedActionApprovalRequest({
    actionFingerprint: sha256Hex(`${ACTION_FINGERPRINT_DOMAIN}\n${exactEffect}`),
    actionId:
      `${HOSTED_CONNECTED_APPS_ACTION_ID_PREFIX}${sha256Hex(`${ACTION_ID_DOMAIN}\n${exactEffect}`)}`,
    actionKind: actionKind(prepared.operation),
    presentation: presentation(prepared),
    returnContactKind: null,
  });

  switch (prepared.operation) {
    case "calendar-create":
      return {
        approvalRequest,
        execution: {
          accountId: prepared.account.id,
          arguments: prepared.arguments,
          operation: prepared.operation,
          providerVersion: prepared.providerVersion,
          toolSlug: prepared.toolSlug,
        },
      };
    case "rename":
      return {
        approvalRequest,
        execution: {
          accountId: prepared.account.id,
          alias: prepared.alias,
          operation: prepared.operation,
        },
      };
    case "disconnect":
      return {
        approvalRequest,
        execution: {
          accountId: prepared.account.id,
          operation: prepared.operation,
        },
      };
  }
}

function buildExactEffect(
  input: HostedConnectedAppsMutationApprovalInput,
): Record<string, unknown> {
  const common = {
    accountAlias: input.account.alias,
    accountId: input.account.id,
    accountWordId: input.account.wordId,
    displayAccountIdFingerprint: input.includeAccountIdFingerprint,
    memberId: input.memberId,
    operation: input.operation,
    toolkit: input.account.toolkit.slug,
    version: 1,
  };
  switch (input.operation) {
    case "calendar-create":
      return {
        ...common,
        arguments: input.arguments,
        providerVersion: input.providerVersion,
        toolSlug: input.toolSlug,
      };
    case "rename":
      return { ...common, alias: input.alias };
    case "disconnect":
      return common;
  }
}

function actionKind(
  operation: HostedConnectedAppsMutationApprovalInput["operation"],
): string {
  switch (operation) {
    case "calendar-create":
      return "connected-app.calendar-create.v1";
    case "rename":
      return "connected-app.account-rename.v1";
    case "disconnect":
      return "connected-app.account-disconnect.v1";
  }
}

function presentation(
  input: HostedConnectedAppsMutationApprovalInput,
): HostedActionApprovalRequest["presentation"] {
  const account = accountPresentation(input);

  switch (input.operation) {
    case "calendar-create": {
      return {
        body: [
          `Account: ${account}`,
          `Event: ${calendarArgument(
            input.arguments,
            ["summary", "subject"],
            CALENDAR_EVENT_NAME_MAX_LENGTH,
          )}`,
          `Starts: ${calendarArgument(
            input.arguments,
            ["start_datetime"],
            CALENDAR_PRIMARY_VALUE_MAX_LENGTH,
          )}`,
          calendarEndOrDuration(input.arguments),
          `Time zone: ${calendarArgument(
            input.arguments,
            ["timezone", "time_zone"],
            48,
          )}`,
          optionalCalendarArgument(
            input.arguments,
            "Location",
            ["location"],
            CALENDAR_PRIMARY_VALUE_MAX_LENGTH,
          ),
          optionalCalendarArgument(
            input.arguments,
            "Details",
            ["description", "body"],
            CALENDAR_DETAIL_MAX_LENGTH,
          ),
          "This approval binds the complete account ID and exact provider "
            + "arguments, including server-set calendar and meeting options.",
        ].filter(Boolean).join(FACT_ROW_SEPARATOR),
        title: "Create this calendar event?",
      };
    }
    case "rename":
      return {
        body: [
          `Account: ${account}`,
          `New name: ${input.alias}`,
          "Only the complete account ID and complete new name are approved.",
        ].join(FACT_ROW_SEPARATOR),
        title: "Rename this connected app?",
      };
    case "disconnect":
      return {
        body: [
          `Account: ${account}`,
          "Murph will revoke its access. The provider account and its data will not be deleted.",
          "Only the complete account ID disconnect is approved.",
        ].join(FACT_ROW_SEPARATOR),
        title: "Disconnect this connected app?",
      };
  }
}

function stringifyCanonicalJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalizeJsonValue(value));
  if (serialized === undefined) {
    throw new TypeError("Connected-app approval value could not be serialized.");
  }
  return serialized;
}

function calendarArgument(
  argumentsValue: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  maxLength: number,
): string {
  for (const key of keys) {
    if (Object.hasOwn(argumentsValue, key)) {
      return displayCalendarValue(argumentsValue[key], maxLength);
    }
  }
  return "Not provided";
}

function optionalCalendarArgument(
  argumentsValue: Readonly<Record<string, unknown>>,
  label: string,
  keys: readonly string[],
  maxLength: number,
): string {
  for (const key of keys) {
    if (Object.hasOwn(argumentsValue, key)) {
      return `${label}: ${displayCalendarValue(
        argumentsValue[key],
        maxLength,
      )}`;
    }
  }
  return "";
}

function displayCalendarValue(value: unknown, maxLength: number): string {
  const displayed = typeof value === "string"
    ? value
    : stringifyCanonicalJson(value);
  if (displayed.length > maxLength) {
    throw new TypeError(
      `Connected-app calendar values must be at most ${maxLength} characters.`,
    );
  }
  return displayed;
}

function calendarEndOrDuration(
  argumentsValue: Readonly<Record<string, unknown>>,
): string {
  if (Object.hasOwn(argumentsValue, "end_datetime")) {
    return `Ends: ${calendarArgument(
      argumentsValue,
      ["end_datetime"],
      CALENDAR_PRIMARY_VALUE_MAX_LENGTH,
    )}`;
  }

  const duration = [
    calendarDurationPart(argumentsValue.event_duration_hour, "hour"),
    calendarDurationPart(argumentsValue.event_duration_minutes, "minute"),
  ].filter((part): part is string => part !== null);
  return `Duration: ${duration.length > 0 ? duration.join(", ") : "Not provided"}`;
}

function calendarDurationPart(
  value: unknown,
  unit: "hour" | "minute",
): string | null {
  if (value === undefined || value === 0 || value === "0") {
    return null;
  }
  const displayed = displayCalendarValue(value, 24);
  return `${displayed} ${displayed === "1" ? unit : `${unit}s`}`;
}

function canonicalizeJsonValue(value: unknown): CanonicalJsonValue {
  if (
    value === null
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return requireSafeProviderText(
      value,
      "Connected-app provider value",
      CALENDAR_DETAIL_MAX_LENGTH,
    );
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "Connected-app approval values must be finite JSON numbers.",
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }
  if (typeof value !== "object") {
    throw new TypeError("Connected-app approval values must be JSON values.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(
      "Connected-app approval values must be plain JSON objects.",
    );
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [
        requireSafeProviderText(
          key,
          "Connected-app provider argument name",
          64,
        ),
        canonicalizeJsonValue(item),
      ]),
  );
}

function canonicalizeMutationInput(
  input: HostedConnectedAppsMutationApprovalInput,
): CanonicalHostedConnectedAppsMutationInput {
  const account = {
    ...input.account,
    alias: input.account.alias === null
      ? null
      : requireSafeProviderText(
          input.account.alias,
          "Connected-app account alias",
          ACCOUNT_ALIAS_MAX_LENGTH,
        ),
    id: requireSafeProviderText(
      input.account.id,
      "Connected-app account id",
      ACCOUNT_ID_MAX_LENGTH,
    ),
    toolkit: {
      ...input.account.toolkit,
      slug: requireToolkitSlug(input.account.toolkit.slug),
    },
    wordId: input.account.wordId === null
      ? null
      : requireSafeProviderText(
          input.account.wordId,
          "Connected-app account word id",
          ACCOUNT_WORD_ID_MAX_LENGTH,
        ),
  };
  const common = {
    account,
    includeAccountIdFingerprint:
      input.includeAccountIdFingerprint === true || account.wordId === null,
    memberId: requireSafeProviderText(
      input.memberId,
      "Connected-app member id",
      MEMBER_ID_MAX_LENGTH,
    ),
  };

  switch (input.operation) {
    case "calendar-create":
      return {
        ...common,
        arguments: canonicalizeJsonRecord(input.arguments),
        operation: input.operation,
        providerVersion: requireSafeProviderText(
          input.providerVersion,
          "Connected-app provider version",
          PROVIDER_IDENTIFIER_MAX_LENGTH,
        ),
        toolSlug: requireSafeProviderText(
          input.toolSlug,
          "Connected-app tool slug",
          PROVIDER_IDENTIFIER_MAX_LENGTH,
        ),
      };
    case "rename":
      return {
        ...common,
        alias: requireSafeProviderText(
          input.alias,
          "Connected-app new alias",
          ACCOUNT_ALIAS_MAX_LENGTH,
        ),
        operation: input.operation,
      };
    case "disconnect":
      return {
        ...common,
        operation: input.operation,
      };
  }
}

function canonicalizeJsonRecord(
  value: Readonly<Record<string, unknown>>,
): Record<string, CanonicalJsonValue> {
  const canonical = canonicalizeJsonValue(value);
  if (
    canonical === null
    || Array.isArray(canonical)
    || typeof canonical !== "object"
  ) {
    throw new TypeError(
      "Connected-app provider arguments must be a plain JSON object.",
    );
  }
  return canonical;
}

function accountPresentation(
  input: HostedConnectedAppsMutationApprovalInput,
): string {
  const fields = [
    formatHostedConnectedAppToolkitLabel(input.account.toolkit.slug),
    `alias ${JSON.stringify(input.account.alias ?? "not set")}`,
    `word ID ${JSON.stringify(input.account.wordId ?? "not available")}`,
  ];
  if (input.includeAccountIdFingerprint) {
    fields.push(`account ID fingerprint ${sha256Hex(input.account.id).slice(0, 16)}`);
  }
  return fields.join(" — ");
}

function requireToolkitSlug(value: string): string {
  const slug = requireSafeProviderText(
    value,
    "Connected-app toolkit slug",
    64,
  );
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(slug)) {
    throw new TypeError("Connected-app toolkit slug is invalid.");
  }
  return slug;
}

function requireSafeProviderText(
  value: string,
  label: string,
  maxLength: number,
): string {
  if (value.length === 0 || value.length > maxLength) {
    throw new TypeError(`${label} must contain 1 to ${maxLength} characters.`);
  }
  if (
    value.trim() !== value
    || value.includes(FACT_ROW_SEPARATOR)
    || FORBIDDEN_TEXT_CONTROLS.test(value)
    || FORBIDDEN_DIRECTIONAL_CONTROLS.test(value)
    || hasUnpairedSurrogate(value)
  ) {
    throw new TypeError(
      `${label} contains unsupported whitespace or control characters.`,
    );
  }
  return value;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xD800 && current <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xDC00 || next > 0xDFFF) {
        return true;
      }
      index += 1;
      continue;
    }
    if (current >= 0xDC00 && current <= 0xDFFF) {
      return true;
    }
  }
  return false;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
