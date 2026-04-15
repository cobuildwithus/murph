import type {
  HostedExecutionDispatchRequest,
  HostedExecutionEventKind,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedExecutionDispatchRequest,
} from "@murphai/hosted-execution/parsers";

import type { R2BucketLike } from "./bundle-store.js";
import { buildHostedStorageAad } from "./crypto-context.js";
import {
  hostedDispatchPayloadObjectKeyForSignature,
} from "./storage-paths.js";
import {
  readEncryptedR2Json,
  writeEncryptedR2Json,
} from "./crypto.js";
import { stringifyStructuredJson } from "./structured-json.js";

const HOSTED_EXECUTION_EVENT_KINDS = [
  "member.activated",
  "member.channels.updated",
  "linq.message.received",
  "telegram.message.received",
  "email.message.received",
  "assistant.cron.tick",
  "device-sync.wake",
  "vault.share.accepted",
  "gateway.message.send",
] as const satisfies readonly HostedExecutionEventKind[];

const HOSTED_EXECUTION_REFERENCE_ONLY_OUTBOX_EVENT_KINDS = [
  "linq.message.received",
  "telegram.message.received",
  "email.message.received",
  "device-sync.wake",
  "gateway.message.send",
] as const satisfies readonly HostedExecutionEventKind[];

const HOSTED_EXECUTION_EVENT_KIND_SET = new Set<HostedExecutionEventKind>(HOSTED_EXECUTION_EVENT_KINDS);
const HOSTED_EXECUTION_REFERENCE_ONLY_OUTBOX_EVENT_KIND_SET = new Set<HostedExecutionEventKind>(
  HOSTED_EXECUTION_REFERENCE_ONLY_OUTBOX_EVENT_KINDS,
);
const HOSTED_EXECUTION_DISPATCH_REF_KEYS = new Set([
  "eventId",
  "eventKind",
  "occurredAt",
  "userId",
]);
const HOSTED_EXECUTION_INLINE_OUTBOX_PAYLOAD_KEYS = new Set([
  "dispatch",
  "storage",
]);
const HOSTED_EXECUTION_REFERENCE_OUTBOX_PAYLOAD_KEYS = new Set([
  "dispatchRef",
  "stagedPayloadId",
  "storage",
]);

export type HostedExecutionOutboxPayloadStorage = "inline" | "reference";

export interface HostedExecutionDispatchRef {
  eventId: string;
  eventKind: HostedExecutionEventKind;
  occurredAt: string;
  userId: string;
}

export interface HostedExecutionInlineOutboxPayload {
  dispatch: HostedExecutionDispatchRequest;
  storage: "inline";
}

export interface HostedExecutionReferenceOutboxPayload {
  dispatchRef: HostedExecutionDispatchRef;
  stagedPayloadId: string;
  storage: "reference";
}

export type HostedExecutionOutboxPayload =
  | HostedExecutionInlineOutboxPayload
  | HostedExecutionReferenceOutboxPayload;

export type HostedExecutionDispatchPayloadRef = Pick<
  HostedExecutionReferenceOutboxPayload,
  "stagedPayloadId"
>;

export interface HostedDispatchPayloadStore {
  deleteDispatchPayload(ref: HostedExecutionDispatchPayloadRef): Promise<void>;
  deleteStoredPayloadEnvelope(payloadJson: unknown): Promise<void>;
  readDispatchPayload(
    ref: HostedExecutionDispatchPayloadRef,
  ): Promise<HostedExecutionDispatchRequest | null>;
  readStoredDispatch(payloadJson: unknown): Promise<HostedExecutionDispatchRequest>;
  readStoredDispatchRef(payloadJson: unknown): HostedExecutionDispatchRef | null;
  writeDispatchPayload(
    dispatch: HostedExecutionDispatchRequest,
  ): Promise<HostedExecutionDispatchPayloadRef>;
  writeStoredDispatch(dispatch: HostedExecutionDispatchRequest): Promise<HostedExecutionOutboxPayload>;
}

const textEncoder = new TextEncoder();

export function createHostedDispatchPayloadStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}): HostedDispatchPayloadStore {
  return {
    async deleteDispatchPayload(ref) {
      if (!input.bucket.delete) {
        return;
      }

      await input.bucket.delete(ref.stagedPayloadId);
    },

    async deleteStoredPayloadEnvelope(payloadJson) {
      const payload = readStoredDispatchPayloadEnvelope(payloadJson);

      if (!payload || payload.storage !== "reference") {
        return;
      }

      await this.deleteDispatchPayload({ stagedPayloadId: payload.stagedPayloadId });
    },

    async readDispatchPayload(ref) {
      return readEncryptedR2Json({
        aad: buildCurrentDispatchPayloadAad(ref.stagedPayloadId),
        bucket: input.bucket,
        cryptoKey: input.key,
        cryptoKeysById: input.keysById,
        expectedKeyId: input.keyId,
        key: ref.stagedPayloadId,
        parse(value) {
          return parseHostedExecutionDispatchRequest(value);
        },
        scope: "dispatch-payload",
      });
    },

    async readStoredDispatch(payloadJson) {
      const payload = readStoredDispatchPayloadEnvelope(payloadJson);

      if (payload?.storage === "inline") {
        return payload.dispatch;
      }

      if (payload?.storage === "reference") {
        const dispatch = await this.readDispatchPayload({
          stagedPayloadId: payload.stagedPayloadId,
        });

        if (!dispatch) {
          throw new Error(
            `Hosted dispatch payload ${payload.dispatchRef.userId}/${payload.dispatchRef.eventId} is missing from R2.`,
          );
        }

        assertHostedDispatchMatchesRef(dispatch, payload.dispatchRef);
        return dispatch;
      }

      throw new TypeError("Hosted dispatch payload envelope is invalid.");
    },

    readStoredDispatchRef(payloadJson) {
      try {
        const payload = readStoredDispatchPayloadEnvelope(payloadJson);

        if (payload?.storage === "reference") {
          return payload.dispatchRef;
        }

        if (payload?.storage === "inline") {
          return buildHostedExecutionDispatchRef(payload.dispatch);
        }

        return null;
      } catch {
        return null;
      }
    },

    async writeDispatchPayload(dispatch) {
      const normalizedDispatch = parseHostedExecutionDispatchRequest(dispatch);
      const stagedPayloadId = await hostedDispatchPayloadObjectKeyForSignature(
        input.key,
        normalizedDispatch.event.userId,
        normalizedDispatch.eventId,
        await createHostedDispatchPayloadSignature(normalizedDispatch),
      );
      await writeEncryptedR2Json({
        aad: buildCurrentDispatchPayloadAad(stagedPayloadId),
        bucket: input.bucket,
        cryptoKey: input.key,
        key: stagedPayloadId,
        keyId: input.keyId,
        scope: "dispatch-payload",
        value: normalizedDispatch,
      });

      return { stagedPayloadId };
    },

    async writeStoredDispatch(dispatch) {
      const normalizedDispatch = parseHostedExecutionDispatchRequest(dispatch);
      const storage = resolveHostedExecutionOutboxPayloadStorage(normalizedDispatch, "auto");

      if (storage === "inline") {
        return buildHostedExecutionOutboxPayload(normalizedDispatch, { storage });
      }

      const payloadRef = await this.writeDispatchPayload(normalizedDispatch);
      return buildHostedExecutionOutboxPayload(normalizedDispatch, {
        stagedPayloadId: payloadRef.stagedPayloadId,
        storage,
      });
    },
  };
}

function readStoredDispatchPayloadEnvelope(payloadJson: unknown): HostedExecutionOutboxPayload | null {
  if (typeof payloadJson === "string") {
    try {
      return readHostedExecutionOutboxPayload(JSON.parse(payloadJson) as unknown);
    } catch {
      return null;
    }
  }

  return readHostedExecutionOutboxPayload(payloadJson);
}

function buildCurrentDispatchPayloadAad(key: string): Uint8Array {
  return buildHostedStorageAad({
    key,
    purpose: "dispatch-payload",
  });
}

function assertHostedDispatchMatchesRef(
  dispatch: HostedExecutionDispatchRequest,
  dispatchRef: HostedExecutionDispatchRef,
): void {
  if (
    dispatch.eventId === dispatchRef.eventId
    && dispatch.event.kind === dispatchRef.eventKind
    && dispatch.event.userId === dispatchRef.userId
    && dispatch.occurredAt === dispatchRef.occurredAt
  ) {
    return;
  }

  throw new Error(
    `Hosted dispatch payload ${dispatchRef.userId}/${dispatchRef.eventId} does not match its stored dispatch ref.`,
  );
}

async function createHostedDispatchPayloadSignature(
  dispatch: HostedExecutionDispatchRequest,
): Promise<string> {
  const canonicalJson = stringifyStructuredJson(parseHostedExecutionDispatchRequest(dispatch));
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(canonicalJson));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function resolveHostedRunnerDispatchPayloadStorage(
  dispatch: HostedExecutionDispatchRequest,
) {
  return resolveHostedExecutionOutboxPayloadStorage(dispatch, "auto");
}

export const createHostedExecutionDispatchPayloadStore = createHostedDispatchPayloadStore;

export function buildHostedExecutionDispatchRef(
  dispatch: HostedExecutionDispatchRequest,
): HostedExecutionDispatchRef {
  return {
    eventId: dispatch.eventId,
    eventKind: dispatch.event.kind,
    occurredAt: dispatch.occurredAt,
    userId: dispatch.event.userId,
  };
}

