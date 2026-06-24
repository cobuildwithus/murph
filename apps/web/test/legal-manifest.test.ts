import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { test } from "vitest";

function readLegalManifest() {
  return JSON.parse(
    readFileSync(
      path.resolve(process.cwd(), "apps/web/public/legal/manifest.json"),
      "utf8",
    ) as string,
  ) as {
    documents: Array<{
      aliases: Array<{ path: string }>;
      id: string;
      latest: { path: string };
      source: string;
      title: string;
      version: string;
      versions: Array<{ path: string }>;
    }>;
    generatedBy: string;
    schema: string;
  };
}

test("legal manifest keeps the current PDF set versioned and deterministic", () => {
  const manifest = readLegalManifest();

  assert.equal(manifest.schema, "murph.legal-document-manifest.v1");
  assert.equal(manifest.generatedBy, "apps/web/scripts/generate-legal-pdfs.ts");
  assert.equal(manifest.documents.length, 6);

  const ids = manifest.documents.map((document) => document.id).sort();
  assert.deepEqual(ids, [
    "consumer-health-data-notice",
    "health-ai-safety-disclosure",
    "legal-documents",
    "privacy-policy",
    "subprocessors",
    "terms-of-service",
  ]);

  for (const document of manifest.documents) {
    assert.match(document.latest.path, /^\/legal\/.+\.pdf$/u);
    assert.equal(document.versions.length, 1);
    assert.equal(document.source.startsWith("apps/web/legal/"), true);
  }

  const privacyPolicy = manifest.documents.find((document) =>
    document.id === "privacy-policy");
  assert.equal(privacyPolicy?.version, "2026-06-24");
  assert.equal(privacyPolicy?.versions[0]?.path, "/legal/privacy-2026-06-24.pdf");

  for (const document of manifest.documents) {
    if (document.id === "privacy-policy") {
      continue;
    }

    assert.equal(document.version, "2026-04-29");
    assert.match(document.versions[0]?.path ?? "", /^\/legal\/.+-2026-04-29\.pdf$/u);
  }

  const consumerHealthNotice = manifest.documents.find((document) =>
    document.id === "consumer-health-data-notice");

  assert.equal(consumerHealthNotice?.aliases.length, 1);
  assert.equal(
    consumerHealthNotice?.aliases[0]?.path,
    "/legal/consumer-health-data-privacy.pdf",
  );
  assert.equal(consumerHealthNotice?.latest.path, "/legal/consumer-health-data-notice.pdf");
  assert.equal(
    consumerHealthNotice?.versions[0]?.path,
    "/legal/consumer-health-data-notice-2026-04-29.pdf",
  );
});
