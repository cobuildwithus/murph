import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { addMeal, initializeVault } from "../src/index.ts";
it("rejects invalid names before typed or photo meal writes while retaining unreviewed photo intake", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "meal-name-core-"));
  try {
    const vaultRoot = path.join(root, "vault"); await initializeVault({ vaultRoot });
    const photoPath = path.join(root, "photo.jpg"); await writeFile(photoPath, "synthetic photo");
    for (const name of ["beans, rice and peas", "One two three four five six", "bean tacos", "Photo shows bean tacos"]) {
      await expect(addMeal({ vaultRoot, name, note: "One plate" })).rejects.toMatchObject({ code: "VAULT_INVALID_MEAL_NAME" });
      await expect(addMeal({ vaultRoot, name, photoPath })).rejects.toMatchObject({ code: "VAULT_INVALID_MEAL_NAME" });
    }
    expect((await addMeal({ vaultRoot, photoPath })).event.title).toBe("Meal");
    expect((await addMeal({ vaultRoot, name: "Bean tacos", note: "One plate" })).event.title).toBe("Bean tacos");
  } finally { await rm(root, { recursive: true, force: true }); }
});
