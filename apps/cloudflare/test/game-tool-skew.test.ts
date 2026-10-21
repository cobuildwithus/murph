import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import * as parsers from "@murphai/hosted-execution/parsers";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import { createHostedRuntimeGroupToolPort } from "../src/runtime-platform/group-tool-port.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

// Opt-in history-dependent proof: exercise the exact previous parser rather
// than committing a duplicate snapshot or pretending new/new covers skew.
const baseline = "35bc378f24df6b94f6ccce244c42d1ffb72195a4";
describe.skipIf(process.env.MURPH_VERIFY_GAME_SKEW !== "1")("game tool legacy response skew", () => {
  it("rejects an unknown new response without replay even when Web already applied it", async () => {
    const parserUrl = new URL(`../../../packages/hosted-execution/src/parsers/.game-skew-${randomUUID()}.ts`, import.meta.url);
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const source = execFileSync("git", ["show", `${baseline}:packages/hosted-execution/src/parsers/runtime-control.ts`], { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 });
    await writeFile(parserUrl, source, { flag: "wx", mode: 0o600 });
    try {
      const legacy = await import(parserUrl.href) as typeof import("@murphai/hosted-execution/parsers");
      const response = { action: "update_game", result: { status: "ok", state: { games: [] } } };
      expect(() => legacy.parseHostedRuntimeGroupToolResponse(response)).toThrow("not supported");
      expect(() => legacy.parseHostedRuntimeGroupToolRequest({ action: "read_game", origin: { kind: "accepted_input", assistantInputId: "ain_" + "a".repeat(32) } })).toThrow("not supported");
      vi.spyOn(parsers, "parseHostedRuntimeGroupToolResponse").mockImplementation(legacy.parseHostedRuntimeGroupToolResponse);
      const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({ HOSTED_WEB_BASE_URL: "https://web.example.test" }));
      let applications = 0;
      const fetchImpl = vi.fn<typeof fetch>(async () => { applications += 1; return Response.json(response); });
      const port = createHostedRuntimeGroupToolPort({ boundUserId: "container_synthetic", fetchImpl, timeoutMs: 2_000,
        transport: { callbackSigning: environment.webCallbackSigning, mode: "direct", webControlBaseUrl: "https://web.example.test", workspaceCheckpointBridge: null } });
      await expect(port.request({ action: "update_game", origin: { kind: "accepted_input", assistantInputId: "ain_" + "a".repeat(32) }, update: { operation: "approve", gameId: "game_synthetic", proposalId: "proposal_synthetic" } })).rejects.toMatchObject({ code: "HOSTED_GROUP_TOOL_RESPONSE_SCHEMA_INVALID" });
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(applications).toBe(1);
    } finally {
      vi.restoreAllMocks();
      await rm(parserUrl, { force: true });
    }
  });
});
