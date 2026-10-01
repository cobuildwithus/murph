import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CdpClient = {
  ready: Promise<void>;
  send: (method: string) => Promise<unknown>;
  close: () => void;
};

type CdpModule = {
  CdpClient: new (url: string, timeoutMs?: number) => CdpClient;
};

class SyntheticSocket extends EventTarget {
  static latest: SyntheticSocket;
  closed = false;
  sent: string[] = [];

  constructor(_url: string) {
    super();
    SyntheticSocket.latest = this;
  }

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.closed = true;
    this.dispatchEvent(new Event("close"));
  }

  reply(result: unknown): void {
    const request = JSON.parse(this.sent.at(-1) ?? "{}") as { id?: number };
    this.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({ id: request.id, result }),
    }));
  }
}

async function installedCdpModule(): Promise<CdpModule> {
  const entrypoint = path.resolve(
    "node_modules/@cobuild/review-gpt/dist/chatgpt-thread-lib.mjs",
  );
  return import(pathToFileURL(entrypoint).href) as Promise<CdpModule>;
}

function outcome(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((error: unknown) => error instanceof Error ? error.message : error);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", SyntheticSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("installed ReviewGPT CDP recovery deadlines", () => {
  it("rejects an unopened socket instead of leaving target recovery pending", async () => {
    const { CdpClient } = await installedCdpModule();
    const client = new CdpClient("ws://synthetic.invalid/devtools/page/example", 25);
    const ready = outcome(client.ready);
    try {
      await vi.advanceTimersByTimeAsync(25);
      expect(await Promise.race([ready, Promise.resolve("still pending")]))
        .toBe("Timed out opening CDP socket.");
      expect(SyntheticSocket.latest.closed).toBe(true);
    } finally {
      client.close();
      await ready;
    }
  });

  it("rejects silent commands and releases the unresponsive socket", async () => {
    const { CdpClient } = await installedCdpModule();
    const client = new CdpClient("ws://synthetic.invalid/devtools/page/example", 25);
    SyntheticSocket.latest.dispatchEvent(new Event("open"));
    const command = outcome(client.send("Runtime.evaluate"));
    try {
      await vi.advanceTimersByTimeAsync(25);
      expect(await Promise.race([command, Promise.resolve("still pending")]))
        .toBe("Timed out executing CDP command Runtime.evaluate.");
      expect(SyntheticSocket.latest.closed).toBe(true);
    } finally {
      client.close();
      await command;
    }
  });

  it("keeps a responsive socket usable after earlier command deadlines", async () => {
    const { CdpClient } = await installedCdpModule();
    const client = new CdpClient("ws://synthetic.invalid/devtools/page/example", 25);
    SyntheticSocket.latest.dispatchEvent(new Event("open"));
    try {
      const first = client.send("Runtime.evaluate");
      await Promise.resolve();
      SyntheticSocket.latest.reply({ value: "first" });
      await expect(first).resolves.toEqual({ value: "first" });
      await vi.advanceTimersByTimeAsync(50);
      expect(SyntheticSocket.latest.closed).toBe(false);
      const second = client.send("Runtime.evaluate");
      await Promise.resolve();
      SyntheticSocket.latest.reply({ value: "second" });
      await expect(second).resolves.toEqual({ value: "second" });
    } finally {
      client.close();
    }
  });
});
