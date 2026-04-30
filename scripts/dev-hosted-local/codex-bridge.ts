import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import net, { type Server, type Socket } from "node:net";
import os from "node:os";
import process from "node:process";

import {
  repoRoot,
} from "./constants.ts";

const CODEX_BRIDGE_HANDSHAKE_MAX_BYTES = 4096;
const CODEX_BRIDGE_HANDSHAKE_TIMEOUT_MS = 5_000;
const CODEX_BRIDGE_CHILD_TERM_TIMEOUT_MS = 2_000;
const CODEX_BRIDGE_CHILD_KILL_TIMEOUT_MS = 1_000;

export interface HostedLocalCodexBridge {
  proxyToken: string;
  proxyUrl: string;
  stop(): Promise<void>;
}

export async function startHostedLocalCodexBridge(input: {
  codexCommand: string;
  env: NodeJS.ProcessEnv;
  listenHost: string;
  listenPort: number;
  stderrTarget?: NodeJS.WritableStream;
}): Promise<HostedLocalCodexBridge> {
  const proxyToken = randomBytes(32).toString("base64url");
  const activeChildren = new Set<ChildProcessWithoutNullStreams>();
  const activeSockets = new Set<Socket>();
  const server = net.createServer((socket) => {
    activeSockets.add(socket);
    socket.once("close", () => {
      activeSockets.delete(socket);
    });
    acceptCodexBridgeConnection({
      activeChildren,
      codexCommand: input.codexCommand,
      env: input.env,
      proxyToken,
      socket,
      stderrTarget: input.stderrTarget,
    });
  });

  await listen(server, input.listenHost, input.listenPort);
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Local Codex bridge did not bind a TCP port.");
  }

  return {
    proxyToken,
    proxyUrl: `tcp://${formatCodexBridgeProxyHost(input.listenHost)}:${address.port}`,
    stop: async () => {
      for (const socket of activeSockets) {
        socket.destroy();
      }
      await terminateCodexBridgeChildren(activeChildren);
      await closeServer(server);
    },
  };
}

function acceptCodexBridgeConnection(input: {
  activeChildren: Set<ChildProcessWithoutNullStreams>;
  codexCommand: string;
  env: NodeJS.ProcessEnv;
  proxyToken: string;
  socket: Socket;
  stderrTarget?: NodeJS.WritableStream;
}): void {
  let buffered = Buffer.alloc(0);
  const handshakeTimer = setTimeout(() => {
    input.socket.destroy();
  }, CODEX_BRIDGE_HANDSHAKE_TIMEOUT_MS);
  input.socket.once("close", () => {
    clearTimeout(handshakeTimer);
  });

  const onData = (chunk: Buffer): void => {
    buffered = Buffer.concat([buffered, chunk]);
    if (buffered.byteLength > CODEX_BRIDGE_HANDSHAKE_MAX_BYTES) {
      input.socket.destroy();
      return;
    }

    const newlineIndex = buffered.indexOf(0x0a);
    if (newlineIndex === -1) {
      return;
    }

    clearTimeout(handshakeTimer);
    input.socket.off("data", onData);
    const handshakeLine = buffered.subarray(0, newlineIndex).toString("utf8").trim();
    const remainder = buffered.subarray(newlineIndex + 1);

    if (!isValidBridgeHandshake(handshakeLine, input.proxyToken)) {
      input.socket.destroy();
      return;
    }

    const child = spawnLocalCodexAppServer(input);
    input.activeChildren.add(child);
    child.stderr.resume();
    child.once("close", (code, signal) => {
      input.activeChildren.delete(child);
      if (code !== 0 && signal === null) {
        writeCodexBridgeDiagnosticText(
          input.stderrTarget,
          `app-server exited with code ${code ?? "unknown"}`,
        );
      }
      input.socket.end();
    });
    child.once("error", (error) => {
      writeCodexBridgeDiagnostic(input.stderrTarget, "app-server spawn failed", error);
      input.socket.destroy();
    });

    input.socket.pipe(child.stdin);
    child.stdout.pipe(input.socket);
    if (remainder.byteLength > 0) {
      child.stdin.write(remainder);
    }
    input.socket.once("close", () => {
      child.kill("SIGTERM");
    });
  };

  input.socket.on("data", onData);
}

async function terminateCodexBridgeChildren(
  activeChildren: Set<ChildProcessWithoutNullStreams>,
): Promise<void> {
  await Promise.all([...activeChildren].map(async (child) => {
    if (isChildClosed(child)) {
      return;
    }

    child.kill("SIGTERM");
    if (await waitForChildClose(child, CODEX_BRIDGE_CHILD_TERM_TIMEOUT_MS)) {
      return;
    }

    child.kill("SIGKILL");
    await waitForChildClose(child, CODEX_BRIDGE_CHILD_KILL_TIMEOUT_MS);
  }));
}

function isChildClosed(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildClose(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (isChildClosed(child)) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      child.off("close", onClose);
      resolve(false);
    }, timeoutMs);
    const onClose = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("close", onClose);
  });
}

function spawnLocalCodexAppServer(input: {
  codexCommand: string;
  env: NodeJS.ProcessEnv;
  stderrTarget?: NodeJS.WritableStream;
}): ChildProcessWithoutNullStreams {
  return spawn(input.codexCommand, ["app-server"], {
    cwd: repoRoot,
    detached: false,
    env: input.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function isValidBridgeHandshake(line: string, token: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return false;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return false;
  }

  const record = parsed as Record<string, unknown>;
  return record.murphLocalCodexBridgeToken === token;
}

function writeCodexBridgeDiagnosticText(
  stderrTarget: NodeJS.WritableStream | undefined,
  label: string,
): void {
  (stderrTarget ?? process.stderr).write(`[codex] ${label}; stderr redacted.\n`);
}

function writeCodexBridgeDiagnostic(
  stderrTarget: NodeJS.WritableStream | undefined,
  label: string,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  (stderrTarget ?? process.stderr).write(
    `[codex] ${label}: ${sanitizeLocalCodexDiagnostic(message)}\n`,
  );
}

function sanitizeLocalCodexDiagnostic(input: string): string {
  let output = input;
  const homeDir = os.homedir();
  const accountName = process.env.USER ?? process.env.LOGNAME ?? "";

  if (homeDir) {
    output = output.split(homeDir).join("<HOME_DIR>");
  }
  if (accountName) {
    output = output.split(accountName).join("<REDACTED_USER>");
  }

  return output
    .replace(/\b(authorization|token|secret|api[_-]?key)\b\s*[:=]\s*[^,\s]+/giu, "$1=<redacted>")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|sess_[A-Za-z0-9_-]{8,})\b/gu, "<redacted>");
}

function formatCodexBridgeProxyHost(listenHost: string): string {
  const normalized = listenHost.trim().toLowerCase();
  if (!normalized || normalized === "0.0.0.0" || normalized === "::") {
    return "127.0.0.1";
  }

  if (normalized.includes(":") && !normalized.startsWith("[")) {
    return `[${normalized}]`;
  }

  return normalized;
}

async function listen(server: Server, host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
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
