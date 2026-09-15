import {
  parseHostedExecutionWake,
  parseHostedMailboxFetchResponse,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";

import { type readHostedExecutionEnvironment } from "../env.ts";
import {
  hasCachedHostedUserCryptoContextEnvelope,
  requireHostedUserCryptoContextFromResponse,
} from "../hosted-crypto/runtime-user-crypto-context.ts";
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

export function addRunnerMailboxCryptoContextRequest(input: {
  body: string | undefined;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  mailboxFetch: boolean;
  userId: string;
}): string | undefined {
  if (!input.mailboxFetch || !input.body) return input.body;
  const request = JSON.parse(input.body);
  // Recompute the opt-in at the Worker boundary; a warm envelope needs no read.
  request.includeIngressCryptoContext = request.decodeInlinePayloads === true
    && !hasCachedHostedUserCryptoContextEnvelope({ ...input, domain: "ingress" });
  return JSON.stringify(request);
}

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
  ingressCryptoContext?: unknown;
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  userId: string;
}): Promise<(payload: HostedMailboxPayloadDecodeRequest) => Promise<HostedExecutionWake>> {
  const cryptoContext = input.ingressCryptoContext !== undefined
    ? await requireHostedUserCryptoContextFromResponse({
        context: input.ingressCryptoContext,
        domain: "ingress",
        environment: input.environment,
        userId: input.userId,
      })
    : await resolveRunnerOutboundUserCryptoContext({
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
  const rawResponse = await input.response.json();
  const mailbox = parseHostedMailboxFetchResponse(rawResponse);
  const ingressCryptoContext = typeof rawResponse === "object" && rawResponse !== null
    && "ingressCryptoContext" in rawResponse ? rawResponse.ingressCryptoContext : undefined;
  if (mailbox.userId !== input.userId
    || mailbox.items.some((item) => item.userId !== input.userId)) {
    return unauthorized();
  }
  const consumed = mailbox.consumedSeqByLane?.find((cursor) => cursor.lane === "conversation");
  let decode: ReturnType<typeof createRunnerMailboxPayloadDecoder> | undefined;
  for (const item of mailbox.items) {
    if (item.kind !== "conversation.message" || item.lane !== "conversation"
      || item.consumedAt || !item.payloadInlineCiphertext || item.payloadRef
      || (consumed && BigInt(item.laneSeq) <= BigInt(consumed.consumedSeq))) {
      continue;
    }
    try {
      decode ??= createRunnerMailboxPayloadDecoder({
        ...input,
        ingressCryptoContext,
      });
      const wake = await (await decode)({
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
