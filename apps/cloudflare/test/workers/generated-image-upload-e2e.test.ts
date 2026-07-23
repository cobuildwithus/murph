/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

interface UploadHandlerSignalResponse {
  observedHasSignal: boolean;
  observedSignalIsIncoming: boolean;
  status: number;
}

describe("generated image upload Worker fetch path", () => {
  it("keeps the fixed upload handler on a fresh timeout signal", async () => {
    const response = await SELF.fetch(
      "https://worker.test/__test/generated-images/upload-handler-signal",
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    const result = await response.json() as UploadHandlerSignalResponse;

    expect(result.status).toBe(200);
    expect(result.observedHasSignal).toBe(true);
    expect(result.observedSignalIsIncoming).toBe(false);
  });
});
