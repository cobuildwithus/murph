import { createHmac } from "node:crypto";

export interface JunctionWebhookReplayDirtyResource {
  payload: {
    eventType?: unknown;
    objectId?: unknown;
    webhookDataJson?: unknown;
  };
  resource: string;
  sourceProviderSlug: string;
}

export function buildSignedWebhookDataRecord(
  record: Record<string, unknown>,
  input: {
    externalAccountId: string;
    objectId: string;
    resource: string;
    sourceProviderSlug: string;
  },
): Record<string, unknown> {
  const sanitized = stripWebhookIdentityFields(record);

  return {
    ...sanitized,
    id: input.objectId,
    resource: input.resource,
    source: {
      provider: input.sourceProviderSlug,
    },
    user_id: input.externalAccountId,
  };
}

export function buildSignedJunctionWebhookBody(input: {
  dirtyResource: JunctionWebhookReplayDirtyResource;
  externalAccountId: string;
}): Record<string, unknown> {
  const webhookDataJson = readRequiredString(
    input.dirtyResource.payload.webhookDataJson,
    "dirtyResource.payload.webhookDataJson",
  );
  const record = readJsonRecord(JSON.parse(webhookDataJson));
  const objectId = readRequiredString(
    input.dirtyResource.payload.objectId,
    "dirtyResource.payload.objectId",
  );
  const eventType = readRequiredString(
    input.dirtyResource.payload.eventType,
    "dirtyResource.payload.eventType",
  );

  return {
    data: buildSignedWebhookDataRecord(record, {
      externalAccountId: input.externalAccountId,
      objectId,
      resource: input.dirtyResource.resource,
      sourceProviderSlug: input.dirtyResource.sourceProviderSlug,
    }),
    event_type: eventType,
    user_id: input.externalAccountId,
  };
}

export function createSignedJunctionSvixWebhook(input: {
  body: Record<string, unknown>;
  messageId: string;
  webhookSecret: string;
}): { headers: Headers; rawBody: Buffer } {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const rawBody = Buffer.from(JSON.stringify(input.body));
  const key = Buffer.from(input.webhookSecret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key)
    .update(Buffer.concat([Buffer.from(`${input.messageId}.${timestamp}.`), rawBody]))
    .digest("base64");

  return {
    headers: new Headers({
      "svix-id": input.messageId,
      "svix-signature": `v1,${signature}`,
      "svix-timestamp": timestamp,
    }),
    rawBody,
  };
}

function stripWebhookIdentityFields(value: Record<string, unknown>): Record<string, unknown> {
  const stripped: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isWebhookIdentityField(key)) {
      continue;
    }
    stripped[key] = stripWebhookIdentityValue(child);
  }
  return stripped;
}

function stripWebhookIdentityValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripWebhookIdentityValue);
  }

  const record = readOptionalJsonRecord(value);
  return record ? stripWebhookIdentityFields(record) : value;
}

function isWebhookIdentityField(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
  return normalized === "userid"
    || normalized === "clientuserid"
    || normalized === "user";
}

function readJsonRecord(value: unknown): Record<string, unknown> {
  const record = readOptionalJsonRecord(value);
  if (!record) {
    throw new TypeError("Expected JSON object.");
  }
  return record;
}

function readOptionalJsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}
