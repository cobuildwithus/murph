import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  appendAssistantAutomationEvent,
  createAssistantAutomationEventId,
  listAssistantAutomationEvents,
} from "../src/assistant-events.ts";
import { resolveAssistantStatePaths } from "../src/assistant-state.ts";
import {
  assertLocalDeviceSyncControlPlaneBaseUrl,
  isDeviceSyncLocalControlPlaneError,
  isLoopbackDeviceSyncBaseUrl,
  resolveDeviceSyncBaseUrl,
  resolveDeviceSyncControlToken,
} from "../src/device-sync.ts";
import { encodeCrockford, encodeRandomCrockford, generateUlid } from "../src/ulid.ts";

function deterministicRandomBytes(length: number): Uint8Array {
  return Uint8Array.from(Array.from({ length }, (_, index) => index));
}

test("shared Crockford helpers preserve the duplicated low-level encoding behavior", () => {
  assert.equal(encodeCrockford(0, 10), "0000000000");
  assert.equal(encodeCrockford(32, 4), "0010");
  assert.equal(encodeRandomCrockford(24, deterministicRandomBytes), "0123456789ABCDEFGHJKMNPQ");
  assert.equal(generateUlid(0, deterministicRandomBytes), "00000000000123456789ABCDEF");
});

test("resolveDeviceSyncBaseUrl reads the unprefixed env var", () => {
  assert.equal(
    resolveDeviceSyncBaseUrl({
      env: {
        DEVICE_SYNC_BASE_URL: "http://127.0.0.1:9911/",
      },
    }),
    "http://127.0.0.1:9911",
  );
});

test("resolveDeviceSyncBaseUrl falls back to the default base URL when env is unset", () => {
  assert.equal(resolveDeviceSyncBaseUrl(), "http://127.0.0.1:8788");
});

test("resolveDeviceSyncBaseUrl rejects non-loopback base URLs when a control-plane bearer is configured", () => {
  assert.throws(
    () =>
      resolveDeviceSyncBaseUrl({
        value: "https://example.com/device-sync",
        controlToken: "control-token",
      }),
    (error) => isDeviceSyncLocalControlPlaneError(error),
  );
});

test("assertLocalDeviceSyncControlPlaneBaseUrl allows loopback control-plane targets", () => {
  assert.equal(isLoopbackDeviceSyncBaseUrl("http://127.0.0.1:8788"), true);
  assert.equal(isLoopbackDeviceSyncBaseUrl("http://localhost:8788"), true);
  assert.equal(isLoopbackDeviceSyncBaseUrl("http://[::1]:8788"), true);

  assert.doesNotThrow(() =>
    assertLocalDeviceSyncControlPlaneBaseUrl({
      baseUrl: "http://localhost:8788",
      controlToken: "control-token",
    }),
  );
});

test("resolveDeviceSyncControlToken reads the unprefixed control token", () => {
  assert.equal(
    resolveDeviceSyncControlToken({
      env: {
        DEVICE_SYNC_CONTROL_TOKEN: "control-token",
      },
    }),
    "control-token",
  );
});

test("resolveDeviceSyncControlToken falls back to DEVICE_SYNC_SECRET", () => {
  assert.equal(
    resolveDeviceSyncControlToken({
      env: {
        DEVICE_SYNC_SECRET: "secret-token",
      },
    }),
    "secret-token",
  );
});

test("resolveDeviceSyncControlToken prefers DEVICE_SYNC_CONTROL_TOKEN over DEVICE_SYNC_SECRET", () => {
  assert.equal(
    resolveDeviceSyncControlToken({
      env: {
        DEVICE_SYNC_CONTROL_TOKEN: "control-token",
        DEVICE_SYNC_SECRET: "secret-token",
      },
    }),
    "control-token",
  );
});

test("resolveDeviceSyncControlToken returns null when no env is set", () => {
  assert.equal(resolveDeviceSyncControlToken(), null);
});

test("assistant state paths expose event queue and transcript maintenance scaffolding", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "healthybob-runtime-state-"));
  const vaultRoot = path.join(parent, "vault");
  await mkdir(vaultRoot, { recursive: true });

  try {
    const paths = resolveAssistantStatePaths(vaultRoot);

    assert.equal(paths.eventQueuePath, path.join(paths.assistantStateRoot, "automation-events.jsonl"));
    assert.equal(
      paths.eventDeadLetterPath,
      path.join(paths.assistantStateRoot, "automation-events.dead-letter.jsonl"),
    );
    assert.equal(
      paths.transcriptMaintenanceDirectory,
      path.join(paths.assistantStateRoot, "transcript-maintenance"),
    );
    assert.equal(
      paths.transcriptArchivesDirectory,
      path.join(paths.assistantStateRoot, "transcript-archives"),
    );
    assert.equal(
      paths.transcriptContinuationsDirectory,
      path.join(paths.assistantStateRoot, "transcript-continuations"),
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("assistant event queue appends and lists events after a cursor", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "healthybob-runtime-events-"));
  const vaultRoot = path.join(parent, "vault");
  await mkdir(vaultRoot, { recursive: true });

  try {
    const paths = resolveAssistantStatePaths(vaultRoot);
    const first = await appendAssistantAutomationEvent(paths, {
      schema: "healthybob.assistant-automation-event.v1",
      eventId: createAssistantAutomationEventId("2026-03-26T00:00:00.000Z"),
      type: "parser-completed",
      occurredAt: "2026-03-26T00:00:00.000Z",
      target: {
        accountId: null,
        attachmentId: "attach_1",
        captureId: "cap_1",
        channel: "email",
        jobId: null,
        sessionId: null,
      },
      dedupeKey: null,
      payload: {
        parser: "default",
      },
    });
    const second = await appendAssistantAutomationEvent(paths, {
      schema: "healthybob.assistant-automation-event.v1",
      eventId: createAssistantAutomationEventId("2026-03-26T00:01:00.000Z"),
      type: "assistant-retry-ready",
      occurredAt: "2026-03-26T00:01:00.000Z",
      target: {
        accountId: null,
        attachmentId: null,
        captureId: null,
        channel: "email",
        jobId: "cron_1",
        sessionId: "asst_1",
      },
      dedupeKey: "retry:cron_1",
      payload: {},
    });
    const third = await appendAssistantAutomationEvent(paths, {
      schema: "healthybob.assistant-automation-event.v1",
      eventId: createAssistantAutomationEventId("2026-03-26T00:00:30.000Z"),
      type: "cron-completed",
      occurredAt: "2026-03-26T00:00:30.000Z",
      target: {
        accountId: null,
        attachmentId: null,
        captureId: null,
        channel: null,
        jobId: "cron_1",
        sessionId: "asst_1",
      },
      dedupeKey: "cron:cron_1:evt",
      payload: {
        status: "succeeded",
      },
    });

    const all = await listAssistantAutomationEvents(paths);
    const afterFirst = await listAssistantAutomationEvents(paths, {
      after: {
        eventId: first.eventId,
        occurredAt: first.occurredAt,
      },
    });

    assert.deepEqual(
      all.map((event) => event.eventId),
      [first.eventId, third.eventId, second.eventId],
    );
    assert.deepEqual(afterFirst.map((event) => event.eventId), [third.eventId, second.eventId]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
