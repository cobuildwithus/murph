import {
  buildHostedExecutionDispatchRef,
  buildHostedExecutionOutboxPayload,
  parseHostedExecutionDispatchRequest,
  readHostedExecutionOutboxPayload,
  type HostedExecutionDispatchRef,
  type HostedExecutionDispatchRequest,
  type HostedExecutionOutboxPayload,
  type HostedExecutionOutboxPayloadStorage,
} from "@murphai/hosted-execution";

import type { R2BucketLike } from "./bundle-store.js";
import {
  buildHostedStorageAad,
  deriveHostedStorageOpaqueId,
} from "./crypto-context.js";
import {
  readEncryptedR2Json,
  writeEncryptedR2Json,
} from "./crypto.js";

export interface HostedDispatchPayloadStore {
  deleteStoredDispatchPayload(payloadJson: string): Promise<void>;
  readStoredDispatch(payloadJson: string): Promise<HostedExecutionDispatchRequest>;
  readStoredDispatchRef(payloadJson: string): HostedExecutionDispatchRef | null;
  writeStoredDispatch(dispatch: HostedExecutionDispatchRequest): Promise<string>;
}

export function createHostedDispatchPayloadStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}): HostedDispatchPayloadStore {
  return {
    async deleteStoredDispatchPayload(payloadJson) {
      const dispatchRef = readStoredReferenceDispatchRef(payloadJson);

      if (!dispatchRef) {
        return;
      }

      if (!input.bucket.delete) {
        return;
      }

      for (const key of await hostedDispatchPayloadObjectKeys(input.key, input.keysById, dispatchRef)) {
        await input.bucket.delete(key);
      }
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
          payload.dispatchRef,
        )) {
          const dispatch = await readEncryptedR2Json({
            aad: buildHostedStorageAad({
              eventId: payload.dispatchRef.eventId,
              eventKind: payload.dispatchRef.eventKind,
              key,
              occurredAt: payload.dispatchRef.occurredAt,
              purpose: "dispatch-payload",
              userId: payload.dispatchRef.userId,
            }),
            bucket: input.bucket,
            cryptoKey: input.key,
            cryptoKeysById: input.keysById,
            expectedKeyId: input.keyId,
            key,
            parse(value) {
              return parseHostedExecutionDispatchRequest(value);
            },
            scope: "dispatch-payload",
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

      return parseHostedExecutionDispatchRequest(JSON.parse(payloadJson) as unknown);
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

        return buildHostedExecutionDispatchRef(
          parseHostedExecutionDispatchRequest(JSON.parse(payloadJson) as unknown),
        );
      } catch {
        return null;
      }
    },

    async writeStoredDispatch(dispatch) {
      const storage = resolveHostedRunnerDispatchPayloadStorage(dispatch);
      const payload = buildHostedExecutionOutboxPayload(dispatch, {
        storage,
      });

      if (payload.storage === "inline") {
        return JSON.stringify(payload);
      }

      const key = await hostedDispatchPayloadObjectKey(input.key, payload.dispatchRef);
      await writeEncryptedR2Json({
        aad: buildHostedStorageAad({
          eventId: payload.dispatchRef.eventId,
          eventKind: payload.dispatchRef.eventKind,
          key,
          occurredAt: payload.dispatchRef.occurredAt,
          purpose: "dispatch-payload",
          userId: payload.dispatchRef.userId,
        }),
        bucket: input.bucket,
        cryptoKey: input.key,
        key,
        keyId: input.keyId,
        scope: "dispatch-payload",
        value: dispatch,
      });

      return JSON.stringify(payload);
    },
  };
}

export function resolveHostedRunnerDispatchPayloadStorage(
  dispatch: HostedExecutionDispatchRequest,
): HostedExecutionOutboxPayloadStorage {
  switch (dispatch.event.kind) {
    case "linq.message.received":
    case "telegram.message.received":
    case "device-sync.wake":
    case "gateway.message.send":
      return "reference";
    case "member.activated":
    case "assistant.cron.tick":
    case "email.message.received":
      return "inline";
    case "vault.share.accepted":
      return "reference";
    default:
      throw new TypeError("Unsupported hosted dispatch payload storage event kind.");
  }
}

function readStoredDispatchPayloadEnvelope(payloadJson: string): HostedExecutionOutboxPayload | null {
  return readHostedExecutionOutboxPayload(JSON.parse(payloadJson) as unknown);
}

function readStoredReferenceDispatchRef(payloadJson: string): HostedExecutionDispatchRef | null {
  const payload = readStoredDispatchPayloadEnvelope(payloadJson);

  return payload?.storage === "reference" ? payload.dispatchRef : null;
}

async function hostedDispatchPayloadObjectKey(
  rootKey: Uint8Array,
  dispatchRef: HostedExecutionDispatchRef,
): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "dispatch-payload-path",
    value: `user:${dispatchRef.userId}`,
  });
  const eventSegment = await deriveHostedStorageOpaqueId({
    length: 40,
    rootKey,
    scope: "dispatch-payload-path",
    value: `event:${dispatchRef.userId}:${dispatchRef.eventId}`,
  });

  return `transient/dispatch-payloads/${userSegment}/${eventSegment}.json`;
}

async function hostedDispatchPayloadObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  dispatchRef: HostedExecutionDispatchRef,
): Promise<string[]> {
  return Promise.all(
    listHostedStorageRootKeys(rootKey, keysById).map((candidateRootKey) =>
      hostedDispatchPayloadObjectKey(candidateRootKey, dispatchRef)
    ),
  ).then((keys) => [...new Set(keys)]);
}

function listHostedStorageRootKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
): Uint8Array[] {
  const seen = new Set<string>();
  const unique: Uint8Array[] = [];

  for (const key of [rootKey, ...Object.values(keysById ?? {})]) {
    const signature = [...key].join(",");

    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    unique.push(key);
  }

  return unique;
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
