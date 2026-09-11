import { createServer, type Socket } from "node:net";
import { brotliCompressSync, gzipSync } from "node:zlib";

import { expect, test, vi } from "vitest";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_BYTES_HEADER,
} from "@murphai/device-syncd/hosted-runtime";

import { createHostedWebDeviceSyncPort } from "../src/runtime-platform/device-sync-port.ts";

vi.mock("@murphai/hosted-execution", async (importOriginal) => ({
  ...await importOriginal<typeof import("@murphai/hosted-execution")>(),
  emitHostedExecutionStructuredLog: vi.fn(),
}));

const snapshot = {
  connections: [],
  generatedAt: "2026-09-10T00:00:00.000Z",
  userId: "synthetic-member",
};
const completeBody = Buffer.from(JSON.stringify({ ...snapshot, synthetic: "é雪" }));

for (const encoding of ["identity", "gzip", "br"] as const) {
  test.each(["empty", "partial"] as const)(
    `snapshot recovers a %s ${encoding} body over real HTTP within one call`,
    async (failure) => {
      const sockets = new Set<Socket>();
      const requests: string[] = [];
      const server = createServer((socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => undefined);
        let request = "";
        socket.on("data", (chunk: Buffer) => {
          request += chunk.toString("utf8");
          const headerEnd = request.indexOf("\r\n\r\n");
          if (headerEnd < 0) return;
          const contentLength = Number(/content-length:\s*(\d+)/iu.exec(request.slice(0, headerEnd))?.[1] ?? 0);
          const requestBody = request.slice(headerEnd + 4);
          if (Buffer.byteLength(requestBody) < contentLength) return;
          requests.push(requestBody);
          const decoded = requests.length === 1
            ? failure === "empty" ? Buffer.alloc(0) : completeBody.subarray(0, 12)
            : completeBody;
          const wire = encoding === "gzip" ? gzipSync(decoded)
            : encoding === "br" ? brotliCompressSync(decoded) : decoded;
          const headers = [
            "HTTP/1.1 200 OK",
            "Content-Type: application/json",
            "Connection: close",
            `Content-Length: ${wire.byteLength}`,
            `${HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_BYTES_HEADER}: ${completeBody.byteLength}`,
            ...(encoding === "identity" ? [] : [`Content-Encoding: ${encoding}`]),
          ];
          socket.end(Buffer.concat([Buffer.from(`${headers.join("\r\n")}\r\n\r\n`), wire]));
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing loopback listener");
        const port = createHostedWebDeviceSyncPort({
          boundUserId: snapshot.userId,
          fetchImpl: (_url, init) => fetch(`http://127.0.0.1:${address.port}/snapshot`, init),
          timeoutMs: 2_000,
          transport: { mode: "proxy" },
        });
        await expect(port.fetchSnapshot({ includeCredentialMaterial: false })).resolves.toEqual(snapshot);
        expect(requests).toHaveLength(2);
        expect(requests[1]).toBe(requests[0]);
        expect(JSON.parse(requests[0]!)).toEqual({
          includeCredentialMaterial: false,
          userId: snapshot.userId,
        });
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    },
  );
}
