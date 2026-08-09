import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.LINQ_API_BASE_URL = "https://linq.test";
process.env.LINQ_API_TOKEN = "linq-test-token";

const {
  isHostedLinqIdempotencyKeyReuseFailure,
  sendHostedLinqAttachmentMessage,
} = await import("@/src/lib/hosted-onboarding/linq-client");

// Byte-identical to the local Linq stub's same-key/different-payload response
// (apps/cloudflare/test/helpers/hosted-local-linq-support.ts). If the stub's
// wording changes, this classification must be revisited rather than silently
// degrade to "ordinary failure".
const PROVIDER_IDEMPOTENCY_CONFLICT_BODY = JSON.stringify({
  error: "Conflicting Linq idempotency-key reuse.",
});

function jsonResponse(status: number, body: string): Response {
  return new Response(body, {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sendHostedLinqAttachmentMessage idempotency-key conflicts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const sendWithFinalResponse = async (finalResponse: Response) => {
    // The attachment is re-created on every attempt, so a replay under a
    // reused key necessarily carries a different body. That is exactly the
    // situation the provider answers with a key-reuse conflict.
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/attachments")) {
        return jsonResponse(200, JSON.stringify({
          attachment_id: `attachment_${fetchImpl.mock.calls.length}`,
          upload_url: "https://linq.test/upload",
        }));
      }
      if (url === "https://linq.test/upload") {
        return new Response(null, { status: 200 });
      }
      return finalResponse;
    });
    vi.stubGlobal("fetch", fetchImpl);

    return await sendHostedLinqAttachmentMessage({
      bytes: new Uint8Array([1, 2, 3]),
      chatId: "chat_direct_1",
      contentType: "text/vcard",
      fileName: "murph.vcf",
      idempotencyKey: "personalized-contact-card:chat_direct_1:input_first",
    }).then(() => null).catch((error: unknown) => error);
  };

  it("classifies the provider's exact same-key conflict", async () => {
    const error = await sendWithFinalResponse(
      jsonResponse(409, PROVIDER_IDEMPOTENCY_CONFLICT_BODY),
    );

    expect(error).toBeInstanceOf(Error);
    expect(isHostedLinqIdempotencyKeyReuseFailure(error)).toBe(true);
  });

  it("leaves an unrelated conflict and other errors unclassified", async () => {
    const unrelatedConflict = await sendWithFinalResponse(
      jsonResponse(409, JSON.stringify({ error: "Chat is locked." })),
    );
    expect(unrelatedConflict).toBeInstanceOf(Error);
    expect(isHostedLinqIdempotencyKeyReuseFailure(unrelatedConflict)).toBe(false);

    const serverError = await sendWithFinalResponse(
      jsonResponse(500, JSON.stringify({ error: "boom" })),
    );
    expect(serverError).toBeInstanceOf(Error);
    expect(isHostedLinqIdempotencyKeyReuseFailure(serverError)).toBe(false);
  });
});
