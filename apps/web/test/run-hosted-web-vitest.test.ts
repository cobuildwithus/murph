import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildHostedWebVitestArgs,
  resolveHostedWebVitestProject,
} from "../scripts/run-hosted-web-vitest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const webTestFile = "imessage-nutrition-card-image.test.tsx";

describe("hosted Web Vitest entrypoint", () => {
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
});
