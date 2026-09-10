import { cp, lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ root: "" }));

vi.mock("../../src/dev-hosted-local/constants.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/dev-hosted-local/constants.ts")>();
  return {
    ...actual,
    get repoRoot() { return fixture.root; },
    get cloudflareDir() { return path.join(fixture.root, "apps", "cloudflare"); },
    get HOSTED_LOCAL_RUNNER_BUNDLE_ROOT() {
      return path.join(fixture.root, "apps", "cloudflare", ".deploy", "runner-bundle");
    },
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, cp: vi.fn(actual.cp) };
});

async function writeFixtureFile(relativePath: string, text: string): Promise<void> {
  const filePath = path.join(fixture.root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text);
}

async function writeWorkspacePackage(
  slug: string,
  dependencies: Record<string, unknown> = {},
): Promise<void> {
  await writeFixtureFile(`packages/${slug}/package.json`, JSON.stringify({
    name: `@murphai/${slug}`,
    dependencies,
  }));
  await writeFixtureFile(`packages/${slug}/dist/index.js`, `export const name = "${slug}";`);
}

async function prepareSnapshot(abortSignal?: AbortSignal) {
  const { prepareHostedLocalCloudflareSourceSnapshot } = await import(
    "../../src/dev-hosted-local/cloudflare-source-snapshot.ts"
  );
  return await prepareHostedLocalCloudflareSourceSnapshot({
    abortSignal,
    tempDir: path.join(fixture.root, "output"),
  });
}

