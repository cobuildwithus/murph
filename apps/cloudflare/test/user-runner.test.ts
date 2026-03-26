import { beforeEach, describe, expect, it, vi } from "vitest";

import { HostedUserRunner } from "../src/user-runner.js";

describe("HostedUserRunner", () => {
  const bucket = createBucket();
  const storage = createStorage();
  const environment = {
    bundleEncryptionKey: Uint8Array.from({ length: 32 }, () => 7),
    bundleEncryptionKeyId: "v1",
    controlToken: null,
    defaultAlarmDelayMs: 60_000,
    dispatchSigningSecret: "dispatch-secret",
    maxEventAttempts: 3,
    retryDelayMs: 10_000,
    runnerBaseUrl: "https://runner.example.test",
    runnerControlToken: "runner-token",
    runnerTimeoutMs: 60_000,
  };

  beforeEach(() => {
    bucket.clear();
    storage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("dispatches work through the runner endpoint and persists encrypted bundles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            bundles: {
              agentState: Buffer.from("agent-state").toString("base64"),
              vault: Buffer.from("vault").toString("base64"),
            },
            result: {
              eventsHandled: 1,
              summary: "ok",
            },
          }),
          {
            status: 200,
          },
        ),
      ),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const status = await runner.dispatch({
      event: {
        kind: "member.activated",
        linqChatId: "chat_123",
        normalizedPhoneNumber: "+15551234567",
        userId: "member_123",
      },
      eventId: "evt_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    expect(status.userId).toBe("member_123");
    expect(status.lastEventId).toBe("evt_123");
    expect(status.lastError).toBeNull();
    expect(status.bundleRefs.vault?.size).toBe(5);
    expect(status.bundleRefs.agentState?.size).toBe(11);
    expect(status.pendingEventCount).toBe(0);
    expect(status.poisonedEventIds).toEqual([]);
    expect(status.retryingEventId).toBeNull();
    expect(storage.lastAlarm).not.toBeNull();
    expect(bucket.keys()).toEqual([
      "users/member_123/agent-state.bundle.json",
      "users/member_123/vault.bundle.json",
    ]);
  });


  it("reuses existing bundle refs when the runner returns unchanged bundle payloads", async () => {
    const encodedAgent = Buffer.from("agent-state").toString("base64");
    const encodedVault = Buffer.from("vault").toString("base64");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            bundles: {
              agentState: encodedAgent,
              vault: encodedVault,
            },
            result: {
              eventsHandled: 1,
              summary: "ok",
            },
          }),
          {
            status: 200,
          },
        ),
      ),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const first = await runner.dispatch({
      event: {
        kind: "member.activated",
        linqChatId: "chat_123",
        normalizedPhoneNumber: "+15551234567",
        userId: "member_123",
      },
      eventId: "evt_first",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });
    const writeCountAfterFirstRun = bucket.putCount();

    const second = await runner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_second",
      occurredAt: "2026-03-26T12:01:00.000Z",
    });

    expect(second.bundleRefs).toEqual(first.bundleRefs);
    expect(bucket.putCount()).toBe(writeCountAfterFirstRun);
  });

  it("retries failed events and eventually poisons them after repeated runner failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("runner failed", {
          status: 503,
        }),
      ),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const first = await runner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_retry_1",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    expect(first.lastError).toContain("HTTP 503");
    expect(first.pendingEventCount).toBe(1);
    expect(first.retryingEventId).toBe("evt_retry_1");

    vi.setSystemTime(new Date("2026-03-26T12:00:10.000Z"));
    await runner.alarm();
    vi.setSystemTime(new Date("2026-03-26T12:00:30.000Z"));
    await runner.alarm();

    const final = await runner.status("member_123");

    expect(final.pendingEventCount).toBe(0);
    expect(final.poisonedEventIds).toEqual(["evt_retry_1"]);
    expect(final.retryingEventId).toBeNull();
    expect(final.lastError).toContain("HTTP 503");
  });

  it("clears the durable-object alarm when no next wake remains", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            bundles: {
              agentState: Buffer.from("agent-state").toString("base64"),
              vault: Buffer.from("vault").toString("base64"),
            },
            result: {
              eventsHandled: 1,
              summary: "ok",
            },
          }),
          {
            status: 200,
          },
        ),
      ),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    await runner.dispatch({
      event: {
        kind: "member.activated",
        linqChatId: "chat_123",
        normalizedPhoneNumber: "+15551234567",
        userId: "member_123",
      },
      eventId: "evt_alarm_clear",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });
    expect(storage.lastAlarm).not.toBeNull();

    storage.clear();
    await runner.alarm();

    expect(storage.lastAlarm).toBeNull();
  });
});

function createBucket() {
  const values = new Map<string, string>();
  let writes = 0;

  return {
    api: {
      async get(key: string) {
        const value = values.get(key);

        if (!value) {
          return null;
        }

        return {
          async arrayBuffer() {
            return Buffer.from(value, "utf8");
          },
        };
      },
      async put(key: string, value: string) {
        writes += 1;
        values.set(key, value);
      },
    },
    clear() {
      values.clear();
      writes = 0;
    },
    keys() {
      return [...values.keys()].sort();
    },
    putCount() {
      return writes;
    },
  };
}

function createStorage() {
  const values = new Map<string, unknown>();
  const state = {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return values.get(key) as T | undefined;
      },
      async put<T>(key: string, value: T): Promise<void> {
        values.set(key, value);
      },
      async deleteAlarm(): Promise<void> {
        storage.lastAlarm = null;
      },
      async getAlarm(): Promise<number | null> {
        return storage.lastAlarm;
      },
      async setAlarm(value: number | Date): Promise<void> {
        storage.lastAlarm = value instanceof Date ? value.getTime() : value;
      },
    },
  };
  const storage = {
    clear() {
      values.clear();
      storage.lastAlarm = null;
    },
    lastAlarm: null as number | null,
    state,
  };

  return storage;
}
