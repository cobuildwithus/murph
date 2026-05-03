import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  startHostedLocalCodexBridge,
} from "./codex-bridge.ts";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((target) =>
      rm(target, {
        force: true,
        recursive: true,
      })
    ),
  );
});

describe("startHostedLocalCodexBridge", () => {
  it("authenticates a TCP bridge and proxies JSON-RPC to local codex app-server", async () => {
    const fakeCodexCommand = await createFakeCodexCommand();
    const bridge = await startHostedLocalCodexBridge({
      codexCommand: fakeCodexCommand,
      env: process.env,
      listenHost: "127.0.0.1",
      listenPort: 0,
    });

    try {
      const response = await runBridgeRoundTrip({
        argv: ["-a", "never", "app-server"],
        proxyToken: bridge.proxyToken,
        proxyUrl: bridge.proxyUrl,
      });

      expect(response).toEqual({
        id: 7,
        result: {
          argv: ["-a", "never", "app-server"],
          ok: true,
        },
      });
    } finally {
      await bridge.stop();
    }
  });

  it("closes unauthenticated bridge connections before spawning codex", async () => {
    const markerPath = await createTemporaryMarkerPath();
    const fakeCodexCommand = await createFakeCodexCommand({ markerPath });
    const bridge = await startHostedLocalCodexBridge({
      codexCommand: fakeCodexCommand,
      env: process.env,
      listenHost: "127.0.0.1",
      listenPort: 0,
    });

    try {
      await expect(runBridgeRoundTrip({
        proxyToken: "wrong-token",
        proxyUrl: bridge.proxyUrl,
      })).rejects.toThrow(/closed before response|ECONNRESET/u);
      await expect(access(markerPath)).rejects.toThrow();
    } finally {
      await bridge.stop();
    }
  });

  it("rejects malformed bridge handshakes before spawning codex", async () => {
    const markerPath = await createTemporaryMarkerPath();
    const fakeCodexCommand = await createFakeCodexCommand({ markerPath });
    const bridge = await startHostedLocalCodexBridge({
      codexCommand: fakeCodexCommand,
      env: process.env,
      listenHost: "127.0.0.1",
      listenPort: 0,
    });

    try {
      await expect(sendInvalidBridgeHandshake({
        payload: "not-json\n",
        proxyUrl: bridge.proxyUrl,
      })).resolves.toBeUndefined();
      await expect(access(markerPath)).rejects.toThrow();
    } finally {
      await bridge.stop();
    }
  });

  it("rejects oversized bridge handshakes before spawning codex", async () => {
    const markerPath = await createTemporaryMarkerPath();
    const fakeCodexCommand = await createFakeCodexCommand({ markerPath });
    const bridge = await startHostedLocalCodexBridge({
      codexCommand: fakeCodexCommand,
      env: process.env,
      listenHost: "127.0.0.1",
      listenPort: 0,
    });

    try {
      await expect(sendInvalidBridgeHandshake({
        payload: "x".repeat(4097),
        proxyUrl: bridge.proxyUrl,
      })).resolves.toBeUndefined();
      await expect(access(markerPath)).rejects.toThrow();
    } finally {
      await bridge.stop();
    }
  });

  it("waits for active local codex app-server children during shutdown", async () => {
    const markerPath = await createTemporaryMarkerPath();
    const fakeCodexCommand = await createFakeCodexCommand({
      markerPath,
      stayAlive: true,
    });
    const bridge = await startHostedLocalCodexBridge({
      codexCommand: fakeCodexCommand,
      env: process.env,
      listenHost: "127.0.0.1",
      listenPort: 0,
    });

    await expect(runBridgeRoundTrip({
      proxyToken: bridge.proxyToken,
      proxyUrl: bridge.proxyUrl,
    })).resolves.toMatchObject({
      result: {
        ok: true,
      },
    });

    await bridge.stop();
    await expect(readFile(markerPath, "utf8")).resolves.toBe("terminated");
  });
});

async function createTemporaryMarkerPath(): Promise<string> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "hosted-local-codex-bridge-"));
  temporaryPaths.push(tempDir);
  return path.join(tempDir, "marker.txt");
}

async function createFakeCodexCommand(input: {
  markerPath?: string;
  stayAlive?: boolean;
} = {}): Promise<string> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "hosted-local-codex-bridge-"));
  temporaryPaths.push(tempDir);
  const commandPath = path.join(tempDir, "fake-codex.js");
  const markerLine = input.markerPath
    ? `require("node:fs").writeFileSync(${JSON.stringify(input.markerPath)}, "spawned");`
    : "";
  const terminateLine = input.markerPath
    ? `process.on("SIGTERM", () => { require("node:fs").writeFileSync(${JSON.stringify(input.markerPath)}, "terminated"); process.exit(0); });`
    : "";
  const keepAliveLine = input.stayAlive ? "setInterval(() => {}, 1000);" : "";
  await writeFile(
    commandPath,
    `#!/usr/bin/env node
const readline = require("node:readline");
${markerLine}
${terminateLine}
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  process.stdout.write(JSON.stringify({
    id: message.id,
    result: {
      argv: process.argv.slice(2),
      ok: true,
    },
  }) + "\\n");
});
${keepAliveLine}
`,
    "utf8",
  );
  await chmod(commandPath, 0o700);
  return commandPath;
}

async function sendInvalidBridgeHandshake(input: {
  payload: string;
  proxyUrl: string;
}): Promise<void> {
  const url = new URL(input.proxyUrl);
  const socket = net.connect({
    host: url.hostname,
    port: Number(url.port),
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("bridge invalid handshake timed out"));
    }, 5_000);
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onError = (error: Error): void => {
      cleanup();
      if ((error as NodeJS.ErrnoException).code === "ECONNRESET") {
        resolve();
        return;
      }

      reject(error);
    };
    const onClose = (): void => {
      cleanup();
      resolve();
    };

    socket.once("error", onError);
    socket.once("close", onClose);
    socket.once("connect", () => {
      socket.write(input.payload);
    });
  });
}

async function runBridgeRoundTrip(input: {
  argv?: readonly string[];
  proxyToken: string;
  proxyUrl: string;
}): Promise<Record<string, unknown>> {
  const url = new URL(input.proxyUrl);
  const socket = net.connect({
    host: url.hostname,
    port: Number(url.port),
  });
  socket.setEncoding("utf8");

  try {
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("bridge round trip timed out"));
      }, 5_000);
      let buffer = "";

      const cleanup = (): void => {
        clearTimeout(timeout);
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("close", onClose);
      };
      const onData = (chunk: string | Buffer): void => {
        buffer += String(chunk);
        const lines = buffer.split(/\r?\n/u);
        buffer = lines.pop() ?? "";
        const line = lines.find((entry) => entry.trim().length > 0);
        if (!line) {
          return;
        }

        cleanup();
        resolve(JSON.parse(line) as Record<string, unknown>);
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const onClose = (): void => {
        cleanup();
        reject(new Error("bridge closed before response"));
      };

      socket.on("data", onData);
      socket.once("error", onError);
      socket.once("close", onClose);
      socket.once("connect", () => {
        socket.write(JSON.stringify({
          ...(input.argv ? { argv: input.argv } : {}),
          murphLocalCodexBridgeToken: input.proxyToken,
        }) + "\n");
        socket.write(JSON.stringify({ id: 7, method: "initialize", params: {} }) + "\n");
      });
    });
  } finally {
    socket.destroy();
  }
}
