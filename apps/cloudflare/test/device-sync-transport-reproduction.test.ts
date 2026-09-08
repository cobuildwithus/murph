import { createServer } from "node:http";
import { afterEach, expect, test, vi } from "vitest";
import { HostedRuntimeArtifactWriteError } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { parseHostedExecutionDeviceSyncRuntimeSnapshotResponse } from "@murphai/device-syncd/hosted-runtime";
import { createCloudflareArtifactStore } from "../src/runtime-platform/artifact-store.ts";
import {
  fetchHostedWebControlPlaneJson,
  HOSTED_RUNNER_WEB_CONTROL_ROUTES,
} from "../src/runtime-platform/web-control-transport.ts";

const mocks = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@murphai/hosted-execution", async () => ({
  ...await vi.importActual("@murphai/hosted-execution"),
  emitHostedExecutionStructuredLog: mocks.log,
}));
afterEach(() => vi.clearAllMocks());

test("a real socket close before upload response preserves retryable failure and permits a later owner retry", async () => {
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    request.resume();
    request.on("end", () => {
      if (requests === 1) request.socket.destroy();
      else response.writeHead(200).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
    const store = createCloudflareArtifactStore({
      fetchImpl: (_url, init) => fetch(`http://127.0.0.1:${address.port}/object`, init),
      timeoutMs: 5_000,
    });
    const artifact = { bytes: new TextEncoder().encode("synthetic artifact"), sha256: "a".repeat(64) };
    const failedPut = store.put(artifact);
    await expect(failedPut).rejects.toBeInstanceOf(HostedRuntimeArtifactWriteError);
    await expect(failedPut).rejects.toMatchObject({ retryable: true });
    expect(requests).toBe(1);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      message: "Hosted runtime artifact upload failed before response.",
      details: expect.objectContaining({ fetchNetworkErrorCode: "UND_ERR_SOCKET" }),
    }));
    await store.put(artifact);
    expect(requests).toBe(2);
    await store.put(artifact);
    expect(requests).toBe(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

async function decodeSnapshot(body: string) {
  const value = await fetchHostedWebControlPlaneJson({
    boundUserId: "synthetic-user",
    body: { userId: "synthetic-user", includeCredentialMaterial: false },
    description: "Hosted device-sync runtime snapshot",
    fetchImpl: async () => new Response(body, { headers: { "content-type": "application/json" } }),
    route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.deviceSyncRuntimeSnapshot,
    timeoutMs: 5_000,
    transport: { mode: "proxy" },
  });
  return parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(value);
}

test.each(["", "null", "[]", "42", '"synthetic-private-sentinel"'])(
  "HTTP 200 nonobject body %j reaches the same snapshot root validation failure",
  async (body) => {
    await expect(decodeSnapshot(body)).rejects.toThrow("Hosted device-sync runtime snapshot response must be an object.");
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("synthetic-private-sentinel");
  },
);

test("HTTP 200 malformed JSON reaches the existing transport failure without logging its text", async () => {
  await expect(decodeSnapshot('{"synthetic-private-sentinel":')).rejects.toThrow("Hosted device-sync runtime snapshot returned invalid JSON.");
  expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("synthetic-private-sentinel");
});
