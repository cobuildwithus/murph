import {
  parseHostedExecutionWake,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";

import { type readHostedExecutionEnvironment } from "../env.ts";
import {
  createHostedMailboxEncryptionEnvironmentFromIngressRootResolver,
  decryptHostedMailboxPayloadCiphertext,
  type HostedMailboxEncryptionEnvironment,
} from "../hosted-mailbox-encryption.ts";
import { json, jsonError, methodNotAllowed, readJsonObject, unauthorized } from "../json.ts";
import {
  parseHostedMailboxPayloadDecodeRequest,
} from "../runtime-mailbox-payload-decode-contract.ts";
import {
  requireRunnerActiveInvocationLease,
  RunnerActiveInvocationLeaseError,
} from "./active-lease.ts";
import {
  resolveRunnerOutboundUserCryptoContext,
  type RunnerOutboundEnvironmentSource,
} from "./shared.ts";

const MAILBOX_PAYLOAD_DECODE_BODY_LIMIT_BYTES = 32 * 1024 * 1024;

export async function handleRunnerMailboxPayloadDecodeRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  userId: string;
}): Promise<Response> {
  if (input.request.method !== "POST") {
    return methodNotAllowed();
  }

  try {
    await requireRunnerActiveInvocationLease({
      env: input.env,
      request: input.request,
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof RunnerActiveInvocationLeaseError) {
      return unauthorized();
    }

    throw error;
  }

  let request;
  try {
    request = parseHostedMailboxPayloadDecodeRequest(await readJsonObject(input.request, {
      limitBytes: MAILBOX_PAYLOAD_DECODE_BODY_LIMIT_BYTES,
    }));
  } catch {
    return jsonError("Bad request.", 400);
  }

  if (request.itemRef.userId !== input.userId) {
    return unauthorized();
  }

  let wake: HostedExecutionWake;
  try {
    const cryptoContext = await resolveRunnerOutboundUserCryptoContext({
      bucket: input.env.BUNDLES,
      domain: "ingress",
      env: input.env,
      environment: input.environment,
      userId: input.userId,
    });
    const environment = createHostedMailboxPayloadDecodeEncryptionEnvironment({
      resolveKeyById: cryptoContext.resolveKeyById,
    });
    const decodedPayload = await decryptHostedMailboxPayloadCiphertext({
      ciphertext: request.payloadCiphertext,
      environment,
      metadata: {
        dedupeKey: request.itemRef.dedupeKey,
        itemId: request.itemRef.id,
        kind: request.itemRef.kind,
        lane: request.itemRef.lane,
        laneSeq: request.itemRef.laneSeq,
        occurredAt: request.itemRef.occurredAt,
        payloadSchema: request.payloadSchema,
        payloadStorage: request.payloadSource === "inline" ? "inline" : "sidecar",
        userId: request.itemRef.userId,
      },
    });
    wake = parseHostedExecutionWake(decodedPayload);
  } catch {
    return jsonError("Mailbox payload decode failed.", 502);
  }

  if (wake.userId !== input.userId) {
    return json({
      reasonCode: "payload.decode_mismatch",
      retryable: false,
      status: "blocked",
    });
  }

  return json({
    status: "decoded",
    wake,
  });
}

function createHostedMailboxPayloadDecodeEncryptionEnvironment(input: {
  resolveKeyById(rootKeyId: string): Promise<Uint8Array | null>;
}): HostedMailboxEncryptionEnvironment {
  return createHostedMailboxEncryptionEnvironmentFromIngressRootResolver({
    async readIngressRoot(rootKeyId) {
      const rootKey = await input.resolveKeyById(rootKeyId);
      if (!rootKey) {
        throw new Error("Hosted mailbox ingress root is not available.");
      }

      return {
        rootKey,
        rootKeyId,
      };
    },
  });
}
