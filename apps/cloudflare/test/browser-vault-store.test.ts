import { describe, expect, it } from "vitest";

import { createBrowserVaultSnapshot, parseBrowserVaultSnapshot } from "@murphai/query/browser";

import {
  createHostedBrowserVaultSnapshotStore,
  resolveHostedBrowserVaultSnapshotStorageRef,
} from "../src/browser-vault-store.js";
import { buildHostedStorageAad } from "../src/crypto-context.js";
import { readEncryptedR2Payload } from "../src/crypto.js";
import { expectOpaqueStrings, findStoredObjectKey } from "./object-key-assertions.js";
import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers.js";

describe("hosted browser vault snapshot store", () => {
  it("round-trips browser vault snapshots through the browser-vault-snapshot scope", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const rootKey = createTestRootKey(29);
    const store = createHostedBrowserVaultSnapshotStore({
      bucket,
      key: rootKey,
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

    const storageRef = await resolveHostedBrowserVaultSnapshotStorageRef({
      rootKey,
      userId: "user_123",
    });
    const loadedBytes = await readEncryptedR2Payload({
      aad: buildHostedStorageAad(storageRef.aadFields),
      bucket,
      cryptoKey: rootKey,
      expectedKeyId: "k-current",
      key: storageRef.objectKey,
      scope: "browser-vault-snapshot",
    });
    expect(loadedBytes).not.toBeNull();
    const loaded = JSON.parse(new TextDecoder().decode(loadedBytes ?? undefined)) as unknown;
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

  it("deletes stored browser vault snapshot sidecars", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const rootKey = createTestRootKey(31);
    const store = createHostedBrowserVaultSnapshotStore({
      bucket,
      key: rootKey,
      keyId: "k-current",
    });

    await store.writeBrowserVaultSnapshot("user_123", {
      entities: [],
      generatedAt: "2026-04-17T00:00:00.000Z",
      metadata: null,
      schema: "murph.browser-vault-snapshot.v1",
      sourceVersion: "b".repeat(64),
    });
    const storageRef = await resolveHostedBrowserVaultSnapshotStorageRef({
      rootKey,
      userId: "user_123",
    });

    expect(bucket.objects.has(storageRef.objectKey)).toBe(true);

    await store.deleteBrowserVaultSnapshot("user_123");

    expect(bucket.objects.has(storageRef.objectKey)).toBe(false);
    expect(bucket.deleted).toContain(storageRef.objectKey);
  });
});
