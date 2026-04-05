import {
  buildHostedExecutionDispatchRef,
  buildHostedExecutionOutboxPayload,
  parseHostedExecutionDispatchRequest,
  readHostedExecutionOutboxPayload,
  resolveHostedExecutionOutboxPayloadStorage,
  type HostedExecutionDispatchRef,
  type HostedExecutionDispatchRequest,
  type HostedExecutionOutboxPayload,
} from "@murphai/hosted-execution";

import type { R2BucketLike } from "./bundle-store.js";
import { buildHostedStorageAad } from "./crypto-context.js";
import {
  hostedDispatchPayloadObjectKey,
  hostedDispatchPayloadObjectKeys,
} from "./storage-paths.js";
import {
  readEncryptedR2Json,
  writeEncryptedR2Json,
} from "./crypto.js";

export interface HostedExecutionDispatchPayloadRef {
  key: string;
}

export interface HostedDispatchPayloadStore {
  deleteDispatchPayload(ref: HostedExecutionDispatchPayloadRef): Promise<void>;
  deleteStoredDispatchPayload(payloadJson: string): Promise<void>;
  readDispatchPayload(
    ref: HostedExecutionDispatchPayloadRef,
  ): Promise<HostedExecutionDispatchRequest | null>;
  readStoredDispatch(payloadJson: string): Promise<HostedExecutionDispatchRequest>;
  readStoredDispatchRef(payloadJson: string): HostedExecutionDispatchRef | null;
  writeDispatchPayload(
    dispatch: HostedExecutionDispatchRequest,
  ): Promise<HostedExecutionDispatchPayloadRef>;
  writeStoredDispatch(dispatch: HostedExecutionDispatchRequest): Promise<string>;
}

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

      await input.bucket.delete(ref.key);
    },

    async deleteStoredDispatchPayload(payloadJson) {
      const dispatchRef = readStoredReferenceDispatchRef(payloadJson);

      if (!dispatchRef || !input.bucket.delete) {
        return;
      }

      for (const key of await hostedDispatchPayloadObjectKeys(
        input.key,
        input.keysById,
        dispatchRef.userId,
        dispatchRef.eventId,
      )) {
        await input.bucket.delete(key);
      }
    },

    async readDispatchPayload(ref) {
      return readEncryptedR2Json({
        aad: buildCurrentDispatchPayloadAad(ref.key),
        bucket: input.bucket,
        cryptoKey: input.key,
        cryptoKeysById: input.keysById,
        expectedKeyId: input.keyId,
        key: ref.key,
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
        for (const key of await hostedDispatchPayloadObjectKeys(
          input.key,
          input.keysById,
          payload.dispatchRef.userId,
          payload.dispatchRef.eventId,
        )) {
          const dispatch = await this.readDispatchPayload({
            key,
          });

          if (!dispatch) {
            continue;
          }

          assertHostedDispatchMatchesRef(dispatch, payload.dispatchRef);
          return dispatch;
        }

        throw new Error(
          `Hosted dispatch payload ${payload.dispatchRef.userId}/${payload.dispatchRef.eventId} is missing from R2.`,
        );
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
      const key = await hostedDispatchPayloadObjectKey(
        input.key,
        dispatch.event.userId,
        dispatch.eventId,
      );
      await writeEncryptedR2Json({
        aad: buildCurrentDispatchPayloadAad(key),
        bucket: input.bucket,
        cryptoKey: input.key,
        key,
        keyId: input.keyId,
        scope: "dispatch-payload",
        value: dispatch,
      });

      return { key };
    },

    async writeStoredDispatch(dispatch) {
      const payload = buildHostedExecutionOutboxPayload(dispatch);

      if (payload.storage === "inline") {
        return JSON.stringify(payload);
      }

      await this.writeDispatchPayload(dispatch);
      return JSON.stringify(payload);
    },
  };
}

function readStoredDispatchPayloadEnvelope(payloadJson: string): HostedExecutionOutboxPayload | null {
  return readHostedExecutionOutboxPayload(JSON.parse(payloadJson) as unknown);
}

function readStoredReferenceDispatchRef(payloadJson: string): HostedExecutionDispatchRef | null {
  const payload = readStoredDispatchPayloadEnvelope(payloadJson);

  return payload?.storage === "reference" ? payload.dispatchRef : null;
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

export function resolveHostedRunnerDispatchPayloadStorage(
  dispatch: HostedExecutionDispatchRequest,
) {
  return resolveHostedExecutionOutboxPayloadStorage(dispatch, "auto");
}

export const createHostedExecutionDispatchPayloadStore = createHostedDispatchPayloadStore;
