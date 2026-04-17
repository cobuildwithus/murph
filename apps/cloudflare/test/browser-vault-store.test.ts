import { describe, expect, it } from "vitest";

import { createBrowserVaultSnapshot, parseBrowserVaultSnapshot } from "@murphai/query/browser";

import { createHostedBrowserVaultSnapshotStore } from "../src/browser-vault-store.js";
import { expectOpaqueStrings, findStoredObjectKey } from "./object-key-assertions.js";
import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers.js";

describe("hosted browser vault snapshot store", () => {
  it("round-trips browser vault snapshots through the browser-vault-snapshot scope", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const store = createHostedBrowserVaultSnapshotStore({
      bucket,
      key: createTestRootKey(29),
      keyId: "k-current",
    });
    type BrowserVaultEntity = Parameters<typeof createBrowserVaultSnapshot>[0]["entities"][number];
    const entities: BrowserVaultEntity[] = [{
      attributes: {
        source: "browser",
      },
      body: null,
      date: null,
      entityId: "goal_browser_01",
      experimentSlug: null,
      family: "goal",
      frontmatter: null,
      kind: "goal",
      links: [],
      lookupIds: ["goal_browser_01"],
      occurredAt: null,
      path: "bank/goals/browser.md",
      primaryLookupId: "goal_browser_01",
      recordClass: "bank",
      relatedIds: [],
      status: null,
      stream: null,
      tags: ["browser"],
      title: "Browser vault goal",
    }];
    const metadata = {
      nested: {
        flag: true,
      },
      source: "browser",
    };
    const snapshot = createBrowserVaultSnapshot({
      entities,
      generatedAt: "2026-04-17T00:00:00.000Z",
      metadata,
      sourceVersion: "a".repeat(64),
    });

    entities[0]!.tags.push("mutated");
    metadata.nested.flag = false;

    await store.writeBrowserVaultSnapshot("user_123", snapshot);

    const storedKey = findStoredObjectKey(
      bucket,
      (key) => key.startsWith("users/browser-vault-snapshots/"),
    );
    expect(storedKey).toMatch(/^users\/browser-vault-snapshots\/[0-9a-f]{24}\.json$/u);
    expectOpaqueStrings([storedKey], ["user_123"]);

    await expect(store.readBrowserVaultSnapshotEnvelope("user_123")).resolves.toMatchObject({
      algorithm: "AES-GCM",
      keyId: "k-current",
      scope: "browser-vault-snapshot",
    });

    const loaded = await store.readBrowserVaultSnapshot("user_123");
    expect(loaded).toEqual(snapshot);
    expect(parseBrowserVaultSnapshot(loaded)).toEqual(snapshot);
    expect(snapshot.entities[0]?.tags).toEqual(["browser"]);
    expect(snapshot.metadata).toEqual({
      nested: {
        flag: true,
      },
      source: "browser",
    });
    expect(() =>
      parseBrowserVaultSnapshot(
        {
          ...snapshot,
          schema: "murph.browser-vault-snapshot.wrong",
        },
        "Browser vault snapshot",
      ),
    ).toThrow("Browser vault snapshot.schema must be murph.browser-vault-snapshot.v1.");
  });
});
