import { createServer } from "node:http";
import { expect, test } from "vitest";
import { JunctionClient } from "../src/providers/junction-client.ts";

test("a real HTTP response stalled at the server produces the local retryable Junction deadline error", async () => {
  let requests = 0;
  const server = createServer((request) => {
    requests += 1;
    request.resume();
    // Deliberately leave this synthetic response open until the client deadline.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
    const client = new JunctionClient({
      apiKey: "sk_us_synthetic_test_key",
      environment: "sandbox",
      region: "us",
      requestTimeoutMs: 1_000,
      fetchImpl: (_url, init) => fetch(`http://127.0.0.1:${address.port}/providers`, init),
    });
    await expect(client.listUserProviders("synthetic-user")).rejects.toMatchObject({
      code: "JUNCTION_API_REQUEST_FAILED",
      httpStatus: 502,
      retryable: true,
      cause: expect.objectContaining({ name: "TimeoutError" }),
    });
    expect(requests).toBe(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
