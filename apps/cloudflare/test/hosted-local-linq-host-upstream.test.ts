import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { unstable_dev } from "wrangler";

import { buildHostedLocalFullStackHostProcessEnvOverrides } from "./helpers/hosted-local-full-stack-scenario.js";
import { startHostedLocalLinqStub } from "./helpers/hosted-local-linq-support.js";

it("reaches the strict Linq upstream from native Workerd using generated host bindings", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linq-host-upstream-"));
  const token = "synthetic-linq-host-upstream-token";
  const stub = await startHostedLocalLinqStub({ expectedAuthorizationToken: token });
  let worker: Awaited<ReturnType<typeof unstable_dev>> | undefined;
  try {
    const source = { LINQ_API_BASE_URL: stub.runnerBaseUrl, LINQ_API_TOKEN: token };
    const hostEnv = { ...source, ...buildHostedLocalFullStackHostProcessEnvOverrides(source) };
    expect(hostEnv.LINQ_API_BASE_URL).toBe(stub.baseUrl);
    const entrypoint = path.join(directory, "worker.js");
    const config = path.join(directory, "wrangler.json");
    await writeFile(config, JSON.stringify({ name: "linq-host-upstream-test", compatibility_date: "2026-03-27" }));
    // This is only a native host transport probe. The composed token-bridge
    // journey owns production SDK, invocation authority and interception proof.
    await writeFile(entrypoint, `export default {
      async fetch(request, env) {
        return fetch(env.LINQ_API_BASE_URL + "/chats/chat_host_upstream/messages", {
          method: "POST",
          headers: { authorization: "Bearer " + env.LINQ_API_TOKEN, "content-type": "application/json" },
          body: JSON.stringify({ message: { parts: [{ type: "text", value: "Synthetic host transport proof." }] } }),
        });
      },
    };`);
    worker = await unstable_dev(entrypoint, {
      config,
      vars: hostEnv,
      envFiles: [],
      ip: "127.0.0.1",
      port: 0,
      inspectorPort: 0,
      local: true,
      persist: false,
      logLevel: "none",
      experimental: {
        disableDevRegistry: true,
        disableExperimentalWarning: true,
        enableContainers: false,
        forceLocal: true,
        testMode: true,
        watch: false,
      },
    });
    const response = await worker.fetch();
    expect(response.status).toBe(200);
    expect(stub.acceptedSendRequests).toHaveLength(1);
    expect(stub.observedRequests).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "/chats/chat_host_upstream/messages",
        authorizationStatus: "expected",
      }),
    ]);
  } finally {
    await worker?.stop();
    await stub.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
