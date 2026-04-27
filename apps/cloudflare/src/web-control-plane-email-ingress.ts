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

export interface HostedEmailMailboxIngressAppendResponse {
  dedupeConflict: boolean;
  duplicate: boolean;
  inserted: boolean;
  item: HostedMailboxItem;
}

export async function appendHostedEmailIngressWakeInWeb(input: {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}
