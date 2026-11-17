import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, test, vi } from "vitest";

import {
  connectSourcePngLogoPath,
  listConnectSourceIds,
  listVisibleDeviceConnectSources,
  resolveConnectSources,
} from "../src/lib/device-sync/connect-sources";

afterEach(() => vi.unstubAllEnvs());

// The only logo paths the iOS app fetches: murph-ios MurphCompanion/Core/APIClient.swift,
// fetchConnectLogo. It refuses anything else and leaves the tile blank, so a
// subfolder or another extension here breaks app builds already installed.
const APP_CONNECT_LOGO_PATH = /^\/brand-logos\/connect\/[A-Za-z0-9._-]+\.png$/u;

test("every listed connect source has a name, a website logo, and a PNG logo", () => {
  vi.stubEnv("MURPH_ANDROID_APP_ENABLED", "1");
  const sources = [...listVisibleDeviceConnectSources(), ...resolveConnectSources()];
  assert.ok(sources.length > 0);

  for (const source of sources) {
    assert.ok(source.name.trim(), `${source.id} needs a name`);
    const pngPath = connectSourcePngLogoPath(source.id);
    assert.ok(pngPath, `${source.id} needs a PNG logo`);
    assert.match(pngPath, APP_CONNECT_LOGO_PATH);
    for (const logoPath of [source.logo.src, pngPath]) {
      assert.ok(
        existsSync(path.join(process.cwd(), "apps/web/public", logoPath)),
        `${logoPath} should exist under apps/web/public`,
      );
    }
  }
});

test("a bare symbol's PNG logo is its padded tile copy, and the website card keeps the original", () => {
  const logoDirectory = path.join(process.cwd(), "apps/web/public/brand-logos/connect");
  const tiles = readdirSync(logoDirectory).filter((file) => file.endsWith("-tile.png"));
  assert.ok(tiles.includes("fitbit-tile.png"));

  for (const file of tiles) {
    const id = file.replace(/-tile\.png$/u, "");
    assert.equal(connectSourcePngLogoPath(id), `/brand-logos/connect/${file}`, `${file} should be served for ${id}`);
  }
  assert.equal(
    listVisibleDeviceConnectSources().find((source) => source.id === "fitbit")?.logo.src,
    "/brand-logos/connect/fitbit.svg",
  );
  assert.equal(connectSourcePngLogoPath("coros"), "/brand-logos/connect/coros.png");
  assert.equal(connectSourcePngLogoPath("not-a-source"), null);
});

test("every source's PNG logo is a path the app will fetch, and the file is there", () => {
  vi.stubEnv("MURPH_ANDROID_APP_ENABLED", "1");
  const ids = new Set([
    ...listConnectSourceIds(),
    ...listVisibleDeviceConnectSources().map((source) => source.id),
    ...resolveConnectSources().map((source) => source.id),
  ]);
  assert.ok(ids.has("fitbit") && ids.has("apple-health") && ids.has("coros"));

  for (const id of ids) {
    const pngPath = connectSourcePngLogoPath(id);
    assert.ok(pngPath, `${id} needs a PNG logo`);
    assert.match(pngPath, APP_CONNECT_LOGO_PATH, `the app would refuse ${id}'s logo path ${pngPath}`);
    assert.ok(
      existsSync(path.join(process.cwd(), "apps/web/public", pngPath)),
      `${pngPath} should exist under apps/web/public`,
    );
  }
});

test("the production admission smoke looks up connect sources by names the page still uses", () => {
  // That smoke runs only after a merge, so a rename here would otherwise fail production admission unseen.
  const smoke = readFileSync(
    path.join(process.cwd(), "apps/web/scripts/run-hosted-local-browser-smoke.ts"),
    "utf8",
  );
  const pinned = [...smoke.matchAll(/aria-label="Connect ([^"]+)"/gu)].map((match) => match[1]!);
  assert.ok(pinned.length > 0, "the smoke should look up at least one source's Connect button");
  const names = new Set(resolveConnectSources().map((source) => source.name));

  for (const name of pinned) {
    assert.ok(names.has(name), `the smoke looks for "Connect ${name}", but no connect source is named "${name}"`);
    for (const text of [`/^${name}$/u`, `"Connect ${name} to Murph"`, `"Continue to ${name}"`]) {
      assert.ok(smoke.includes(text), `the smoke should still look for ${text}`);
    }
  }
});
