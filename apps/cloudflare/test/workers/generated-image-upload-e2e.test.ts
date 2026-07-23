/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

interface UploadHandlerSignalResponse {
  observedHasSignal: boolean;
  observedSignalIsIncoming: boolean;
  status: number;
}

describe("generated image upload Worker fetch path", () => {
  it("forwards the caller's request signal to the upload", async () => {
    const response = await SELF.fetch(
      "https://worker.test/__test/generated-images/upload-handler-signal",
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    const result = await response.json() as UploadHandlerSignalResponse;

    expect(result.status).toBe(200);
    expect(result.observedHasSignal).toBe(true);
    // The upload is bounded by the caller-owned deadline (the incoming request
    // signal), not a separate handler-local timer.
    expect(result.observedSignalIsIncoming).toBe(true);
  });
});
