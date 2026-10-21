import assert from "node:assert/strict";

import { test } from "vitest";

test("listVisibleConnectSources covers every hosted-visible device source with UI metadata", async () => {
  const { listVisibleConnectSources } = await import("../app/(dashboard)/connect/connect-page-content");
  const { DEVICE_CONNECT_SOURCES } = await import("@murphai/device-syncd/connect-config");

  const displayOnlySourceIds = new Set([
    "apple-health",
    "coros",
    "huawei-health",
    "ringconn",
    "suunto",
    "xiaomi-mi-fitness",
    "zepp",
  ]);
  const expectedVisibleSourceIds = [
    ...DEVICE_CONNECT_SOURCES
    .filter((source) =>
      displayOnlySourceIds.has(source.connectSourceId)
      || source.routes.some((route) => route.kind === "direct" || route.kind === "junction_link"),
    )
    .map((source) => source.connectSourceId),
  ]
    .sort();

  const actualVisibleSources = listVisibleConnectSources();
  const actualVisibleSourceIds = actualVisibleSources.map((source) => source.id).sort();

  assert.deepEqual(actualVisibleSourceIds, expectedVisibleSourceIds);
  const connectionSourceIds = new Set<string>(
    DEVICE_CONNECT_SOURCES.map((source) => source.connectSourceId),
  );
  assert.equal(connectionSourceIds.has("mobvoi-health"), false);
  assert.equal(
    listVisibleConnectSources({ MURPH_ANDROID_APP_ENABLED: "1" })
      .some((source) => source.id === "mobvoi-health"),
    true,
  );

  const sourceIdsWithMissingUi = actualVisibleSources
    .filter((source) => !source.name || !source.description || !source.logo.src)
    .map((source) => source.id);
  assert.deepEqual(sourceIdsWithMissingUi, []);
});
