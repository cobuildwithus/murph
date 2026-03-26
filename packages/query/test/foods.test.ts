import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { listFoods, readFood, showFood } from "../src/index.js";

async function writeVaultFile(vaultRoot: string, relativePath: string, contents: string) {
  await mkdir(path.dirname(path.join(vaultRoot, relativePath)), {
    recursive: true,
  });
  await writeFile(path.join(vaultRoot, relativePath), contents, "utf8");
}

test("food registry queries expose regular foods by id, slug, and status", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "healthybob-query-foods-"));

  try {
    await writeVaultFile(
      vaultRoot,
      "bank/foods/regular-acai-bowl.md",
      `---
schemaVersion: hb.frontmatter.food.v1
docType: food
foodId: food_01JNV422Y2M5ZBV64ZP4N1DRB1
slug: regular-acai-bowl
title: Regular Acai Bowl
status: active
summary: The usual acai bowl order from the neighborhood spot with repeat toppings.
kind: acai bowl
vendor: Neighborhood Acai Bar
location: Brooklyn, NY
serving: 1 bowl
aliases:
  - regular acai bowl
  - usual acai bowl
ingredients:
  - acai base
  - banana
  - strawberries
  - granola
  - almond butter
tags:
  - breakfast
  - favorite
note: Typical order includes extra granola and no honey.
---
# Regular Acai Bowl
`,
    );
    await writeVaultFile(
      vaultRoot,
      "bank/foods/purely-elizabeth-granola.md",
      `---
schemaVersion: hb.frontmatter.food.v1
docType: food
foodId: food_01JNV4R0R1DVH1YP8KQQD5GQ7X
slug: purely-elizabeth-granola
title: Purely Elizabeth Granola
status: archived
brand: Purely Elizabeth
kind: granola
---
# Purely Elizabeth Granola
`,
    );

    const activeFoods = await listFoods(vaultRoot, {
      status: "active",
    });
    const allFoods = await listFoods(vaultRoot, {
      limit: 10,
    });
    const readById = await readFood(vaultRoot, "food_01JNV422Y2M5ZBV64ZP4N1DRB1");
    const shownBySlug = await showFood(vaultRoot, "regular-acai-bowl");
    const shownByTitle = await showFood(vaultRoot, "Purely Elizabeth Granola");

    assert.equal(activeFoods.length, 1);
    assert.equal(activeFoods[0]?.id, "food_01JNV422Y2M5ZBV64ZP4N1DRB1");
    assert.equal(allFoods.length, 2);
    assert.equal(allFoods[0]?.title, "Purely Elizabeth Granola");
    assert.equal(allFoods[1]?.title, "Regular Acai Bowl");
    assert.equal(readById?.vendor, "Neighborhood Acai Bar");
    assert.deepEqual(readById?.aliases, ["regular acai bowl", "usual acai bowl"]);
    assert.deepEqual(readById?.ingredients, [
      "acai base",
      "banana",
      "strawberries",
      "granola",
      "almond butter",
    ]);
    assert.equal(shownBySlug?.slug, "regular-acai-bowl");
    assert.equal(shownByTitle?.id, "food_01JNV4R0R1DVH1YP8KQQD5GQ7X");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
