import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import {
  DERIVED_KNOWLEDGE_PAGES_ROOT,
  readDerivedKnowledgeGraph,
  searchDerivedKnowledgeGraph,
} from "../src/index.ts";

const createdVaultRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdVaultRoots.splice(0).map(async (vaultRoot) => {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }),
  );
});

test("derived knowledge graph strips trailing generated sections but preserves narrative Related and Sources sections", async () => {
  const vaultRoot = await createVaultRoot();
  await writeKnowledgePage(
    vaultRoot,
    "sleep-quality",
    [
      "---",
      "title: Sleep quality",
      "slug: sleep-quality",
      "pageType: concept",
      "status: active",
      "---",
      "",
      "# Sleep quality",
      "",
      "Baseline narrative body.",
      "",
      "## Related",
      "",
      "This section compares nearby protocols and habits without using generated links.",
      "",
      "## Sources",
      "",
      "This section summarizes the synthesis pass and follow-up notes.",
    ].join("\n"),
  );
  await writeKnowledgePage(
    vaultRoot,
    "generated-tail",
    [
      "---",
      "title: Generated tail",
      "slug: generated-tail",
      "relatedSlugs:",
      "  - sleep-quality",
      "sourcePaths:",
      "  - research/current.md",
      "---",
      "",
      "# Generated tail",
      "",
      "Stable narrative body.",
      "",
      "## Related",
      "",
      "- [[sleep-quality]]",
      "",
      "## Sources",
      "",
      "- `research/stale.md`",
    ].join("\n"),
  );

  const graph = await readDerivedKnowledgeGraph(vaultRoot);
  const preserved = graph.bySlug.get("sleep-quality");
  const stripped = graph.bySlug.get("generated-tail");
  const search = searchDerivedKnowledgeGraph(graph, "synthesis");

  expect(preserved?.body).toContain("## Related");
  expect(preserved?.body).toContain("nearby protocols and habits");
  expect(preserved?.body).toContain("## Sources");
  expect(preserved?.body).toContain("synthesis pass and follow-up notes");
  expect(stripped?.body).toBe("Stable narrative body.");
  expect(search.hits[0]).toMatchObject({
    slug: "sleep-quality",
  });
  expect(search.hits[0]?.snippet).toContain("synthesis pass");
});

async function createVaultRoot(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-knowledge-graph-"));
  createdVaultRoots.push(vaultRoot);
  await mkdir(path.join(vaultRoot, DERIVED_KNOWLEDGE_PAGES_ROOT), {
    recursive: true,
  });
  return vaultRoot;
}

async function writeKnowledgePage(
  vaultRoot: string,
  slug: string,
  markdown: string,
): Promise<void> {
  await writeFile(
    path.join(vaultRoot, DERIVED_KNOWLEDGE_PAGES_ROOT, `${slug}.md`),
    markdown,
    "utf8",
  );
}
