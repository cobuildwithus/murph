import { createServer } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const linqRuntimeConfig = vi.hoisted(() => ({
  apiBaseUrl: "http://127.0.0.1:0",
  apiToken: "linq-test-token",
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingLinqConfig: () => linqRuntimeConfig,
}));

const {
  isHostedLinqAttachmentSendPrepareFailure,
  isHostedLinqIdempotencyKeyReuseFailure,
  isHostedLinqUnconfirmedAcknowledgementFailure,
  sendHostedLinqAttachmentMessage,
} = await import("@/src/lib/hosted-onboarding/linq-client");

// The provider double below speaks the same wire contract as the repository's
// production-faithful local Linq support
// (apps/cloudflare/test/helpers/hosted-local-linq-support.ts): one accepted
// message per idempotency key, a byte-identical resubmission under that key
// replays the original message identity, a different body under it conflicts,
// and the post-accept controls record the acceptance before failing. If that
// support's contract changes, this one must be revisited rather than silently
// diverge.
const PROVIDER_IDEMPOTENCY_CONFLICT_BODY = JSON.stringify({
  error: "Conflicting Linq idempotency-key reuse.",
});

type ProviderControl =
  | { kind: "post_accept_lost_acknowledgment"; responses: number }
  | { kind: "post_accept_transport_loss"; responses: number }
  | { kind: "post_accept_timeout"; responses: number }
  | { kind: "pre_accept_definitive"; responses: number }
  | { kind: "pre_accept_unrelated_conflict"; responses: number }
  | { kind: "post_accept_stalled_body"; responses: number }
  | { kind: "conflict_stalled_body"; responses: number }
  | { kind: "attachment_create_stalled_body"; responses: number }
  | { kind: "attachment_create_failure_stalled_body"; responses: number }
  | { kind: "upload_stalled_body"; responses: number }
  | { kind: "post_accept_retryable_stalled_body"; responses: number }
  | { kind: "definitive_stalled_body"; responses: number };

interface AcceptedMessage {
  body: string;
  messageId: string;
  url: string;
}

interface ProviderDouble {
  acceptedMessageIds: string[];
  arm(control: ProviderControl): void;
  baseUrl: string;
  close(): Promise<void>;
  /**
   * Sockets carrying a response this double deliberately never finished. A
   * completed response's socket stays open under keep-alive and that is not a
   * leak; a stalled one can only end because the client ended it.
   */
  liveStalledResponseCount(): number;
  observedSendBodies: string[];
}

