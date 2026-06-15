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
      writePolicyFixture(tempRoot, [
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
      ]);

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

  it("rejects vulnerable Dependabot patch floors and affected version ranges in the lockfile", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "murph-dependency-policy-"));

    try {
      writePolicyFixture(tempRoot, [
        "lockfileVersion: '9.0'",
        "settings:",
        "  autoInstallPeers: true",
        "",
        "packages:",
        "  '@grpc/grpc-js@1.14.3':",
        "    resolution: {integrity: sha512-vulnerable}",
        "  axios@1.15.9:",
        "    resolution: {integrity: sha512-vulnerable}",
        "  esbuild@0.28.0:",
        "    resolution: {integrity: sha512-vulnerable}",
        "  hono@4.12.20:",
        "    resolution: {integrity: sha512-vulnerable}",
        "  ip-address@10.1.0:",
        "    resolution: {integrity: sha512-vulnerable}",
        "  js-cookie@3.0.6:",
        "    resolution: {integrity: sha512-vulnerable}",
        "  postcss@8.5.9:",
        "    resolution: {integrity: sha512-vulnerable}",
        "  qs@6.15.1:",
        "    resolution: {integrity: sha512-vulnerable}",
        "  uuid@11.1.0:",
        "    resolution: {integrity: sha512-vulnerable}",
        "  brace-expansion@1.1.15:",
        "    resolution: {integrity: sha512-outside-range}",
        "  brace-expansion@2.1.1:",
        "    resolution: {integrity: sha512-outside-range}",
        "  brace-expansion@5.0.5:",
        "    resolution: {integrity: sha512-vulnerable}",
        "  ws@7.5.10:",
        "    resolution: {integrity: sha512-outside-range}",
        "  ws@8.20.0:",
        "    resolution: {integrity: sha512-vulnerable}",
        "",
      ]);

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

        expect(stderr).toContain("pnpm-lock.yaml contains @grpc/grpc-js@1.14.3");
        expect(stderr).toContain("pnpm-lock.yaml contains axios@1.15.9");
        expect(stderr).toContain("pnpm-lock.yaml contains esbuild@0.28.0");
        expect(stderr).toContain("pnpm-lock.yaml contains hono@4.12.20");
        expect(stderr).toContain("pnpm-lock.yaml contains ip-address@10.1.0");
        expect(stderr).toContain("pnpm-lock.yaml contains js-cookie@3.0.6");
        expect(stderr).toContain("pnpm-lock.yaml contains postcss@8.5.9");
        expect(stderr).toContain("pnpm-lock.yaml contains qs@6.15.1");
        expect(stderr).toContain("pnpm-lock.yaml contains uuid@11.1.0");
        expect(stderr).toContain("pnpm-lock.yaml contains brace-expansion@5.0.5");
        expect(stderr).toContain("pnpm-lock.yaml contains ws@8.20.0");
        expect(stderr).not.toContain("brace-expansion@1.1.15");
        expect(stderr).not.toContain("brace-expansion@2.1.1");
        expect(stderr).not.toContain("ws@7.5.10");
        return;
      }

      throw new Error("Expected dependency policy verification to reject vulnerable Dependabot entries.");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects prerelease versions for guarded dependency-security lockfile entries", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "murph-dependency-policy-"));

    try {
      writePolicyFixture(tempRoot, [
        "lockfileVersion: '9.0'",
        "settings:",
        "  autoInstallPeers: true",
        "",
        "packages:",
        "  axios@1.16.0-beta.1:",
        "    resolution: {integrity: sha512-prerelease}",
        "  esbuild@0.28.1-rc.0:",
        "    resolution: {integrity: sha512-prerelease}",
        "  brace-expansion@5.0.6-rc.0:",
        "    resolution: {integrity: sha512-prerelease}",
        "  ws@8.20.1-beta.1:",
        "    resolution: {integrity: sha512-prerelease}",
        "",
      ]);

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

        expect(stderr).toContain("pnpm-lock.yaml contains axios@1.16.0-beta.1");
        expect(stderr).toContain("pnpm-lock.yaml contains esbuild@0.28.1-rc.0");
        expect(stderr).toContain("pnpm-lock.yaml contains brace-expansion@5.0.6-rc.0");
        expect(stderr).toContain("pnpm-lock.yaml contains ws@8.20.1-beta.1");
        expect(stderr).toContain("requires a stable release, not a prerelease");
        return;
      }

      throw new Error("Expected dependency policy verification to reject prerelease guarded entries.");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

function writePolicyFixture(tempRoot: string, lockfileLines: string[]) {
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
    lockfileLines.join("\n"),
    "utf8",
  );
}
