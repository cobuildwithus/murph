import { readMailboxWebTiming } from "./mailbox-timing.ts";
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
  timings?: Record<string, number>;
  userId: string;
}): Promise<Response> {
  const timings = input.timings ?? {};
  const bodyStartedAt = performance.now();
  const rawResponse = await input.response.json();
  const mailbox = parseHostedMailboxFetchResponse(rawResponse);
  timings.mailboxWorkerResponseBodyMs = Math.max(0, Math.round(performance.now() - bodyStartedAt));
  const ingressCryptoContext = typeof rawResponse === "object" && rawResponse !== null
    && "ingressCryptoContext" in rawResponse ? rawResponse.ingressCryptoContext : undefined;
  if (mailbox.userId !== input.userId
    || mailbox.items.some((item) => item.userId !== input.userId)) {
    return unauthorized();
  }
  const consumed = mailbox.consumedSeqByLane?.find((cursor) => cursor.lane === "conversation");
  let decode: ReturnType<typeof createRunnerMailboxPayloadDecoder> | undefined;
  let cryptoElapsedMs = 0;
  let decryptElapsedMs = 0;
  let decodedCount = 0;
  let failedCount = 0;
  for (const item of mailbox.items) {
    if (item.kind !== "conversation.message" || item.lane !== "conversation"
      || item.consumedAt || !item.payloadInlineCiphertext || item.payloadRef
      || (consumed && BigInt(item.laneSeq) <= BigInt(consumed.consumedSeq))) {
      continue;
    }
    try {
      if (!decode) {
        const cryptoStartedAt = performance.now();
        decode = createRunnerMailboxPayloadDecoder({ ...input, ingressCryptoContext });
        try { await decode; }
        finally { cryptoElapsedMs += performance.now() - cryptoStartedAt; }
      }
      const decodePayload = await decode;
      const decryptStartedAt = performance.now();
      let wake: HostedExecutionWake;
      try {
        wake = await decodePayload({
          itemRef: item,
          payloadCiphertext: item.payloadInlineCiphertext,
          payloadRequestId: null,
          payloadSchema: item.payloadSchema,
          payloadSource: "inline",
        });
      } finally { decryptElapsedMs += performance.now() - decryptStartedAt; }
      if (wake.userId === input.userId && wake.kind === "conversation.message") {
        item.decodedWake = wake;
        decodedCount += 1;
      }
    } catch {
      failedCount += 1;
      // Keep lazy import's existing item-scoped failure/retry behavior. A bad
      // payload must not make the whole fetch (including other lanes) fail.
    }
  }
  const serializeStartedAt = performance.now();
  const response = json(mailbox);
  response.headers.set("cache-control", "no-store");
  Object.assign(timings, {
    mailboxWorkerCryptoContextMs: Math.max(0, Math.round(cryptoElapsedMs)),
    mailboxWorkerPayloadDecryptMs: Math.max(0, Math.round(decryptElapsedMs)),
    mailboxWorkerSerializeMs: Math.max(0, Math.round(performance.now() - serializeStartedAt)),
    mailboxWorkerDecodedCount: decodedCount,
    mailboxWorkerDecodeFailedCount: failedCount,
  });
  return response;
}

/** Complete the mailbox-only response and measure its existing work. */
export async function completeRunnerMailboxFetchResponse(input: Parameters<typeof decodeRunnerMailboxFetchResponse>[0] & {
  body: string | undefined;
  requestStartedAt: number;
  forwardStartedAt: number;
}): Promise<{ response: Response; timings: Record<string, number> }> {
  const timings = {
    ...readMailboxWebTiming(input.response),
    mailboxWorkerPrepareMs: Math.max(0, Math.round(input.forwardStartedAt - input.requestStartedAt)),
    mailboxWorkerWebFetchMs: Math.max(0, Math.round(performance.now() - input.forwardStartedAt)),
  };
  const response = input.response.ok && input.body && JSON.parse(input.body).decodeInlinePayloads === true
    ? await decodeRunnerMailboxFetchResponse({ ...input, timings })
    : input.response;
  return { response, timings: { ...timings,
    mailboxWorkerTotalMs: Math.max(0, Math.round(performance.now() - input.requestStartedAt)),
  } };
}
