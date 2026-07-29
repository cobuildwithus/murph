import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNTIME_PRODUCT_FEEDBACK_RECORD_PATH,
} from "@murphai/hosted-execution/routes";
import type {
  HostedRuntimeProductFeedbackRecord,
} from "@murphai/hosted-execution/runtime-control";

import {
  createHostedRuntimeProductFeedbackPort,
} from "../src/runtime-platform/product-feedback-port.ts";

const FEEDBACK: HostedRuntimeProductFeedbackRecord = {
  idempotencyKey: "a".repeat(64),
  kind: "feature_request",
  relatedChangelogItemIds: [],
  summary: "Speculative: Support the missing Murph workflow.",
};

describe("hosted product feedback port", () => {
  it("records a fast response through the bounded transport", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        feedbackId: "product_feedback_123",
        recorded: true,
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      })
    );
    const port = createHostedRuntimeProductFeedbackPort({
      boundUserId: "member_bound",
      fetchImpl,
      timeoutMs: 45_000,
      transport: { mode: "proxy" },
    });

    await expect(port.recordProductFeedback(FEEDBACK)).resolves.toEqual({
      feedbackId: "product_feedback_123",
      recorded: true,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) {
      throw new Error("Expected one product feedback request.");
    }
    const request = new Request(call[0], call[1]);
    expect(request.url).toBe(
      `http://web-control.worker${HOSTED_RUNTIME_PRODUCT_FEEDBACK_RECORD_PATH}`,
    );
    await expect(request.clone().json()).resolves.toEqual({
      feedback: FEEDBACK,
    });
  });

  it("caps a stalled response body at the feedback-specific deadline", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(new ReadableStream<Uint8Array>({
        start() {},
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      })
    );
    const port = createHostedRuntimeProductFeedbackPort({
      boundUserId: "member_bound",
      fetchImpl,
      timeoutMs: 45_000,
      transport: { mode: "proxy" },
    });
    const startedAt = performance.now();

    await expect(port.recordProductFeedback(FEEDBACK)).rejects.toThrow(
      "aborted due to timeout",
    );

    expect(performance.now() - startedAt).toBeLessThan(5_000);
  }, 6_000);

  it("preserves a tighter caller deadline across response-body reads", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(new ReadableStream<Uint8Array>({
        start() {},
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      })
    );
    const port = createHostedRuntimeProductFeedbackPort({
      boundUserId: "member_bound",
      fetchImpl,
      timeoutMs: 50,
      transport: { mode: "proxy" },
    });
    const startedAt = performance.now();

    await expect(port.recordProductFeedback(FEEDBACK)).rejects.toThrow(
      "aborted due to timeout",
    );

    expect(performance.now() - startedAt).toBeLessThan(1_000);
  }, 2_000);
});
