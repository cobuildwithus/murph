import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeVault } from "../src/index.ts";
import {
  patchAutomation, readAutomation, registerAutomationFollowUp, upsertAutomation,
  type UpsertAutomationInput,
} from "../src/automation.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "automation-follow-up-"));
  roots.push(vaultRoot);
  await initializeVault({ vaultRoot });
  const input: UpsertAutomationInput = {
    vaultRoot,
    title: "Follow up on a pending decision",
    instructions: "Reconsider the pending date choice; skip if answered or no longer useful.",
    status: "active",
    continuityPolicy: "preserve",
    now: new Date("2026-09-01T12:00:00.000Z"),
    schedule: { kind: "at", at: "2026-09-01T12:20:00.000Z" },
    activeUntil: "2026-09-01T13:20:00.000Z",
    route: {
      channel: "linq", deliveryTarget: "test-direct", identityId: null,
      participantId: null, threadId: "test-thread", threadIsDirect: true,
    },
  };
  return input;
}

describe("canonical follow-up registration", () => {
  it("replays one identity without resurrecting an archived follow-up", async () => {
    const input = await fixture();
    const request = { ...input, followUpSourceIntentId: "outbox_original" };
    const first = await registerAutomationFollowUp(request);
    expect(first).not.toBeNull();
    const replay = await registerAutomationFollowUp(request);
    expect(replay?.automationId).toBe(first?.automationId);
    const archived = await patchAutomation({
      vaultRoot: input.vaultRoot, lookup: first!.automationId,
      expectedUpdatedAt: first!.updatedAt, status: "archived",
      now: new Date("2026-09-01T12:05:00.000Z"),
    });
    expect(archived.record.followUpSourceIntentId).toBe("outbox_original");
    expect((await registerAutomationFollowUp(request))?.status).toBe("archived");
    const read = await readAutomation({ vaultRoot: input.vaultRoot, automationId: first!.automationId });
    expect(read.markdown).toContain("followUpSourceIntentId: outbox_original");
  });

  it("serializes admission and preserves unrelated conversation capacity", async () => {
    const input = await fixture();
    const results = await Promise.all(["a", "b", "c", "d"].map((id) =>
      registerAutomationFollowUp({ ...input, followUpSourceIntentId: `outbox_${id}` })));
    expect(results.filter(Boolean)).toHaveLength(2);
    expect(await registerAutomationFollowUp({
      ...input, followUpSourceIntentId: "outbox_other",
      route: { ...input.route, threadId: "other-thread", deliveryTarget: "other-direct" },
    })).not.toBeNull();
  });

  it("keeps the source immutable through deferral and requires a finite one-shot", async () => {
    const input = await fixture();
    const record = await registerAutomationFollowUp({ ...input, followUpSourceIntentId: "outbox_defer" });
    const deferred = await patchAutomation({
      vaultRoot: input.vaultRoot, lookup: record!.automationId,
      expectedUpdatedAt: record!.updatedAt,
      schedule: { kind: "at", at: "2026-09-01T14:00:00.000Z" },
      activeUntil: "2026-09-01T15:00:00.000Z",
    });
    expect(deferred.record.followUpSourceIntentId).toBe("outbox_defer");
    await expect(patchAutomation({
      vaultRoot: input.vaultRoot, lookup: record!.automationId,
      schedule: { kind: "every", everyMs: 60_000 },
    })).rejects.toThrow(/finite one-shot/);
  });
  it("preserves a one-shot child on consumption and retires it on explicit cancellation", async () => {
    const input = await fixture();
    const parent = (await upsertAutomation({ ...input, title: "Original cue" })).record;
    const child = await registerAutomationFollowUp({
      ...input, followUpSourceIntentId: "outbox_parent",
      followUpParentAutomationId: parent.automationId, parentExpectedUpdatedAt: parent.updatedAt,
    });
    await upsertAutomation({ ...parent, vaultRoot: input.vaultRoot, status: "archived", completedOccurrence: true });
    expect((await readAutomation({ vaultRoot: input.vaultRoot, automationId: child!.automationId })).status).toBe("active");
    await patchAutomation({ vaultRoot: input.vaultRoot, lookup: parent.automationId, status: "archived" });
    expect((await readAutomation({ vaultRoot: input.vaultRoot, automationId: child!.automationId })).status).toBe("archived");
    await expect(patchAutomation({ vaultRoot: input.vaultRoot, lookup: child!.automationId, status: "active" }))
      .rejects.toThrow(/cannot be reactivated/);
  });

  it("retires an older child when its recurring parent changes and fences stale registration", async () => {
    const input = await fixture();
    const parent = (await upsertAutomation({
      ...input, title: "Recurring cue", schedule: { kind: "every", everyMs: 86_400_000 }, activeUntil: null,
    })).record;
    const request = { ...input, followUpSourceIntentId: "outbox_recurring",
      followUpParentAutomationId: parent.automationId, parentExpectedUpdatedAt: parent.updatedAt };
    const child = await registerAutomationFollowUp(request);
    await patchAutomation({ vaultRoot: input.vaultRoot, lookup: parent.automationId,
      instructions: "A newly chosen cue", now: new Date("2026-09-01T12:06:00.000Z") });
    expect((await readAutomation({ vaultRoot: input.vaultRoot, automationId: child!.automationId })).status).toBe("archived");
    expect(await registerAutomationFollowUp({ ...request, followUpSourceIntentId: "outbox_stale" })).toBeNull();
    expect((await registerAutomationFollowUp(request))?.status).toBe("archived");
  });

});
