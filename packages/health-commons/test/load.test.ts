import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readAllHealthCommonsArtifactManifests, readHealthCommonsContent } from "../src/load.ts";

const sourcePage = `---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:test-page
slug: sources/test-page
title: Test Page
source:
  kind: web_page
  url: https://example.com/test
artifacts:
  -
    artifactId: art_test_page_html
    kind: html
    storage: cloudflare-r2
    objectKey: commons/test-page.html
    localPath: source-artifacts/test-page.html
    sourceUrl: https://example.com/test
    rightsStatus: unknown
    redistributable: false
---

Test page.
`;

const nonSourcePage = `---
schemaVersion: murph.commons.page.v1
entityType: source_person
key: source_person:test-person
slug: sources/people/test-person
title: Test Person
source:
  kind: web_page
  url: https://example.com/person
artifacts:
  -
    artifactId: art_should_be_ignored
    kind: html
    storage: cloudflare-r2
    objectKey: commons/ignored.html
    localPath: source-artifacts/ignored.html
    sourceKey: source_artifact:wrong-owner
    sourceUrl: https://example.com/ignored
    rightsStatus: unknown
    redistributable: false
---

Ignored non-source page.
`;

describe("Health Commons artifact manifests", () => {
  it("includes source-page artifact pointers and preserves source-page ownership", async () => {
    const contentRoot = await mkdtemp(path.join(os.tmpdir(), "murph-health-commons-"));
    await writeFile(path.join(contentRoot, "source.md"), sourcePage, "utf8");
    await writeFile(path.join(contentRoot, "non-source.md"), nonSourcePage, "utf8");

    const manifests = await readAllHealthCommonsArtifactManifests(contentRoot);
    const pageManifest = manifests.find((manifest) => manifest.manifestKey === "artifact_manifest:page-frontmatter-artifacts");

    expect(pageManifest?.artifacts).toEqual([
      expect.objectContaining({
        artifactId: "art_test_page_html",
        sourceKey: "source_artifact:test-page",
      }),
    ]);
  });

  it("loads standalone evidence appraisal JSONL records", async () => {
    const contentRoot = await mkdtemp(path.join(os.tmpdir(), "murph-health-commons-"));
    await mkdir(path.join(contentRoot, "evidence-appraisals"), { recursive: true });
    await writeFile(
      path.join(contentRoot, "evidence-appraisals", "example.jsonl"),
      `${JSON.stringify({
        schemaVersion: "murph.commons.evidence-appraisal.v1",
        key: "evidence_appraisal:example",
        sourceKey: "source_artifact:test-page",
        targetKey: "protocol_variant:test-protocol",
        targetKind: "protocol_variant",
        groupId: "example-group",
        stance: "supports",
        scope: "direct_protocol",
        result: "positive",
        headline: "Example headline",
        implication: "Example implication",
      })}\n`,
      "utf8",
    );

    const content = await readHealthCommonsContent(contentRoot);

    expect(content.evidenceAppraisals).toEqual([
      expect.objectContaining({
        key: "evidence_appraisal:example",
        sourceKey: "source_artifact:test-page",
        targetKey: "protocol_variant:test-protocol",
      }),
    ]);
  });
});
