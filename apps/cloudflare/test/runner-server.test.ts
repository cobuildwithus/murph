import { once } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

import { startHostedRunnerServer } from "../src/runner-server.js";

describe("startHostedRunnerServer", () => {
  const servers: Array<Awaited<ReturnType<typeof startHostedRunnerServer>>> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(async (server) => {
      server.close();
      await once(server, "close");
    }));
  });

  it("serves a lightweight health endpoint", async () => {
    const server = await startHostedRunnerServer({
      controlToken: null,
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted runner server to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "cloudflare-hosted-runner-node",
    });
  });
});
