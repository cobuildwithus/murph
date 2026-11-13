import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
