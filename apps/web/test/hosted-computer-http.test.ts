import { ContractValidationError } from "@murphai/contracts/validation-error";
import { RequestInputError } from "@murphai/hosted-execution/request-input";
import { describe, expect, it, vi } from "vitest";

const httpMocks = vi.hoisted(() => ({
  requireHostedCloudflareCallbackRequest: vi.fn(),
  parseOpen: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: httpMocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@murphai/hosted-execution/computer-use", async (importOriginal) => ({
  ...await importOriginal<typeof import("@murphai/hosted-execution/computer-use")>(),
  parseHostedComputerOpenRunRequest: httpMocks.parseOpen,
}));

import {
  readSignedComputerOpenRunRequest,
  readSignedComputerOsControlRequest,
} from "../src/lib/computer-use/http";

describe("hosted computer HTTP helpers", () => {
  it.each([new ContractValidationError("rejected"), new RequestInputError("rejected")])(
    "preserves the domain response for explicit parser rejection %s",
    async (error) => {
      httpMocks.requireHostedCloudflareCallbackRequest.mockResolvedValueOnce("member_123");
      httpMocks.parseOpen.mockImplementationOnce(() => { throw error; });
      await expect(readSignedComputerOpenRunRequest(new Request("https://example.test/body", {
        method: "POST", body: "{}",
      }))).rejects.toMatchObject({ code: "HOSTED_COMPUTER_INVALID_REQUEST", httpStatus: 400 });
    },
  );

  it.each([new TypeError("parser bug"), new SyntaxError("parser bug"), new RangeError("parser bug")])(
    "lets parser bugs escape unchanged: %s",
    async (error) => {
      httpMocks.requireHostedCloudflareCallbackRequest.mockResolvedValueOnce("member_123");
      httpMocks.parseOpen.mockImplementationOnce(() => { throw error; });
      await expect(readSignedComputerOpenRunRequest(new Request("https://example.test/body", {
        method: "POST", body: "{}",
      }))).rejects.toBe(error);
    },
  );

  it("keeps malformed computer JSON as a domain rejection after authentication", async () => {
    httpMocks.requireHostedCloudflareCallbackRequest.mockResolvedValueOnce("member_123");
    await expect(readSignedComputerOpenRunRequest(new Request("https://example.test/body", {
      method: "POST", body: "{",
    }))).rejects.toMatchObject({ code: "HOSTED_COMPUTER_INVALID_JSON", httpStatus: 400 });
  });

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
