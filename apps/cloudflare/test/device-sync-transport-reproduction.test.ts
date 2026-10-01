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
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test.each([1, 2])("recovers one real socket close and retains owner recovery after %i socket closes", async (failures) => {
  vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 0, 1));
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    request.resume();
    request.on("end", () => {
      if (requests <= failures) request.socket.destroy();
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
    const upload = store.put(artifact);
    if (failures === 1) {
      await expect(upload).resolves.toBeUndefined();
      expect(requests).toBe(2);
    } else {
      await expect(upload).rejects.toBeInstanceOf(HostedRuntimeArtifactWriteError);
      await expect(upload).rejects.toMatchObject({ retryable: true });
      expect(requests).toBe(2);
      await store.put(artifact);
      expect(requests).toBe(3);
    }
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      message: failures === 1
        ? "Hosted runtime artifact upload transport recovery backoff."
        : "Hosted runtime artifact upload failed before response.",
      details: expect.objectContaining({ fetchNetworkErrorCode: "UND_ERR_SOCKET" }),
    }));
    await store.put(artifact);
    expect(requests).toBe(failures + 1);
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
