import { createServer } from "node:http";
import { once } from "node:events";
import type { Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import { afterAll, expect, it, vi } from "vitest";
import type { Agent } from "undici";

const state = vi.hoisted(() => ({ agents: [] as Agent[] }));
vi.mock("undici", async (importOriginal) => {
  const original = await importOriginal<typeof import("undici")>();
  return {
    ...original,
    Agent: class extends original.Agent {
      constructor(options: Agent.Options) {
        super({
          ...options,
          connect: {
            lookup: (_hostname, options, callback) => {
              if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
              else callback(null, "127.0.0.1", 4);
            },
          },
        });
        state.agents.push(this);
      }
    },
  };
});

import { fetchHostedRunnerInternal } from "../src/hosted-runner-internal-fetch.ts";

afterAll(async () => {
  await Promise.all(state.agents.map((agent) => agent.close()));
});

it("reuses an internal connection after the default idle window and reconnects after server close", async () => {
  let connections = 0;
  let lastSocket: Socket | undefined;
  const server = createServer((request, response) => {
    expect(request.headers.host).toMatch(/^web-control\.worker:/);
    // Exercise the client fallback, rather than a server-provided timeout.
    if (request.url === "/pending") return;
    response.setHeader("Keep-Alive", "");
    response.end("ok");
  });
  server.keepAliveTimeout = 60_000;
  server.on("connection", (socket) => { connections += 1; lastSocket = socket; });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server port.");
  const url = `http://web-control.worker:${address.port}/mailbox`;
  try {
    expect(await (await fetchHostedRunnerInternal(url)).text()).toBe("ok");
    await delay(4_500);
    expect(await (await fetchHostedRunnerInternal(url)).text()).toBe("ok");
    expect(connections).toBe(1);
    if (!lastSocket) throw new Error("Missing test connection.");
    const closed = once(lastSocket, "close");
    server.closeAllConnections();
    await closed;
    await delay(0);
    expect(await (await fetchHostedRunnerInternal(url)).text()).toBe("ok");
    expect(connections).toBe(2);

    const controller = new AbortController();
    const received = once(server, "request");
    const pending = fetchHostedRunnerInternal(new URL("/pending", url), {
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await received;
    controller.abort();
    await rejected;
    expect(await (await fetchHostedRunnerInternal(url)).text()).toBe("ok");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("leaves public and provider fetch options unchanged", async () => {
  const response = new Response("ok");
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  const init = { headers: { "x-test": "synthetic" } };
  try {
    expect(await fetchHostedRunnerInternal("https://example.test/", init)).toBe(response);
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/", init);
  } finally {
    vi.unstubAllGlobals();
  }
});
