import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildNextEnvDeclarationArtifact,
  isBlockedTrackedArtifactPath,
  isAllowedDeclarationArtifactContents,
  shouldSkipSourceArtifactDirectory,
} from "./check-no-js.ts";
import {
  ensureNextRouteTypeStub,
  extractNextRootParamsTypesImport,
} from "./ensure-next-route-type-stubs.ts";
import {
  generatedArtifactDirectories,
  pruneKnownGeneratedArtifactDirectory,
} from "./prune-generated-source-sidecars.ts";

describe("check-no-js hygiene guards", () => {
  it("skips generated deploy and smoke output directories during source scans", () => {
    expect(shouldSkipSourceArtifactDirectory(".deploy")).toBe(true);
    expect(shouldSkipSourceArtifactDirectory(".wrangler")).toBe(true);
    expect(shouldSkipSourceArtifactDirectory("dist")).toBe(true);
    expect(shouldSkipSourceArtifactDirectory(".next-smoke")).toBe(true);
    expect(shouldSkipSourceArtifactDirectory(".next-smoke-e2e-123")).toBe(true);
    expect(shouldSkipSourceArtifactDirectory("src")).toBe(false);
  });

  it("treats ephemeral next smoke directories as blocked tracked artifacts", () => {
    expect(
      isBlockedTrackedArtifactPath("apps/web/.next-smoke/dev/static/chunks/runtime.js"),
    ).toBe(true);
    expect(
      isBlockedTrackedArtifactPath("apps/web/.next-smoke-e2e-123/dev/static/chunks/runtime.js"),
    ).toBe(true);
    expect(isBlockedTrackedArtifactPath("apps/web/src/runtime.ts")).toBe(false);
  });

  it("prunes Cloudflare dry-run artifact directories before source hygiene checks", () => {
    expect(generatedArtifactDirectories).toContain("apps/cloudflare/.deploy/.deploy");
    expect(generatedArtifactDirectories).toContain("apps/cloudflare/.deploy/dry-run");
    expect(generatedArtifactDirectories).toContain("apps/cloudflare/.deploy/smoke-dist");
  });

  it("keeps large git file-list scans on an explicit buffer", async () => {
    const [checkNoJsSource, pruneSource] = await Promise.all([
      readFile(new URL("./check-no-js.ts", import.meta.url), "utf8"),
      readFile(new URL("./prune-generated-source-sidecars.ts", import.meta.url), "utf8"),
    ]);

    for (const source of [checkNoJsSource, pruneSource]) {
      expect(source).toContain("const gitListMaxBuffer = 16 * 1024 * 1024;");
      expect(source).toMatch(/execFileAsync\("git",[\s\S]*?maxBuffer: gitListMaxBuffer,/u);
    }
  });

  it("refuses to prune through symlinked generated artifact parents", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "murph-prune-test-"));
    const outside = await mkdtemp(path.join(tmpdir(), "murph-prune-target-"));

    try {
      await mkdir(path.join(root, "apps/cloudflare"), { recursive: true });
      await mkdir(path.join(outside, "dry-run"), { recursive: true });
      await writeFile(path.join(outside, "dry-run/keep.txt"), "keep");
      await symlink(outside, path.join(root, "apps/cloudflare/.deploy"), "dir");

      await expect(
        pruneKnownGeneratedArtifactDirectory(root, "apps/cloudflare/.deploy/dry-run"),
      ).rejects.toThrow("symlinked parent");
      await expect(access(path.join(outside, "dry-run/keep.txt"))).resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });

  it("allows generated next-env.d.ts variants for stable and suffixed Next output directories", () => {
    expect(
      isAllowedDeclarationArtifactContents(
        "apps/web/next-env.d.ts",
        buildNextEnvDeclarationArtifact("./.next/types/routes.d.ts"),
      ),
    ).toBe(true);
    expect(
      isAllowedDeclarationArtifactContents(
        "apps/web/next-env.d.ts",
        buildNextEnvDeclarationArtifact("./.next-smoke/dev/types/routes.d.ts"),
      ),
    ).toBe(true);
    expect(
      isAllowedDeclarationArtifactContents(
        "apps/web/next-env.d.ts",
        buildNextEnvDeclarationArtifact("./.next-smoke-e2e-run/dev/types/routes.d.ts"),
      ),
    ).toBe(true);
    expect(
      isAllowedDeclarationArtifactContents(
        "apps/web/next-env.d.ts",
        buildNextEnvDeclarationArtifact("./.next-dev-e2e-run/types/routes.d.ts"),
      ),
    ).toBe(true);
  });

  it("requires the Next 16.3 root-params declaration beside route types", () => {
    const declaration = buildNextEnvDeclarationArtifact("./.next/types/routes.d.ts");

    expect(extractNextRootParamsTypesImport(declaration)).toBe(
      "./.next/types/root-params.d.ts",
    );
    expect(
      isAllowedDeclarationArtifactContents(
        "apps/web/next-env.d.ts",
        declaration.replace("./.next/types/root-params.d.ts", "./src/types/root-params.d.ts"),
      ),
    ).toBe(false);
    expect(
      isAllowedDeclarationArtifactContents(
        "apps/web/next-env.d.ts",
        declaration.replace('import "./.next/types/root-params.d.ts";\n', ""),
      ),
    ).toBe(false);
  });

  it("migrates the generated Next 16.2 declaration before preparing 16.3 stubs", async () => {
    const testTempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
    if (!testTempRoot) {
      throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
    }

    const workspaceRoot = await mkdtemp(path.join(testTempRoot, "next-type-stubs-"));
    const nextEnvPath = path.join(workspaceRoot, "next-env.d.ts");
    const routeTypesPath = path.join(workspaceRoot, ".next-smoke/dev/types/routes.d.ts");
    const rootParamsPath = path.join(workspaceRoot, ".next-smoke/dev/types/root-params.d.ts");

    try {
      const currentDeclaration = buildNextEnvDeclarationArtifact(
        "./.next-smoke/dev/types/routes.d.ts",
      );
      const legacyDeclaration = currentDeclaration.replace(
        'import "./.next-smoke/dev/types/root-params.d.ts";\n',
        "",
      );
      await writeFile(nextEnvPath, legacyDeclaration);

      await expect(ensureNextRouteTypeStub(nextEnvPath)).resolves.toBe(routeTypesPath);
      await expect(readFile(nextEnvPath, "utf8")).resolves.toBe(currentDeclaration);
      await expect(readFile(routeTypesPath, "utf8")).resolves.toContain(
        "Auto-generated route-type stub",
      );
      await expect(readFile(rootParamsPath, "utf8")).resolves.toContain(
        "Type definitions for Next.js root params",
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it.each([
    [".next/types", "app"],
    [".next/types", "src/app"],
    [".next-smoke/dev/types", "src/app"],
  ])("removes orphan route guards in %s while preserving live %s guards", async (typesDir, appDir) => {
    const tempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
    if (!tempRoot) throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
    const root = await mkdtemp(path.join(tempRoot, "next-orphan-guards-"));
    const nextEnvPath = path.join(root, "next-env.d.ts");
    const makeGuard = async (relativePath: string, sourcePath: string) => {
      const guardPath = path.join(root, relativePath);
      const importedPath = path.relative(path.dirname(guardPath), path.join(root, sourcePath))
        .replace(/\\/gu, "/");
      const contents = `// File: synthetic route fixture\nimport * as entry from '${importedPath}'\n`;
      await mkdir(path.dirname(guardPath), { recursive: true });
      await writeFile(guardPath, contents);
      return { guardPath, contents };
    };
    try {
      await mkdir(path.join(root, appDir), { recursive: true });
      await writeFile(path.join(root, appDir, "page.tsx"), "export default function Page() {}\n");
      await writeFile(path.join(root, appDir, "layout.jsx"), "export default function Layout() {}\n");
      await mkdir(path.join(root, appDir, "api/live"), { recursive: true });
      await writeFile(path.join(root, appDir, "api/live/route.ts"), "export function GET() {}\n");
      await writeFile(nextEnvPath, buildNextEnvDeclarationArtifact(`./${typesDir}/routes.d.ts`));
      const orphan = await makeGuard(`${typesDir}/app/api/removed/route.ts`, `${appDir}/api/removed/route.js`);
      const stableOrphan = await makeGuard(".next/types/app/api/old/route.ts", `${appDir}/api/old/route.js`);
      const page = await makeGuard(`${typesDir}/app/page.ts`, `${appDir}/page.js`);
      const layout = await makeGuard(`${typesDir}/app/layout.ts`, `${appDir}/layout.js`);
      const route = await makeGuard(`${typesDir}/app/api/live/route.ts`, `${appDir}/api/live/route.js`);
      const unknown = await makeGuard(`${typesDir}/app/custom.ts`, `${appDir}/missing.js`);
      const unrecognized = await makeGuard(`${typesDir}/app/unrecognized/route.ts`, `${appDir}/unrecognized/route.js`);
      unrecognized.contents = "export {}; // unrelated generated shape\n";
      await writeFile(unrecognized.guardPath, unrecognized.contents);
      const outside = await makeGuard(`${typesDir}/app/elsewhere/route.ts`, "other/route.js");
      await writeFile(path.join(root, typesDir, "validator.ts"), "import './removed.js';\n");

      await ensureNextRouteTypeStub(nextEnvPath);

      await expect(access(orphan.guardPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(stableOrphan.guardPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(path.join(root, typesDir, "validator.ts"))).rejects.toMatchObject({ code: "ENOENT" });
      for (const retained of [page, layout, route, unknown, unrecognized, outside]) {
        await expect(readFile(retained.guardPath, "utf8")).resolves.toBe(retained.contents);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(["app", "app/nested"])("preserves route guards behind a generated %s symlink", async (linkedDirectory) => {
    const tempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
    if (!tempRoot) throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
    const root = await mkdtemp(path.join(tempRoot, "next-linked-guards-"));
    const outside = await mkdtemp(path.join(tempRoot, "next-retained-guards-"));
    const nextEnvPath = path.join(root, "next-env.d.ts");
    const linkPath = path.join(root, ".next/types", linkedDirectory);
    const importedPath = path.relative(linkPath, path.join(root, "app/route.js"))
      .replace(/\\/gu, "/");
    const guard = `// File: synthetic route fixture\nimport * as entry from '${importedPath}'\n`;
    try {
      await mkdir(path.dirname(linkPath), { recursive: true });
      await symlink(outside, linkPath, "dir");
      await writeFile(path.join(outside, "route.ts"), guard);
      await writeFile(nextEnvPath, buildNextEnvDeclarationArtifact("./.next/types/routes.d.ts"));

      await ensureNextRouteTypeStub(nextEnvPath);

      await expect(readFile(path.join(outside, "route.ts"), "utf8")).resolves.toBe(guard);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a root-params import outside the accepted route-types directory", async () => {
    const testTempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
    if (!testTempRoot) {
      throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
    }

    const workspaceRoot = await mkdtemp(path.join(testTempRoot, "next-type-boundary-"));
    const escapeRoot = `${workspaceRoot}-escape`;
    const nextEnvPath = path.join(workspaceRoot, "next-env.d.ts");
    const escapedRootParamsPath = path.join(escapeRoot, "types/root-params.d.ts");
    const malformedDeclaration = buildNextEnvDeclarationArtifact(
      "./.next/types/routes.d.ts",
    ).replace(
      "./.next/types/root-params.d.ts",
      `../${path.basename(escapeRoot)}/types/root-params.d.ts`,
    );

    try {
      await writeFile(nextEnvPath, malformedDeclaration);

      await expect(ensureNextRouteTypeStub(nextEnvPath)).rejects.toThrow(
        "does not match the generated Next 16.2 or 16.3 declaration shape",
      );
      await expect(access(escapedRootParamsPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
      await rm(escapeRoot, { force: true, recursive: true });
    }
  });

  it("rejects next-env.d.ts variants that point outside allowed Next output directories", () => {
    expect(
      isAllowedDeclarationArtifactContents(
        "apps/web/next-env.d.ts",
        buildNextEnvDeclarationArtifact("./src/types/routes.d.ts"),
      ),
    ).toBe(false);
    expect(
      isAllowedDeclarationArtifactContents(
        "apps/web/next-env.d.ts",
        buildNextEnvDeclarationArtifact("./.next-random/types/routes.d.ts"),
      ),
    ).toBe(false);
  });
});
