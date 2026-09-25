import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

it("assigns every repository Node test to a package script or workflow command", () => {
  const commands: string[] = Object.values(JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts);
  for (const file of readdirSync(path.join(repoRoot, ".github/workflows"))) {
    if (!/\.ya?ml$/.test(file)) continue;
    const source = readFileSync(path.join(repoRoot, ".github/workflows", file), "utf8");
    // Inspect executable run blocks, excluding comments and other YAML fields.
    for (const match of source.matchAll(/^( +)run: ([^\n]*)(\n(?:(?:\1  .*|[ \t]*)\n)*)?/gm)) {
      commands.push(match[2]?.startsWith(">")
        ? (match[3] ?? "").trim().replace(/\n\s*/g, " ")
        : `${match[2]}\n${match[3] ?? ""}`);
    }
  }
  const nodeCommands = commands
    .flatMap((command) => command.replace(/\\\r?\n\s*/g, " ").split("\n"))
    .filter((command) => /^\s*node\s+--test\b/.test(command))
    .map((command) => command.replace(/\s+#.*$/, ""));
  const unowned = readdirSync(path.join(repoRoot, "scripts"), { recursive: true })
    .filter((file): file is string => typeof file === "string" && file.endsWith(".test.mjs"))
    .map((file) => `scripts/${file.split(path.sep).join("/")}`)
    .filter((file) => !nodeCommands.some((command) => command.split(/\s+/).includes(file)
      || command.split(/\s+/).includes(`candidate/${file}`)));
  expect(unowned).toEqual([]);
});