async function startLinqProviderDouble(): Promise<ProviderDouble> {
  const acceptedByIdempotencyKey = new Map<string, AcceptedMessage>();
  const acceptedMessageIds: string[] = [];
  const observedSendBodies: string[] = [];
  let armed: ProviderControl | null = null;
  let nextAttachmentSequence = 0;
  let nextMessageSequence = 0;
  let baseUrl = "";

  const consumeArmed = (): ProviderControl | null => {
    if (!armed) {
      return null;
    }
    const control = armed;
    armed = control.responses <= 1 ? null : { ...control, responses: control.responses - 1 };
    return control;
  };

  const stalledSockets = new Set<import("node:net").Socket>();
  const server = createServer(async (request, response) => {
    const stall = () => {
      stalledSockets.add(request.socket);
    };
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    const url = request.url ?? "/";

    if (request.method === "POST" && url === "/attachments") {
      const attachmentId = `attachment_${++nextAttachmentSequence}`;
      if (armed?.kind === "attachment_create_stalled_body") {
        consumeArmed();
        response.writeHead(200, { "content-type": "application/json" });
        response.write("{");
        stall();
        return;
      }
      if (armed?.kind === "attachment_create_failure_stalled_body") {
        consumeArmed();
        response.writeHead(500, { "content-type": "application/json" });
        response.write("{");
        stall();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        attachment_id: attachmentId,
        required_headers: { "content-type": "text/vcard" },
        upload_url: `${baseUrl}/uploads/${attachmentId}`,
      }));
      return;
    }

    if (request.method === "PUT" && url.startsWith("/uploads/")) {
      if (armed?.kind === "upload_stalled_body") {
        consumeArmed();
        response.writeHead(200, { "content-type": "application/json" });
        response.write("{");
        stall();
        return;
      }
      response.writeHead(200);
      response.end();
      return;
    }

    if (request.method === "POST" && /^\/chats\/[^/]+\/messages$/u.test(url)) {
      observedSendBodies.push(body);
      const control = consumeArmed();
      if (control?.kind === "pre_accept_definitive") {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Synthetic definitive Linq send failure." }));
        return;
      }
      if (control?.kind === "definitive_stalled_body") {
        response.writeHead(400, { "content-type": "application/json" });
        response.write("{");
        stall();
        return;
      }
      if (control?.kind === "conflict_stalled_body") {
        // Headers say 409, then the body never arrives.
        response.writeHead(409, { "content-type": "application/json" });
        response.write("{");
        stall();
        return;
      }
      if (control?.kind === "pre_accept_unrelated_conflict") {
        response.writeHead(409, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Proxy wrapped: Conflicting Linq idempotency-key reuse." }));
        return;
      }

      const idempotencyKey = readIdempotencyKey(body);
      const replay = idempotencyKey ? acceptedByIdempotencyKey.get(idempotencyKey) ?? null : null;
      if (replay && (replay.body !== body || replay.url !== url)) {
        response.writeHead(409, { "content-type": "application/json" });
        response.end(PROVIDER_IDEMPOTENCY_CONFLICT_BODY);
        return;
      }

      const accepted = replay ?? (() => {
        const messageId = `linq_msg_${++nextMessageSequence}`;
        acceptedMessageIds.push(messageId);
        return { body, messageId, url };
      })();
      if (idempotencyKey && !replay) {
        acceptedByIdempotencyKey.set(idempotencyKey, accepted);
      }

      // Every control below runs after the message was accepted, so the card is
      // in the chat no matter what the caller observes.
      if (control?.kind === "post_accept_lost_acknowledgment") {
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Synthetic retryable Linq send failure." }));
        return;
      }
      if (control?.kind === "post_accept_transport_loss") {
        request.socket.destroy();
        return;
      }
      if (control?.kind === "post_accept_retryable_stalled_body") {
        // Accepted, then retryable headers whose body never finishes. Nothing
        // in this branch ever reads that body, so only an explicit end closes
        // it before reconciliation opens the next connection.
        response.writeHead(503, { "content-type": "application/json" });
        response.write("{");
        stall();
        return;
      }
      if (control?.kind === "post_accept_stalled_body") {
        // Accepted, headers returned inside the budget, body never finishes.
        response.writeHead(200, { "content-type": "application/json" });
        response.write("{");
        stall();
        return;
      }
      if (control?.kind === "post_accept_timeout") {
        // Never answered: the caller's own request timeout must fire.
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        chat_id: url.split("/")[2],
        message: { id: accepted.messageId },
      }));
      return;
    }

    response.writeHead(404);
    response.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a loopback TCP server address.");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    acceptedMessageIds,
    arm(control) {
      armed = control;
    },
    baseUrl,
    liveStalledResponseCount: () =>
      [...stalledSockets].filter((socket) => !socket.destroyed).length,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
    observedSendBodies,
  };
}

function readIdempotencyKey(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: { idempotency_key?: unknown } };
    const key = parsed?.message?.idempotency_key;
    return typeof key === "string" && key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
}

const REQUEST_KEY = "personalized-contact-card:chat_direct_1:input_first";

