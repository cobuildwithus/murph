import { describe, expect, it, vi } from "vitest";

const httpMocks = vi.hoisted(() => ({
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: httpMocks.requireHostedCloudflareCallbackRequest,
}));

import {
  readSignedComputerOsControlRequest,
} from "../src/lib/computer-use/http";

describe("hosted computer HTTP helpers", () => {
  it("ignores legacy typeText delay from signed OS-control requests", async () => {
    httpMocks.requireHostedCloudflareCallbackRequest.mockResolvedValueOnce("member_123");

    const result = await readSignedComputerOsControlRequest(new Request(
      "https://web.example.test/api/internal/computer/runs/hcr_run123/os-control",
      {
        body: JSON.stringify({
          action: "typeText",
          delayMs: 250,
          text: "safe fixture text",
        }),
        method: "POST",
      },
    ));

    expect(result).toEqual({
      body: {
        action: "typeText",
        text: "safe fixture text",
      },
      memberId: "member_123",
    });
    expect(httpMocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        payloadText: expect.stringContaining("\"delayMs\":250"),
      }),
    );
  });

  it("preserves dragMouse delay in signed OS-control requests", async () => {
    httpMocks.requireHostedCloudflareCallbackRequest.mockResolvedValueOnce("member_123");

    const result = await readSignedComputerOsControlRequest(new Request(
      "https://web.example.test/api/internal/computer/runs/hcr_run123/os-control",
      {
        body: JSON.stringify({
          action: "dragMouse",
          button: "left",
          delayMs: 25,
          path: [[1, 2], [3, 4]],
        }),
        method: "POST",
      },
    ));

    expect(result.body).toEqual(expect.objectContaining({
      action: "dragMouse",
      delayMs: 25,
      path: [[1, 2], [3, 4]],
    }));
  });
});
