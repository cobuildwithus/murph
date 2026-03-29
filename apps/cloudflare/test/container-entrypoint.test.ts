import { request as httpRequest } from "node:http";
import { once } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { startHostedContainerEntrypoint } from "../src/container-entrypoint.js";
import * as nodeRunner from "../src/node-runner.js";

const servers: Array<Awaited<ReturnType<typeof startHostedContainerEntrypoint>>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.close();
    await once(server, "close");
  }));
});

describe("startHostedContainerEntrypoint", () => {
  it("serves a lightweight health endpoint", async () => {
    const server = await startHostedContainerEntrypoint({
      controlToken: null,
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "cloudflare-hosted-runner-node",
    });
  });

  it("fails closed when the runner control token is missing", async () => {
    const server = await startHostedContainerEntrypoint({
      controlToken: null,
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/__internal/run`, {
      body: JSON.stringify({
        bundles: { agentState: null, vault: null },
        dispatch: {
          event: { kind: "assistant.cron.tick", reason: "manual", userId: "u1" },
          eventId: "evt_missing_token",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      }),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted runner control token is not configured.",
    });
  });

  it("returns a stable invalid JSON error for malformed run requests", async () => {
    const server = await startHostedContainerEntrypoint({
      controlToken: "runner-token",
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/__internal/run`, {
      body: "{]",
      headers: {
        authorization: "Bearer runner-token",
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid JSON.",
    });
  });

  it("returns a stable invalid request error when the run body is not an object", async () => {
    const server = await startHostedContainerEntrypoint({
      controlToken: "runner-token",
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/__internal/run`, {
      body: JSON.stringify(["not-an-object"]),
      headers: {
        authorization: "Bearer runner-token",
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request.",
    });
  });

  it("keeps downstream runtime TypeErrors as internal errors after request decoding succeeds", async () => {
    const spy = vi.spyOn(nodeRunner, "runHostedExecutionJob").mockRejectedValue(
      new TypeError("missing hosted runtime config"),
    );

    try {
      const server = await startHostedContainerEntrypoint({
        controlToken: "runner-token",
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/__internal/run`, {
        body: JSON.stringify({
          bundles: { agentState: null, vault: null },
          dispatch: {
            event: { kind: "assistant.cron.tick", reason: "manual", userId: "u1" },
            eventId: "evt_runtime_type_error",
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
        }),
        headers: {
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Internal error.",
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("passes the hosted run context through request parsing into the node runner", async () => {
    const spy = vi.spyOn(nodeRunner, "runHostedExecutionJob").mockResolvedValue({
      bundles: { agentState: null, vault: null },
      result: { eventsHandled: 1, summary: "ok" },
    });

    try {
      const server = await startHostedContainerEntrypoint({
        controlToken: "runner-token",
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const run = {
        attempt: 4,
        runId: "run_trace",
        startedAt: "2026-03-26T12:00:00.000Z",
      };
      const response = await fetch(`http://127.0.0.1:${address.port}/__internal/run`, {
        body: JSON.stringify({
          bundles: { agentState: null, vault: null },
          dispatch: {
            event: { kind: "assistant.cron.tick", reason: "manual", userId: "u1" },
            eventId: "evt_with_run",
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
          run,
        }),
        headers: {
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(200);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatch: expect.objectContaining({
            eventId: "evt_with_run",
          }),
          run,
        }),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("allows concurrent hosted jobs inside one container process", async () => {
    const started: string[] = [];
    const finished: string[] = [];
    let inFlight = 0;
    let sawOverlap = false;

    const spy = vi.spyOn(nodeRunner, "runHostedExecutionJob").mockImplementation(async (job: any) => {
      started.push(job.dispatch.eventId);
      inFlight += 1;

      if (inFlight > 1) {
        sawOverlap = true;
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      finished.push(job.dispatch.eventId);

      return {
        bundles: { agentState: null, vault: null },
        result: { eventsHandled: 1, summary: job.dispatch.eventId },
      };
    });

    try {
      const server = await startHostedContainerEntrypoint({ controlToken: "runner-token", port: 0 });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const url = `http://127.0.0.1:${address.port}/__internal/run`;
      await Promise.all([
        fetch(url, {
          method: "POST",
          headers: {
            authorization: "Bearer runner-token",
            "content-type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({
            bundles: { agentState: null, vault: null },
            dispatch: {
              event: { kind: "assistant.cron.tick", reason: "manual", userId: "u1" },
              eventId: "evt_a",
              occurredAt: "2026-03-26T12:00:00.000Z",
            },
          }),
        }),
        fetch(url, {
          method: "POST",
          headers: {
            authorization: "Bearer runner-token",
            "content-type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({
            bundles: { agentState: null, vault: null },
            dispatch: {
              event: { kind: "assistant.cron.tick", reason: "manual", userId: "u2" },
              eventId: "evt_b",
              occurredAt: "2026-03-26T12:00:00.000Z",
            },
          }),
        }),
      ]);

      expect(sawOverlap).toBe(true);
      expect(started).toEqual(["evt_a", "evt_b"]);
      expect(finished).toHaveLength(2);
      expect(new Set(finished)).toEqual(new Set(["evt_a", "evt_b"]));
    } finally {
      spy.mockRestore();
    }
  });

  it("does not block another hosted job when a concurrent job fails", async () => {
    const started: string[] = [];
    const finished: string[] = [];
    let rejectFirstJob: ((error: Error) => void) | null = null;

    const firstJob = new Promise<never>((_, reject) => {
      rejectFirstJob = reject;
    });
    const spy = vi.spyOn(nodeRunner, "runHostedExecutionJob").mockImplementation(async (job: any) => {
      started.push(job.dispatch.eventId);

      if (job.dispatch.eventId === "evt_a") {
        try {
          await firstJob;
          throw new Error("Expected the first hosted job to reject.");
        } finally {
          finished.push(job.dispatch.eventId);
        }
      }

      finished.push(job.dispatch.eventId);
      return {
        bundles: { agentState: null, vault: null },
        result: { eventsHandled: 1, summary: job.dispatch.eventId },
      };
    });

    try {
      const server = await startHostedContainerEntrypoint({ controlToken: "runner-token", port: 0 });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const url = `http://127.0.0.1:${address.port}/__internal/run`;
      const firstResponsePromise = fetch(url, {
        method: "POST",
        headers: {
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          bundles: { agentState: null, vault: null },
          dispatch: {
            event: { kind: "assistant.cron.tick", reason: "manual", userId: "u1" },
            eventId: "evt_a",
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
        }),
      });
      const secondResponsePromise = fetch(url, {
        method: "POST",
        headers: {
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          bundles: { agentState: null, vault: null },
          dispatch: {
            event: { kind: "assistant.cron.tick", reason: "manual", userId: "u2" },
            eventId: "evt_b",
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(started).toEqual(["evt_a", "evt_b"]);
      rejectFirstJob?.(new Error("boom"));

      const [firstResponse, secondResponse] = await Promise.all([
        firstResponsePromise,
        secondResponsePromise,
      ]);

      expect(started).toEqual(["evt_a", "evt_b"]);
      expect(new Set(finished)).toEqual(new Set(["evt_a", "evt_b"]));
      expect(firstResponse.status).toBe(500);
      await expect(firstResponse.json()).resolves.toEqual({
        error: "Internal error.",
      });
      expect(secondResponse.status).toBe(200);
      await expect(secondResponse.json()).resolves.toMatchObject({
        result: { summary: "evt_b" },
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("aborts the hosted job when the client disconnects before the response completes", async () => {
    let abortSignal: AbortSignal | null = null;
    let abortReason: unknown = null;
    let resolveStarted: (() => void) | null = null;
    let resolveAborted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      resolveAborted = resolve;
    });
    const spy = vi.spyOn(nodeRunner, "runHostedExecutionJob").mockImplementation(async (_job: any, options) => {
      abortSignal = options?.signal ?? null;
      resolveStarted?.();

      await new Promise<never>((_, reject) => {
        abortSignal?.addEventListener("abort", () => {
          abortReason = abortSignal?.reason;
          resolveAborted?.();
          reject(abortReason instanceof Error ? abortReason : new Error("aborted"));
        }, { once: true });
      });

      throw new Error("unreachable");
    });

    try {
      const server = await startHostedContainerEntrypoint({ controlToken: "runner-token", port: 0 });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const request = httpRequest({
        headers: {
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        host: "127.0.0.1",
        method: "POST",
        path: "/__internal/run",
        port: address.port,
      });
      request.on("error", () => {});
      request.write(JSON.stringify({
        bundles: { agentState: null, vault: null },
        dispatch: {
          event: { kind: "assistant.cron.tick", reason: "manual", userId: "u1" },
          eventId: "evt_disconnect",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      }));
      request.end();

      await started;
      request.destroy();
      await aborted;

      expect(spy).toHaveBeenCalledTimes(1);
      expect(abortSignal?.aborted).toBe(true);
      expect(abortReason).toBeInstanceOf(Error);
      expect((abortReason as Error).message).toContain("aborted");
    } finally {
      spy.mockRestore();
    }
  });
});
