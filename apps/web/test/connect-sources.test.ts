import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, test, vi } from "vitest";

import {
  connectSourcePngLogoPath,
  listVisibleDeviceConnectSources,
  resolveConnectSources,
} from "../src/lib/device-sync/connect-sources";

afterEach(() => vi.unstubAllEnvs());

test("every listed connect source has a name, a website logo, and a PNG logo", () => {
  vi.stubEnv("MURPH_ANDROID_APP_ENABLED", "1");
  const sources = [...listVisibleDeviceConnectSources(), ...resolveConnectSources()];
  assert.ok(sources.length > 0);

  for (const source of sources) {
    assert.ok(source.name.trim(), `${source.id} needs a name`);
    const pngPath = connectSourcePngLogoPath(source.id);
    assert.ok(pngPath, `${source.id} needs a PNG logo`);
    assert.match(pngPath, /^\/brand-logos\/connect\/.+\.png$/u);
    for (const logoPath of [source.logo.src, pngPath]) {
      assert.ok(
        existsSync(path.join(process.cwd(), "apps/web/public", logoPath)),
        `${logoPath} should exist under apps/web/public`,
      );
    }
  }
});

test("a bare symbol's PNG logo is its padded tile copy, and the website card keeps the original", () => {
  const tileDirectory = path.join(process.cwd(), "apps/web/public/brand-logos/connect/tile");
  const tiles = readdirSync(tileDirectory).filter((file) => file.endsWith(".png"));
  assert.ok(tiles.includes("fitbit.png"));

  for (const file of tiles) {
    const id = file.replace(/\.png$/u, "");
    assert.equal(connectSourcePngLogoPath(id), `/brand-logos/connect/tile/${file}`, `${file} should be served for ${id}`);
  }
  assert.equal(
    listVisibleDeviceConnectSources().find((source) => source.id === "fitbit")?.logo.src,
    "/brand-logos/connect/fitbit.svg",
  );
  assert.equal(connectSourcePngLogoPath("coros"), "/brand-logos/connect/coros.png");
  assert.equal(connectSourcePngLogoPath("not-a-source"), null);
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
