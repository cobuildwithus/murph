import "server-only";

import { createHash } from "node:crypto";

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
const CALENDAR_DETAIL_MAX_LENGTH = 120;
const CALENDAR_EVENT_NAME_MAX_LENGTH = 96;
const CALENDAR_PRIMARY_VALUE_MAX_LENGTH = 72;

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
      memberId: string;
      operation: "calendar-create";
      providerVersion: string;
      toolSlug: string;
    }
  | {
      account: ConnectedAppAccountIdentity;
      alias: string;
      memberId: string;
      operation: "rename";
    }
  | {
      account: ConnectedAppAccountIdentity;
      memberId: string;
      operation: "disconnect";
    };

export function buildHostedConnectedAppsMutationApprovalRequest(
  input: HostedConnectedAppsMutationApprovalInput,
): HostedActionApprovalRequest {
  const exactEffect = stringifyCanonicalJson(buildExactEffect(input));
  return {
    actionFingerprint: sha256Hex(`${ACTION_FINGERPRINT_DOMAIN}\n${exactEffect}`),
    actionId:
      `${HOSTED_CONNECTED_APPS_ACTION_ID_PREFIX}${sha256Hex(`${ACTION_ID_DOMAIN}\n${exactEffect}`)}`,
    actionKind: actionKind(input.operation),
    presentation: presentation(input),
    returnContactKind: null,
  };
}

function buildExactEffect(
  input: HostedConnectedAppsMutationApprovalInput,
): Record<string, unknown> {
  const common = {
    accountAlias: input.account.alias,
    accountId: input.account.id,
    accountWordId: input.account.wordId,
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
  const account = `${cleanText(
    formatHostedConnectedAppToolkitLabel(input.account.toolkit.slug),
    64,
  )} — ${cleanText(
    input.account.alias ?? input.account.wordId ?? input.account.id,
    CALENDAR_PRIMARY_VALUE_MAX_LENGTH,
  )}`;

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
        ].filter(Boolean).join(" · "),
        title: "Create this calendar event?",
      };
    }
    case "rename":
      return {
        body: [
          `Account: ${account}`,
          `New name: ${cleanText(input.alias, 180)}`,
          "Only the complete account ID and complete new name are approved.",
        ].join(" · "),
        title: "Rename this connected app?",
      };
    case "disconnect":
      return {
        body: [
          `Account: ${account}`,
          "Murph will revoke its access. The provider account and its data will not be deleted.",
          "Only the complete account ID disconnect is approved.",
        ].join(" · "),
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
  return cleanText(
    typeof value === "string" ? value : stringifyCanonicalJson(value),
    maxLength,
  );
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
    || typeof value === "string"
  ) {
    return value;
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
      .map(([key, item]) => [key, canonicalizeJsonValue(item)]),
  );
}

function cleanText(value: string, maxLength: number): string {
  const clean = value
    .replace(/[\u0000-\u001F\u007F]/gu, " ")
    .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, "")
    .replace(/\s+/gu, " ")
    .replaceAll(" · ", " — ")
    .trim();
  return clean.length <= maxLength
    ? clean
    : `${clean.slice(0, maxLength - 1)}…`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
