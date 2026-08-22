/**
 * Hosted email routing keeps Cloudflare focused on reply-alias execution.
 * Public-sender and verified-owner authorization stay web-owned and are only
 * consulted through narrow signed callbacks.
 */

import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  createHostedEmailGroupReplyAliasRoute,
  createHostedEmailReplyAliasRoute,
  HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH,
  HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
  HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
  parseHostedEmailReplyAliasRegistrationCallbackResponse,
  parseHostedEmailRouteResolutionCallbackResponse,
} from "@murphai/hosted-execution/hosted-email";
import {
  isHostedEmailAuthenticatedSenderVerdictAccepted,
  normalizeHostedEmailAddress,
  type HostedEmailAuthenticatedSenderVerdict,
} from "@murphai/runtime-state";

import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "../web-control-plane.ts";
import type { HostedWebCallbackSigningEnvironment } from "../web-callback-auth.ts";
import type { HostedEmailConfig } from "./config.ts";
import {
  isHostedEmailPublicSenderAddress,
  parseHostedEmailRouteCandidate,
} from "./route-addressing.ts";
import {
  parseHostedEmailRouteToken,
} from "./route-crypto.ts";

export { isHostedEmailPublicSenderAddress } from "./route-addressing.ts";

export interface HostedEmailInboundRoute {
  authorization: "direct-public-sender" | "signed-reply-alias";
  groupId: string | null;
  identityId: string;
  routeAddress: string;
  userId: string;
}

export class HostedEmailIngressRouteResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostedEmailIngressRouteResolutionError";
  }
}

interface HostedEmailRouteCallbackContext {
  authenticatedSender?: HostedEmailAuthenticatedSenderVerdict | null;
  fetchImpl?: typeof fetch;
  hasRepeatedHeaderFrom?: boolean;
  headerFrom?: string | null;
  webCallbackSigning?: HostedWebCallbackSigningEnvironment | null;
  webControlAllowHttpHosts?: readonly string[];
  webControlBaseUrl?: string | null;
}

const HOSTED_WEB_EMAIL_CALLBACK_TIMEOUT_MS = 1_500;
export async function resolveHostedEmailIngressRoute(input: HostedEmailRouteCallbackContext & {
  config: HostedEmailConfig;
  envelopeFrom?: string | null;
  to: string;
}): Promise<HostedEmailInboundRoute | null> {
  if (isHostedEmailPublicSenderAddress(input.to, input.config)) {
    return resolveHostedEmailPublicSenderIngressRoute(input);
  }

  return resolveHostedEmailInboundRoute(input);
}

export async function createHostedEmailUserAddress(input: {
  config: HostedEmailConfig;
  fetchImpl?: typeof fetch;
  groupId?: string | null;
  userId: string;
  webCallbackSigning?: HostedWebCallbackSigningEnvironment | null;
  webControlAllowHttpHosts?: readonly string[];
  webControlBaseUrl?: string | null;
}): Promise<string> {
  if (!input.config.domain || !input.config.signingSecret || !input.config.fromAddress) {
    throw new Error("Hosted email addressing is not configured.");
  }
  const groupId = typeof input.groupId === "string" && input.groupId.trim()
    ? input.groupId.trim()
    : null;
  if (groupId) {
    const replyAlias = await createHostedEmailGroupReplyAliasRoute({
      domain: input.config.domain,
      groupId,
      localPart: input.config.localPart,
      signingSecret: input.config.signingSecret,
    });
    return replyAlias.address;
  }

  if (!input.webCallbackSigning || !input.webControlBaseUrl) {
    throw new Error("Hosted email route registration callback is not configured.");
  }

  let response: Response;
  try {
    response = await fetchHostedExecutionWebControlPlaneResponse({
      ...(input.webControlAllowHttpHosts ? { allowHttpHosts: input.webControlAllowHttpHosts } : {}),
      baseUrl: input.webControlBaseUrl,
      // Web owns the current generation. A new Worker against an old Web fails
      // closed because the old endpoint rejects null; an old Worker against a
      // rotated Web receives 409 rather than restoring the deterministic alias.
      body: JSON.stringify({ aliasKey: null }),
      boundUserId: input.userId,
      callbackSigning: input.webCallbackSigning,
      fetchImpl: input.fetchImpl,
      method: "POST",
      path: HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH,
      timeoutMs: HOSTED_WEB_EMAIL_CALLBACK_TIMEOUT_MS,
    });
  } catch (error) {
    const wrappedError = new Error(
      `Hosted email route registration failed: ${formatHostedEmailRouteErrorDetails(error)}`,
      { cause: error },
    );
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: {
        operation: "register-reply-alias",
        path: HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH,
        userId: input.userId,
        webControlOrigin: readHostedWebControlOrigin(input.webControlBaseUrl),
      },
      error: wrappedError,
      level: "warn",
      message: "Hosted email route registration request failed.",
      phase: "outbox",
      userId: input.userId,
    });
    throw wrappedError;
  }

  if (!response.ok) {
    const responseDetail = (await response.text()).trim();
    const error = new Error(
      responseDetail.length > 0
        ? `Hosted email route registration failed with HTTP ${response.status}. ${responseDetail}`
        : `Hosted email route registration failed with HTTP ${response.status}.`,
    ) as Error & {
      status: number;
      statusCode: number;
    };
    error.status = response.status;
    error.statusCode = response.status;
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: {
        operation: "register-reply-alias",
        path: HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH,
        responseStatus: response.status,
        userId: input.userId,
        webControlOrigin: readHostedWebControlOrigin(input.webControlBaseUrl),
      },
      error,
      level: "warn",
      message: "Hosted email route registration response returned non-OK.",
      phase: "outbox",
      userId: input.userId,
    });
    throw error;
  }

  const payload = parseHostedEmailReplyAliasRegistrationCallbackResponse(
    await response.json(),
  );
  const expectedRoute = await createHostedEmailReplyAliasRoute({
    aliasKey: payload.aliasKey,
    domain: input.config.domain,
    localPart: input.config.localPart,
    signingSecret: input.config.signingSecret,
  });
  if (payload.address !== expectedRoute.address) {
    throw new Error("Hosted email route registration returned an inconsistent alias address.");
  }

  return payload.address;
}

