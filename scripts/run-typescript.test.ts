import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

type Lane = "package" | "web" | "workspace-build" | "watch";
type Env = Record<string, string | undefined>;

interface Invocation {
  args: string[];
  budget: {
    lane: Lane;
    profile: "default" | "shared";
    mode: "checkers" | "single-threaded";
    checkers: number | null;
    builders: number | null;
  };
}

interface RunnerModule {
  buildTypeScriptInvocation(lane: Lane, args: string[], env?: Env): Invocation;
  containsBuildFlag(args: string[]): boolean;
  formatTypeScriptBudget(budget: Invocation["budget"]): string;
  parseTypeScriptRunnerArgs(argv: string[]): { lane: Lane; args: string[] };
  resolveRootTypeScriptCompiler(repoRoot?: string): {
    compilerPath: string;
    version: string;
  };
}

const runner = await import(
  new URL("./run-typescript.mjs", import.meta.url).href
) as RunnerModule;
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("TypeScript runner arguments", () => {
  it("preserves TypeScript defaults outside the shared profile", () => {
    expect(runner.buildTypeScriptInvocation("package", ["-p", "tsconfig.json"]).args)
      .toEqual(["-p", "tsconfig.json"]);
    expect(runner.buildTypeScriptInvocation("web", ["-p", "apps/web/tsconfig.json"]).args)
      .toEqual(["-p", "apps/web/tsconfig.json"]);
    expect(runner.buildTypeScriptInvocation("workspace-build", ["-b", "tsconfig.json"]).args)
      .toEqual(["-b", "tsconfig.json"]);
  });

  it("adds conservative shared-host defaults per lane", () => {
    expect(
      runner.buildTypeScriptInvocation(
        "package",
        ["-p", "tsconfig.typecheck.json"],
        { MURPH_VERIFY_SHARED_HOST: "1" },
      ).args,
    ).toEqual([
      "-p",
      "tsconfig.typecheck.json",
      "--checkers",
      "1",
    ]);
    expect(
      runner.buildTypeScriptInvocation(
        "web",
        ["-p", "apps/web/tsconfig.json"],
        { MURPH_VERIFY_SHARED_HOST: "1" },
      ).args,
    ).toEqual([
      "-p",
      "apps/web/tsconfig.json",
      "--checkers",
      "2",
    ]);
    expect(
      runner.buildTypeScriptInvocation(
        "workspace-build",
        ["-b", "tsconfig.json"],
        { MURPH_VERIFY_SHARED_HOST: "1" },
      ).args,
    ).toEqual([
      "-b",
      "tsconfig.json",
      "--builders",
      "2",
      "--checkers",
      "1",
    ]);
  });

  it("automatically selects the shared profile for Codex with an explicit opt-out", () => {
    expect(
      runner.buildTypeScriptInvocation(
        "package",
        ["-p", "tsconfig.json"],
        { CODEX_THREAD_ID: "thread" },
      ).args,
    ).toEqual(["-p", "tsconfig.json", "--checkers", "1"]);
    expect(
      runner.buildTypeScriptInvocation(
        "package",
        ["-p", "tsconfig.json"],
        { CODEX_THREAD_ID: "thread", MURPH_VERIFY_SHARED_HOST: "0" },
      ).args,
    ).toEqual(["-p", "tsconfig.json"]);
    expect(
      runner.buildTypeScriptInvocation(
        "package",
        ["-p", "tsconfig.json"],
        { CI: "1", CODEX_THREAD_ID: "thread" },
      ).args,
    ).toEqual(["-p", "tsconfig.json"]);
  });

  it("keeps package builders at one for shared build-mode invocations", () => {
    expect(runner.containsBuildFlag(["-b", "tsconfig.json"])).toBe(true);
    expect(runner.containsBuildFlag(["--build", "tsconfig.json"])).toBe(true);
    expect(runner.containsBuildFlag(["-p", "tsconfig.json"])).toBe(false);

    const shortBuild = runner.buildTypeScriptInvocation(
      "package",
      ["-b", "tsconfig.json"],
      { MURPH_VERIFY_SHARED_HOST: "1" },
    );
    const longBuild = runner.buildTypeScriptInvocation(
      "package",
      ["--build", "tsconfig.json"],
      { MURPH_VERIFY_SHARED_HOST: "1" },
    );

    expect(shortBuild.args).toEqual([
      "-b",
      "tsconfig.json",
      "--checkers",
      "1",
      "--builders",
      "1",
    ]);
    expect(longBuild.budget.builders).toBe(1);
  });

  it("supports explicit lane overrides and a one-checker watch default", () => {
    expect(
      runner.buildTypeScriptInvocation("package", ["-p", "tsconfig.json"], {
        MURPH_TSC_PACKAGE_CHECKERS: "3",
      }).args,
    ).toEqual(["-p", "tsconfig.json", "--checkers", "3"]);
    expect(
      runner.buildTypeScriptInvocation("web", ["-p", "tsconfig.json"], {
        MURPH_TSC_WEB_CHECKERS: "4",
      }).args,
    ).toEqual(["-p", "tsconfig.json", "--checkers", "4"]);
    expect(
      runner.buildTypeScriptInvocation("workspace-build", ["-b"], {
        MURPH_TSC_BUILDERS: "3",
        MURPH_TSC_BUILD_CHECKERS: "2",
      }).args,
    ).toEqual(["-b", "--builders", "3", "--checkers", "2"]);
    expect(
      runner.buildTypeScriptInvocation("watch", ["-p", "tsconfig.json", "--watch"]).args,
    ).toEqual(["-p", "tsconfig.json", "--watch", "--checkers", "1"]);
    expect(
      runner.buildTypeScriptInvocation("watch", ["--watch"], {
        MURPH_TSC_WEB_WATCH_CHECKERS: "2",
      }).args,
    ).toEqual(["--watch", "--checkers", "2"]);
  });

  it("supports fully single-threaded package checks", () => {
    expect(
      runner.buildTypeScriptInvocation("package", ["-p", "tsconfig.json"], {
        MURPH_TSC_PACKAGE_MODE: "single-threaded",
      }).args,
    ).toEqual(["-p", "tsconfig.json", "--singleThreaded"]);
    expect(
      runner.buildTypeScriptInvocation("package", ["-b", "tsconfig.json"], {
        MURPH_VERIFY_SHARED_HOST: "1",
        MURPH_TSC_PACKAGE_MODE: "single-threaded",
      }).args,
    ).toEqual([
      "-b",
      "tsconfig.json",
      "--singleThreaded",
    ]);
  });

  it("rejects invalid profiles, modes, and worker counts", () => {
    expect(() => runner.buildTypeScriptInvocation("web", [], {
      MURPH_VERIFY_SHARED_HOST: "true",
    })).toThrow("must be 0 or 1");
    expect(() => runner.buildTypeScriptInvocation("package", [], {
      MURPH_TSC_PACKAGE_MODE: "parallel",
    })).toThrow("must be checkers or single-threaded");
    expect(() => runner.buildTypeScriptInvocation("package", [], {
      MURPH_TSC_PACKAGE_CHECKERS: "0",
    })).toThrow("positive integer");
    expect(() => runner.buildTypeScriptInvocation("web", [], {
      MURPH_TSC_WEB_CHECKERS: "2.5",
    })).toThrow("positive integer");
    expect(() => runner.buildTypeScriptInvocation("workspace-build", [], {
      MURPH_TSC_BUILDERS: "02",
    })).toThrow("positive integer");
    expect(() => runner.buildTypeScriptInvocation("watch", [], {
      MURPH_TSC_WEB_WATCH_CHECKERS: "",
    })).toThrow("positive integer");
    expect(() => runner.buildTypeScriptInvocation("package", [], {
      MURPH_TSC_PACKAGE_MODE: "single-threaded",
      MURPH_TSC_PACKAGE_CHECKERS: "1",
    })).toThrow("cannot be set");
  });

  it("rejects caller-provided TypeScript budget flags", () => {
    for (const args of [
      ["--checkers", "2"],
      ["--builders=2"],
      ["--singleThreaded"],
      ["--SINGLETHREADED"],
    ]) {
      expect(() => runner.buildTypeScriptInvocation("package", args))
        .toThrow("managed by run-typescript.mjs");
    }
  });

  it("parses the lane without a separator and formats one concise budget", () => {
    expect(runner.parseTypeScriptRunnerArgs([
      "web",
      "-p",
      "apps/web/tsconfig.json",
    ])).toEqual({
      lane: "web",
      args: ["-p", "apps/web/tsconfig.json"],
    });
    expect(() => runner.parseTypeScriptRunnerArgs([])).toThrow("Usage");
    expect(() => runner.parseTypeScriptRunnerArgs(["unknown"])).toThrow("Usage");
    expect(() => runner.parseTypeScriptRunnerArgs(["web", "--", "-p"])).toThrow(
      "without a leading --",
    );

    const sharedBuild = runner.buildTypeScriptInvocation(
      "workspace-build",
      ["-b"],
      { MURPH_VERIFY_SHARED_HOST: "1" },
    );
    expect(runner.formatTypeScriptBudget(sharedBuild.budget)).toBe(
      "[typescript] lane=workspace-build profile=shared mode=checkers checkers=1 builders=2",
    );
  });
});

