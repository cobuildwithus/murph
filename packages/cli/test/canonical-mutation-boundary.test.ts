import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "vitest";

import {
  createIntegratedInboxServices,
  type RuntimeCaptureRecordInput,
} from "@murphai/inbox-services";

const builtCoreRuntimeUrl = new URL("../../core/dist/index.js", import.meta.url).href;
const builtInboxRuntimeUrl = new URL("../../inboxd/dist/index.js", import.meta.url).href;

async function loadBuiltRuntime<T>(runtimeUrl: string): Promise<T> {
  return (await import(runtimeUrl)) as T;
}

async function loadBuiltCoreRuntime() {
  return loadBuiltRuntime<any>(builtCoreRuntimeUrl);
}

async function loadBuiltInboxRuntime() {
  return loadBuiltRuntime<any>(builtInboxRuntimeUrl);
}

async function seedInboxCapture(input: {
  capture: RuntimeCaptureRecordInput;
  vaultRoot: string;
}) {
  const inboxRuntime = await loadBuiltInboxRuntime();
  const runtime = await inboxRuntime.openInboxRuntime({
    vaultRoot: input.vaultRoot,
  });
  const pipeline = await inboxRuntime.createInboxPipeline({
    runtime,
    vaultRoot: input.vaultRoot,
  });

  try {
    await pipeline.processCapture(input.capture);
  } finally {
    pipeline.close();
  }
}

async function captureSingleCaptureId(input: {
  services: ReturnType<typeof createIntegratedInboxServices>;
  vaultRoot: string;
}) {
  const listed = await input.services.list({
    vault: input.vaultRoot,
    requestId: null,
    limit: 10,
  });
  const captureId = listed.items[0]?.captureId;
  assert.ok(captureId);
  return captureId;
}

test.sequential(
  "inbox journal and experiment-note promotions only require high-level core mutation ports",
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-inbox-high-level-ports-vault-"));

    const coreRuntime = await loadBuiltCoreRuntime();
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-03-13T12:00:00.000Z",
    });

    const journalCalls: Array<{ date: string; captureId: string }> = [];
    const experimentCalls: Array<{ relativePath: string; captureId: string }> = [];
    const fakeCoreRuntime = {
      async promoteInboxJournal(input: {
        vaultRoot: string;
        date: string;
        capture: {
          captureId: string;
          eventId: string;
        };
      }) {
        journalCalls.push({
          date: input.date,
          captureId: input.capture.captureId,
        });
        return {
          lookupId: `journal:${input.date}`,
          relatedId: input.capture.eventId,
          journalPath: `journal/${input.date.slice(0, 4)}/${input.date}.md`,
          created: false,
          appended: true,
          linked: true,
        };
      },
      async promoteInboxExperimentNote(input: {
        vaultRoot: string;
        relativePath: string;
        capture: {
          captureId: string;
          eventId: string;
        };
      }) {
        experimentCalls.push({
          relativePath: input.relativePath,
          captureId: input.capture.captureId,
        });
        return {
          experimentId: "exp_fake_focus",
          relatedId: input.capture.eventId,
          experimentPath: input.relativePath,
          experimentSlug: "focus-sprint",
          appended: true,
        };
      },
    };
    const fakeQueryRuntime = {
      async readVault() {
        return {};
      },
      listEntities() {
        return [
          {
            path: "bank/experiments/focus-sprint.md",
            entityId: "exp_fake_focus",
            experimentSlug: "focus-sprint",
            status: "active",
            attributes: {
              slug: "focus-sprint",
              status: "active",
            },
          },
        ];
      },
    };
    const services = createIntegratedInboxServices({
      enableJournalPromotion: true,
      loadCoreModule: async () => fakeCoreRuntime as never,
      loadInboxModule: loadBuiltInboxRuntime,
      loadQueryModule: async () => fakeQueryRuntime as never,
    });

    try {
      await services.init({
        vault: vaultRoot,
        requestId: null,
      });
      await seedInboxCapture({
        vaultRoot,
        capture: {
          source: "telegram",
          accountId: "bot",
          externalId: "telegram-breakfast-1",
          occurredAt: "2026-03-13T08:00:00.000Z",
          receivedAt: "2026-03-13T08:00:10.000Z",
          thread: {
            id: "chat-1",
            title: "Breakfast",
            isDirect: true,
          },
          actor: {
            id: "telegram:user",
            displayName: "Friend",
            isSelf: false,
          },
          text: "Breakfast note from inbox",
          attachments: [],
          raw: {},
        },
      });
      const captureId = await captureSingleCaptureId({
        services,
        vaultRoot,
      });

      const journalPromotion = await services.promoteJournal({
        vault: vaultRoot,
        requestId: null,
        captureId,
      });
      const experimentPromotion = await services.promoteExperimentNote({
        vault: vaultRoot,
        requestId: null,
        captureId,
      });

      assert.equal(journalPromotion.target, "journal");
      assert.equal(journalPromotion.lookupId, "journal:2026-03-13");
      assert.equal(journalPromotion.journalPath, "journal/2026/2026-03-13.md");
      assert.equal(experimentPromotion.target, "experiment-note");
      assert.equal(experimentPromotion.lookupId, "exp_fake_focus");
      assert.equal(experimentPromotion.experimentPath, "bank/experiments/focus-sprint.md");
      assert.equal(experimentPromotion.experimentSlug, "focus-sprint");
      assert.deepEqual(journalCalls, [
        {
          date: "2026-03-13",
          captureId,
        },
      ]);
      assert.deepEqual(experimentCalls, [
        {
          relativePath: "bank/experiments/focus-sprint.md",
          captureId,
        },
      ]);
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  },
);
