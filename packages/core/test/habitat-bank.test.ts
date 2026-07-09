import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import { VaultError, initializeVault } from "../src/index.ts";
import {
  listHabitatAspects,
  readHabitatAspect,
  upsertHabitatAspect,
} from "../src/bank/habitat.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("habitat aspects merge indicators across saves and keep one file per aspect", async () => {
  const vaultRoot = await makeTempDirectory("murph-habitat-bank");
  await initializeVault({ vaultRoot });

  const created = await upsertHabitatAspect({
    vaultRoot,
    aspect: "sleep-environment",
    indicators: {
      night_temp_c: 19,
      window_at_night: "open",
      co2_meter: "declined",
    },
    recordedAt: "2026-07-01",
    body: "Window stays closed on smog days.",
  });

  assert.equal(created.created, true);
  assert.equal(created.aspect, "sleep-environment");
  assert.equal(created.relativePath, "bank/habitat/sleep-environment.md");

  const updated = await upsertHabitatAspect({
    vaultRoot,
    aspect: "sleep-environment",
    indicators: {
      darkness: "blackout",
      window_at_night: null,
    },
    recordedAt: "2026-07-08",
  });

  assert.equal(updated.created, false);
  assert.equal(updated.habitatId, created.habitatId);

  const record = await readHabitatAspect({ vaultRoot, slug: "sleep-environment" });

  assert.equal(record.title, "Bedroom & sleep");
  assert.equal(record.domain, "environment");
  assert.deepEqual(record.indicators, {
    night_temp_c: 19,
    co2_meter: "declined",
    darkness: "blackout",
  });
  assert.deepEqual(record.indicatorRecordedAt, {
    night_temp_c: "2026-07-01",
    co2_meter: "2026-07-01",
    darkness: "2026-07-08",
  });
  assert.match(record.body, /smog days/);

  const listed = await listHabitatAspects(vaultRoot);
  assert.equal(listed.length, 1);
});

test("habitat upsert rejects unknown aspects and foreign indicators", async () => {
  const vaultRoot = await makeTempDirectory("murph-habitat-invalid");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () => upsertHabitatAspect({ vaultRoot, aspect: "spaceship" }),
    /Unknown habitat aspect/,
  );

  await assert.rejects(
    () =>
      upsertHabitatAspect({
        vaultRoot,
        aspect: "sleep-environment",
        indicators: { standing_desk: "fixed" },
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "HABITAT_FRONTMATTER_INVALID",
  );
});

test("habitat upsert rejects aspect records stored at another aspect path", async () => {
  const vaultRoot = await makeTempDirectory("murph-habitat-path-mismatch");
  await initializeVault({ vaultRoot });
  const habitatPath = path.join(vaultRoot, "bank/habitat/sleep-environment.md");

  await fs.mkdir(path.dirname(habitatPath), { recursive: true });
  await fs.writeFile(
    habitatPath,
    [
      "---",
      "schemaVersion: murph.frontmatter.habitat.v1",
      "docType: habitat",
      "habitatId: hab_01JNV422Y2M5ZBV64ZP4N1DRB1",
      "slug: home-location",
      "title: Location & climate",
      "status: active",
      "domain: environment",
      "aspect: home-location",
      "indicators:",
      "  location: Boston",
      "---",
      "# Location & climate",
      "",
    ].join("\n"),
    "utf8",
  );

  await assert.rejects(
    () =>
      upsertHabitatAspect({
        vaultRoot,
        aspect: "sleep-environment",
        indicators: { night_temp_c: 19 },
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "HABITAT_FRONTMATTER_INVALID" &&
      error.message.includes("must be stored at bank/habitat/home-location.md"),
  );

  const storedMarkdown = await fs.readFile(habitatPath, "utf8");
  assert.match(storedMarkdown, /aspect: home-location/);
  assert.doesNotMatch(storedMarkdown, /night_temp_c/);
});
