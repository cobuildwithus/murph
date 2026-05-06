import type {
  HostedEmailIngressWakeAppendRequest,
} from "@murphai/hosted-execution";
import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";
import { parseHostedMailboxItem } from "@murphai/hosted-execution/parsers";
import type {
  HostedMailboxItem,
} from "@murphai/hosted-execution/runtime-control";

import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "./web-control-plane.ts";
import type { HostedWebCallbackSigningEnvironment } from "./web-callback-auth.ts";

const HOSTED_WEB_HOSTED_MAILBOX_EMAIL_INGRESS_PATH =
  "/api/internal/hosted-mailbox/email-ingress";
const HOSTED_WEB_HOSTED_MAILBOX_EMAIL_INGRESS_NUDGE_WORKFLOW_PATH =
  "/api/internal/hosted-mailbox/email-ingress/nudge-workflow";

export interface HostedEmailMailboxIngressAppendResponse {
  dedupeConflict: boolean;
  duplicate: boolean;
  inserted: boolean;
  item: HostedMailboxItem;
}

export interface HostedEmailMailboxNudgeWorkflowStartResponse {
  runId: string;
}

export async function appendHostedEmailIngressWakeInWeb(input: {
  allowHttpHosts?: readonly string[];
  baseUrl: string;
  body: HostedEmailIngressWakeAppendRequest;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): Promise<HostedEmailMailboxIngressAppendResponse> {
  let response: Response;
  try {
    response = await fetchHostedExecutionWebControlPlaneResponse({
      ...(input.allowHttpHosts ? { allowHttpHosts: input.allowHttpHosts } : {}),
      baseUrl: input.baseUrl,
      body: JSON.stringify(input.body),
      boundUserId: input.boundUserId,
      callbackSigning: input.callbackSigning,
      fetchImpl: input.fetchImpl,
      method: "POST",
      path: HOSTED_WEB_HOSTED_MAILBOX_EMAIL_INGRESS_PATH,
      timeoutMs: input.timeoutMs,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: {
        description: "Hosted email ingress wake append",
        path: HOSTED_WEB_HOSTED_MAILBOX_EMAIL_INGRESS_PATH,
        userId: input.boundUserId,
      },
      error,
      level: "warn",
      message: "Hosted email ingress control-plane request failed.",
      phase: "outbox",
      userId: input.boundUserId,
    });
    throw error;
  }

  if (!response.ok) {
    const responseDetail = (await response.text()).trim();
    const error = new Error(
      responseDetail.length > 0
        ? `Hosted email ingress wake append failed with HTTP ${response.status}. ${responseDetail}`
        : `Hosted email ingress wake append failed with HTTP ${response.status}.`,
    ) as Error & {
      status: number;
      statusCode: number;
    };
    error.status = response.status;
    error.statusCode = response.status;
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: {
        description: "Hosted email ingress wake append",
        path: HOSTED_WEB_HOSTED_MAILBOX_EMAIL_INGRESS_PATH,
        responseStatus: response.status,
        userId: input.boundUserId,
      },
      error,
      level: "warn",
      message: "Hosted email ingress control-plane response returned non-OK.",
      phase: "outbox",
      userId: input.boundUserId,
    });
    throw error;
  }

  return parseHostedEmailMailboxIngressAppendResponse(await response.json());
}

export async function startHostedEmailIngressNudgeWorkflowInWeb(input: {
  allowHttpHosts?: readonly string[];
  baseUrl: string;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  mailboxItemId: string;
  timeoutMs: number | null;
}): Promise<HostedEmailMailboxNudgeWorkflowStartResponse> {
  const body = JSON.stringify({
    mailboxItemId: input.mailboxItemId,
  });
  let response: Response;

  try {
    response = await fetchHostedExecutionWebControlPlaneResponse({
      ...(input.allowHttpHosts ? { allowHttpHosts: input.allowHttpHosts } : {}),
      baseUrl: input.baseUrl,
      body,
      boundUserId: input.boundUserId,
      callbackSigning: input.callbackSigning,
      fetchImpl: input.fetchImpl,
      method: "POST",
      path: HOSTED_WEB_HOSTED_MAILBOX_EMAIL_INGRESS_NUDGE_WORKFLOW_PATH,
      timeoutMs: input.timeoutMs,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: {
        description: "Hosted email ingress nudge workflow start",
        path: HOSTED_WEB_HOSTED_MAILBOX_EMAIL_INGRESS_NUDGE_WORKFLOW_PATH,
        userId: input.boundUserId,
      },
      error,
      level: "warn",
      message: "Hosted email ingress nudge workflow control-plane request failed.",
      phase: "outbox",
      userId: input.boundUserId,
    });
    throw error;
  }

  if (!response.ok) {
    const responseDetail = (await response.text()).trim();
    const error = new Error(
      responseDetail.length > 0
        ? `Hosted email ingress nudge workflow start failed with HTTP ${response.status}. ${responseDetail}`
        : `Hosted email ingress nudge workflow start failed with HTTP ${response.status}.`,
    ) as Error & {
      status: number;
      statusCode: number;
    };
    error.status = response.status;
    error.statusCode = response.status;
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: {
        description: "Hosted email ingress nudge workflow start",
        path: HOSTED_WEB_HOSTED_MAILBOX_EMAIL_INGRESS_NUDGE_WORKFLOW_PATH,
        responseStatus: response.status,
        userId: input.boundUserId,
      },
      error,
      level: "warn",
      message: "Hosted email ingress nudge workflow control-plane response returned non-OK.",
      phase: "outbox",
      userId: input.boundUserId,
    });
    throw error;
  }

  return parseHostedEmailMailboxNudgeWorkflowStartResponse(await response.json());
}

function parseHostedEmailMailboxIngressAppendResponse(
  value: unknown,
): HostedEmailMailboxIngressAppendResponse {
  if (!isRecord(value)) {
    throw new TypeError("Hosted email mailbox ingress append response must be an object.");
  }

  return {
    dedupeConflict: requireBoolean(
      value.dedupeConflict,
      "Hosted email mailbox ingress append response dedupeConflict",
    ),
    duplicate: requireBoolean(
      value.duplicate,
      "Hosted email mailbox ingress append response duplicate",
    ),
    inserted: requireBoolean(
      value.inserted,
      "Hosted email mailbox ingress append response inserted",
    ),
    item: parseHostedMailboxItem(value.item),
  };
}

function parseHostedEmailMailboxNudgeWorkflowStartResponse(
  value: unknown,
): HostedEmailMailboxNudgeWorkflowStartResponse {
  if (!isRecord(value)) {
    throw new TypeError("Hosted email mailbox nudge workflow response must be an object.");
  }

  return {
    runId: requireString(
      value.runId,
      "Hosted email mailbox nudge workflow response runId",
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}