export async function resolveHostedEmailInboundRoute(
  input: HostedEmailRouteCallbackContext & {
    config: HostedEmailConfig;
    envelopeFrom?: string | null;
    to: string;
  },
): Promise<HostedEmailInboundRoute | null> {
  const configuredSender = normalizeHostedEmailAddress(input.config.fromAddress);
  if (!input.config.domain || !input.config.signingSecret || !configuredSender) {
    return null;
  }

  const candidate = parseHostedEmailRouteCandidate(input.to, input.config);
  if (!candidate) {
    return null;
  }

  const token = await parseHostedEmailRouteToken({
    secret: input.config.signingSecret,
    token: candidate.detail,
  });
  if (!token) {
    return null;
  }

  const userId = await resolveHostedEmailRouteUserId({
    aliasKey: token.aliasKey,
    context: input,
    groupId: token.groupId ?? null,
  });
  if (!userId) {
    return null;
  }

  return {
    authorization: "signed-reply-alias",
    groupId: token.groupId ?? null,
    identityId: configuredSender,
    routeAddress: candidate.address,
    userId,
  };
}

async function resolveHostedEmailPublicSenderIngressRoute(
  input: HostedEmailRouteCallbackContext & {
    config: HostedEmailConfig;
    envelopeFrom?: string | null;
    to: string;
  },
): Promise<HostedEmailInboundRoute | null> {
  const configuredSender = normalizeHostedEmailAddress(input.config.fromAddress);
  if (!configuredSender) {
    throw new HostedEmailIngressRouteResolutionError(
      "Hosted email public-sender routing is not configured.",
    );
  }

  const userId = await resolveHostedEmailRouteUserId({
    aliasKey: null,
    context: input,
    groupId: null,
  });
  if (!userId) {
    return null;
  }

  return {
    authorization: "direct-public-sender",
    groupId: null,
    identityId: configuredSender,
    routeAddress: input.to,
    userId,
  };
}

