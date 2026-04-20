import { readFile } from "node:fs/promises";
import path from "node:path";

import { findFiles, repoRoot } from "./scanner.mjs";

export async function verifyTypecheckScripts(failures) {
  const packageJsonPaths = await findFiles(["packages", "apps"], (filePath) =>
    path.basename(filePath) === "package.json",
  );

  for (const packageJsonPath of packageJsonPaths) {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    const typecheckScript = packageJson.scripts?.typecheck;

    if (
      typeof typecheckScript === "string" &&
      /pnpm\s+--dir\s+\.\.\/[^\s;&|]+(?:\/[^\s;&|]+)*\s+build\b/u.test(typecheckScript)
    ) {
      failures.push(
        `${path.relative(repoRoot, packageJsonPath)} typecheck script still prebuilds sibling workspace packages; keep package-local typecheck source-based and no-emit.`,
      );
    }
  }
}

export async function verifyTypecheckTsconfigs(failures) {
  const tsconfigPaths = await findFiles(["packages", "apps"], (filePath) =>
    path.basename(filePath) === "tsconfig.typecheck.json",
  );

  for (const tsconfigPath of tsconfigPaths) {
    const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf8"));

    if (tsconfig.compilerOptions?.disableSourceOfProjectReferenceRedirect === true) {
      failures.push(
        `${path.relative(repoRoot, tsconfigPath)} sets disableSourceOfProjectReferenceRedirect; package-local typecheck should resolve referenced workspace packages from source.`,
      );
    }
  }
}
