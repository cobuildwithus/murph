import {
  parseHostedExecutionWake,
  parseHostedMailboxFetchResponse,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";

import { type readHostedExecutionEnvironment } from "../env.ts";
import {
  createHostedMailboxEncryptionEnvironmentFromIngressRootResolver,
  decryptHostedMailboxPayloadCiphertext,
} from "../hosted-mailbox-encryption.ts";
import { json, jsonError, methodNotAllowed, readJsonObject, unauthorized } from "../json.ts";
import {
  parseHostedMailboxPayloadDecodeRequest,
  type HostedMailboxPayloadDecodeRequest,
} from "../runtime-mailbox-payload-decode-contract.ts";
import {
  requireRunnerRuntimeWriteFence,
  RunnerRuntimeWriteFenceError,
} from "./write-fence.ts";
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
    await requireRunnerRuntimeWriteFence({
      env: input.env,
      request: input.request,
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof RunnerRuntimeWriteFenceError) {
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
    const decode = await createRunnerMailboxPayloadDecoder(input);
    wake = await decode(request);
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

async function createRunnerMailboxPayloadDecoder(input: {
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  userId: string;
}): Promise<(payload: HostedMailboxPayloadDecodeRequest) => Promise<HostedExecutionWake>> {
  const cryptoContext = await resolveRunnerOutboundUserCryptoContext({
    bucket: input.env.BUNDLES,
    domain: "ingress",
    env: input.env,
    environment: input.environment,
    userId: input.userId,
  });
  const environment = createHostedMailboxEncryptionEnvironmentFromIngressRootResolver({
    async readIngressRoot(rootKeyId) {
      const rootKey = await cryptoContext.resolveKeyById(rootKeyId);
      if (!rootKey) {
        throw new Error("Hosted mailbox ingress root is not available.");
      }
      return { rootKey, rootKeyId };
    },
  });
  return async (payload) => {
    const decodedPayload = await decryptHostedMailboxPayloadCiphertext({
      ciphertext: payload.payloadCiphertext,
      environment,
      metadata: {
        dedupeKey: payload.itemRef.dedupeKey,
        itemId: payload.itemRef.id,
        kind: payload.itemRef.kind,
        lane: payload.itemRef.lane,
        laneSeq: payload.itemRef.laneSeq,
        occurredAt: payload.itemRef.occurredAt,
        payloadSchema: payload.payloadSchema,
        payloadStorage: payload.payloadSource === "inline" ? "inline" : "sidecar",
        userId: payload.itemRef.userId,
      },
    });
    return parseHostedExecutionWake(decodedPayload);
  };
}

/** The caller has already validated the current runtime write fence. */
export async function decodeRunnerMailboxFetchResponse(input: {
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  response: Response;
  userId: string;
}): Promise<Response> {
  const mailbox = parseHostedMailboxFetchResponse(await input.response.json());
  if (mailbox.userId !== input.userId
    || mailbox.items.some((item) => item.userId !== input.userId)) {
    return unauthorized();
  }
  const consumed = mailbox.consumedSeqByLane?.find((cursor) => cursor.lane === "conversation");
  let decode: Awaited<ReturnType<typeof createRunnerMailboxPayloadDecoder>> | undefined;
  for (const item of mailbox.items) {
    if (item.kind !== "conversation.message" || item.lane !== "conversation"
      || item.consumedAt || !item.payloadInlineCiphertext || item.payloadRef
      || (consumed && BigInt(item.laneSeq) <= BigInt(consumed.consumedSeq))) {
      continue;
    }
    try {
      decode ??= await createRunnerMailboxPayloadDecoder(input);
      const wake = await decode({
        itemRef: item,
        payloadCiphertext: item.payloadInlineCiphertext,
        payloadRequestId: null,
        payloadSchema: item.payloadSchema,
        payloadSource: "inline",
      });
      if (wake.userId === input.userId && wake.kind === "conversation.message") {
        item.decodedWake = wake;
      }
    } catch {
      // Keep lazy import's existing item-scoped failure/retry behavior. A bad
      // payload must not make the whole fetch (including other lanes) fail.
    }
  }
  const response = json(mailbox);
  response.headers.set("cache-control", "no-store");
  return response;
}
