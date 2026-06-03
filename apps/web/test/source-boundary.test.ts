import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(appDir, "src");

describe("hosted web source boundary", () => {
  it("keeps testkit exports and imports out of app source", async () => {
    const violations: string[] = [];
    const files = await listSourceFiles(srcDir);

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const relativePath = path.relative(appDir, file);

      if (exportsForTestSymbol(source)) {
        violations.push(`${relativePath} exports a ForTest or ForTesting symbol`);
      }

      if (importsAppTestkit(source)) {
        violations.push(`${relativePath} imports app test support`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("detects the hosted-local testkit alias as app test support", () => {
    expect(importsAppTestkit("import { seedHostedActiveMember } from \"#hosted-web-testing\";"))
      .toBe(true);
    expect(importsAppTestkit("const testkit = await import(\"#hosted-web-testing\");"))
      .toBe(true);
  });

  it("detects forbidden test-only source export names", () => {
    expect(exportsForTestSymbol("export function seedHostedMemberForTest() {}")).toBe(true);
    expect(exportsForTestSymbol("export default function seedHostedMemberForTesting() {}"))
      .toBe(true);
    expect(exportsForTestSymbol("export function setCodecForTests() {}")).toBe(false);
  });
});

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(entryPath));
    } else if (/\.(?:ts|tsx)$/u.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

function exportsForTestSymbol(source: string): boolean {
  return /\bexport\s+(?:async\s+)?(?:function|class|const|let|var|interface|type)\s+\w*(?:ForTest|ForTesting)\b/u
    .test(source)
    || /\bexport\s+default\s+(?:async\s+)?function\s+\w*(?:ForTest|ForTesting)\b/u
      .test(source)
    || /\bexport\s*\{[^}]*\b\w*(?:ForTest|ForTesting)\b[^}]*\}/u.test(source);
}

function importsAppTestkit(source: string): boolean {
  return /\bfrom\s+["']#hosted-web-testing["']/u.test(source)
    || /\bfrom\s+["'][^"']*(?:^|\/|\.\.\/)test\/support(?:\/|["'])/u.test(source)
    || /\bfrom\s+["']@\/test\/support(?:\/|["'])/u.test(source)
    || /\bimport\s*\(\s*["']#hosted-web-testing["']\s*\)/u.test(source)
    || /\bimport\s*\(\s*["'][^"']*(?:^|\/|\.\.\/)test\/support(?:\/|["'])/u.test(source)
    || /\bimport\s*\(\s*["']@\/test\/support(?:\/|["'])/u.test(source);
}
