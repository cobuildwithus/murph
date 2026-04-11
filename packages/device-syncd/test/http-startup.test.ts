import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, test } from "vitest";

import { startDeviceSyncHttpServer } from "../src/http.ts";
import { createDeviceSyncService } from "../src/service.ts";

const LOOPBACK_HOST = "127.0.0.1";
const TEMP_DIRECTORIES: string[] = [];

afterEach(async () => {
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

test("device sync http server rejects URL-bracket public listener hosts before binding", async () => {
  const service = await createDeviceSyncServiceForStartupTest();

  try {
    await assert.rejects(
      () =>
        startDeviceSyncHttpServer({
          service,
          config: {
            host: LOOPBACK_HOST,
            port: 0,
            controlToken: "test-control-token",
            publicHost: "[::1]",
            publicPort: 0,
          },
        }),
      /Device sync public listener host must be a hostname or address without URL bracket syntax/u,
    );
  } finally {
    service.close();
  }
});

test("device sync http server closes the control listener when the public listener fails to bind", async () => {
  const service = await createDeviceSyncServiceForStartupTest();
  const blocker = await listenTcpServer(createServer(), LOOPBACK_HOST, 0);
  const controlPort = await reserveDistinctTcpPort(LOOPBACK_HOST, blocker.port);

  try {
    await assert.rejects(
      () =>
        startDeviceSyncHttpServer({
          service,
          config: {
            host: LOOPBACK_HOST,
            port: controlPort,
            controlToken: "test-control-token",
            publicHost: LOOPBACK_HOST,
            publicPort: blocker.port,
          },
        }),
    );

    const probe = await listenTcpServer(createServer(), LOOPBACK_HOST, controlPort);
    await closeTcpServer(probe.server);
  } finally {
    await closeTcpServer(blocker.server);
    service.close();
  }
});

async function createDeviceSyncServiceForStartupTest() {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-device-syncd-startup-"));
  TEMP_DIRECTORIES.push(vaultRoot);
  return createDeviceSyncService({
    secret: "test-secret",
    config: {
      publicBaseUrl: "https://sync.example.test/device-sync",
      vaultRoot,
    },
    providers: [],
  });
}

async function reserveTcpPort(host: string): Promise<number> {
  const handle = await listenTcpServer(createServer(), host, 0);
  try {
    return handle.port;
  } finally {
    await closeTcpServer(handle.server);
  }
}

async function listenTcpServer(
  server: Server,
  host: string,
  port: number,
): Promise<{ server: Server; port: number }> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new TypeError("Expected a TCP listener address.");
  }

  return {
    server,
    port: address.port,
  };
}

async function closeTcpServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function reserveDistinctTcpPort(host: string, blockedPort: number): Promise<number> {
  for (;;) {
    const port = await reserveTcpPort(host);
    if (port !== blockedPort) {
      return port;
    }
  }
}
