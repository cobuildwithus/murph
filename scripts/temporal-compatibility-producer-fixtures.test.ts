import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  HOSTED_RUNTIME_RECONCILIATION_BLOCKED_REASONS,
  HOSTED_RUNTIME_SYSTEM_MAILBOX_FRONTIER_CLASSES,
} from "../packages/hosted-execution/src/reconciliation-facts-wire.ts";

import {
  buildTemporalCompatibilityProducerFixtures,
  writeTemporalCompatibilityProducerFixtures,
} from "./temporal-compatibility-producer-fixtures.ts";

describe("Temporal compatibility producer fixtures", () => {
  it("executes the production wire projection across every optional frontier and progress shape", () => {
    const fixtures = buildTemporalCompatibilityProducerFixtures();
    const frontierFixtureCount =
      HOSTED_RUNTIME_SYSTEM_MAILBOX_FRONTIER_CLASSES.length + 2;

    expect(fixtures).toHaveLength(
      HOSTED_RUNTIME_RECONCILIATION_BLOCKED_REASONS.length
        + frontierFixtureCount
        + 1,
    );
    expect(fixtures[0]).toEqual({
      blocked: null,
      mailboxLag: [],
      workspace: null,
    });
    expect(fixtures.flatMap((fixture) =>
      fixture.blocked === null ? [] : [fixture.blocked.reason])).toEqual(
      HOSTED_RUNTIME_RECONCILIATION_BLOCKED_REASONS,
    );

    const frontierFixtures = fixtures.slice(
      HOSTED_RUNTIME_RECONCILIATION_BLOCKED_REASONS.length + 1,
    );
    expect(frontierFixtures.map((fixture) =>
      fixture.workspace !== null && Object.hasOwn(fixture.workspace, "systemMailboxFrontier")
        ? fixture.workspace.systemMailboxFrontier
        : "omitted")).toEqual([
      ...HOSTED_RUNTIME_SYSTEM_MAILBOX_FRONTIER_CLASSES,
      null,
      "omitted",
    ]);
    expect(frontierFixtures.at(-1)?.workspace).not.toHaveProperty(
      "hostedMailboxSystemHandledThroughSeq",
    );

    const progressWorkspaces = frontierFixtures.flatMap((fixture) =>
      fixture.workspace !== null
        && Object.hasOwn(fixture.workspace, "systemMailboxProgressGeneration")
        ? [fixture.workspace]
        : []);
    expect(progressWorkspaces).toHaveLength(2);
    expect(progressWorkspaces[0]).toMatchObject({
      nextDefaultProcessingWakeAt: "2026-01-01T00:03:00.000Z",
      nextDefaultProcessingWakeReason: "assistant_due",
      systemMailboxFrontier: "default_owned",
      systemMailboxProgressGeneration: "7",
    });
    expect(progressWorkspaces[1]).toMatchObject({
      nextDefaultProcessingWakeAt: null,
      nextDefaultProcessingWakeReason: null,
      systemMailboxFrontier: "model_free",
      systemMailboxProgressGeneration: "8",
    });
    for (const workspace of progressWorkspaces) {
      expect(workspace).toHaveProperty("nextDefaultProcessingWakeAt");
      expect(workspace).toHaveProperty("nextDefaultProcessingWakeReason");
      expect(workspace).toHaveProperty("systemMailboxProgressGeneration");
    }

    expect(fixtures[1]).toMatchObject({
      mailboxLag: [{ maxUpdatedAt: "2026-01-01T00:00:00.000Z" }],
      workspace: {
        hostedMailboxSystemHandledThroughSeq: "0",
      },
    });
  });

  it("writes one canonical artifact for unprivileged CI handoff", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "temporal-producer-fixtures-"));
    const outputPath = path.join(directory, "fixtures.json");
    try {
      await writeTemporalCompatibilityProducerFixtures(outputPath);
      expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual(
        buildTemporalCompatibilityProducerFixtures(),
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
