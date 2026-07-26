import "server-only";

import {
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
  type HostedSecureBoxPrismaClient,
} from "../hosted-crypto/secure-box";
import { normalizeHostedOpaqueInput } from "../hosted-onboarding/contact-privacy";

export const HOSTED_THREAD_DELIVERY_ROUTE_SCHEMA =
  "murph.hosted-thread-delivery-route.v1";
const HOSTED_THREAD_DELIVERY_ROUTE_FIELD = "delivery_route_encrypted";
const HOSTED_THREAD_DELIVERY_ROUTE_SCOPE =
  "hosted-thread-route:delivery-route:v1";
const HOSTED_THREAD_DELIVERY_ROUTE_VALUE_MAX_CHARS = 16_384;
const HOSTED_THREAD_DELIVERY_ROUTE_PART_MAX_CHARS = 4_096;

export const HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY = "telegram:bot";

export type HostedThreadDeliveryRouteChannel = "linq" | "telegram";

export type HostedThreadDeliveryRouteV1 =
  | {
      accountLookupKey: string;
      channel: "linq";
      schema: typeof HOSTED_THREAD_DELIVERY_ROUTE_SCHEMA;
      threadId: string;
    }
  | {
      channel: "telegram";
      schema: typeof HOSTED_THREAD_DELIVERY_ROUTE_SCHEMA;
      threadId: string;
    };

export function isHostedThreadDeliveryRouteChannel(
  value: string,
): value is HostedThreadDeliveryRouteChannel {
  return value === "linq" || value === "telegram";
}

export function buildHostedThreadDeliveryRoute(input: {
  accountLookupKey: string | null | undefined;
  channel: HostedThreadDeliveryRouteChannel;
  threadId: string | number;
}): HostedThreadDeliveryRouteV1 {
  const threadId = requireHostedThreadDeliveryRouteString(
    normalizeHostedOpaqueInput(input.threadId),
  );

  if (input.channel === "linq") {
    return {
      accountLookupKey: requireHostedThreadDeliveryRouteString(
        input.accountLookupKey,
      ),
      channel: "linq",
      schema: HOSTED_THREAD_DELIVERY_ROUTE_SCHEMA,
      threadId,
    };
  }

  if (
    requireHostedThreadDeliveryRouteString(input.accountLookupKey)
    !== HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY
  ) {
    throw new TypeError(
      "Hosted Telegram thread routes require the canonical account lookup key.",
    );
  }
  return {
    channel: "telegram",
    schema: HOSTED_THREAD_DELIVERY_ROUTE_SCHEMA,
    threadId,
  };
}

export function serializeHostedThreadDeliveryRouteV1(
  value: HostedThreadDeliveryRouteV1,
): string {
  const serialized = JSON.stringify(value);
  if (serialized.length > HOSTED_THREAD_DELIVERY_ROUTE_VALUE_MAX_CHARS) {
    throw new TypeError("Hosted thread delivery route is too large.");
  }
  return serialized;
}

export function parseHostedThreadDeliveryRouteV1(
  value: string,
): HostedThreadDeliveryRouteV1 {
  if (
    value.length === 0
    || value.length > HOSTED_THREAD_DELIVERY_ROUTE_VALUE_MAX_CHARS
  ) {
    throw new TypeError("Hosted thread delivery route is invalid.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("Hosted thread delivery route is invalid.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Hosted thread delivery route is invalid.");
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema !== HOSTED_THREAD_DELIVERY_ROUTE_SCHEMA) {
    throw new TypeError("Hosted thread delivery route schema is invalid.");
  }

  const channel = record.channel;
  if (channel === "linq") {
    assertExactHostedThreadDeliveryRouteKeys(record, [
      "accountLookupKey",
      "channel",
      "schema",
      "threadId",
    ]);
    return {
      accountLookupKey: requireHostedThreadDeliveryRouteString(
        record.accountLookupKey,
      ),
      channel,
      schema: HOSTED_THREAD_DELIVERY_ROUTE_SCHEMA,
      threadId: requireHostedThreadDeliveryRouteString(record.threadId),
    };
  }

  if (channel === "telegram") {
    assertExactHostedThreadDeliveryRouteKeys(record, [
      "channel",
      "schema",
      "threadId",
    ]);
    return {
      channel,
      schema: HOSTED_THREAD_DELIVERY_ROUTE_SCHEMA,
      threadId: requireHostedThreadDeliveryRouteString(record.threadId),
    };
  }

  throw new TypeError("Hosted thread delivery route channel is invalid.");
}

export async function sealHostedThreadDeliveryRoute(input: {
  containerMemberId: string;
  prisma?: HostedSecureBoxPrismaClient;
  route: HostedThreadDeliveryRouteV1;
  signal?: AbortSignal;
}): Promise<string> {
  const encrypted = await sealHostedUserSecureBoxString({
    aad: buildHostedThreadDeliveryRouteAad({
      channel: input.route.channel,
      containerMemberId: input.containerMemberId,
    }),
    lane: "hosted-member-private-field",
    prisma: input.prisma,
    scope: HOSTED_THREAD_DELIVERY_ROUTE_SCOPE,
    signal: input.signal,
    userId: input.containerMemberId,
    value: serializeHostedThreadDeliveryRouteV1(input.route),
  });
  if (!encrypted) {
    throw new Error("Hosted thread delivery route encryption returned no value.");
  }
  return encrypted;
}

export async function openHostedThreadDeliveryRoute(input: {
  channel: HostedThreadDeliveryRouteChannel;
  containerMemberId: string;
  encrypted: string | null | undefined;
  prisma?: HostedSecureBoxPrismaClient;
  signal?: AbortSignal;
}): Promise<HostedThreadDeliveryRouteV1> {
  const serialized = await openHostedUserSecureBoxString({
    aad: buildHostedThreadDeliveryRouteAad({
      channel: input.channel,
      containerMemberId: input.containerMemberId,
    }),
    lane: "hosted-member-private-field",
    prisma: input.prisma,
    scope: HOSTED_THREAD_DELIVERY_ROUTE_SCOPE,
    signal: input.signal,
    userId: input.containerMemberId,
    value: input.encrypted,
  });
  if (!serialized) {
    throw new TypeError("Hosted thread delivery route is required.");
  }
  const route = parseHostedThreadDeliveryRouteV1(serialized);
  if (route.channel !== input.channel) {
    throw new TypeError("Hosted thread delivery route channel is invalid.");
  }
  return route;
}

function buildHostedThreadDeliveryRouteAad(input: {
  channel: HostedThreadDeliveryRouteChannel;
  containerMemberId: string;
}) {
  return {
    field: HOSTED_THREAD_DELIVERY_ROUTE_FIELD,
    objectKey: input.channel,
    purpose: "hosted-thread-route-delivery",
    rowId: input.containerMemberId,
    table: "hosted_thread_route",
  } as const;
}

function assertExactHostedThreadDeliveryRouteKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): void {
  const actualKeys = Object.keys(value).sort();
  const normalizedExpectedKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== normalizedExpectedKeys.length
    || actualKeys.some((key, index) => key !== normalizedExpectedKeys[index])
  ) {
    throw new TypeError("Hosted thread delivery route fields are invalid.");
  }
}

function requireHostedThreadDeliveryRouteString(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    normalized.length === 0
    || normalized.length > HOSTED_THREAD_DELIVERY_ROUTE_PART_MAX_CHARS
  ) {
    throw new TypeError("Hosted thread delivery route value is invalid.");
  }
  return normalized;
}