describe("root TypeScript compiler resolution", () => {
  it("uses the root TypeScript 7 package instead of a web-local compiler", () => {
    const root = createFakeRepo({ rootVersion: "7.0.2", webVersion: "5.9.3" });

    expect(runner.resolveRootTypeScriptCompiler(root)).toEqual({
      compilerPath: path.join(
        realpathSync(root),
        "node_modules/typescript/bin/tsc",
      ),
      version: "7.0.2",
    });
  });

  it("rejects a non-TypeScript-7 root compiler", () => {
    const root = createFakeRepo({ rootVersion: "6.0.1", webVersion: "7.0.2" });

    expect(() => runner.resolveRootTypeScriptCompiler(root)).toThrow(
      "root TypeScript compiler must be version 7",
    );
  });

  it("runs the real root TypeScript 7 entrypoint", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(path.resolve(import.meta.dirname, ".."), "scripts", "run-typescript.mjs"), "package", "--version"],
      {
        encoding: "utf8",
        env: { ...process.env, MURPH_VERIFY_SHARED_HOST: "0" },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^Version 7\./mu);
    expect(result.stderr).toContain("lane=package profile=default");
  });
});

describe("TypeScript script ownership", () => {
  it("routes workspace package and app compiler scripts through the root runner", () => {
    const repoRoot = path.resolve(import.meta.dirname, "..");
    const manifestPaths = [
      path.join(repoRoot, "package.json"),
      ...["apps", "packages"].flatMap((workspaceDir) =>
        readdirSync(path.join(repoRoot, workspaceDir))
          .map((entry) => path.join(repoRoot, workspaceDir, entry, "package.json"))
          .filter((manifestPath) => {
            try {
              readFileSync(manifestPath);
              return true;
            } catch {
              return false;
            }
          }),
      ),
    ];
    const rawCompilerScripts: string[] = [];
    let routedScriptCount = 0;

    for (const manifestPath of manifestPaths) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      for (const [scriptName, command] of Object.entries(manifest.scripts ?? {})) {
        if (/(?:^|\s|&&|;)tsc\s+(?:-[bp]|--(?:build|project))\b/u.test(command)) {
          rawCompilerScripts.push(
            `${path.relative(repoRoot, manifestPath)}#${scriptName}`,
          );
        }
        if (command.includes("scripts/run-typescript.mjs")) {
          routedScriptCount += 1;
        }
      }
    }

    expect(rawCompilerScripts).toEqual([]);
    expect(routedScriptCount).toBeGreaterThan(0);
  });
});

function createFakeRepo(input: { rootVersion: string; webVersion: string }): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "murph-typescript-runner-"));
  temporaryRoots.push(root);
  writeFileSync(path.join(root, "package.json"), '{"private":true}\n', "utf8");
  writeFakeTypeScriptPackage(
    path.join(root, "node_modules/typescript"),
    input.rootVersion,
  );
  const webRoot = path.join(root, "apps/web");
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(path.join(webRoot, "package.json"), '{"private":true}\n', "utf8");
  writeFakeTypeScriptPackage(
    path.join(webRoot, "node_modules/typescript"),
    input.webVersion,
  );
  return root;
}

function writeFakeTypeScriptPackage(packageRoot: string, version: string): void {
  mkdirSync(path.join(packageRoot, "bin"), { recursive: true });
  writeFileSync(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify({ name: "typescript", version, bin: { tsc: "./bin/tsc" } })}\n`,
    "utf8",
  );
  writeFileSync(path.join(packageRoot, "bin/tsc"), "#!/usr/bin/env node\n", "utf8");
}