describe("sendHostedLinqAttachmentMessage acknowledgement contract", () => {
  let provider: ProviderDouble;

  beforeEach(async () => {
    provider = await startLinqProviderDouble();
    linqRuntimeConfig.apiBaseUrl = provider.baseUrl;
  });

  afterEach(async () => {
    await provider.close();
  });

  const send = async (
    idempotencyKey: string | null = REQUEST_KEY,
  ): Promise<{ error: unknown; result: unknown }> => {
    try {
      return {
        error: null,
        result: await sendHostedLinqAttachmentMessage({
          bytes: new Uint8Array(Buffer.from("BEGIN:VCARD\r\nEND:VCARD\r\n", "utf8")),
          chatId: "chat_direct_1",
          contentType: "text/vcard",
          fileName: "murph.vcf",
          idempotencyKey,
        }),
      };
    } catch (error) {
      return { error, result: null };
    }
  };

  it("recovers the accepted message when the acknowledgement is lost", async () => {
    provider.arm({ kind: "post_accept_lost_acknowledgment", responses: 1 });

    const { error, result } = await send();

    expect(error).toBeNull();
    expect(result).toEqual({ chatId: "chat_direct_1", messageId: "linq_msg_1" });
    // Two submissions, one card: the reconciliation carried the identical body
    // under the same key, so the provider replayed rather than accepted again.
    expect(provider.observedSendBodies).toHaveLength(2);
    expect(provider.observedSendBodies[0]).toBe(provider.observedSendBodies[1]);
    expect(provider.acceptedMessageIds).toEqual(["linq_msg_1"]);
  });

  it("recovers the accepted message when the connection is lost after acceptance", async () => {
    provider.arm({ kind: "post_accept_transport_loss", responses: 1 });

    const { error, result } = await send();

    expect(error).toBeNull();
    expect(result).toEqual({ chatId: "chat_direct_1", messageId: "linq_msg_1" });
    expect(provider.acceptedMessageIds).toEqual(["linq_msg_1"]);
  });

  it("recovers the accepted message when the send times out", async () => {
    provider.arm({ kind: "post_accept_timeout", responses: 1 });

    const { error, result } = await send();

    expect(error).toBeNull();
    expect(result).toEqual({ chatId: "chat_direct_1", messageId: "linq_msg_1" });
    expect(provider.acceptedMessageIds).toEqual(["linq_msg_1"]);
  });

  it("reports an unconfirmed acknowledgement when reconciliation cannot resolve it", async () => {
    provider.arm({ kind: "post_accept_lost_acknowledgment", responses: 2 });

    const { error } = await send();

    expect(isHostedLinqUnconfirmedAcknowledgementFailure(error)).toBe(true);
    expect(isHostedLinqIdempotencyKeyReuseFailure(error)).toBe(false);
    // Still exactly one card in the chat; the caller simply cannot prove it.
    expect(provider.acceptedMessageIds).toEqual(["linq_msg_1"]);
    expect(provider.observedSendBodies).toHaveLength(2);
  });

  it("classifies a later request that reuses the key with a new attachment", async () => {
    const first = await send();
    expect(first.error).toBeNull();

    // A replay re-creates the attachment, so the body under the reused key
    // genuinely differs. That is the provider's key-reuse conflict.
    const replay = await send();

    expect(isHostedLinqIdempotencyKeyReuseFailure(replay.error)).toBe(true);
    expect(isHostedLinqUnconfirmedAcknowledgementFailure(replay.error)).toBe(false);
    expect(provider.acceptedMessageIds).toEqual(["linq_msg_1"]);
  });

  it("leaves a definitive pre-acceptance rejection an ordinary failure", async () => {
    provider.arm({ kind: "pre_accept_definitive", responses: 1 });

    const { error } = await send();

    expect(error).toBeInstanceOf(Error);
    expect(isHostedLinqUnconfirmedAcknowledgementFailure(error)).toBe(false);
    expect(isHostedLinqIdempotencyKeyReuseFailure(error)).toBe(false);
    // A rejected request must not be resubmitted: nothing was accepted.
    expect(provider.observedSendBodies).toHaveLength(1);
    expect(provider.acceptedMessageIds).toEqual([]);
  });

  it("leaves a wrapped conflict phrase as an ordinary failure", async () => {
    provider.arm({ kind: "pre_accept_unrelated_conflict", responses: 1 });

    const { error } = await send();

    expect(error).toBeInstanceOf(Error);
    expect(isHostedLinqIdempotencyKeyReuseFailure(error)).toBe(false);
    expect(isHostedLinqUnconfirmedAcknowledgementFailure(error)).toBe(false);
    expect(provider.observedSendBodies).toHaveLength(1);
    expect(provider.acceptedMessageIds).toEqual([]);
  });

  it("reconciles an accepted send whose response body stalls", async () => {
    provider.arm({ kind: "post_accept_stalled_body", responses: 1 });

    const { error, result } = await send();

    // Headers said accepted but the answer never finished arriving, so nothing
    // was established. The same-key resubmission replays the original message
    // rather than accepting a second one, which is what makes it safe.
    expect(error).toBeNull();
    expect(result).toEqual({ chatId: "chat_direct_1", messageId: "linq_msg_1" });
    expect(provider.observedSendBodies).toHaveLength(2);
    expect(provider.observedSendBodies[0]).toBe(provider.observedSendBodies[1]);
    expect(provider.acceptedMessageIds).toEqual(["linq_msg_1"]);
  });

  it("reports unconfirmed when the reconciled body also never arrives", async () => {
    provider.arm({ kind: "post_accept_stalled_body", responses: 2 });

    const { error } = await send();

    // Reconciliation was the one attempt available and it could not be read
    // either, so the request ends explicitly unresolved rather than claiming
    // a delivery it never established — and still exactly one card exists.
    expect(isHostedLinqUnconfirmedAcknowledgementFailure(error)).toBe(true);
    expect(isHostedLinqIdempotencyKeyReuseFailure(error)).toBe(false);
    expect(provider.observedSendBodies).toHaveLength(2);
    expect(provider.acceptedMessageIds).toEqual(["linq_msg_1"]);
  });

  it("keeps an unkeyed accepted send sent when its body stalls", async () => {
    provider.arm({ kind: "post_accept_stalled_body", responses: 1 });

    const { error, result } = await send(null);

    // Without a key a resubmission would accept a second message, so there is
    // no safe way to learn more. The 200 already proved acceptance; only the
    // message identity is lost, and no caller of this send uses it.
    expect(error).toBeNull();
    expect(result).toEqual({ chatId: null, messageId: null });
    expect(provider.observedSendBodies).toHaveLength(1);
    expect(provider.acceptedMessageIds).toEqual(["linq_msg_1"]);
  });

  it("treats a conflict whose body never arrives as unresolved, not as failed", async () => {
    provider.arm({ kind: "conflict_stalled_body", responses: 1 });

    const { error, result } = await send();

    // An answer we could not finish reading is not an answer. The reconcile
    // resubmits the identical body under the same key, which the provider
    // accepts once, so the member gets exactly one card and a truthful result.
    expect(error).toBeNull();
    expect(result).toEqual({ chatId: "chat_direct_1", messageId: "linq_msg_1" });
    expect(provider.acceptedMessageIds).toEqual(["linq_msg_1"]);
    expect(provider.observedSendBodies).toHaveLength(2);
  });

  // The operation must have released every stalled response before it settles;
  // the production code joins its cancellation rather than firing it off. What
  // this can observe is the far side of that: the provider sees its socket end
  // promptly, with no further client action. Closure travels over the socket,
  // so it cannot land in the same tick the caller settles — but it does land,
  // which is exactly what an unowned body never does. The previous
  // implementation leaves these open indefinitely and fails here.
  const PROVIDER_CLOSE_GRACE_MS = 1_000;
  const expectNoLiveProviderConnections = async () => {
    await vi.waitFor(() => {
      expect(provider.liveStalledResponseCount()).toBe(0);
    }, { interval: 10, timeout: PROVIDER_CLOSE_GRACE_MS });
  };

  it("ends the provider connection when a stalled body hits its deadline", async () => {
    provider.arm({ kind: "post_accept_stalled_body", responses: 2 });
    const startedAt = Date.now();

    let error: unknown = null;
    try {
      await sendHostedLinqAttachmentMessage({
        bytes: new Uint8Array(Buffer.from("BEGIN:VCARD\r\nEND:VCARD\r\n", "utf8")),
        chatId: "chat_direct_1",
        contentType: "text/vcard",
        fileName: "murph.vcf",
        idempotencyKey: REQUEST_KEY,
        sendDeadlineAt: startedAt + 3_000,
      });
    } catch (caught) {
      error = caught;
    }

    expect(isHostedLinqUnconfirmedAcknowledgementFailure(error)).toBe(true);
    expect(provider.acceptedMessageIds).toEqual(["linq_msg_1"]);
    await expectNoLiveProviderConnections();
  });

  it.each([
    {
      arm: { kind: "attachment_create_failure_stalled_body", responses: 1 } as const,
      label: "an attachment-create failure whose body stalls",
    },
    {
      arm: { kind: "upload_stalled_body", responses: 1 } as const,
      label: "an upload response whose body stalls",
    },
    {
      arm: { kind: "definitive_stalled_body", responses: 1 } as const,
      label: "a definitive send rejection whose body stalls",
    },
    {
      arm: { kind: "post_accept_retryable_stalled_body", responses: 2 } as const,
      label: "retryable send responses whose bodies stall",
    },
  ])("leaves no live provider connection after $label", async ({ arm }) => {
    // The SDK adapter drains every bounded control-plane response before the
    // operation settles; the raw presigned upload path explicitly drains too.
    // Either way, a status-only branch must not leave a live connection behind.
    provider.arm(arm);
    const startedAt = Date.now();

    await sendHostedLinqAttachmentMessage({
      bytes: new Uint8Array(Buffer.from("BEGIN:VCARD\r\nEND:VCARD\r\n", "utf8")),
      chatId: "chat_direct_1",
      contentType: "text/vcard",
      fileName: "murph.vcf",
      idempotencyKey: REQUEST_KEY,
      prepareDeadlineAt: startedAt + 4_000,
      sendDeadlineAt: startedAt + 12_000,
    }).catch(() => undefined);

    await expectNoLiveProviderConnections();
  });

  it("refuses the send when the pre-send deadline already passed", async () => {
    // The abort callback is a scheduling mechanism; a busy event loop can run
    // it late. The comparison has to be synchronous or the POST goes out.
    let error: unknown = null;
    try {
      await sendHostedLinqAttachmentMessage({
        bytes: new Uint8Array(Buffer.from("BEGIN:VCARD\r\nEND:VCARD\r\n", "utf8")),
        chatId: "chat_direct_1",
        contentType: "text/vcard",
        fileName: "murph.vcf",
        idempotencyKey: REQUEST_KEY,
        prepareDeadlineAt: Date.now() - 1,
        sendDeadlineAt: Date.now() + 12_000,
      });
    } catch (caught) {
      error = caught;
    }

    expect(isHostedLinqAttachmentSendPrepareFailure(error)).toBe(true);
    expect(provider.observedSendBodies).toEqual([]);
    expect(provider.acceptedMessageIds).toEqual([]);
    await expectNoLiveProviderConnections();
  });

  it("never dispatches a send whose deadline has already elapsed", async () => {
    let error: unknown = null;
    try {
      await sendHostedLinqAttachmentMessage({
        bytes: new Uint8Array(Buffer.from("BEGIN:VCARD\r\nEND:VCARD\r\n", "utf8")),
        chatId: "chat_direct_1",
        contentType: "text/vcard",
        fileName: "murph.vcf",
        idempotencyKey: REQUEST_KEY,
        sendDeadlineAt: Date.now() - 1,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    // A zero-millisecond abort still lets fetch dispatch first, so the budget
    // has to be checked before the request rather than around it.
    expect(provider.observedSendBodies).toEqual([]);
    expect(provider.acceptedMessageIds).toEqual([]);
  });

  it("bounds a stalled attachment-create body and never reaches the send", async () => {
    provider.arm({ kind: "attachment_create_stalled_body", responses: 1 });
    const startedAt = Date.now();

    let error: unknown = null;
    try {
      await sendHostedLinqAttachmentMessage({
        bytes: new Uint8Array(Buffer.from("BEGIN:VCARD\r\nEND:VCARD\r\n", "utf8")),
        chatId: "chat_direct_1",
        contentType: "text/vcard",
        fileName: "murph.vcf",
        idempotencyKey: REQUEST_KEY,
        prepareDeadlineAt: startedAt + 1_000,
        sendDeadlineAt: startedAt + 15_000,
      });
    } catch (caught) {
      error = caught;
    }

    // The SDK attempt deadline remains active while the bounded body is read.
    // The tighter prepare deadline is provably before the message POST.
    expect(isHostedLinqAttachmentSendPrepareFailure(error)).toBe(true);
    expect(isHostedLinqUnconfirmedAcknowledgementFailure(error)).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(provider.observedSendBodies).toEqual([]);
    expect(provider.acceptedMessageIds).toEqual([]);
    await expectNoLiveProviderConnections();
  });

  it("keeps both send attempts inside one caller deadline", async () => {
    provider.arm({ kind: "post_accept_stalled_body", responses: 2 });
    const startedAt = Date.now();

    let error: unknown = null;
    try {
      await sendHostedLinqAttachmentMessage({
        bytes: new Uint8Array(Buffer.from("BEGIN:VCARD\r\nEND:VCARD\r\n", "utf8")),
        chatId: "chat_direct_1",
        contentType: "text/vcard",
        fileName: "murph.vcf",
        idempotencyKey: REQUEST_KEY,
        sendDeadlineAt: startedAt + 14_000,
      });
    } catch (caught) {
      error = caught;
    }

    // The send and its one reconciliation share the caller's window, so the
    // owner returns its own terminal result rather than outliving the turn.
    expect(isHostedLinqUnconfirmedAcknowledgementFailure(error)).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(16_000);
    expect(provider.observedSendBodies).toHaveLength(2);
    expect(provider.acceptedMessageIds).toEqual(["linq_msg_1"]);
  });

  it("treats a prepare-deadline expiry as provably unsent", async () => {
    // Everything the prepare signal bounds happens before the message POST, so
    // expiring under it can never leave an ambiguous send.
    const prepareSignal = AbortSignal.abort(new DOMException("deadline", "TimeoutError"));

    let error: unknown = null;
    try {
      await sendHostedLinqAttachmentMessage({
        bytes: new Uint8Array(Buffer.from("BEGIN:VCARD\r\nEND:VCARD\r\n", "utf8")),
        chatId: "chat_direct_1",
        contentType: "text/vcard",
        fileName: "murph.vcf",
        idempotencyKey: REQUEST_KEY,
        prepareSignal,
      });
    } catch (caught) {
      error = caught;
    }

    expect(isHostedLinqAttachmentSendPrepareFailure(error)).toBe(true);
    expect(isHostedLinqUnconfirmedAcknowledgementFailure(error)).toBe(false);
    expect(provider.observedSendBodies).toEqual([]);
    expect(provider.acceptedMessageIds).toEqual([]);
  });

  it("never resubmits an unkeyed send", async () => {
    provider.arm({ kind: "post_accept_lost_acknowledgment", responses: 1 });

    const { error } = await send(null);

    expect(error).toBeInstanceOf(Error);
    expect(isHostedLinqUnconfirmedAcknowledgementFailure(error)).toBe(false);
    // Without a key a second submission would accept a second message, so the
    // ambiguous failure is returned as-is.
    expect(provider.observedSendBodies).toHaveLength(1);
    expect(provider.acceptedMessageIds).toEqual(["linq_msg_1"]);
  });
});
