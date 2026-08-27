import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  HOSTED_RUNTIME_RECONCILIATION_BLOCKED_REASONS,
  HOSTED_RUNTIME_SYSTEM_MAILBOX_FRONTIER_CLASSES,
  projectHostedRuntimeReconciliationFactsWireResponse,
} from "../packages/hosted-execution/src/reconciliation-facts-wire.ts";

import {
  buildTemporalCompatibilityProducerFixtures,
  writeTemporalCompatibilityProducerFixtures,
} from "./temporal-compatibility-producer-fixtures.ts";

describe("Temporal compatibility producer fixtures", () => {
  it("executes the production wire projection across populated and nullable branches", () => {
    const fixtures = buildTemporalCompatibilityProducerFixtures();

    expect(fixtures).toHaveLength(
      HOSTED_RUNTIME_RECONCILIATION_BLOCKED_REASONS.length + 1,
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
    expect(fixtures.flatMap((fixture) =>
      fixture.workspace !== null && Object.hasOwn(fixture.workspace, "systemMailboxFrontier")
        ? [fixture.workspace.systemMailboxFrontier]
        : [])).toEqual([
      ...HOSTED_RUNTIME_SYSTEM_MAILBOX_FRONTIER_CLASSES,
      null,
    ]);
    expect(fixtures.some((fixture) =>
      fixture.workspace !== null
      && !Object.hasOwn(fixture.workspace, "systemMailboxFrontier"))).toBe(true);
    expect(fixtures[1]).toMatchObject({
      mailboxLag: [{ maxUpdatedAt: "2026-01-01T00:00:00.000Z" }],
      workspace: {
        hostedMailboxSystemHandledThroughSeq: "0",
        systemMailboxFrontier: "default_owned",
      },
    });
    expect(fixtures.every((fixture) =>
      !Object.hasOwn(fixture, "environmentInterviewPending"))).toBe(true);
  });

  it("projects Environment state only for a negotiated reader", () => {
    expect(projectHostedRuntimeReconciliationFactsWireResponse({
      blocked: null,
      environmentInterviewPending: true,
      mailboxLag: [],
      workspace: null,
    }, true)).toEqual({
      blocked: null,
      environmentInterviewPending: true,
      mailboxLag: [],
      workspace: null,
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