async function resolveHostedEmailRouteUserId(input: {
  aliasKey: string | null;
  context: HostedEmailRouteCallbackContext & {
    authenticatedSender?: HostedEmailAuthenticatedSenderVerdict | null;
    envelopeFrom?: string | null;
    webCallbackSigning?: HostedWebCallbackSigningEnvironment | null;
    webControlBaseUrl?: string | null;
  };
  groupId: string | null;
}): Promise<string | null> {
  if (
    input.aliasKey === null
    && input.groupId === null
    && !isHostedEmailAuthenticatedSenderVerdictAccepted(input.context.authenticatedSender)
  ) {
    return null;
  }

  if (!input.context.webCallbackSigning || !input.context.webControlBaseUrl) {
    throw new HostedEmailIngressRouteResolutionError(
      "Hosted email route resolution callback is not configured.",
    );
  }

  let response: Response;
  try {
    response = await fetchHostedExecutionWebControlPlaneResponse({
      ...(input.context.webControlAllowHttpHosts
        ? { allowHttpHosts: input.context.webControlAllowHttpHosts }
        : {}),
      baseUrl: input.context.webControlBaseUrl,
      body: JSON.stringify(input.aliasKey
        ? { aliasKey: input.aliasKey }
        : input.groupId
          ? {
            envelopeFrom: input.context.envelopeFrom ?? null,
            groupId: input.groupId,
            hasRepeatedHeaderFrom: input.context.hasRepeatedHeaderFrom === true,
            headerFrom: input.context.headerFrom ?? null,
          }
          : {
            authenticatedSender: input.context.authenticatedSender ?? null,
            envelopeFrom: input.context.envelopeFrom ?? null,
            hasRepeatedHeaderFrom: input.context.hasRepeatedHeaderFrom === true,
            headerFrom: input.context.headerFrom ?? null,
          }),
      boundUserId: HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
      callbackSigning: input.context.webCallbackSigning,
      fetchImpl: input.context.fetchImpl,
      method: "POST",
      path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
      timeoutMs: HOSTED_WEB_EMAIL_CALLBACK_TIMEOUT_MS,
    });
  } catch (error) {
    const wrappedError = new HostedEmailIngressRouteResolutionError(
      `Hosted email route resolution failed: ${formatHostedEmailRouteErrorDetails(error)}`,
    );
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: buildHostedEmailRouteLogDetails({
        envelopeFrom: input.context.envelopeFrom,
        headerFrom: input.context.headerFrom,
        operation: "resolve-route-user-id",
        path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
        webControlBaseUrl: input.context.webControlBaseUrl,
      }),
      error: wrappedError,
      level: "warn",
      message: "Hosted email route resolution request failed.",
      phase: "outbox",
      userId: null,
    });
    throw wrappedError;
  }

  if (!response.ok) {
    const responseDetail = (await response.text()).trim();
    const error = new HostedEmailIngressRouteResolutionError(
      responseDetail.length > 0
        ? `Hosted email route resolution failed with HTTP ${response.status}. ${responseDetail}`
        : `Hosted email route resolution failed with HTTP ${response.status}.`,
    );
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: buildHostedEmailRouteLogDetails({
        envelopeFrom: input.context.envelopeFrom,
        headerFrom: input.context.headerFrom,
        operation: "resolve-route-user-id",
        path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
        responseStatus: response.status,
        webControlBaseUrl: input.context.webControlBaseUrl,
      }),
      error,
      level: "warn",
      message: "Hosted email route resolution response returned non-OK.",
      phase: "outbox",
      userId: null,
    });
    throw error;
  }

  let payload: { userId: string | null };
  try {
    payload = parseHostedEmailRouteResolutionCallbackResponse(await response.json());
  } catch (error) {
    const wrappedError = new HostedEmailIngressRouteResolutionError(
      `Hosted email route resolution returned invalid JSON: ${formatHostedEmailRouteErrorDetails(error)}`,
    );
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: buildHostedEmailRouteLogDetails({
        envelopeFrom: input.context.envelopeFrom,
        headerFrom: input.context.headerFrom,
        operation: "resolve-route-user-id",
        path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
        responseStatus: response.status,
        webControlBaseUrl: input.context.webControlBaseUrl,
      }),
      error: wrappedError,
      level: "warn",
      message: "Hosted email route resolution returned invalid JSON.",
      phase: "outbox",
      userId: null,
    });
    throw wrappedError;
  }

  if (payload.userId === null) {
    return null;
  }

  const userId = typeof payload.userId === "string" && payload.userId.trim()
    ? payload.userId.trim()
    : null;
  if (!userId) {
    const error = new HostedEmailIngressRouteResolutionError(
      "Hosted email route resolution returned an invalid payload.",
    );
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: buildHostedEmailRouteLogDetails({
        envelopeFrom: input.context.envelopeFrom,
        headerFrom: input.context.headerFrom,
        operation: "resolve-route-user-id",
        path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
        responseStatus: response.status,
        webControlBaseUrl: input.context.webControlBaseUrl,
      }),
      error,
      level: "warn",
      message: "Hosted email route resolution returned an invalid payload.",
      phase: "outbox",
      userId: null,
    });
    throw error;
  }

  return userId;
}

function readHostedWebControlOrigin(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function buildHostedEmailRouteLogDetails(input: {
  envelopeFrom?: string | null;
  headerFrom?: string | null;
  operation: string;
  path: string;
  responseStatus?: number;
  webControlBaseUrl?: string | null;
}): Record<string, number | string | boolean> {
  return {
    hasEnvelopeFrom: Boolean(input.envelopeFrom),
    hasHeaderFrom: Boolean(input.headerFrom),
    operation: input.operation,
    path: input.path,
    ...(input.responseStatus === undefined ? {} : { responseStatus: input.responseStatus }),
    ...(readHostedWebControlOrigin(input.webControlBaseUrl)
      ? { webControlOrigin: readHostedWebControlOrigin(input.webControlBaseUrl) as string }
      : {}),
  };
}

function formatHostedEmailRouteErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : error.name;
  }

  if (typeof error === "string") {
    const trimmed = error.trim();
    return trimmed.length > 0 ? trimmed : "unknown error";
  }

  return "unknown error";
}
