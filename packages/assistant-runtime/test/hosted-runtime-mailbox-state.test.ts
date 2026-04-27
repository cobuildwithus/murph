import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
  advanceHostedMailboxLaneWatermark,
  createEmptyHostedMailboxImportState,
  parseHostedMailboxImportStateEnvelope,
  readHostedMailboxImportState,
  recordHostedMailboxImportQuarantine,
  recordHostedMailboxImportStatus,
  resolveHostedMailboxImportStatePath,
  writeHostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";

describe("hosted runtime mailbox import state", () => {
  it("initializes empty runtime-local state at the assistant operations path", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-mailbox-state-"));

    try {
      expect(resolveHostedMailboxImportStatePath(vaultRoot)).toBe(
        path.join(vaultRoot, HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH),
      );
      await expect(readHostedMailboxImportState({ vaultRoot })).resolves.toEqual({
        recentStatuses: [],
        watermarks: {
          conversation: "0",
          system: "0",
        },
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("writes and reads an explicit schema-versioned state envelope privately", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-mailbox-state-"));

    try {
      let state = createEmptyHostedMailboxImportState();
      state = advanceHostedMailboxLaneWatermark(state, {
        lane: "conversation",
        seq: "900719925474099312345",
      }).state;
      state = recordHostedMailboxImportStatus(state, {
        itemKind: "conversation.message",
        lane: "conversation",
        occurredAt: "2026-04-26T00:00:00.000Z",
        seq: "900719925474099312345",
        status: "imported",
      });

      await writeHostedMailboxImportState({
        state,
        vaultRoot,
      });

      await expect(readHostedMailboxImportState({ vaultRoot })).resolves.toEqual(state);

      const mode = (await stat(resolveHostedMailboxImportStatePath(vaultRoot))).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("rejects malformed schema, lanes, and decimal sequence strings", () => {
    const validEnvelope = {
      schema: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
      schemaVersion: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
      value: {
        recentStatuses: [],
        watermarks: {
          conversation: "1",
          system: "0",
        },
      },
    };

    expect(() =>
      parseHostedMailboxImportStateEnvelope({
        ...validEnvelope,
        schema: "murph.hosted-mailbox-import-state.v0",
      }),
    ).toThrow(/schema must be murph\.hosted-mailbox-import-state\.v1/u);

    expect(() =>
      parseHostedMailboxImportStateEnvelope({
        ...validEnvelope,
        schemaVersion: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION + 1,
      }),
    ).toThrow(/schemaVersion must be 1/u);

    expect(() =>
      parseHostedMailboxImportStateEnvelope({
        ...validEnvelope,
        value: {
          recentStatuses: [],
          watermarks: {
            conversation: "1",
            system: "0",
            web: "2",
          },
        },
      }),
    ).toThrow(/must be one of: conversation, system/u);

    expect(() =>
      parseHostedMailboxImportStateEnvelope({
        ...validEnvelope,
        value: {
          recentStatuses: [],
          watermarks: {
            conversation: "01",
            system: "0",
          },
        },
      }),
    ).toThrow(/non-negative decimal string/u);
  });

  it("advances per-lane watermarks monotonically only", () => {
    let state = createEmptyHostedMailboxImportState();

    const firstAdvance = advanceHostedMailboxLaneWatermark(state, {
      lane: "system",
      seq: "3",
    });
    expect(firstAdvance.advanced).toBe(true);
    expect(firstAdvance.state.watermarks).toEqual({
      conversation: "0",
      system: "3",
    });

    const equalAdvance = advanceHostedMailboxLaneWatermark(firstAdvance.state, {
      lane: "system",
      seq: "3",
    });
    expect(equalAdvance.advanced).toBe(false);
    expect(equalAdvance.state.watermarks.system).toBe("3");

    const lowerAdvance = advanceHostedMailboxLaneWatermark(equalAdvance.state, {
      lane: "system",
      seq: "2",
    });
    expect(lowerAdvance.advanced).toBe(false);
    expect(lowerAdvance.state.watermarks.system).toBe("3");

    state = advanceHostedMailboxLaneWatermark(lowerAdvance.state, {
      lane: "conversation",
      seq: "4",
    }).state;
    expect(state.watermarks).toEqual({
      conversation: "4",
      system: "3",
    });
  });

  it("records compact quarantine metadata without accepting sensitive payload fields", () => {
    let state = createEmptyHostedMailboxImportState();

    state = recordHostedMailboxImportQuarantine(
      state,
      {
        itemKind: "conversation.message",
        lane: "conversation",
        occurredAt: "2026-04-26T00:00:00.000Z",
        reasonCode: "payload.missing",
        seq: "5",
      },
      {
        maxRecentStatuses: 2,
      },
    );
    state = recordHostedMailboxImportStatus(
      state,
      {
        itemKind: "system.maintenance",
        lane: "system",
        occurredAt: "2026-04-26T00:01:00.000Z",
        reasonCode: "kind.unsupported",
        seq: "7",
        status: "skipped",
      },
      {
        maxRecentStatuses: 2,
      },
    );

    expect(state.recentStatuses).toEqual([
      {
        itemKind: "conversation.message",
        lane: "conversation",
        occurredAt: "2026-04-26T00:00:00.000Z",
        reasonCode: "payload.missing",
        seq: "5",
        status: "quarantined",
      },
      {
        itemKind: "system.maintenance",
        lane: "system",
        occurredAt: "2026-04-26T00:01:00.000Z",
        reasonCode: "kind.unsupported",
        seq: "7",
        status: "skipped",
      },
    ]);

    expect(() =>
      parseHostedMailboxImportStateEnvelope({
        schema: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
        schemaVersion: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
        value: {
          recentStatuses: [
            {
              contactIdentifier: "not-allowed",
              itemKind: "conversation.message",
              lane: "conversation",
              occurredAt: "2026-04-26T00:00:00.000Z",
              providerPayload: {
                text: "not-allowed",
              },
              reasonCode: "payload.missing",
              seq: "5",
              status: "quarantined",
            },
          ],
          watermarks: {
            conversation: "5",
            system: "7",
          },
        },
      }),
    ).toThrow(/unsupported field contactIdentifier/u);
  });

  it("compacts status records to the newest bounded entries", () => {
    let state = createEmptyHostedMailboxImportState();

    for (let index = 1; index <= 4; index += 1) {
      state = recordHostedMailboxImportStatus(
        state,
        {
          itemKind: "system.maintenance",
          lane: "system",
          occurredAt: `2026-04-26T00:0${index}:00.000Z`,
          seq: String(index),
          status: "imported",
        },
        {
          maxRecentStatuses: 3,
        },
      );
    }

    expect(state.recentStatuses.map((record) => record.seq)).toEqual(["2", "3", "4"]);
  });
});
