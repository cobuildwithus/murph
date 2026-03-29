import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { deriveWorkoutFormatCompatibilityId } from "@murph/contracts";

import {
  listProviders,
  listRecipes,
  listWorkoutFormats,
  readProvider,
  readRecipe,
  readWorkoutFormat,
  showProvider,
  showRecipe,
  showWorkoutFormat,
} from "../src/index.ts";

async function writeVaultFile(vaultRoot: string, relativePath: string, contents: string) {
  await mkdir(path.dirname(path.join(vaultRoot, relativePath)), {
    recursive: true,
  });
  await writeFile(path.join(vaultRoot, relativePath), contents, "utf8");
}

test("recipe, provider, and workout-format registry queries expose direct list/read/show boundaries", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-bank-"));

  try {
    await writeVaultFile(
      vaultRoot,
      "bank/recipes/salmon-rice-bowl.md",
      `---
schemaVersion: murph.frontmatter.recipe.v1
docType: recipe
recipeId: rcp_01JNV422Y2M5ZBV64ZP4N1DRB1
slug: salmon-rice-bowl
title: Salmon Rice Bowl
status: saved
servings: 2
relatedGoalIds:
  - goal_01JNV4R0R1DVH1YP8KQQD5GQ7X
---
# Salmon Rice Bowl
`,
    );
    await writeVaultFile(
      vaultRoot,
      "bank/providers/primary-care.md",
      `---
schemaVersion: murph.frontmatter.provider.v1
docType: provider
providerId: prov_01JNV4R0R1DVH1YP8KQQD5GQ7X
slug: primary-care
title: Primary Care
status: active
specialty: primary-care
organization: Neighborhood Clinic
---
# Primary Care
`,
    );
    await writeVaultFile(
      vaultRoot,
      "bank/workout-formats/garage-day.md",
      `---
schemaVersion: murph.frontmatter.workout-format.v1
docType: workout_format
slug: garage-day
title: Garage Day
status: active
type: strength-training
durationMinutes: 40
text: Garage day template.
---
# Garage Day
`,
    );

    const recipes = await listRecipes(vaultRoot, {
      status: "saved",
    });
    const providers = await listProviders(vaultRoot, {
      status: "active",
    });
    const workoutFormats = await listWorkoutFormats(vaultRoot, {
      status: "active",
    });
    const workoutFormatCompatibilityId =
      deriveWorkoutFormatCompatibilityId("garage-day");

    assert.equal(recipes.length, 1);
    assert.equal(recipes[0]?.entity.id, "rcp_01JNV422Y2M5ZBV64ZP4N1DRB1");
    assert.equal(
      (await readRecipe(vaultRoot, "rcp_01JNV422Y2M5ZBV64ZP4N1DRB1"))?.entity.title,
      "Salmon Rice Bowl",
    );
    assert.equal(
      (await showRecipe(vaultRoot, "salmon-rice-bowl"))?.entity.servings,
      2,
    );

    assert.equal(providers.length, 1);
    assert.equal(providers[0]?.entity.id, "prov_01JNV4R0R1DVH1YP8KQQD5GQ7X");
    assert.equal(
      (await readProvider(vaultRoot, "prov_01JNV4R0R1DVH1YP8KQQD5GQ7X"))?.entity.organization,
      "Neighborhood Clinic",
    );
    assert.equal(
      (await showProvider(vaultRoot, "Primary Care"))?.entity.slug,
      "primary-care",
    );

    assert.equal(workoutFormats.length, 1);
    assert.equal(workoutFormats[0]?.entity.id, workoutFormatCompatibilityId);
    assert.equal(
      (await readWorkoutFormat(vaultRoot, workoutFormatCompatibilityId))?.entity.slug,
      "garage-day",
    );
    assert.equal(
      (await showWorkoutFormat(vaultRoot, "garage-day"))?.entity.id,
      workoutFormatCompatibilityId,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
