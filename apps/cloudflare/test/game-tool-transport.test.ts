import { describe, expect, it, vi } from "vitest";
import { HOSTED_EXECUTION_SIGNATURE_HEADER, HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";
import { HOSTED_RUNTIME_GROUP_TOOL_PATH } from "@murphai/hosted-execution/routes";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import { createHostedRuntimeGroupToolPort } from "../src/runtime-platform/group-tool-port.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

describe("game tools reuse signed group transport", () => {
  it("signs the accepted sender provenance, validates shared response and does not retry uncertain updates", async () => {
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({ HOSTED_WEB_BASE_URL: "https://web.example.test" }));
    const request = { action: "update_game" as const, origin: { kind: "accepted_input" as const, assistantInputId: "ain_" + "a".repeat(32) }, update: { operation: "approve" as const, gameId: "game_synthetic", proposalId: "proposal_synthetic" } };
    const result = { action: "update_game", result: { status: "ok", state: { games: [] } } };
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(new URL(String(url)).pathname).toBe(HOSTED_RUNTIME_GROUP_TOOL_PATH);
      expect(init?.body).toBe(JSON.stringify(request));
      const headers = new Headers(init?.headers);
      expect(headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("container_synthetic");
      expect(headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER)).toBeTruthy();
      return Response.json(result);
    });
    const port = createHostedRuntimeGroupToolPort({ boundUserId: "container_synthetic", fetchImpl, timeoutMs: 2_000,
      transport: { callbackSigning: environment.webCallbackSigning, mode: "direct", webControlBaseUrl: "https://web.example.test", workspaceCheckpointBridge: null } });
    expect(await port.request(request)).toEqual(result);
    fetchImpl.mockResolvedValueOnce(Response.json({ ...result, result: { status: "ok", state: { games: [], privatePhotos: [] } } }));
    await expect(port.request(request)).rejects.toThrow("invalid response");
    fetchImpl.mockClear(); fetchImpl.mockRejectedValueOnce(new Error("Synthetic uncertain response"));
    await expect(port.request(request)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
