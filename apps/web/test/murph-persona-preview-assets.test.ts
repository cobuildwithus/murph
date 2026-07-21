import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";

import { assistantBasePersonaOptions } from "@murphai/contracts";
import { test } from "vitest";

const personaPreviewRoot = new URL("../public/audio/murph-personas/", import.meta.url);

test("persona preview assets belong exactly to the six base personas", async () => {
  const rootEntries = await readdir(personaPreviewRoot, { withFileTypes: true });
  assert.ok(rootEntries.every((entry) => entry.isDirectory()));
  assert.deepEqual(
    rootEntries.map((entry) => entry.name).sort(),
    assistantBasePersonaOptions.map((option) => option.id).sort(),
  );

  for (const option of assistantBasePersonaOptions) {
    const personaDirectory = new URL(`${option.id}/`, personaPreviewRoot);
    const entries = await readdir(personaDirectory, { withFileTypes: true });
    assert.ok(entries.every((entry) => entry.isFile()));
    assert.deepEqual(
      entries.map((entry) => entry.name).sort(),
      option.recommendedVoiceIds.map((voiceId) => `${voiceId}.mp3`).sort(),
    );
    for (const entry of entries) {
      assert.ok((await stat(new URL(entry.name, personaDirectory))).size > 0);
    }
  }
});
