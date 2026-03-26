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
    runnerBaseUrl: "https://runner.example.test",
    runnerControlToken: "runner-token",
  };

  beforeEach(() => {
    bucket.clear();
    storage.clear();
    vi.restoreAllMocks();
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
    expect(storage.lastAlarm).not.toBeNull();
    expect(bucket.keys()).toEqual([
      "users/member_123/agent-state.bundle.json",
      "users/member_123/vault.bundle.json",
    ]);
  });
});

function createBucket() {
  const values = new Map<string, string>();

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
        values.set(key, value);
      },
    },
    clear() {
      values.clear();
    },
    keys() {
      return [...values.keys()].sort();
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
