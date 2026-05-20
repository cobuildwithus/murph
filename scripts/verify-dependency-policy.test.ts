import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const policyScriptPath = path.join(repoRoot, "scripts", "verify-dependency-policy.mjs");

describe("verify-dependency-policy", () => {
  it("rejects compromised Axios releases and the plain-crypto-js dropper in the lockfile", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "murph-dependency-policy-"));

    try {
      mkdirSync(path.join(tempRoot, "scripts"), { recursive: true });
      writeFileSync(
        path.join(tempRoot, "scripts", "verify-dependency-policy.mjs"),
        readFileSync(policyScriptPath, "utf8"),
        "utf8",
      );
      writeFileSync(
        path.join(tempRoot, "package.json"),
        JSON.stringify(
          {
            packageManager: "pnpm@10.25.0+sha512.testintegrity",
            engines: {
              pnpm: "10.25.0",
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      writeFileSync(
        path.join(tempRoot, "pnpm-workspace.yaml"),
        [
          "engineStrict: true",
          "packageManagerStrictVersion: true",
          "managePackageManagerVersions: true",
          "blockExoticSubdeps: true",
          "trustPolicy: no-downgrade",
          "minimumReleaseAge: 1440",
          "trustPolicyIgnoreAfter: 259200",
          "allowBuilds:",
          "",
        ].join("\n"),
        "utf8",
      );
      writeFileSync(
        path.join(tempRoot, "pnpm-lock.yaml"),
        [
          "lockfileVersion: '9.0'",
          "settings:",
          "  autoInstallPeers: true",
          "",
          "packages:",
          "  axios@1.14.1:",
          "    resolution: {integrity: sha512-compromised}",
          "  axios@0.30.4:",
          "    resolution: {integrity: sha512-compromised}",
          "  plain-crypto-js@1.0.0:",
          "    resolution: {integrity: sha512-dropper}",
          "",
        ].join("\n"),
        "utf8",
      );

      try {
        execFileSync(process.execPath, [path.join(tempRoot, "scripts", "verify-dependency-policy.mjs")], {
          cwd: tempRoot,
          encoding: "utf8",
          stdio: "pipe",
        });
      } catch (error) {
        const stderr = error instanceof Error && "stderr" in error
          ? String(error.stderr)
          : "";

        expect(stderr).toContain("pnpm-lock.yaml must not contain axios@1.14.1");
        expect(stderr).toContain("pnpm-lock.yaml must not contain axios@0.30.4");
        expect(stderr).toContain("pnpm-lock.yaml must not contain plain-crypto-js");
        return;
      }

      throw new Error("Expected dependency policy verification to reject blocked lockfile entries.");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
