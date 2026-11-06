import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = path.resolve(import.meta.dirname, "../apps/web");

interface Diagnostic {
  code: string;
  severity: string;
}

function lint(source: string): { status: number | null; diagnostics: Diagnostic[] } {
  const directory = mkdtempSync(path.join(os.tmpdir(), "murph-web-lint-"));
  try {
    const filename = path.join(directory, "example.tsx");
    writeFileSync(filename, source);
    const result = spawnSync(process.execPath, [
      path.join(webRoot, "node_modules/oxlint/bin/oxlint"),
      "--config", path.join(webRoot, ".oxlintrc.json"),
      "--threads", "1", "--format", "json", filename,
    ], { cwd: webRoot, encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.stdout, result.stderr).toMatch(/"diagnostics"/u);
    return { status: result.status, diagnostics: JSON.parse(result.stdout).diagnostics as Diagnostic[] };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("Web Oxlint policy", () => {
  it("rejects TypeScript escapes, invalid hooks and JSX without keys", () => {
    const result = lint(`
      import { useState } from "react";
      export function Broken({ enabled }: { enabled: boolean }) {
        if (enabled) useState(0);
        const values: any[] = [];
        return values.map(value => <span>{value}</span>);
      }
    `);
    expect(result.status).toBe(1);
    const codes = result.diagnostics.map(item => item.code);
    expect(codes).toContain("typescript(no-explicit-any)");
    expect(codes).toContain("react-hooks(rules-of-hooks)");
    expect(codes).toContain("react(jsx-key)");
  });

  it("retains Next warnings, accessibility warnings and unused underscore bindings", () => {
    const result = lint(`
      export const _unusedExport = 1;
      const _unusedLocal = 2;
      export function Example() {
        return <img onClick={() => window.location.assign("/settings")} />;
      }
    `);
    expect(result.status, JSON.stringify(result.diagnostics)).toBe(0);
    const codes = result.diagnostics.map(item => item.code);
    expect(codes).toContain("next-compat(no-location-assign-relative-destination)");
    expect(codes).toContain("next(no-img-element)");
    expect(codes).toContain("jsx-a11y(alt-text)");
    expect(codes).toContain("eslint(no-unused-vars)");
    expect(result.diagnostics.every(item => item.severity === "warning")).toBe(true);
  });

  it("runs retained React plugin rules", () => {
    const result = lint(`
      import React from "react";
      export class Broken extends React.Component {
        render() { const text = "missing return"; console.log(text); }
      }
      export function Impure() { return <span>{Date.now()}</span>; }
    `);
    expect(result.status).toBe(1);
    const codes = result.diagnostics.map(item => item.code);
    expect(codes).toContain("react-compat(require-render-return)");
    expect(codes).toContain("hooks-compat(purity)");
  });

  it("honors existing Next suppressions and accepts async server components", () => {
    const result = lint(`
      /* eslint-disable @next/next/no-img-element */
      export default async function ServerPage() {
        const source = await Promise.resolve("example.png");
        return <img alt="example" src={source} />;
      }
    `);
    expect(result.status, JSON.stringify(result.diagnostics)).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });
});
