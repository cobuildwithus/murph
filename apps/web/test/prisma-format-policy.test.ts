import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const tempRoots: string[] = [];
const fullPrismaFormatOptIn = "MURPH_ALLOW_FULL_PRISMA_FORMAT";

function createSchemaFixture(): string {
  const sharedTempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
  if (!sharedTempRoot) throw new Error("MURPH_VITEST_TEMP_ROOT is required.");

  const root = mkdtempSync(path.join(sharedTempRoot, "prisma-format-policy-"));
  const schemaPath = path.join(root, "schema.prisma");
  tempRoots.push(root);
  writeFileSync(
    schemaPath,
    `datasource db {
  provider = "postgresql"
}

model Example {
  id String @id
  displayName String?
}
`,
  );
  return schemaPath;
}

function runPrisma(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = {},
) {
  return spawnSync(
    "pnpm",
    ["--dir", "apps/web", "exec", "prisma", ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        [fullPrismaFormatOptIn]: "",
        ...environment,
      },
    },
  );
}

afterEach(() => {
  while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { force: true, recursive: true });
});

describe("hosted Web Prisma format policy", () => {
  it("blocks the real Prisma formatter before it mutates the target", () => {
    const schemaPath = createSchemaFixture();
    const before = readFileSync(schemaPath, "utf8");
    const result = runPrisma(["format", "--schema", schemaPath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "Refusing to format the full hosted Web Prisma schema",
    );
    expect(readFileSync(schemaPath, "utf8")).toBe(before);
  });

  it("retains explicit full formatting and format help", () => {
    const schemaPath = createSchemaFixture();
    const before = readFileSync(schemaPath, "utf8");
    const formatResult = runPrisma(
      ["format", "--schema", schemaPath],
      { [fullPrismaFormatOptIn]: "1" },
    );
    const helpResult = runPrisma(["format", "--help"]);

    expect(formatResult.status, formatResult.stderr).toBe(0);
    expect(readFileSync(schemaPath, "utf8")).not.toBe(before);
    expect(helpResult.status, helpResult.stderr).toBe(0);
  });
});
