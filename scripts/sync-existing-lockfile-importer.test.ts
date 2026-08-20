import { describe, expect, it } from "vitest";

import { syncExistingImporterLockfile } from "./sync-existing-lockfile-importer.mjs";

const lockfile = `lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      alpha:
        specifier: 1.0.0
        version: 1.0.0

  packages/example:
    dependencies:
      pg:
        specifier: 8.20.0
        version: 8.20.0(peer@1.0.0)

packages: {}
`;

describe("existing lockfile importer sync", () => {
  it("copies one exact locked record without touching unrelated snapshots", () => {
    const result = syncExistingImporterLockfile({
      importer: ".",
      lockfileText: lockfile,
      manifest: { devDependencies: { alpha: "1.0.0", pg: "8.20.0" } },
    });
    expect(result.added).toEqual(["devDependencies.pg"]);
    expect(result.lockfileText).toContain(`      pg:
        specifier: 8.20.0
        version: 8.20.0(peer@1.0.0)`);
    expect(result.lockfileText).toContain("packages: {}\n");
  });

  it("fails when the dependency needs a new resolution", () => {
    expect(() => syncExistingImporterLockfile({
      importer: ".",
      lockfileText: lockfile,
      manifest: { devDependencies: { missing: "2.0.0" } },
    })).toThrow(/use pnpm for a real resolution/u);
  });

  it("fails instead of choosing between peer snapshots", () => {
    const ambiguous = lockfile.replace(
      "packages: {}",
      `  packages/other:
    dependencies:
      pg:
        specifier: 8.20.0
        version: 8.20.0(peer@2.0.0)

packages: {}`,
    );
    expect(() => syncExistingImporterLockfile({
      importer: ".",
      lockfileText: ambiguous,
      manifest: { devDependencies: { pg: "8.20.0" } },
    })).toThrow(/ambiguous/u);
  });
});