describe("hosted-local Cloudflare source snapshot", () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(cp).mockReset().mockImplementation(actual.cp);
    fixture.root = await mkdtemp(path.join(os.tmpdir(), "murph-source-snapshot-"));
    await writeFixtureFile("Dockerfile.cloudflare-hosted-runner", "FROM fixture-runner\n");
    await writeFixtureFile("apps/cloudflare/.dockerignore", "node_modules\n");
    await writeFixtureFile("apps/cloudflare/src/index.ts", "export const worker = true;\n");
    await writeFixtureFile("apps/cloudflare/.deploy/runner-bundle/index.js", "runner bundle\n");
    await writeFixtureFile("apps/cloudflare/package.json", JSON.stringify({
      dependencies: { "@murphai/alpha": "workspace:*", "@murphai/beta": "workspace:*" },
      devDependencies: { "@murphai/unused-dev": "workspace:*" },
    }));
    await writeWorkspacePackage("alpha", { "@murphai/shared": "workspace:*" });
    await writeWorkspacePackage("beta", { "@murphai/shared": "workspace:*" });
    await writeWorkspacePackage("shared", { "@murphai/alpha": "workspace:*" });
  });

  afterEach(async () => {
    await rm(fixture.root, { force: true, recursive: true });
  });

  it("copies the dependency closure once in breadth-first order and isolates built artifacts", async () => {
    await writeWorkspacePackage("unreferenced");
    await writeFixtureFile("packages/not-workspace/package.json", '{"name":"external-package"}');
    await mkdir(path.join(fixture.root, "packages", "without-manifest"));
    await writeFixtureFile("packages/README.txt", "ignored file");
    await writeFixtureFile("output/cloudflare-source/stale.txt", "stale snapshot");

    const snapshot = await prepareSnapshot();
    expect(snapshot).toEqual({
      cloudflareAppDir: path.join(fixture.root, "output/cloudflare-source/apps/cloudflare"),
      workspaceRoot: path.join(fixture.root, "output/cloudflare-source"),
    });
    const packagesRoot = path.join(snapshot.cloudflareAppDir, "node_modules", "@murphai");
    expect(vi.mocked(cp).mock.calls
      .map(([, destination]) => String(destination))
      .filter((destination) => destination.endsWith(`${path.sep}dist`)))
      .toEqual(["alpha", "beta", "shared"].map((slug) => path.join(packagesRoot, slug, "dist")));
    expect(await readFile(path.join(snapshot.workspaceRoot, "Dockerfile.cloudflare-hosted-runner"), "utf8"))
      .toBe("FROM fixture-runner\n");
    expect(await readFile(path.join(snapshot.cloudflareAppDir, ".dockerignore"), "utf8"))
      .toBe("node_modules\n");
    expect(await readFile(path.join(snapshot.cloudflareAppDir, ".deploy/runner-bundle/index.js"), "utf8"))
      .toBe("runner bundle\n");
    expect(await readFile(path.join(packagesRoot, "alpha/package.json"), "utf8"))
      .toBe(await readFile(path.join(fixture.root, "packages/alpha/package.json"), "utf8"));
    await writeFixtureFile("packages/alpha/dist/index.js", "changed after snapshot");
    await writeFixtureFile("apps/cloudflare/src/index.ts", "changed after snapshot");
    expect(await readFile(path.join(packagesRoot, "alpha/dist/index.js"), "utf8"))
      .toBe('export const name = "alpha";');
    expect(await readFile(path.join(snapshot.cloudflareAppDir, "src/index.ts"), "utf8"))
      .toBe("export const worker = true;\n");
    await expect(lstat(path.join(snapshot.workspaceRoot, "stale.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(path.join(packagesRoot, "unreferenced"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("links individual installed external dependencies without aliasing Cloudflare node_modules", async () => {
    await writeWorkspacePackage("alpha", {
      zod: "1.0.0",
      "@vendor/tool": "1.0.0",
      "@murphai/published": "1.0.0",
      missing: "1.0.0",
      invalid: 42,
    });
    await writeFixtureFile("apps/cloudflare/package.json", JSON.stringify({
      dependencies: { "@murphai/alpha": "workspace:*", jose: "1.0.0" },
    }));
    for (const relativePath of [
      "node_modules/root-only/index.js",
      "packages/alpha/node_modules/zod/index.js",
      "packages/alpha/node_modules/@vendor/tool/index.js",
      "packages/alpha/node_modules/@murphai/published/index.js",
      "apps/cloudflare/node_modules/jose/index.js",
    ]) {
      await writeFixtureFile(relativePath, "external fixture");
    }

    const snapshot = await prepareSnapshot();
    const nodeModulesRoot = path.join(snapshot.cloudflareAppDir, "node_modules");
    expect((await lstat(nodeModulesRoot)).isSymbolicLink()).toBe(false);
    expect(await readlink(path.join(snapshot.workspaceRoot, "node_modules")))
      .toBe(path.join(fixture.root, "node_modules"));
    expect(await readlink(path.join(nodeModulesRoot, "jose")))
      .toBe(path.join(fixture.root, "apps/cloudflare/node_modules/jose"));
    for (const dependency of ["zod", "@vendor/tool", "@murphai/published"]) {
      expect(await readlink(path.join(nodeModulesRoot, "@murphai/alpha/node_modules", dependency)))
        .toBe(path.join(fixture.root, "packages/alpha/node_modules", dependency));
    }
    for (const dependency of ["missing", "invalid"]) {
      await expect(lstat(path.join(nodeModulesRoot, "@murphai/alpha/node_modules", dependency)))
        .rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("rejects a missing transitive workspace package before materializing packages", async () => {
    await writeWorkspacePackage("shared", { "@murphai/missing": "workspace:*" });
    await expect(prepareSnapshot()).rejects.toThrow(
      "Cloudflare depends on @murphai/missing, but no matching workspace package was found.",
    );
    expect(vi.mocked(cp).mock.calls.some(([, destination]) => String(destination).endsWith(`${path.sep}dist`)))
      .toBe(false);
  });

  it("rejects an unbuilt workspace package and leaves later packages untouched", async () => {
    await rm(path.join(fixture.root, "packages/alpha/dist"), { recursive: true });
    await expect(prepareSnapshot()).rejects.toThrow(
      "Hosted local Cloudflare snapshot requires @murphai/alpha/dist. Run the package build before starting pnpm dev.",
    );
    await expect(lstat(path.join(fixture.root, "output/cloudflare-source/apps/cloudflare/node_modules/@murphai/beta")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a non-object manifest with a repository-relative diagnostic", async () => {
    await writeFixtureFile("packages/alpha/package.json", "[]");
    await expect(prepareSnapshot()).rejects.toThrow("Invalid package.json at packages/alpha/package.json.");
  });

  it("stops an already-aborted build before copying source", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(prepareSnapshot(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(cp).not.toHaveBeenCalled();
  });

  it("checks cancellation between workspace packages", async () => {
    const controller = new AbortController();
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(cp).mockImplementation(async (source, destination, options) => {
      await actual.cp(source, destination, options);
      if (String(source) === path.join(fixture.root, "packages/alpha/dist")) {
        controller.abort();
      }
    });
    await expect(prepareSnapshot(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    const packagesRoot = path.join(fixture.root, "output/cloudflare-source/apps/cloudflare/node_modules/@murphai");
    expect(await readFile(path.join(packagesRoot, "alpha/dist/index.js"), "utf8"))
      .toBe('export const name = "alpha";');
    await expect(lstat(path.join(packagesRoot, "beta"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
