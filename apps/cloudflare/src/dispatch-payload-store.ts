import {
  buildHostedExecutionDispatchRef,
  type HostedExecutionDispatchRef,
} from "@murphai/hosted-execution/dispatch-ref";
import {
  buildHostedExecutionOutboxPayload,
  readHostedExecutionOutboxPayload,
  resolveHostedExecutionOutboxPayloadStorage,
  type HostedExecutionOutboxPayload,
  type HostedExecutionReferenceOutboxPayload,
} from "@murphai/hosted-execution/outbox-payload";
import type {
  HostedExecutionDispatchRequest,
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

export type HostedExecutionDispatchPayloadRef = Pick<
  HostedExecutionReferenceOutboxPayload,
  "stagedPayloadId"
>;

export interface HostedDispatchPayloadStore {
  deleteDispatchPayload(ref: HostedExecutionDispatchPayloadRef): Promise<void>;
  deleteStoredDispatchPayload(payloadJson: unknown): Promise<void>;
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

    async deleteStoredDispatchPayload(payloadJson) {
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
  const canonicalJson = JSON.stringify(canonicalizeJson(parseHostedExecutionDispatchRequest(dispatch)));
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(canonicalJson));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJson(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeJson(entry)]),
  );
}

export function resolveHostedRunnerDispatchPayloadStorage(
  dispatch: HostedExecutionDispatchRequest,
) {
  return resolveHostedExecutionOutboxPayloadStorage(dispatch, "auto");
}

export const createHostedExecutionDispatchPayloadStore = createHostedDispatchPayloadStore;
