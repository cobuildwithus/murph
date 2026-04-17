/**
 * Hosted email routing keeps Cloudflare focused on reply-alias execution.
 * Public-sender and verified-owner authorization stay web-owned and are only
 * consulted through narrow signed callbacks.
 */

import {
  HOSTED_EMAIL_PUBLIC_SENDER_ROUTE_CALLBACK_USER_ID,
} from "@murphai/hosted-execution/hosted-email";
import { normalizeHostedEmailAddress } from "@murphai/runtime-state";

import type { R2BucketLike } from "../bundle-store.ts";
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
import {
  createHostedEmailRouteStore,
  type HostedEmailRouteStore,
} from "./route-store.ts";

export { isHostedEmailPublicSenderAddress } from "./route-addressing.ts";

export interface HostedEmailInboundRoute {
  authorization: "direct-public-sender" | "verified-email";
  identityId: string;
  routeAddress: string;
  userId: string;
}

interface HostedEmailRouteStoreContext {
  bucket: R2BucketLike;
  fetchImpl?: typeof fetch;
  hasRepeatedHeaderFrom?: boolean;
  headerFrom?: string | null;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  webCallbackSigning?: HostedWebCallbackSigningEnvironment | null;
  webControlBaseUrl?: string | null;
}

const HOSTED_WEB_EMAIL_AUTHORIZATION_TIMEOUT_MS = 1_500;
const HOSTED_WEB_EMAIL_PUBLIC_ROUTE_PATH = "/api/internal/hosted-execution/email/public-route";

export async function resolveHostedEmailIngressRoute(input: {
  bucket: R2BucketLike;
  config: HostedEmailConfig;
  envelopeFrom?: string | null;
  fetchImpl?: typeof fetch;
  hasRepeatedHeaderFrom?: boolean;
  headerFrom?: string | null;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  to: string;
  webCallbackSigning?: HostedWebCallbackSigningEnvironment | null;
  webControlBaseUrl?: string | null;
}): Promise<HostedEmailInboundRoute | null> {
  if (isHostedEmailPublicSenderAddress(input.to, input.config)) {
    return resolveHostedEmailPublicSenderIngressRoute(input);
  }

  return resolveHostedEmailInboundRoute({
    bucket: input.bucket,
    config: input.config,
    key: input.key,
    keyId: input.keyId,
    keysById: input.keysById,
    to: input.to,
  });
}

export async function createHostedEmailUserAddress(input: {
  bucket: R2BucketLike;
  config: HostedEmailConfig;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  userId: string;
}): Promise<string> {
  if (!input.config.domain || !input.config.signingSecret || !input.config.fromAddress) {
    throw new Error("Hosted email addressing is not configured.");
  }

  const aliasKey = await deriveStableHostedEmailKey(input.config.signingSecret, `user:${input.userId}`);
  const store = createHostedEmailRoutingStore(input);
  const existing = await store.readUserRoute(aliasKey);
  if (existing && existing.userId !== input.userId) {
    throw new Error("Hosted email user route is already assigned to a different user.");
  }
  if (!existing) {
    await store.writeUserRoute({
      aliasKey,
      userId: input.userId,
    });
  }

  return formatHostedEmailAddress(input.config, await createHostedEmailRouteToken({
    aliasKey,
    secret: input.config.signingSecret,
  }));
}

export async function resolveHostedEmailInboundRoute(input: {
  bucket: R2BucketLike;
  config: HostedEmailConfig;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  to: string;
}): Promise<HostedEmailInboundRoute | null> {
  const configuredSender = normalizeHostedEmailAddress(input.config.fromAddress);
  if (!input.config.domain || !input.config.signingSecret || !configuredSender) {
    return null;
  }

  const store = createHostedEmailRoutingStore(input);

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

  const record = await store.readUserRoute(token.aliasKey);
  if (!record) {
    return null;
  }

  return {
    authorization: "verified-email",
    identityId: configuredSender,
    routeAddress: candidate.address,
    userId: record.userId,
  };
}

async function resolveHostedEmailPublicSenderIngressRoute(
  input: HostedEmailRouteStoreContext & {
    config: HostedEmailConfig;
    envelopeFrom?: string | null;
    to: string;
  },
): Promise<HostedEmailInboundRoute | null> {
  const configuredSender = normalizeHostedEmailAddress(input.config.fromAddress);
  if (!configuredSender || !input.webCallbackSigning || !input.webControlBaseUrl) {
    return null;
  }

  try {
    const response = await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: input.webControlBaseUrl,
      body: JSON.stringify({
        envelopeFrom: input.envelopeFrom ?? null,
        hasRepeatedHeaderFrom: input.hasRepeatedHeaderFrom === true,
        headerFrom: input.headerFrom ?? null,
      }),
      boundUserId: HOSTED_EMAIL_PUBLIC_SENDER_ROUTE_CALLBACK_USER_ID,
      callbackSigning: input.webCallbackSigning,
      fetchImpl: input.fetchImpl,
      method: "POST",
      path: HOSTED_WEB_EMAIL_PUBLIC_ROUTE_PATH,
      timeoutMs: HOSTED_WEB_EMAIL_AUTHORIZATION_TIMEOUT_MS,
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as { userId?: unknown };
    const userId = typeof payload.userId === "string" && payload.userId.trim()
      ? payload.userId.trim()
      : null;

    if (!userId) {
      return null;
    }

    return {
      authorization: "direct-public-sender",
      identityId: configuredSender,
      routeAddress: input.to,
      userId,
    };
  } catch {
    return null;
  }
}

function createHostedEmailRoutingStore(input: HostedEmailRouteStoreContext): HostedEmailRouteStore {
  return createHostedEmailRouteStore({
    bucket: input.bucket,
    cryptoKey: input.key,
    cryptoKeyId: input.keyId,
    cryptoKeysById: input.keysById,
  });
}
