import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

describe("macOS setup Node alignment", () => {
  it("derives the Homebrew formula from the repo-pinned Node requirement", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { engines?: { node?: string } };
    const pinnedNode = readFileSync(path.join(repoRoot, ".nvmrc"), "utf8").trim();
    const setupScript = readFileSync(path.join(repoRoot, "scripts/setup-macos.sh"), "utf8");
    const auditPackageScript = readFileSync(
      path.join(repoRoot, "scripts/package-audit-context-full.sh"),
      "utf8",
    );

    expect(packageJson.engines?.node).toBe(`>=${pinnedNode}`);
    expect(setupScript).toContain('node_formula="node@${required_node%%.*}"');
    expect(setupScript).toContain('brew install "$node_formula"');
    expect(setupScript).toContain('brew --prefix "$node_formula"');
    expect(setupScript).not.toContain("node@22");
    expect(auditPackageScript).toContain('$\'\\n\'".nvmrc"');
  });
});
