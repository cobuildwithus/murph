import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { unstable_dev } from "wrangler";
import { executeCodexAppServerTurn, stopWarmCodexAppServer } from "@murphai/assistant-engine/assistant-codex";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { createPostgresTestOwner } from "./postgres-owner-fixtures.ts";
import { HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL } from "../src/runner-injected-credential.ts";

it("keeps native Codex on one workerd pass-through across idle turns and recovers closed or declined sockets", { timeout: 90_000 }, async () => {
  const root = process.env.MURPH_VITEST_TEMP_ROOT;
  if (!root) throw new Error("Native proof requires the marked Vitest temp root");
  const directory = await mkdtemp(path.join(root, "codex-passthrough-"));
  let worker: Awaited<ReturnType<typeof unstable_dev>> | undefined;
  try {
    worker = await unstable_dev(fileURLToPath(new URL("./fixtures/responses-passthrough-worker.ts", import.meta.url)), {
      config: fileURLToPath(new URL("./fixtures/responses-passthrough.wrangler.json", import.meta.url)),
      vars: { ...createHostedExecutionTestEnv(), OPENAI_API_KEY: "synthetic-provider-key", TEST_OWNER: JSON.stringify(createPostgresTestOwner()) },
      envFiles: [], ip: "127.0.0.1", port: 0, inspectorPort: 0, local: true, persist: false, logLevel: "none",
      experimental: { disableDevRegistry: true, disableExperimentalWarning: true, enableContainers: false, forceLocal: true, testMode: true, watch: false },
    });
    const baseUrl = `http://${worker.address}:${worker.port}/v1`;
    const codexHome = path.join(directory, "codex");
    const workingDirectory = path.join(directory, "workspace");
    await Promise.all([mkdir(codexHome), mkdir(workingDirectory)]);
    await writeFile(path.join(codexHome, "config.toml"), [
      'model = "gpt-5.6-terra"', 'model_provider = "passthrough"',
      'approval_policy = "never"', 'sandbox_mode = "workspace-write"', 'check_for_update_on_startup = false',
      '[history]', 'persistence = "none"',
      '[model_providers.passthrough]', 'name = "Synthetic pass-through"', `base_url = "${baseUrl}"`,
      'env_key = "SYNTHETIC_CODEX_KEY"', 'wire_api = "responses"', 'requires_openai_auth = false',
      'supports_websockets = true', 'request_max_retries = 0', 'stream_max_retries = 0', 'stream_idle_timeout_ms = 1000',
    ].join("\n"));
    const turn = {
      codexCommand: fileURLToPath(new URL("../../../packages/assistant-engine/node_modules/.bin/codex", import.meta.url)),
      codexHome, workingDirectory, model: "gpt-5.6-terra", modelProvider: "passthrough", reasoningEffort: "low",
      processLifetime: "warm" as const, sandbox: "workspace-write" as const, dynamicTools: [],
      env: { HOME: directory, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, SYNTHETIC_CODEX_KEY: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL },
      prompt: "Answer the synthetic turn.",
    };
    const first = await executeCodexAppServerTurn(turn);
    expect(first.finalMessage).toBe("PASSTHROUGH_OK");
    // No request is active during this gap. A response timeout must not end
    // native connection reuse between turns or require relay JS to stay alive.
    // Cross the ordinary 30-second post-response waitUntil window too.
    await new Promise((resolve) => setTimeout(resolve, 35_000));
    const second = await executeCodexAppServerTurn({ ...turn, resumeSessionId: first.sessionId });
    expect(second.finalMessage).toBe("PASSTHROUGH_OK");
    expect(await (await worker.fetch("/control")).json()).toMatchObject({ connections: 1, websocketRequests: 2, httpRequests: 0, accessChecks: 1 });
    await worker.fetch("/control?close=true");
    const recoveryStartedAt = Date.now();
    const third = await executeCodexAppServerTurn({ ...turn, resumeSessionId: second.sessionId });
    expect(third.finalMessage).toBe("PASSTHROUGH_OK");
    expect(Date.now() - recoveryStartedAt).toBeLessThan(5000);
    expect(await (await worker.fetch("/control")).json()).toMatchObject({ connections: 1, websocketRequests: 3, httpRequests: 1 });
    await stopWarmCodexAppServer();
    const before = await (await worker.fetch("/control?allowed=false")).json() as { connections: number; httpRequests: number };
    const fallback = await executeCodexAppServerTurn(turn);
    expect(fallback.finalMessage).toBe("PASSTHROUGH_OK");
    expect(await (await worker.fetch("/control")).json()).toMatchObject({ connections: before.connections, httpRequests: before.httpRequests + 1 });
  } finally {
    await stopWarmCodexAppServer();
    await worker?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