export function buildHostedExecutionOutboxPayload(
  dispatch: HostedExecutionDispatchRequest,
  options: {
    stagedPayloadId?: string | null;
    storage?: HostedExecutionOutboxPayloadStorage | "auto";
  } = {},
): HostedExecutionOutboxPayload {
  const normalizedDispatch = parseHostedExecutionDispatchRequest(dispatch);
  const storage = resolveHostedExecutionOutboxPayloadStorage(
    normalizedDispatch,
    options.storage ?? "auto",
  );

  if (storage === "inline") {
    return {
      dispatch: normalizedDispatch,
      storage,
    };
  }

  const stagedPayloadId = requireText(
    options.stagedPayloadId,
    `Hosted execution ${normalizedDispatch.event.kind} reference payloads require a staged payload id.`,
  );

  return {
    dispatchRef: buildHostedExecutionDispatchRef(normalizedDispatch),
    stagedPayloadId,
    storage,
  };
}

export function readHostedExecutionOutboxPayload(
  payloadJson: unknown,
): HostedExecutionOutboxPayload | null {
  const payloadObject = toObject(payloadJson);

  switch (readText(payloadObject.storage)) {
    case "inline":
      return readHostedExecutionInlineOutboxPayload(payloadObject);
    case "reference":
      return readHostedExecutionReferenceOutboxPayload(payloadObject);
    default:
      return null;
  }
}

export function resolveHostedExecutionOutboxPayloadStorage(
  dispatch: HostedExecutionDispatchRequest,
  requested: HostedExecutionOutboxPayloadStorage | "auto",
): HostedExecutionOutboxPayloadStorage {
  const canonicalStorage = resolveHostedExecutionCanonicalOutboxPayloadStorage(dispatch.event.kind);

  if (requested !== "auto") {
    if (canonicalStorage !== requested) {
      throw new TypeError(
        `Hosted execution ${dispatch.event.kind} outbox payloads must use ${canonicalStorage} storage.`,
      );
    }

    return requested;
  }

  return canonicalStorage;
}

function resolveHostedExecutionCanonicalOutboxPayloadStorage(
  eventKind: HostedExecutionEventKind,
): HostedExecutionOutboxPayloadStorage {
  if (HOSTED_EXECUTION_REFERENCE_ONLY_OUTBOX_EVENT_KIND_SET.has(eventKind)) {
    return "reference";
  }

  if (HOSTED_EXECUTION_EVENT_KIND_SET.has(eventKind)) {
    return "inline";
  }

  throw new TypeError(`Unsupported hosted execution event kind: ${eventKind}`);
}

function readHostedExecutionInlineOutboxPayload(
  payloadObject: Record<string, unknown>,
): HostedExecutionInlineOutboxPayload | null {
  if (!hasOnlyAllowedKeys(payloadObject, HOSTED_EXECUTION_INLINE_OUTBOX_PAYLOAD_KEYS)) {
    return null;
  }

  try {
    return {
      dispatch: parseHostedExecutionDispatchRequest(payloadObject.dispatch),
      storage: "inline",
    };
  } catch {
    return null;
  }
}

function readHostedExecutionReferenceOutboxPayload(
  payloadObject: Record<string, unknown>,
): HostedExecutionReferenceOutboxPayload | null {
  if (!hasOnlyAllowedKeys(payloadObject, HOSTED_EXECUTION_REFERENCE_OUTBOX_PAYLOAD_KEYS)) {
    return null;
  }

  const dispatchRef = readHostedExecutionDispatchRef(payloadObject);
  if (!dispatchRef || !HOSTED_EXECUTION_REFERENCE_ONLY_OUTBOX_EVENT_KIND_SET.has(dispatchRef.eventKind)) {
    return null;
  }

  const stagedPayloadId = readText(payloadObject.stagedPayloadId);
  if (!stagedPayloadId) {
    return null;
  }

  return {
    dispatchRef,
    stagedPayloadId,
    storage: "reference",
  };
}

function readHostedExecutionDispatchRef(value: unknown): HostedExecutionDispatchRef | null {
  const payloadObject = toObject(value);
  const nestedRef = toObject(payloadObject.dispatchRef);
  const source = readText(payloadObject.storage) === "reference" ? nestedRef : payloadObject;

  if (!hasOnlyAllowedKeys(source, HOSTED_EXECUTION_DISPATCH_REF_KEYS)) {
    return null;
  }

  const eventId = readText(source.eventId);
  const eventKind = readHostedExecutionEventKind(source.eventKind);
  const occurredAt = readText(source.occurredAt);
  const userId = readText(source.userId);

  if (!eventId || !eventKind || !occurredAt || !userId) {
    return null;
  }

  return {
    eventId,
    eventKind,
    occurredAt,
    userId,
  };
}

function readHostedExecutionEventKind(value: unknown): HostedExecutionEventKind | null {
  return typeof value === "string" && HOSTED_EXECUTION_EVENT_KIND_SET.has(value as HostedExecutionEventKind)
    ? value as HostedExecutionEventKind
    : null;
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function requireText(value: unknown, errorMessage: string): string {
  const text = readText(value);

  if (text === null) {
    throw new TypeError(errorMessage);
  }

  return text;
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasOnlyAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}
