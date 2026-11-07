import { describe, expect, it, vi } from "vitest";
import { HOSTED_EXECUTION_SIGNATURE_HEADER, HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";
import { HOSTED_RUNTIME_POLL_TOOL_PATH } from "@murphai/hosted-execution/routes";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import { createHostedRuntimePollToolPort } from "../src/runtime-platform/poll-tool-port.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

describe("hosted poll tool transport", () => {
  it.each(["list", "vote"] as const)("signs %s requests and validates responses", async (action) => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({ HOSTED_WEB_BASE_URL: "https://web.example.test" }));
    const request = { assistantInputId: "ain_" + "a".repeat(32), request: action === "list" ? { action } : { action, pollRef: "poll_" + "a".repeat(32), optionIndex: 0, operation: "add" as const } };
    const status = action === "list" ? "listed" : "vote_submitted";
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://web.example.test" + HOSTED_RUNTIME_POLL_TOOL_PATH);
      expect(init?.body).toBe(JSON.stringify(request));
      const headers = new Headers(init?.headers);
      expect(headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("member_synthetic");
      expect(headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER)).toBeTruthy();
      return Response.json({ status, polls: [] });
    });
    const port = createHostedRuntimePollToolPort({
      boundUserId: "member_synthetic", fetchImpl, timeoutMs: 2_000,
      transport: { callbackSigning: environment.webCallbackSigning, mode: "direct", webControlBaseUrl: "https://web.example.test", workspaceCheckpointBridge: null },
    });
    expect(await port.request(request)).toEqual({ status, polls: [] });
    expect(fetchImpl).toHaveBeenCalledOnce();
    fetchImpl.mockResolvedValueOnce(Response.json({ status: "invented", polls: [] }));
    await expect(port.request(request)).rejects.toThrow();
  });
});
