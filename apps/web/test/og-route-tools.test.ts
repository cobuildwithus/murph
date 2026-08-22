import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertUnhashedOgImageRoutes,
  collectExpectedOgImageRoutes,
} from "../scripts/check-og-route-manifest";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { force: true, recursive: true });
});

function fixture(): string {
  const base = process.env.MURPH_VITEST_TEMP_ROOT;
  if (!base) throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
  const root = mkdtempSync(path.join(base, "og-route-manifest-"));
  roots.push(root);
  for (const relative of [
    "opengraph-image.tsx",
    "(dashboard)/biomarkers/[biomarkerId]/opengraph-image.tsx",
  ]) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "export default function Image() {}\n");
  }
  return root;
}

describe("OG route verification", () => {
  it("derives public routes with route groups stripped", () => {
    expect(collectExpectedOgImageRoutes(fixture())).toEqual([
      {
        route: "/biomarkers/[biomarkerId]/opengraph-image",
        source: "(dashboard)/biomarkers/[biomarkerId]/opengraph-image.tsx",
      },
      { route: "/opengraph-image", source: "opengraph-image.tsx" },
    ]);
  });

  it("rejects a hash-suffixed emitted route in place of the advertised URL", () => {
    const root = fixture();
    expect(() => assertUnhashedOgImageRoutes(root, {
      "/(dashboard)/biomarkers/[biomarkerId]/opengraph-image": "/biomarkers/[biomarkerId]/opengraph-image-1umbqe",
      "/opengraph-image": "/opengraph-image",
    })).toThrow(/missing their exact unhashed public paths/u);
  });

  it("accepts exact unhashed emitted routes", () => {
    const root = fixture();
    expect(() => assertUnhashedOgImageRoutes(root, {
      "/biomarkers/[biomarkerId]/opengraph-image": "/biomarkers/[biomarkerId]/opengraph-image",
      "/opengraph-image": "/opengraph-image",
    })).not.toThrow();
  });
});
