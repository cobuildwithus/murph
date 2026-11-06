import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const webDir = path.resolve(import.meta.dirname, "..");

// Next loads a route's whole static import graph on that route's first request
// in each process, and Linq traffic is sparse enough that most inbound messages
// pay it. Keep other providers' handlers and optional SDKs off that graph.
describe("Linq webhook route graph boundary", () => {
  it("keeps the Linq webhook service off the Stripe webhook and group tool modules", () => {
    const source = readSource("src/lib/hosted-onboarding/webhook-service.ts");

    expect(source).not.toContain("\"./webhook-service-stripe\"");
    expect(source).not.toContain("\"../hosted-groups/group-tool\"");
  });

  it("loads the Workflow client SDK only when a workflow is started or resumed", () => {
    const staticImporters = [...listSourceFiles("src"), ...listSourceFiles("app")]
      .filter((file) => /from "workflow\/api"/u.test(readSource(file)));

    expect(staticImporters).toEqual([]);
  });
});

function readSource(relativePath: string): string {
  return readFileSync(path.join(webDir, relativePath), "utf8");
}

function listSourceFiles(relativeDir: string): string[] {
  return readdirSync(path.join(webDir, relativeDir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/u.test(entry.name))
    .map((entry) => path.relative(webDir, path.join(entry.parentPath, entry.name)));
}
