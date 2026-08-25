import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildHostedWebVitestArgs,
  resolveHostedWebVitestProject,
} from "../scripts/run-hosted-web-vitest.mjs";
import {
  createHostedWebVitestConfig,
  hostedWebVitestProjects,
} from "../vitest.workspace";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const webTestFile = "imessage-nutrition-card-image.test.tsx";

describe("hosted Web Vitest entrypoint", () => {
  it("generates a missing Prisma client before returning Web test projects", () => {
    const events: string[] = [];

    const config = createHostedWebVitestConfig(
      () => {
        events.push("probe");
        return false;
      },
      () => {
        events.push("generate");
      },
    );
    events.push("config-returned");

    expect(events).toEqual(["probe", "generate", "config-returned"]);
    expect(config.test.projects).toBe(hostedWebVitestProjects);
  });

  it("reuses an already resolvable Prisma client", () => {
    let generated = false;

    createHostedWebVitestConfig(
      () => true,
      () => {
        generated = true;
      },
    );

    expect(generated).toBe(false);
  });

  it.each([
    webTestFile,
    `test/${webTestFile}`,
    `apps/web/test/${webTestFile}`,
    path.join(repoRoot, "apps", "web", "test", webTestFile),
  ])("selects the owning project for exact file path %s", (fileArg) => {
    expect(resolveHostedWebVitestProject([fileArg], repoRoot)).toBe(
      "hosted-web-store-config",
    );
    expect(buildHostedWebVitestArgs([fileArg], repoRoot)).toEqual([
      "run",
      "--config",
      "apps/web/vitest.workspace.ts",
      "--no-coverage",
      "--project",
      "hosted-web-store-config",
      fileArg,
    ]);
  });

  it("leaves ambiguous filters and explicit project selection unchanged", () => {
    expect(resolveHostedWebVitestProject(["imessage-nutrition-card"], repoRoot))
      .toBeUndefined();
    expect(
      resolveHostedWebVitestProject(
        ["--project", "hosted-web-execution", webTestFile],
        repoRoot,
      ),
    ).toBeUndefined();
  });

  it.each([
    ["--exclude", webTestFile],
    ["-t", webTestFile],
  ])("does not mistake the %s option value for a positional file", (...callerArgs) => {
    expect(resolveHostedWebVitestProject(callerArgs, repoRoot)).toBeUndefined();
    expect(buildHostedWebVitestArgs(callerArgs, repoRoot)).toEqual([
      "run",
      "--config",
      "apps/web/vitest.workspace.ts",
      "--no-coverage",
      ...callerArgs,
    ]);
  });

  it("keeps a leading exact file narrow when ordinary options follow", () => {
    expect(buildHostedWebVitestArgs([webTestFile, "-t", "renders"], repoRoot))
      .toEqual([
        "run",
        "--config",
        "apps/web/vitest.workspace.ts",
        "--no-coverage",
        "--project",
        "hosted-web-store-config",
        webTestFile,
        "-t",
        "renders",
      ]);
  });

  it("removes pnpm's leading separator without dropping the exact file filter", () => {
    expect(buildHostedWebVitestArgs(["--", webTestFile], repoRoot)).toEqual([
      "run",
      "--config",
      "apps/web/vitest.workspace.ts",
      "--no-coverage",
      "--project",
      "hosted-web-store-config",
      webTestFile,
    ]);
  });

  it("forwards native shard selection without narrowing the workspace", () => {
    expect(
      buildHostedWebVitestArgs(
        ["--", "--shard=1/4", "--passWithNoTests=false"],
        repoRoot,
      ),
    ).toEqual([
      "run",
      "--config",
      "apps/web/vitest.workspace.ts",
      "--no-coverage",
      "--shard=1/4",
      "--passWithNoTests=false",
    ]);
  });
});
