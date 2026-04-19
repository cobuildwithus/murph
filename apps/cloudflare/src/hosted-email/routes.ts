/**
 * Hosted email routing keeps Cloudflare focused on reply-alias execution.
 * Public-sender and verified-owner authorization stay web-owned and are only
 * consulted through narrow signed callbacks.
 */

import {
  HOSTED_EMAIL_PUBLIC_SENDER_ROUTE_CALLBACK_USER_ID,
} from "@murphai/hosted-execution/hosted-email";
import { normalizeHostedEmailAddress } from "@murphai/runtime-state";

import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "../web-control-plane.ts";
import type { HostedWebCallbackSigningEnvironment } from "../web-callback-auth.ts";
import type { HostedEmailConfig } from "./config.ts";
import {
  formatHostedEmailAddress,
  isHostedEmailPublicSenderAddress,
  parseHostedEmailRouteCandidate,
} from "./route-addressing.ts";
import {
  createHostedEmailRouteToken,
  deriveStableHostedEmailKey,
  parseHostedEmailRouteToken,
} from "./route-crypto.ts";

export { isHostedEmailPublicSenderAddress } from "./route-addressing.ts";

export interface HostedEmailInboundRoute {
  authorization: "direct-public-sender" | "verified-email";
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
  fetchImpl?: typeof fetch;
  hasRepeatedHeaderFrom?: boolean;
  headerFrom?: string | null;
  webCallbackSigning?: HostedWebCallbackSigningEnvironment | null;
  webControlBaseUrl?: string | null;
}

const HOSTED_WEB_EMAIL_CALLBACK_TIMEOUT_MS = 1_500;
const HOSTED_WEB_EMAIL_REGISTER_REPLY_ALIAS_PATH =
  "/api/internal/hosted-execution/email/register-reply-alias";
const HOSTED_WEB_EMAIL_RESOLVE_ROUTE_PATH =
  "/api/internal/hosted-execution/email/resolve-route";

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
  userId: string;
  webCallbackSigning?: HostedWebCallbackSigningEnvironment | null;
  webControlBaseUrl?: string | null;
}): Promise<string> {
  if (!input.config.domain || !input.config.signingSecret || !input.config.fromAddress) {
    throw new Error("Hosted email addressing is not configured.");
  }
  if (!input.webCallbackSigning || !input.webControlBaseUrl) {
    throw new Error("Hosted email route registration callback is not configured.");
  }

  const aliasKey = await deriveStableHostedEmailKey(
    input.config.signingSecret,
    `user:${input.userId}`,
  );
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.webControlBaseUrl,
    body: JSON.stringify({
      aliasKey,
    }),
    boundUserId: input.userId,
    callbackSigning: input.webCallbackSigning,
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: HOSTED_WEB_EMAIL_REGISTER_REPLY_ALIAS_PATH,
    timeoutMs: HOSTED_WEB_EMAIL_CALLBACK_TIMEOUT_MS,
  }).catch((error: unknown) => {
    throw new Error(
      `Hosted email route registration failed: ${formatHostedEmailRouteErrorDetails(error)}`,
    );
  });

  if (!response.ok) {
    throw new Error(`Hosted email route registration failed with HTTP ${response.status}.`);
  }

  return formatHostedEmailAddress(
    input.config,
    await createHostedEmailRouteToken({
      aliasKey,
      secret: input.config.signingSecret,
    }),
  );
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
  });
  if (!userId) {
    return null;
  }

  return {
    authorization: "verified-email",
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
  });
  if (!userId) {
    return null;
  }

  return {
    authorization: "direct-public-sender",
    identityId: configuredSender,
    routeAddress: input.to,
    userId,
  };
}

async function resolveHostedEmailRouteUserId(input: {
  aliasKey: string | null;
  context: HostedEmailRouteCallbackContext & {
    envelopeFrom?: string | null;
    webCallbackSigning?: HostedWebCallbackSigningEnvironment | null;
    webControlBaseUrl?: string | null;
  };
}): Promise<string | null> {
  if (!input.context.webCallbackSigning || !input.context.webControlBaseUrl) {
    throw new HostedEmailIngressRouteResolutionError(
      "Hosted email route resolution callback is not configured.",
    );
  }

  let response: Response;
  try {
    response = await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: input.context.webControlBaseUrl,
      body: JSON.stringify({
        ...(input.aliasKey ? { aliasKey: input.aliasKey } : {}),
        envelopeFrom: input.context.envelopeFrom ?? null,
        hasRepeatedHeaderFrom: input.context.hasRepeatedHeaderFrom === true,
        headerFrom: input.context.headerFrom ?? null,
      }),
      boundUserId: HOSTED_EMAIL_PUBLIC_SENDER_ROUTE_CALLBACK_USER_ID,
      callbackSigning: input.context.webCallbackSigning,
      fetchImpl: input.context.fetchImpl,
      method: "POST",
      path: HOSTED_WEB_EMAIL_RESOLVE_ROUTE_PATH,
      timeoutMs: HOSTED_WEB_EMAIL_CALLBACK_TIMEOUT_MS,
    });
  } catch (error) {
    throw new HostedEmailIngressRouteResolutionError(
      `Hosted email route resolution failed: ${formatHostedEmailRouteErrorDetails(error)}`,
    );
  }

  if (!response.ok) {
    throw new HostedEmailIngressRouteResolutionError(
      `Hosted email route resolution failed with HTTP ${response.status}.`,
    );
  }

  let payload: { userId?: unknown };
  try {
    payload = await response.json() as { userId?: unknown };
  } catch (error) {
    throw new HostedEmailIngressRouteResolutionError(
      `Hosted email route resolution returned invalid JSON: ${formatHostedEmailRouteErrorDetails(error)}`,
    );
  }

  if (payload.userId === null) {
    return null;
  }

  const userId = typeof payload.userId === "string" && payload.userId.trim()
    ? payload.userId.trim()
    : null;
  if (!userId) {
    throw new HostedEmailIngressRouteResolutionError(
      "Hosted email route resolution returned an invalid payload.",
    );
  }

  return userId;
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
