import type {
  HostedExecutionBundleKind,
  HostedExecutionBundleRef,
  HostedExecutionDispatchRequest,
  HostedExecutionRunnerRequest,
  HostedExecutionRunnerResult,
  HostedExecutionUserStatus,
} from "@healthybob/runtime-state";

import { createHostedBundleStore, type R2BucketLike } from "./bundle-store.js";
import type { HostedExecutionEnvironment } from "./env.js";

export interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
}

export interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
}

interface UserRunnerRecord {
  activated: boolean;
  bundleRefs: {
    agentState: HostedExecutionBundleRef | null;
    vault: HostedExecutionBundleRef | null;
  };
  inFlight: boolean;
  lastError: string | null;
  lastEventId: string | null;
  lastRunAt: string | null;
  nextWakeAt: string | null;
  recentEventIds: string[];
  userId: string;
}

const STORAGE_KEY = "state";
const MAX_RECENT_EVENT_IDS = 32;

export class HostedUserRunner {
  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: HostedExecutionEnvironment,
    private readonly bucket: R2BucketLike,
  ) {}

  async dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus> {
    let record = await this.readState(input.event.userId);

    if (record.recentEventIds.includes(input.eventId)) {
      return toUserStatus(record);
    }

    record = {
      ...record,
      activated: record.activated || input.event.kind === "member.activated",
      lastEventId: input.eventId,
      recentEventIds: [...record.recentEventIds, input.eventId].slice(-MAX_RECENT_EVENT_IDS),
    };
    await this.writeState(record);

    return this.run(input);
  }

  async run(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus> {
    let record = await this.readState(input.event.userId);

    if (record.inFlight) {
      return toUserStatus(record);
    }

    record = {
      ...record,
      inFlight: true,
      lastError: null,
    };
    await this.writeState(record);

    try {
      if (!this.env.runnerBaseUrl) {
        throw new Error("HOSTED_EXECUTION_RUNNER_BASE_URL is not configured.");
      }

      const store = createHostedBundleStore({
        bucket: this.bucket,
        key: this.env.bundleEncryptionKey,
        keyId: this.env.bundleEncryptionKeyId,
      });
      const requestBody: HostedExecutionRunnerRequest = {
        bundles: {
          agentState: await readBundleBase64(store, record.userId, "agent-state"),
          vault: await readBundleBase64(store, record.userId, "vault"),
        },
        dispatch: input,
      };
      const response = await fetch(`${this.env.runnerBaseUrl}/__internal/run`, {
        body: JSON.stringify(requestBody),
        headers: {
          ...(this.env.runnerControlToken
            ? {
                authorization: `Bearer ${this.env.runnerControlToken}`,
              }
            : {}),
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Hosted runner returned HTTP ${response.status}.`);
      }

      const result = (await response.json()) as HostedExecutionRunnerResult;
      const nextRefs = {
        agentState: result.bundles.agentState
          ? await store.writeBundle(record.userId, "agent-state", decodeBase64(result.bundles.agentState))
          : record.bundleRefs.agentState,
        vault: result.bundles.vault
          ? await store.writeBundle(record.userId, "vault", decodeBase64(result.bundles.vault))
          : record.bundleRefs.vault,
      };
      const nextWakeAt = record.activated
        ? new Date(Date.now() + this.env.defaultAlarmDelayMs).toISOString()
        : null;

      if (nextWakeAt) {
        await this.state.storage.setAlarm(new Date(nextWakeAt));
      }

      record = {
        ...record,
        bundleRefs: nextRefs,
        inFlight: false,
        lastRunAt: new Date().toISOString(),
        nextWakeAt,
      };
      await this.writeState(record);
      return toUserStatus(record);
    } catch (error) {
      record = {
        ...record,
        inFlight: false,
        lastError: error instanceof Error ? error.message : String(error),
      };
      await this.writeState(record);
      return toUserStatus(record);
    }
  }

  async alarm(): Promise<void> {
    const record = await this.readState(null);

    if (!record.activated) {
      return;
    }

    await this.run({
      event: {
        kind: "assistant.cron.tick",
        reason: "alarm",
        userId: record.userId,
      },
      eventId: `alarm:${Date.now()}`,
      occurredAt: new Date().toISOString(),
    });
  }

  async status(userId: string): Promise<HostedExecutionUserStatus> {
    return toUserStatus(await this.readState(userId));
  }

  private async readState(userId: string | null): Promise<UserRunnerRecord> {
    const existing = await this.state.storage.get<UserRunnerRecord>(STORAGE_KEY);

    if (existing) {
      return existing;
    }

    return {
      activated: false,
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      inFlight: false,
      lastError: null,
      lastEventId: null,
      lastRunAt: null,
      nextWakeAt: null,
      recentEventIds: [],
      userId: userId ?? "unknown",
    };
  }

  private async writeState(record: UserRunnerRecord): Promise<void> {
    await this.state.storage.put(STORAGE_KEY, record);
  }
}

async function readBundleBase64(
  store: ReturnType<typeof createHostedBundleStore>,
  userId: string,
  kind: HostedExecutionBundleKind,
): Promise<string | null> {
  const bundle = await store.readBundle(userId, kind);
  return bundle ? Buffer.from(bundle).toString("base64") : null;
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function toUserStatus(record: UserRunnerRecord): HostedExecutionUserStatus {
  return {
    bundleRefs: record.bundleRefs,
    inFlight: record.inFlight,
    lastError: record.lastError,
    lastEventId: record.lastEventId,
    lastRunAt: record.lastRunAt,
    nextWakeAt: record.nextWakeAt,
    userId: record.userId,
  };
}
