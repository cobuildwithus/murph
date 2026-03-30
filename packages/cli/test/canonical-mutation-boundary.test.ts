import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "vitest";

import { openSqliteRuntimeDatabase } from "@murph/runtime-state";
import { createIntegratedInboxServices } from "../src/inbox-services.js";

const builtCoreRuntimeUrl = new URL("../../core/dist/index.js", import.meta.url).href;
const builtInboxRuntimeUrl = new URL("../../inboxd/dist/index.js", import.meta.url).href;

async function loadBuiltCoreRuntime() {
  return (await import(builtCoreRuntimeUrl)) as any;
}

async function loadBuiltInboxRuntime() {
  return (await import(builtInboxRuntimeUrl)) as any;
}

function createFakeImessageDriver(input: {
  photoPath: string;
  text: string;
}) {
  return {
    async listChats() {
      return [{ guid: "chat-1", displayName: "Breakfast", participantCount: 2 }];
    },
    async getMessages() {
      return [
        {
          guid: "im-1",
          text: input.text,
          date: "2026-03-13T08:00:00.000Z",
          dateRead: "2026-03-13T08:00:10.000Z",
          chatGuid: "chat-1",
          handleId: "friend",
          displayName: "Friend",
          isFromMe: false,
          attachments: [
            {
              guid: "att-1",
              fileName: "toast.jpg",
              path: input.photoPath,
              mimeType: "image/jpeg",
            },
          ],
        },
      ];
    },
    async startWatching() {
      return {
        close() {},
      };
    },
  };
}

async function initializeImessageSource(input: {
  services: ReturnType<typeof createIntegratedInboxServices>;
  vaultRoot: string;
}) {
  await input.services.init({
    vault: input.vaultRoot,
    requestId: null,
  });
  await input.services.sourceAdd({
    vault: input.vaultRoot,
    requestId: null,
    source: "imessage",
    id: "imessage:self",
    account: "self",
    includeOwn: true,
  });
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
    const homeRoot = await mkdtemp(path.join(tmpdir(), "murph-inbox-high-level-ports-home-"));
    const photoPath = path.join(vaultRoot, "meal-photo.jpg");
    const messagesDbPath = path.join(homeRoot, "Library", "Messages", "chat.db");

    const coreRuntime = await loadBuiltCoreRuntime();
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-03-13T12:00:00.000Z",
    });
    await writeFile(photoPath, "photo", "utf8");

    const messagesDb = openSqliteRuntimeDatabase(messagesDbPath, {
      create: true,
      foreignKeys: false,
    });
    messagesDb.close();

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
      getHomeDirectory: () => homeRoot,
      getPlatform: () => "darwin",
      loadCoreModule: async () => fakeCoreRuntime as never,
      loadInboxModule: loadBuiltInboxRuntime,
      loadQueryModule: async () => fakeQueryRuntime as never,
      loadImessageDriver: async () =>
        createFakeImessageDriver({
          photoPath,
          text: "Breakfast note from inbox",
        }),
    });

    try {
      await initializeImessageSource({
        services,
        vaultRoot,
      });
      await services.backfill({
        vault: vaultRoot,
        requestId: null,
        sourceId: "imessage:self",
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
      await rm(homeRoot, { recursive: true, force: true });
    }
  },
);
